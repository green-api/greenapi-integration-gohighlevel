import { Injectable, HttpException, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosInstance, AxiosError } from "axios";
import {
	BaseAdapter,
	GreenApiWebhook,
	WebhookType,
	IntegrationError,
	NotFoundError,
	Settings, StateInstanceWebhook,
	WaSettings, SendResponse,
} from "@green-api/greenapi-integration";
import { GhlTransformer } from "./ghl.transformer";
import { PrismaService } from "../prisma/prisma.service";
import { GhlWebhookDto } from "./dto/ghl-webhook.dto";
import type { Instance, User } from "@prisma/client";
import { randomBytes } from "crypto";
import { GhlPlatformMessage } from "../types";

@Injectable()
export class GhlService extends BaseAdapter<
	GhlWebhookDto,
	GhlPlatformMessage,
	User,
	Instance
> {
	private readonly ghlApiBaseUrl = "https://services.leadconnectorhq.com";
	private readonly ghlApiVersion = "2021-07-28";

	constructor(
		protected readonly ghlTransformer: GhlTransformer,
		protected readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {
		super(ghlTransformer, prisma);
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

	private async findOrCreateGhlContact(
		ghlUserId: string,
		phone: string,
		name?: string,
	): Promise<{ id: string; [key: string]: any }> {
		const httpClient = await this.getHttpClient(ghlUserId);
		const formattedPhone = phone.startsWith("+") ? phone : `+${phone}`;

		const upsertPayload = {
			locationId: ghlUserId,
			phone: formattedPhone,
			name: name || `WhatsApp ${formattedPhone}`,
			source: "GREEN-API",
		};
		this.gaLogger.info(`Upserting GHL contact for phone ${formattedPhone} in Location ${ghlUserId} with payload:`, upsertPayload);

		try {
			const {data} = await httpClient.post("/contacts/upsert", upsertPayload);

			if (data && data.contact && data.contact.id) {
				this.gaLogger.log(`Successfully upserted GHL contact. ID: ${data.contact.id} for phone ${formattedPhone} in Location ${ghlUserId}`);
				return data.contact;
			} else {
				this.gaLogger.error("Failed to upsert contact or get ID from response. Response data:", data);
				throw new Error("Could not get ID from GHL contact upsert response.");
			}
		} catch (error) {
			this.gaLogger.error(`Error during GHL contact upsert for phone ${formattedPhone} in Location ${ghlUserId}: ${error.message}`, error.response?.data);
			throw error;
		}
	}

	private async updateGhlMessageStatus(
		ghlLocationId: string,
		ghlMessageId: string,
		status: "delivered" | "read" | "failed" | "pending",
	): Promise<void> {
		this.gaLogger.log(`Attempting to update GHL message ${ghlMessageId} to status ${status} for location ${ghlLocationId}`);

		try {
			const httpClient = await this.getHttpClient(ghlLocationId);
			const apiUrl = `/conversations/messages/${ghlMessageId}/status`;

			const payload = {
				status: status,
			};

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

	private async postInboundMessageToGhl(
		ghlUserId: string,
		contactId: string,
		messageContent: string,
		attachments: GhlPlatformMessage["attachments"],
	): Promise<void> {
		const httpClient = await this.getHttpClient(ghlUserId);
		let conversationId: string;

		try {
			const {data: search} = await httpClient.get("/conversations/search", {
				params: {
					locationId: ghlUserId,
					contactId,
					limit: 1,
					lastMessageType: "TYPE_CUSTOM_PROVIDER_SMS",
				},
			});
			if (search.conversations?.length > 0) {
				conversationId = search.conversations[0].id;
				this.gaLogger.log(`Found existing GHL conversation ${conversationId} for contact ${contactId} in Location ${ghlUserId}`);
			} else {
				this.gaLogger.log(`No existing GHL conversation for contact ${contactId} in Location ${ghlUserId}. Creating new one.`);
				const {data: create} = await httpClient.post("/conversations/", {
					locationId: ghlUserId,
					contactId,
				});
				conversationId = create.conversation?.id ?? create.id;
				if (!conversationId) {
					this.gaLogger.error("Failed to get conversationId from create conversation response", create);
					throw new Error("Failed to create or retrieve conversation ID.");
				}
				this.gaLogger.log(`Created new GHL conversation ${conversationId} for contact ${contactId} in Location ${ghlUserId}`);
			}
		} catch (error) {
			this.gaLogger.error(`Error during get/create GHL conversation for contact ${contactId} in Location ${ghlUserId}: ${error.message}`, error.response?.data);
			throw error;
		}

		const payload: any = {
			type: "Custom",
			conversationId,
			message: messageContent,
			direction: "inbound",
			conversationProviderId: this.configService.get<string>("GHL_CONVERSATION_PROVIDER_ID"),
		};

		if (attachments && attachments.length > 0) {
			payload.attachments = attachments.map(att => att.url);
			this.gaLogger.warn(`Sending attachments to GHL for custom inbound. Payload (array of URLs):`, payload.attachments);
		}

		this.gaLogger.log(`Attempting to post inbound message to GHL for convo ${conversationId}. Payload:`, payload);
		try {
			const {data: msgRes} = await httpClient.post(
				`/conversations/messages/inbound`,
				payload,
			);
			this.gaLogger.log(`Successfully posted inbound message to GHL conversation ${conversationId}. Response:`, msgRes);
			return msgRes;
		} catch (error) {
			this.gaLogger.error(`Error posting inbound GHL message to convo ${conversationId}: ${error.message}. Payload sent:`, payload);
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
			await this.postInboundMessageToGhl(
				instance.userId,
				ghlMessageDto.contactId,
				ghlMessageDto.message,
				ghlMessageDto.attachments,
			);
			this.gaLogger.log(`Message sent to GHL for contact ${ghlMessageDto.contactId} in User (Loc) ${instance.userId}.`);
		} catch (error) {
			this.gaLogger.error(`Failed to send message to GHL: ${error.message}`, error.stack);
			throw error;
		}
	}

	public async getInstanceByUserId(userId: string): Promise<Instance | null> {
		if (!this.storage || typeof (this.storage as any).getInstanceByUserId !== "function") {
			this.gaLogger.error("Storage provider or getInstanceByUserId method is not available.");
			throw new Error("Storage provider or getInstanceByUserId method is not available.");
		}
		return (this.storage as PrismaService).getInstanceByUserId(userId);
	}

	public async handlePlatformWebhook(
		ghlWebhook: GhlWebhookDto,
		idInstance: number | bigint,
	): Promise<SendResponse> {
		this.gaLogger.log(`Handling GHL webhook for Green API Instance ID: ${idInstance}`);
		this.gaLogger.debug(`GHL Webhook DTO: ${JSON.stringify(ghlWebhook)}`);

		const instance = await this.prisma.getInstance(BigInt(idInstance));
		if (!instance) throw new NotFoundError(`Instance ${idInstance} not found.`);
		if (!instance.user) throw new IntegrationError("Instance not linked to User.", "DATA_ERROR");

		const greenApiClient = this.createGreenApiClient(instance);
		const transformedMessage = this.ghlTransformer.toGreenApiMessage(ghlWebhook);

		this.gaLogger.log(`Transformed GHL message to Green API format for instance ${idInstance}`);
		this.gaLogger.debug(`Green API Message: ${JSON.stringify(transformedMessage)}`);

		let gaResponse: SendResponse;
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

		const locationId = ghlWebhook.locationId;
		const messageId = ghlWebhook.messageId;
		try {
			await this.updateGhlMessageStatus(locationId, messageId, "delivered");
		} catch (ghlStatusUpdateError) {
			this.gaLogger.error(
				`Failed to update GHL message ${messageId} status for location ${locationId}. The message was likely sent via Green API. Error: ${ghlStatusUpdateError.message}`,
				ghlStatusUpdateError,
			);
		}
		return gaResponse;
	}

	public async handleGreenApiWebhook(
		webhook: GreenApiWebhook,
		allowedTypes: WebhookType[],
	): Promise<void> {
		const idInstance = BigInt(webhook.instanceData.idInstance);
		this.gaLogger.info(`Handling Green API webhook type: ${webhook.typeWebhook} for Instance: ${idInstance}`, webhook);
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
			} else if (webhook.typeWebhook === "incomingMessageReceived") {
				const senderPhoneRaw = webhook.senderData.sender;
				const normalizedPhone = senderPhoneRaw.split("@")[0];
				const senderName = webhook.senderData.senderName || webhook.senderData.chatName || `WhatsApp ${normalizedPhone}`;

				const ghlContact = await this.findOrCreateGhlContact(
					instanceWithUser.userId,
					normalizedPhone, senderName,
				);
				if (!ghlContact?.id) throw new IntegrationError("Failed to resolve GHL contact.", "GHL_API_ERROR");

				const transformedMsg = this.ghlTransformer.toPlatformMessage(webhook);
				transformedMsg.contactId = ghlContact.id;
				transformedMsg.locationId = instanceWithUser.userId;

				await this.sendToPlatform(transformedMsg, instanceWithUser);
			} else {
				this.gaLogger.warn(`Unhandled allowed Green API webhook type: ${webhook.typeWebhook}`);
			}
		} catch (error) {
			this.gaLogger.error(`Error in handleGreenApiWebhook for instance ${idInstance}, type ${webhook.typeWebhook}: ${error.message}`, error.stack);
			throw new IntegrationError("Failed to handle Green API webhook", "GA_WEBHOOK_ERROR", 500);
		}
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
			incomingWebhook: "yes",
			stateWebhook: "yes",
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
}
