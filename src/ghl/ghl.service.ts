import { Injectable, HttpException, HttpStatus, BadRequestException, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance, AxiosError } from "axios";
import {
	BaseAdapter,
	GreenApiWebhook,
	WebhookType,
	IntegrationError,
	NotFoundError,
	Settings, StateInstanceWebhook,
	WaSettings, SendResponse, SendInteractiveButtonsReply, formatPhoneNumber,
	MessageWebhook, OutgoingMessageStatus, OutgoingMessageStatusWebhook,
} from "@green-api/greenapi-integration";
import { GhlTransformer } from "./ghl.transformer";
import { PrismaService } from "../prisma/prisma.service";
import { GhlWebhookDto } from "./dto/ghl-webhook.dto";
import type { Instance, User } from "@prisma/client";
import { randomBytes } from "crypto";
import {
	GhlContact,
	GhlContactUpsertRequest,
	GhlContactUpsertResponse,
	GhlPlatformMessage,
	isMessageWebhook,
	isOutgoingMessageWebhook,
	MessageStatusPayload, WorkflowActionData, WorkflowActionResult,
} from "../types";
import { SendInteractiveButtons } from "@green-api/greenapi-integration/dist/types/types";

/**
 * Webhook notification types the integration relies on. Every GREEN-API instance managed by the
 * app must have all of them enabled, otherwise messages sent from the phone or from another API
 * consumer never reach the GHL conversation.
 *
 * - `outgoingWebhook` – statuses of sent messages (sent/delivered/read/failed)
 * - `outgoingMessageWebhook` – messages sent from the phone itself
 * - `outgoingAPIMessageWebhook` – messages sent through the API (by us or any other integration)
 */
export const REQUIRED_WEBHOOK_SETTINGS = {
	incomingWebhook: "yes",
	incomingCallWebhook: "yes",
	stateWebhook: "yes",
	outgoingWebhook: "yes",
	outgoingMessageWebhook: "yes",
	outgoingAPIMessageWebhook: "yes",
} as const satisfies Settings;

/**
 * GHL only accepts pending/delivered/read/failed. GREEN-API statuses are mapped onto them and
 * ranked so a late-arriving earlier status cannot roll a message back in the GHL UI.
 */
const GHL_STATUS_RANK: Record<"delivered" | "read", number> = {delivered: 1, read: 2};

interface TrackedOutboundMessage {
	locationId: string;
	ghlMessageId?: string;
	statusRank: number;
	failed: boolean;
	expiresAt: number;
}

@Injectable()
export class GhlService extends BaseAdapter<
	GhlWebhookDto,
	GhlPlatformMessage,
	User,
	Instance
> implements OnModuleInit {
	private readonly ghlApiBaseUrl = "https://services.leadconnectorhq.com";
	private readonly ghlApiVersion = "2021-07-28";
	private readonly selfPostedMessageTtlMs = 10 * 60 * 1000;
	private readonly selfPostedMessageIds = new Map<string, number>();
	private readonly outboundMessageTtlMs = 24 * 60 * 60 * 1000;
	private readonly outboundMessages = new Map<string, TrackedOutboundMessage>();
	/**
	 * Messages the integration sends itself come back as `outgoingAPIMessageReceived`. They are
	 * registered as soon as GREEN-API answers the send request, but the notification can overtake
	 * that bookkeeping, so echoes are inspected with a small delay.
	 */
	private readonly outgoingApiEchoDelayMs: number;

	public wasRecentlyPostedByUs(messageId: string): boolean {
		if (!messageId) return false;
		this.pruneSelfPostedMessageIds();
		return this.selfPostedMessageIds.has(messageId);
	}

	private markSelfPosted(messageId: string): void {
		if (!messageId) return;
		this.selfPostedMessageIds.set(messageId, Date.now() + this.selfPostedMessageTtlMs);
	}

	private pruneSelfPostedMessageIds(): void {
		const now = Date.now();
		for (const [id, expiresAt] of this.selfPostedMessageIds) {
			if (expiresAt <= now) this.selfPostedMessageIds.delete(id);
		}
	}

	async onModuleInit(): Promise<void> {
		// Instances created before outgoing notifications were supported still have them disabled
		// on the GREEN-API side, so bring every stored instance up to date. Runs detached: a
		// GREEN-API outage must not prevent the app from starting.
			void this.syncInstancesWebhookSettings().catch(error => {
			this.gaLogger.error(`Webhook settings sync failed: ${error.message}`, error.stack);
		});
	}

	/**
	 * Makes sure every stored instance has all notification types the integration needs enabled.
	 * `setSettings` reboots the instance, so it is only called when something actually differs.
	 */
	public async syncInstancesWebhookSettings(): Promise<void> {
		const instances = await this.prisma.getAllInstances();
		this.gaLogger.info(`Checking webhook settings of ${instances.length} instance(s)`);

		let updated = 0;
		for (const instance of instances) {
			try {
				const client = this.createGreenApiClient(instance);
				const remoteSettings = await client.getSettings();
				const missing = Object.entries(REQUIRED_WEBHOOK_SETTINGS)
					.filter(([key, value]) => remoteSettings[key as keyof Settings] !== value);

				if (missing.length === 0) continue;

				this.gaLogger.info(`Enabling missing notifications on instance ${instance.idInstance}`, {
					missing: missing.map(([key]) => key),
				});
				await client.setSettings({...REQUIRED_WEBHOOK_SETTINGS});
				await this.prisma.updateInstanceSettings(instance.idInstance, {
					...(instance.settings || {}),
					...REQUIRED_WEBHOOK_SETTINGS,
				});
				updated++;
			} catch (error) {
				this.gaLogger.warn(
					`Could not sync webhook settings for instance ${instance.idInstance}: ${error.message}`,
				);
			}
		}
		this.gaLogger.info(`Webhook settings sync finished. Instances updated: ${updated}`);
	}

	/**
	 * Remembers that a GREEN-API message already has a counterpart in a GHL conversation, so its
	 * `outgoing*MessageReceived` echo is not posted twice and its status updates can be routed to
	 * the right GHL message.
	 */
	private trackOutboundMessage(
		idMessage: string | undefined,
		locationId: string,
		ghlMessageId?: string,
		appliedStatus?: keyof typeof GHL_STATUS_RANK,
	): void {
		if (!idMessage) return;
		this.pruneOutboundMessages();
		const existing = this.outboundMessages.get(idMessage);
		const statusRank = appliedStatus !== undefined ? GHL_STATUS_RANK[appliedStatus] : existing?.statusRank ?? -1;
		this.outboundMessages.set(idMessage, {
			locationId,
			ghlMessageId: ghlMessageId ?? existing?.ghlMessageId,
			statusRank,
			failed: existing?.failed ?? false,
			expiresAt: Date.now() + this.outboundMessageTtlMs,
		});
	}

	/** Releases a reservation so a later notification for the same message can still reach GHL. */
	private forgetOutboundMessage(idMessage: string | undefined): void {
		if (idMessage) this.outboundMessages.delete(idMessage);
	}

	private isOutboundMessageTracked(idMessage: string | undefined): boolean {
		if (!idMessage) return false;
		this.pruneOutboundMessages();
		return this.outboundMessages.has(idMessage);
	}

	private pruneOutboundMessages(): void {
		const now = Date.now();
		for (const [id, tracked] of this.outboundMessages) {
			if (tracked.expiresAt <= now) this.outboundMessages.delete(id);
		}
	}

	constructor(
		protected readonly ghlTransformer: GhlTransformer,
		protected readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {
		super(ghlTransformer, prisma);
		const configuredDelay = Number(this.configService.get<string>("OUTGOING_API_ECHO_DELAY_MS"));
		this.outgoingApiEchoDelayMs = Number.isFinite(configuredDelay) && configuredDelay >= 0 ? configuredDelay : 3000;
	}

	private async getHttpClient(ghlUserId: string): Promise<AxiosInstance> {
		const userWithTokens = await this.prisma.getUserWithTokens(ghlUserId);
		if (!userWithTokens || !userWithTokens.accessToken || !userWithTokens.refreshToken) {
			this.gaLogger.error(`No tokens found for GHL User (Location ID): ${ghlUserId}`);
			throw new HttpException(`GHL auth tokens not found for User ${ghlUserId}. Re-authorize.`, HttpStatus.UNAUTHORIZED);
		}

		let currentAccessToken = userWithTokens.accessToken;

		if (userWithTokens.tokenExpiresAt && new Date(userWithTokens.tokenExpiresAt).getTime() < Date.now() + 5 * 60 * 1000) {
			this.gaLogger.log(`GHL Access token for User ${ghlUserId} expiring. Refreshing...`);
			try {
				const newTokens = await this.refreshGhlAccessToken(userWithTokens.refreshToken);
				await this.prisma.updateUserTokens(
					ghlUserId, newTokens.access_token, newTokens.refresh_token,
					new Date(Date.now() + newTokens.expires_in * 1000),
				);
				currentAccessToken = newTokens.access_token;
				this.gaLogger.log(`GHL Access token refreshed for User ${ghlUserId}`);
			} catch (error) {
				this.gaLogger.error(`Failed to refresh GHL access token for User ${ghlUserId}: ${error.message}`);
				throw new HttpException(`Failed to refresh GHL token for User ${ghlUserId}. Re-authorize.`, HttpStatus.UNAUTHORIZED);
			}
		}

		const httpClient = axios.create({
			baseURL: this.ghlApiBaseUrl,
			headers: {
				Authorization: `Bearer ${currentAccessToken}`,
				Version: this.ghlApiVersion,
				"Content-Type": "application/json",
			},
		});

		httpClient.interceptors.response.use((response) => response, async (error: AxiosError) => {
			const originalRequest = error.config;
			const userForRetry = await this.prisma.getUserWithTokens(ghlUserId);
			if (!userForRetry?.refreshToken) {
				this.gaLogger.error(`User ${ghlUserId} or refresh token disappeared during retry logic.`);
				throw error;
			}

			if (error.response?.status === 401 && originalRequest && !originalRequest.headers["_retry"]) {
				originalRequest.headers["_retry"] = true;
				this.gaLogger.warn(`GHL API request 401 for User ${ghlUserId}. Retrying with token refresh.`);
				try {
					const newTokens = await this.refreshGhlAccessToken(userForRetry.refreshToken);
					await this.prisma.updateUserTokens(
						ghlUserId, newTokens.access_token, newTokens.refresh_token,
						new Date(Date.now() + newTokens.expires_in * 1000),
					);
					this.gaLogger.log(`GHL Token refreshed after 401 for User ${ghlUserId}`);
					originalRequest.headers["Authorization"] = `Bearer ${newTokens.access_token}`;
					return httpClient(originalRequest);
				} catch (refreshError) {
					this.gaLogger.error(`Failed to refresh GHL token after 401 for User ${ghlUserId}: ${refreshError.message}`);
					throw new HttpException(`GHL token refresh failed for User ${ghlUserId} after 401. Re-authorize.`, HttpStatus.UNAUTHORIZED);
				}
			}
			const status = error.response?.status;
			const data = error.response?.data;
			this.gaLogger.error(`GHL API Error: [${originalRequest?.method?.toUpperCase()} ${originalRequest?.url}] ${status} – ${JSON.stringify(data)}`);
			throw new HttpException((data as any)?.message || "GHL API request failed", status || HttpStatus.INTERNAL_SERVER_ERROR);
		});
		return httpClient;
	}

	private async refreshGhlAccessToken(refreshToken: string): Promise<{
		access_token: string; refresh_token: string; expires_in: number;
		token_type: string; scope: string; userType: string; companyId: string;
	}> {
		const body = new URLSearchParams({
			client_id: this.configService.get<string>("GHL_CLIENT_ID")!,
			client_secret: this.configService.get<string>("GHL_CLIENT_SECRET")!,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			user_type: "Location",
		});
		try {
			const response = await axios.post(`${this.ghlApiBaseUrl}/oauth/token`, body.toString(),
				{headers: {"Content-Type": "application/x-www-form-urlencoded"}});
			return response.data;
		} catch (error) {
			this.gaLogger.error(`GHL Token Refresh Error: ${error.response?.status} ${JSON.stringify(error.response?.data)}`);
			throw new Error(`Failed to refresh GHL token: ${error.response?.data?.message || error.message}`);
		}
	}

	public async getGhlContact(
		ghlUserId: string,
		phone: string,
	): Promise<GhlContact | null> {
		const httpClient = await this.getHttpClient(ghlUserId);
		const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;

		try {
			const {data}: { data: GhlContactUpsertResponse } = await httpClient.post("/contacts/upsert", {
				locationId: ghlUserId,
				phone: formattedPhone,
			});

			if (data && data.contact) {
				return data.contact;
			}
			return null;
		} catch (error) {
			this.gaLogger.error(`Error getting GHL contact by phone ${formattedPhone} in Location ${ghlUserId}: ${error.message}`, error.response?.data);
			throw error;
		}
	}

	private async findOrCreateGhlContact(
		ghlUserId: string,
		phone: string,
		name?: string,
		instanceId?: string,
		isGroup?: boolean,
	): Promise<{ id: string; [key: string]: any }> {
		const httpClient = await this.getHttpClient(ghlUserId);

		let contactName: string;
		let tags = [`whatsapp-instance-${instanceId}`];
		const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;

		if (isGroup) {
			contactName = `[Group] ${name || "Unknown Group"}`;
			tags.push("whatsapp-group");
		} else {
			contactName = name || `WhatsApp ${phone}`;
		}

		const upsertPayload: GhlContactUpsertRequest = {
			locationId: ghlUserId,
			phone: formattedPhone,
			name: contactName,
			source: "GREEN-API",
			tags: instanceId ? tags : undefined,
		};

		this.gaLogger.info(`Upserting GHL contact for ${isGroup ? "group" : "phone"} ${formattedPhone} in Location ${ghlUserId} with payload:`, upsertPayload);

		try {
			const {data} = await httpClient.post("/contacts/upsert", upsertPayload);

			if (data && data.contact && data.contact.id) {
				this.gaLogger.log(`Successfully upserted GHL contact. ID: ${data.contact.id} for ${isGroup ? "group" : "phone"} ${formattedPhone} in Location ${ghlUserId}`);
				return data.contact;
			} else {
				this.gaLogger.error("Failed to upsert contact or get ID from response. Response data:", data);
				throw new Error("Could not get ID from GHL contact upsert response.");
			}
		} catch (error) {
			this.gaLogger.error(`Error during GHL contact upsert for ${isGroup ? "group" : "phone"} ${phone} in Location ${ghlUserId}: ${error.message}`, error.response?.data);
			throw error;
		}
	}

	public async updateGhlMessageStatus(
		ghlLocationId: string,
		ghlMessageId: string,
		status: "delivered" | "read" | "failed" | "pending",
		errorDetails?: { code: string; type: string; message: string },
	): Promise<void> {
		this.gaLogger.log(`Attempting to update GHL message ${ghlMessageId} to status ${status} for location ${ghlLocationId}`);

		try {
			const httpClient = await this.getHttpClient(ghlLocationId);
			const apiUrl = `/conversations/messages/${ghlMessageId}/status`;

			const payload: MessageStatusPayload = {status};

			if (status === "failed") {
				payload.error = errorDetails || {
					code: "1",
					type: "delivery_failed",
					message: "Message delivery failed",
				};
			}

			await httpClient.put(apiUrl, payload);
			this.gaLogger.log(`Successfully updated GHL message ${ghlMessageId} to status ${status} for location ${ghlLocationId}`);
		} catch (error) {
			this.gaLogger.error(
				`Failed to update GHL message status for message ${ghlMessageId} in location ${ghlLocationId} to ${status}: ${error.message}`,
				error.response?.data,
			);
			if (error instanceof HttpException) {
				throw error;
			}
			throw new IntegrationError(
				`GHL API call to update message status failed for message ${ghlMessageId}`,
				"GHL_API_ERROR",
				error.response?.status || 500,
				error.response?.data,
			);
		}
	}

	public async postOutboundMessageToGhl(
		locationId: string,
		contactId: string,
		messageContent: string,
		attachments?: string[],
	): Promise<string | undefined> {
		const httpClient = await this.createPlatformClient(locationId);
		const payload: any = {
			type: "Custom",
			contactId,
			message: messageContent,
			conversationProviderId: this.configService.get<string>("GHL_CONVERSATION_PROVIDER_ID")!,
		};

		this.gaLogger.info(`Posting outbound message to GHL for contact ${contactId}`, payload);

		if (attachments && attachments.length > 0) {
			payload.attachments = attachments;
		}

		try {
			const {data: msgRes} = await httpClient.post("/conversations/messages", payload);
			this.gaLogger.info(`Successfully posted outbound message to GHL for contact ${contactId}`, msgRes);

			const messageId = msgRes.messageId;
			this.markSelfPosted(messageId);

			setTimeout(async () => {
				try {
					await this.updateGhlMessageStatus(locationId, messageId, "delivered");
					this.gaLogger.info(`Updated GHL message status to delivered`, {messageId});
				} catch (statusError) {
					this.gaLogger.warn(`Failed to update GHL message status, but message was posted successfully`, {
						messageId,
						error: statusError.message,
					});
				}
			}, 5000);

			return messageId;
		} catch (error) {
			this.gaLogger.error(`Error posting outbound GHL message for contact ${contactId}`, error);
			throw error;
		}
	}

	private async getOrCreateGhlConversation(
		httpClient: AxiosInstance,
		ghlUserId: string,
		contactId: string,
	): Promise<string> {
		try {
			const {data: search} = await httpClient.get("/conversations/search", {
				params: {
					locationId: ghlUserId,
					contactId,
					limit: 1,
				},
			});
			if (search.conversations?.length > 0) {
				const conversationId = search.conversations[0].id;
				this.gaLogger.log(`Found existing GHL conversation ${conversationId} for contact ${contactId} in Location ${ghlUserId}`);
				return conversationId;
			}

			this.gaLogger.log(`No existing GHL conversation for contact ${contactId} in Location ${ghlUserId}. Creating new one.`);
			const {data: create} = await httpClient.post("/conversations/", {
				locationId: ghlUserId,
				contactId,
			});
			const conversationId = create.conversation?.id ?? create.id;
			if (!conversationId) {
				this.gaLogger.error("Failed to get conversationId from create conversation response", create);
				throw new Error("Failed to create or retrieve conversation ID.");
			}
			this.gaLogger.log(`Created new GHL conversation ${conversationId} for contact ${contactId} in Location ${ghlUserId}`);
			return conversationId;
		} catch (error) {
			this.gaLogger.error(`Error during get/create GHL conversation for contact ${contactId} in Location ${ghlUserId}: ${error.message}`, error.response?.data);
			throw error;
		}
	}

	/**
	 * Adds a message to a GHL conversation without asking GHL to deliver it.
	 *
	 * `direction: "outbound"` is what makes messages that were already sent over WhatsApp
	 * (from the phone or by another API consumer) show up on the right-hand side of the GHL
	 * conversation instead of being sent a second time.
	 */
	private async postMessageToGhlConversation(
		ghlUserId: string,
		contactId: string,
		messageContent: string,
		attachments: GhlPlatformMessage["attachments"],
		direction: "inbound" | "outbound",
	): Promise<{ conversationId: string; messageId?: string }> {
		const httpClient = await this.getHttpClient(ghlUserId);
		const conversationId = await this.getOrCreateGhlConversation(httpClient, ghlUserId, contactId);

		const payload: any = {
			type: "Custom",
			conversationId,
			message: messageContent,
			direction,
			conversationProviderId: this.configService.get<string>("GHL_CONVERSATION_PROVIDER_ID"),
		};

		if (attachments && attachments.length > 0) {
			payload.attachments = attachments.map(att => att.url);
			this.gaLogger.warn(`Sending attachments to GHL for custom ${direction} message. Payload (array of URLs):`, payload.attachments);
		}

		this.gaLogger.log(`Attempting to post ${direction} message to GHL for convo ${conversationId}. Payload:`, payload);
		try {
			const {data: msgRes} = await httpClient.post(
				`/conversations/messages/inbound`,
				payload,
			);
			this.gaLogger.log(`Successfully posted ${direction} message to GHL conversation ${conversationId}. Response:`, msgRes);
			return {conversationId, messageId: msgRes?.messageId};
		} catch (error) {
			this.gaLogger.error(`Error posting ${direction} GHL message to convo ${conversationId}: ${error.message}. Payload sent:`, payload);
			this.gaLogger.error("Error data:", error.response?.data);
			throw error;
		}
	}

	public async createPlatformClient(ghlUserId: string): Promise<AxiosInstance> {
		this.gaLogger.log(`Creating platform client (AxiosInstance) for GHL User (Location): ${ghlUserId}.`);
		return this.getHttpClient(ghlUserId);
	}

	public async sendToPlatform(
		ghlMessageDto: GhlPlatformMessage,
		instance: Instance & { user: User },
	): Promise<void> {
		this.gaLogger.log(`Sending message to GHL for instance ${instance.idInstance} linked to User (Loc) ${instance.userId}`);
		this.gaLogger.debug(`GHL DTO: ${JSON.stringify(ghlMessageDto)}`);

		if (!instance.userId) throw new IntegrationError("Instance not linked to User (GHL Location).", "CONFIGURATION_ERROR");
		if (!ghlMessageDto.contactId) throw new IntegrationError("GHL Contact ID missing.", "DATA_ERROR");

		ghlMessageDto.locationId = instance.userId;

		try {
			const {messageId} = await this.postMessageToGhlConversation(
				instance.userId,
				ghlMessageDto.contactId,
				ghlMessageDto.message,
				ghlMessageDto.attachments,
				ghlMessageDto.direction,
			);

			if (ghlMessageDto.direction === "outbound") {
				// GHL may echo the freshly added message back through the conversation provider
				// webhook; skipping it there prevents the message from being sent to WhatsApp again.
				if (messageId) this.markSelfPosted(messageId);
				this.trackOutboundMessage(ghlMessageDto.greenApiMessageId, instance.userId, messageId);
			}
			this.gaLogger.log(`${ghlMessageDto.direction} message sent to GHL for contact ${ghlMessageDto.contactId} in User (Loc) ${instance.userId}.`);
		} catch (error) {
			this.gaLogger.error(`Failed to send message to GHL: ${error.message}`, error.stack);
			throw error;
		}
	}

	public async handlePlatformWebhook(
		ghlWebhook: GhlWebhookDto,
		idInstance: number | bigint,
	): Promise<SendResponse> {
		const locationId = ghlWebhook.locationId;
		const messageId = ghlWebhook.messageId;

		let gaResponse: SendResponse;
		this.gaLogger.log(`Handling GHL webhook for Green API Instance ID: ${idInstance}`);
		this.gaLogger.debug(`GHL Webhook DTO: ${JSON.stringify(ghlWebhook)}`);

		const instance = await this.prisma.getInstance(BigInt(idInstance));
		if (!instance) throw new NotFoundError(`Instance ${idInstance} not found.`);
		if (!instance.user) throw new IntegrationError("Instance not linked to User.", "DATA_ERROR");
		if (instance.stateInstance !== "authorized") throw new IntegrationError("Instance is not authorized", "INSTANCE_NOT_AUTHORIZED");

		const greenApiClient = this.createGreenApiClient(instance);
		const transformedMessage = this.ghlTransformer.toGreenApiMessage(ghlWebhook);

		this.gaLogger.log(`Transformed GHL message to Green API format for instance ${idInstance}`);
		this.gaLogger.debug(`Green API Message: ${JSON.stringify(transformedMessage)}`);

		switch (transformedMessage.type) {
			case "text":
				gaResponse = await greenApiClient.sendMessage(transformedMessage);
				break;
			case "url-file":
				gaResponse = await greenApiClient.sendFileByUrl(transformedMessage);
				break;
			default:
				this.gaLogger.error(`Unsupported Green API message type from GHL transform: ${transformedMessage.type}`);
				throw new IntegrationError(`Invalid Green API message type: ${transformedMessage.type}`, "INVALID_MESSAGE_TYPE", 500);
		}
		// The message is already in the GHL conversation (GHL itself put it there), so its
		// outgoingAPIMessageReceived echo must not be posted again; status notifications for it
		// are routed to this GHL message.
		this.trackOutboundMessage(gaResponse.idMessage, locationId, messageId, "delivered");
		await this.updateGhlMessageStatus(locationId, messageId, "delivered");
		return gaResponse;
	}

	public async handleGreenApiWebhook(
		webhook: GreenApiWebhook,
		allowedTypes: WebhookType[],
	): Promise<void> {
		const idInstance = BigInt(webhook.instanceData.idInstance);
		const webhookType: WebhookType = webhook.typeWebhook;
		this.gaLogger.info(`Handling Green API webhook type: ${webhookType} for Instance: ${idInstance}`, webhook);
		if (!allowedTypes.includes(webhook.typeWebhook)) {
			this.gaLogger.warn(`Skipping Green API webhook: type ${webhook.typeWebhook} not in allowed: ${allowedTypes.join(", ")}`);
			return;
		}

		const instance = await this.prisma.getInstance(idInstance);
		if (!instance) throw new NotFoundError(`Instance ${idInstance} not found.`);
		if (!instance.user || !instance.userId) {
			throw new IntegrationError("Instance not linked to User (GHL Location).", "CONFIGURATION_ERROR", 500, {idInstance: idInstance});
		}
		const instanceWithUser = instance as Instance & { user: User };

		try {
			if (webhook.typeWebhook === "stateInstanceChanged") {
				await this.handleStateInstanceWebhook(webhook);
			} else if (isMessageWebhook(webhook)) {
				await this.handleMessageWebhook(webhook, instanceWithUser);
			} else if (webhook.typeWebhook === "outgoingMessageStatus") {
				await this.handleOutgoingMessageStatus(webhook);
			} else if (webhook.typeWebhook === "incomingCall") {
				const callerPhoneRaw = webhook.from;
				const normalizedPhone = callerPhoneRaw.split("@")[0];
				const callerName = `WhatsApp ${normalizedPhone}`;

				const ghlContact = await this.findOrCreateGhlContact(
					instanceWithUser.userId,
					normalizedPhone,
					callerName,
					webhook.instanceData.idInstance.toString(),
				);
				if (!ghlContact.id) throw new IntegrationError("Failed to resolve GHL contact for call.", "GHL_API_ERROR");

				const transformedCallMsg = this.ghlTransformer.toPlatformMessage(webhook);
				transformedCallMsg.contactId = ghlContact.id;
				transformedCallMsg.locationId = instanceWithUser.userId;

				await this.sendToPlatform(transformedCallMsg, instanceWithUser);
			} else {
				this.gaLogger.warn(`Unhandled allowed Green API webhook type: ${webhookType}`);
			}
		} catch (error) {
			this.gaLogger.error(`Error in handleGreenApiWebhook for instance ${idInstance}, type ${webhookType}: ${error.message}`, error.stack);
			throw new IntegrationError("Failed to handle Green API webhook", "GA_WEBHOOK_ERROR", 500);
		}
	}

	/**
	 * Handles every notification that carries a WhatsApp message: incoming ones, messages sent
	 * from the phone (`outgoingMessageReceived`) and messages sent through the API by us or by
	 * another integration (`outgoingAPIMessageReceived`). Outgoing ones are added to the GHL
	 * conversation as outbound messages so they are visible in the GHL interface.
	 */
	private async handleMessageWebhook(
		webhook: MessageWebhook,
		instanceWithUser: Instance & { user: User },
	): Promise<void> {
		const isOutgoing = isOutgoingMessageWebhook(webhook);
		const chatId = webhook.senderData?.chatId;

		if (!chatId) {
			this.gaLogger.warn(`Skipping ${webhook.typeWebhook} without chatId`, webhook.senderData);
			return;
		}
		// Broadcasts, statuses and channels (status@broadcast, *@newsletter, ...) have no GHL counterpart.
		if (!/@[cg]\.us$/.test(chatId)) {
			this.gaLogger.info(`Skipping ${webhook.typeWebhook} for non-chat recipient ${chatId}`);
			return;
		}

		if (isOutgoing) {
			if (webhook.typeWebhook === "outgoingAPIMessageReceived" && this.outgoingApiEchoDelayMs > 0) {
				await this.delay(this.outgoingApiEchoDelayMs);
			}
			if (this.isOutboundMessageTracked(webhook.idMessage)) {
				this.gaLogger.info(
					`Skipping ${webhook.typeWebhook} ${webhook.idMessage}: already present in GHL conversation`,
				);
				return;
			}
			// Reserve the id before any awaits so a duplicated notification cannot post it twice.
			this.trackOutboundMessage(webhook.idMessage, instanceWithUser.userId);
		}

		const isGroup = chatId.endsWith("@g.us");
		const contactIdentifier = chatId.replace(/@[cg]\.us$/, "");
		let contactName: string;
		let logContext: string;

		if (isGroup) {
			contactName = webhook.senderData.chatName || "Unknown Group";
			logContext = `group "${contactName}" (${contactIdentifier})`;
		} else if (isOutgoing) {
			// For outgoing notifications senderData describes the instance itself,
			// the chat partner is in chatName.
			contactName = webhook.senderData.chatName || `WhatsApp ${contactIdentifier}`;
			logContext = `individual ${contactName} (${contactIdentifier})`;
		} else {
			contactName = webhook.senderData.senderName || webhook.senderData.senderContactName || `WhatsApp ${contactIdentifier}`;
			logContext = `individual ${contactName} (${contactIdentifier})`;
		}

		this.gaLogger.log(
			isOutgoing
				? `Processing outgoing message (${webhook.typeWebhook}) to ${logContext}`
				: `Processing message from ${logContext}${isGroup ? ` sent by ${webhook.senderData.senderName || "Unknown"}` : ""}`,
		);

		try {
			const ghlContact = await this.findOrCreateGhlContact(
				instanceWithUser.userId,
				contactIdentifier,
				contactName,
				webhook.instanceData.idInstance.toString(),
				isGroup,
			);
			if (!ghlContact?.id) throw new IntegrationError("Failed to resolve GHL contact.", "GHL_API_ERROR");

			const transformedMsg = this.ghlTransformer.toPlatformMessage(webhook);
			transformedMsg.contactId = ghlContact.id;
			transformedMsg.locationId = instanceWithUser.userId;

			await this.sendToPlatform(transformedMsg, instanceWithUser);
		} catch (error) {
			// Nothing reached the GHL conversation, so the reservation has to go: otherwise a repeated
			// notification for this message would be dismissed as a duplicate that was never posted.
			if (isOutgoing) this.forgetOutboundMessage(webhook.idMessage);
			throw error;
		}
	}

	/**
	 * Mirrors WhatsApp delivery statuses onto the corresponding GHL message so the GHL interface
	 * shows whether an outgoing message was delivered, read or failed.
	 */
	private async handleOutgoingMessageStatus(webhook: OutgoingMessageStatusWebhook): Promise<void> {
		this.pruneOutboundMessages();
		const tracked = this.outboundMessages.get(webhook.idMessage);

		if (!tracked?.ghlMessageId) {
			this.gaLogger.debug(
				`No GHL message known for GREEN-API message ${webhook.idMessage}, ignoring status "${webhook.status}"`,
			);
			return;
		}

		const ghlStatus = this.mapGreenApiStatusToGhl(webhook.status);
		if (!ghlStatus) {
			this.gaLogger.debug(`Status "${webhook.status}" has no GHL counterpart, ignoring`);
			return;
		}

		if (ghlStatus === "failed") {
			if (tracked.failed) return;
		} else if (tracked.failed || GHL_STATUS_RANK[ghlStatus] <= tracked.statusRank) {
			this.gaLogger.debug(
				`Ignoring status "${webhook.status}" for GHL message ${tracked.ghlMessageId}: not newer than the applied one`,
			);
			return;
		}

		try {
			await this.updateGhlMessageStatus(
				tracked.locationId,
				tracked.ghlMessageId,
				ghlStatus,
				ghlStatus === "failed"
					? {
						code: webhook.status,
						type: "delivery_failed",
						message: webhook.description || `WhatsApp reported status "${webhook.status}"`,
					}
					: undefined,
			);
			if (ghlStatus === "failed") {
				tracked.failed = true;
			} else {
				tracked.statusRank = GHL_STATUS_RANK[ghlStatus];
			}
		} catch (error) {
			this.gaLogger.warn(
				`Could not apply status "${webhook.status}" to GHL message ${tracked.ghlMessageId}: ${error.message}`,
			);
		}
	}

	private mapGreenApiStatusToGhl(status: OutgoingMessageStatus): "delivered" | "read" | "failed" | null {
		switch (status) {
			case "delivered":
				return "delivered";
			case "read":
				return "read";
			// "sent" is deliberately dropped: GHL's only equivalent is "pending", which would show
			// an already sent message as still being in progress.
			case "sent":
				return null;
			// failed, noAccount, notInGroup, yellowCard
			default:
				return "failed";
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	public async handleStateInstanceWebhook(webhook: StateInstanceWebhook): Promise<void> {
		const idInstance = BigInt(webhook.instanceData.idInstance);
		this.gaLogger.log(`StateInstanceWebhook for instance ${idInstance}. New state: ${webhook.stateInstance}`);
		try {
			const dbInstance = await this.prisma.updateInstanceState(idInstance, webhook.stateInstance);
			const currentSettings = dbInstance.settings || {};
			if (webhook.instanceData.wid && webhook.instanceData.wid !== currentSettings.wid) {
				await this.prisma.updateInstanceSettings(idInstance, {
					...currentSettings,
					wid: webhook.instanceData.wid,
				});
				this.gaLogger.log(`Instance ${idInstance} WID updated to ${webhook.instanceData.wid}.`);
			}
			this.gaLogger.log(`Instance ${idInstance} state updated to ${webhook.stateInstance}.`);
		} catch (error) {
			this.gaLogger.error(`Failed to update instance state for ${idInstance}: ${error.message}`, error.stack);
			throw error;
		}
	}

	public async createGreenApiInstanceForUser(
		ghlUserId: string,
		idInstance: number | bigint,
		apiTokenInstance: string,
		name?: string,
	): Promise<Instance> {
		this.gaLogger.log(`Creating Green API instance ${idInstance} for User (GHL Location) ${ghlUserId}`);

		const ghlUser = await this.prisma.findUser(ghlUserId);
		if (!ghlUser) throw new NotFoundError(`User (GHL Location) ${ghlUserId} not found.`);

		const greenApiClient = this.createGreenApiClient({idInstance: BigInt(idInstance), apiTokenInstance});
		let waSettings: WaSettings;
		try {
			waSettings = await greenApiClient.getWaSettings();
		} catch (error) {
			this.gaLogger.warn(`Failed to get WA settings for new instance ${idInstance}: ${error.message}.`);
			throw new IntegrationError("Invalid instance credentials", "INVALID_CREDENTIALS", 400);
		}

		const appBaseUrl = this.configService.get<string>("APP_URL");
		const webhookToken = randomBytes(16).toString("hex");
		const settings: Settings = {
			webhookUrl: `${appBaseUrl}/webhooks/green-api`,
			webhookUrlToken: webhookToken,
			...REQUIRED_WEBHOOK_SETTINGS,
			wid: waSettings?.phone ? `${waSettings.phone}@c.us` : undefined,
		};

		try {
			const dbInstance = await this.prisma.createInstance({
				idInstance: BigInt(idInstance),
				apiTokenInstance,
				user: {
					connect: {id: ghlUserId},
				},
				settings,
				stateInstance: waSettings?.stateInstance || "notAuthorized",
				name: name || `WhatsApp ${idInstance}`,
			});
			this.gaLogger.log(`Instance ${idInstance} record created for User (Loc) ${ghlUserId}. DB ID: ${dbInstance.id}`);

			try {
				await greenApiClient.setSettings(settings);
				this.gaLogger.log(`Applied initial settings to Green API instance ${idInstance}.`);
			} catch (error) {
				this.gaLogger.error(`Failed to apply initial settings to Green API instance ${idInstance}: ${error.message}. DB record exists.`);
			}
			return dbInstance;
		} catch (error) {
			this.gaLogger.error(`Failed to create Green API instance ${idInstance} for User ${ghlUserId}: ${error.message}`, error.stack);
			throw new IntegrationError("Failed to create instance", "INSTANCE_CREATION_ERROR", 500);
		}
	}

	public async handleWorkflowAction(
		locationId: string,
		contactPhone: string,
		data: WorkflowActionData,
		actionType: "message" | "file" | "interactive-buttons" | "reply-buttons",
	): Promise<WorkflowActionResult> {
		this.gaLogger.info(`Processing ${actionType} workflow action for location ${locationId}`, {
			actionType,
			contactPhone,
			data,
		});

		const instance = await this.prisma.getInstance(BigInt(data.instanceId));
		if (!instance) {
			this.gaLogger.error(`Instance ${data.instanceId} not found`, {data, locationId, contactPhone});
			throw new BadRequestException(`Instance ${data.instanceId} not found`);
		}
		if (!instance.user || instance.userId !== locationId) {
			this.gaLogger.error(`Instance ${data.instanceId} does not belong to location ${locationId}`, {
				data,
				locationId,
				contactPhone,
			});
			throw new BadRequestException(`Instance ${data.instanceId} does not belong to location ${locationId}`);
		}
		if (instance.stateInstance !== "authorized") {
			this.gaLogger.error(`Instance ${data.instanceId} is not authorized (state: ${instance.stateInstance})`, {
				data,
				locationId,
				contactPhone,
			});
			throw new BadRequestException(`Instance ${data.instanceId} is not authorized (state: ${instance.stateInstance})`);
		}

		const chatId = formatPhoneNumber(contactPhone);
		const cleanPhone = chatId.replace("@c.us", "");
		const greenApiClient = this.createGreenApiClient(instance);

		let sendResponse: SendResponse;
		let ghlMessageContent: string;
		let ghlAttachments: string[] | undefined;

		switch (actionType) {
			case "message":
				if (!data.message) throw new Error("Message is required");
				sendResponse = await greenApiClient.sendMessage({
					chatId,
					message: data.message,
					linkPreview: true,
				});
				ghlMessageContent = data.message;
				this.gaLogger.info(`Text message sent via GREEN-API`, {
					instanceId: data.instanceId,
					messageId: sendResponse.idMessage,
				});
				break;

			case "file":
				if (!data.url || !data.fileName) throw new Error("URL and fileName are required for file messages");
				sendResponse = await greenApiClient.sendFileByUrl({
					chatId,
					file: {url: data.url, fileName: data.fileName},
					caption: data.caption || undefined,
				});
				ghlMessageContent = data.caption ? data.caption : `[File: ${data.fileName}]`;
				ghlAttachments = [data.url];
				this.gaLogger.info(`File sent via GREEN-API`, {
					instanceId: data.instanceId,
					messageId: sendResponse.idMessage,
					fileName: data.fileName,
				});
				break;

			case "interactive-buttons":
				if (!data.body) throw new Error("Body is required for interactive buttons");
				const buttons = this.buildInteractiveButtons(data);
				if (buttons.length === 0) throw new Error("At least one button is required");

				sendResponse = await greenApiClient.sendInteractiveButtons({
					chatId,
					header: data.header,
					body: data.body,
					footer: data.footer,
					buttons,
				});
				ghlMessageContent = this.formatInteractiveButtonsForGhl(data, buttons);
				this.gaLogger.info(`Interactive buttons sent via GREEN-API`, {
					instanceId: data.instanceId,
					messageId: sendResponse.idMessage,
					buttonCount: buttons.length,
				});
				break;

			case "reply-buttons":
				if (!data.body) throw new Error("Body is required for reply buttons");
				const replyButtons = this.buildReplyButtons(data);
				if (replyButtons.length === 0) throw new Error("At least one button is required");

				sendResponse = await greenApiClient.sendInteractiveButtonsReply({
					chatId,
					header: data.header,
					body: data.body,
					footer: data.footer,
					buttons: replyButtons,
				});
				ghlMessageContent = this.formatReplyButtonsForGhl(data, replyButtons);
				this.gaLogger.info(`Reply buttons sent via GREEN-API`, {
					instanceId: data.instanceId,
					messageId: sendResponse.idMessage,
					buttonCount: replyButtons.length,
				});
				break;

			default:
				throw new Error(`Unsupported action type: ${actionType}`);
		}

		// Reserved before the GHL round trip so the outgoingAPIMessageReceived echo of this send
		// is recognised even if posting to GHL takes a while.
		this.trackOutboundMessage(sendResponse.idMessage, locationId);

		let ghlContact: GhlContact | null;
		let ghlMessageId: string | undefined;
		try {
			ghlContact = await this.getGhlContact(locationId, cleanPhone);
			if (!ghlContact) {
				// Release the reservation: the outgoingAPIMessageReceived notification of this send
				// resolves the contact on its own and can still get the message into GHL.
				this.forgetOutboundMessage(sendResponse.idMessage);
				this.gaLogger.warn(`Could not find/create GHL contact for phone ${cleanPhone}`);
				return {
					success: true,
					messageId: sendResponse.idMessage,
					warning: `${actionType} sent but contact not found in GHL`,
				};
			}
			ghlMessageId = await this.postOutboundMessageToGhl(locationId, ghlContact.id, ghlMessageContent, ghlAttachments);
		} catch (error) {
			this.forgetOutboundMessage(sendResponse.idMessage);
			throw error;
		}
		this.trackOutboundMessage(sendResponse.idMessage, locationId, ghlMessageId, "delivered");

		this.gaLogger.info(`Outbound ${actionType} posted to GHL conversation`, {
			contactId: ghlContact.id,
			locationId,
			data,
			contactPhone,
		});

		return {
			success: true,
			messageId: sendResponse.idMessage,
			contactId: ghlContact.id,
		};
	}

	private buildInteractiveButtons(data: WorkflowActionData): Array<{
		type: "copy" | "call" | "url";
		buttonId: string;
		buttonText: string;
		copyCode?: string;
		phoneNumber?: string;
		url?: string;
	}> {
		const buttons: SendInteractiveButtons["buttons"] = [];

		if (data.button1Type && data.button1Text && data.button1Value) {
			buttons.push({
				type: data.button1Type as "copy" | "call" | "url",
				buttonId: "1",
				buttonText: data.button1Text,
				...(data.button1Type === "copy" && {copyCode: data.button1Value}),
				...(data.button1Type === "call" && {phoneNumber: data.button1Value}),
				...(data.button1Type === "url" && {url: data.button1Value}),
			});
		}

		if (data.button2Type && data.button2Text && data.button2Value) {
			buttons.push({
				type: data.button2Type as "copy" | "call" | "url",
				buttonId: "2",
				buttonText: data.button2Text,
				...(data.button2Type === "copy" && {copyCode: data.button2Value}),
				...(data.button2Type === "call" && {phoneNumber: data.button2Value}),
				...(data.button2Type === "url" && {url: data.button2Value}),
			});
		}

		if (data.button3Type && data.button3Text && data.button3Value) {
			buttons.push({
				type: data.button3Type as "copy" | "call" | "url",
				buttonId: "3",
				buttonText: data.button3Text,
				...(data.button3Type === "copy" && {copyCode: data.button3Value}),
				...(data.button3Type === "call" && {phoneNumber: data.button3Value}),
				...(data.button3Type === "url" && {url: data.button3Value}),
			});
		}

		return buttons;
	}

	private buildReplyButtons(data: WorkflowActionData): Array<{
		buttonId: string;
		buttonText: string;
	}> {
		const buttons: SendInteractiveButtonsReply["buttons"] = [];

		if (data.button1Text) {
			buttons.push({buttonId: "1", buttonText: data.button1Text});
		}
		if (data.button2Text) {
			buttons.push({buttonId: "2", buttonText: data.button2Text});
		}
		if (data.button3Text) {
			buttons.push({buttonId: "3", buttonText: data.button3Text});
		}

		return buttons;
	}

	private formatInteractiveButtonsForGhl(data: WorkflowActionData, buttons: any[]): string {
		const buttonsList = buttons.map(btn => {
			let buttonDesc = `• ${btn.buttonText}`;
			if (btn.type === "url" && btn.url) buttonDesc += ` (${btn.url})`;
			else if (btn.type === "call" && btn.phoneNumber) buttonDesc += ` (📞 ${btn.phoneNumber})`;
			else if (btn.type === "copy" && btn.copyCode) buttonDesc += ` (📋 ${btn.copyCode})`;
			return buttonDesc;
		}).join("\n");

		return [
			data.header && `${data.header}`,
			data.body,
			data.footer && `${data.footer}`,
			`\nButtons:\n${buttonsList}`,
		].filter(Boolean).join("\n");
	}

	private formatReplyButtonsForGhl(data: WorkflowActionData, buttons: any[]): string {
		const buttonsList = buttons.map(btn => `• ${btn.buttonText}`).join("\n");

		return [
			data.header && `${data.header}`,
			data.body,
			data.footer && `${data.footer}`,
			`\nReply options:\n${buttonsList}`,
		].filter(Boolean).join("\n");
	}
}
