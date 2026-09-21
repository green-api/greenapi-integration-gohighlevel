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
	MessageWebhook, MessageType, OutgoingMessageStatus, OutgoingMessageStatusWebhook,
} from "@green-api/greenapi-integration";
import { GhlTransformer } from "./ghl.transformer";
import { PrismaService } from "../prisma/prisma.service";
import { GhlWebhookDto } from "./dto/ghl-webhook.dto";
import type { Instance, User } from "@prisma/client";
import { randomBytes } from "crypto";
import {
	GhlContact,
	GhlContactUpsertRequest,
	GhlContactLookup,
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

/** Ties a GHL contact to the GREEN-API instance whose chat it belongs to. */
export const INSTANCE_TAG_PREFIX = "whatsapp-instance-";

/** Marks a GHL contact that stands for a WhatsApp group chat rather than a person. */
export const GROUP_TAG = "whatsapp-group";

/**
 * Message types deliberately kept out of GHL conversations: a reaction belongs to the message it
 * is attached to rather than being one of its own, a poll posts a fresh message for every single
 * vote cast, and a deletion is an event about a message rather than a message to show.
 */
const UNSUPPORTED_MESSAGE_TYPES: readonly MessageType[] = [
	"reactionMessage",
	"pollMessage",
	"pollUpdateMessage",
	"deletedMessage",
];

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
			// The error body is whatever GHL chose to send, so its message is read only once it has
			// been shown to be a string.
			const message = this.isRecord(data) && typeof data.message === "string"
				? data.message
				: "GHL API request failed";
			throw new HttpException(message, status || HttpStatus.INTERNAL_SERVER_ERROR);
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

	/** Narrows an unknown payload to something whose fields can be read one by one. */
	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

	/**
	 * Reads a contact out of a GHL response. The wrapped (`{contact: {...}}`) and the bare shape are
	 * both accepted, and only the fields this integration actually uses are taken over.
	 *
	 * A field the payload does not carry is left out here as well: callers tell an absent field
	 * from an empty one to decide whether a name or a tag may be written, and a field invented with
	 * an empty value would make them overwrite what a GHL user typed.
	 */
	private parseGhlContact(payload: unknown): GhlContact | null {
		if (!this.isRecord(payload)) {
			return null;
		}

		const source = this.isRecord(payload.contact) ? payload.contact : payload;
		if (typeof source.id !== "string" || source.id.length === 0) {
			return null;
		}

		const contact: GhlContact = {id: source.id};
		if (typeof source.name === "string") contact.name = source.name;
		if (typeof source.firstName === "string") contact.firstName = source.firstName;
		if (typeof source.lastName === "string") contact.lastName = source.lastName;
		if (typeof source.phone === "string") contact.phone = source.phone;
		if (typeof source.locationId === "string") contact.locationId = source.locationId;
		if (Array.isArray(source.tags)) {
			contact.tags = source.tags.filter((tag): tag is string => typeof tag === "string");
		}

		return contact;
	}

	/**
	 * Reads the answer of `POST /contacts/upsert`. `isNew` stays null when the response does not
	 * say: "the contact was created" and "GHL did not tell us" lead to different decisions about
	 * overwriting a name, so they must not collapse into one value.
	 */
	private parseGhlContactUpsert(payload: unknown): { contact: GhlContact | null; isNew: boolean | null } {
		const contact = this.parseGhlContact(payload);
		if (!this.isRecord(payload)) {
			return {contact, isNew: null};
		}

		return {contact, isNew: typeof payload.new === "boolean" ? payload.new : null};
	}

	/**
	 * Reads a GHL contact by phone number. `/contacts/search/duplicate` resolves the number with
	 * the same duplicate-detection rules the upsert endpoint applies, so it answers exactly the
	 * question "which contact would an upsert of this number hit?" — without the side effect of
	 * creating an empty contact whenever the number is unknown.
	 *
	 * A lookup that could not answer is reported as "unknown" rather than "missing": callers that
	 * are about to write must not take a failure for an absent contact.
	 */
	private async lookupGhlContactByPhone(ghlUserId: string, phone: string): Promise<GhlContactLookup> {
		const formattedPhone = this.formatContactPhone(phone);

		try {
			return await this.requestGhlContactByPhone(ghlUserId, formattedPhone);
		} catch (error) {
			this.gaLogger.error(`Error looking up GHL contact by phone ${formattedPhone} in Location ${ghlUserId}: ${error.message}`);
			return {status: "unknown", contact: null};
		}
	}

	private async requestGhlContactByPhone(ghlUserId: string, formattedPhone: string): Promise<GhlContactLookup> {
		const httpClient = await this.getHttpClient(ghlUserId);
		// 404 and 400 are answers rather than failures, so they must not reach the error
		// interceptor. Axios encodes the leading "+" as %2B, which is what the API expects.
		const response = await httpClient.get("/contacts/search/duplicate", {
			params: {locationId: ghlUserId, number: formattedPhone},
			validateStatus: status => status === HttpStatus.NOT_FOUND
				|| status === HttpStatus.BAD_REQUEST
				|| (status >= 200 && status < 300),
		});

		if (response.status === HttpStatus.BAD_REQUEST) {
			// Group chats are stored with the WhatsApp group id in the phone field, which this
			// endpoint may well refuse. "unknown" keeps the caller from writing blindly.
			this.gaLogger.warn(`GHL rejected the contact lookup for ${formattedPhone} in Location ${ghlUserId}: ${JSON.stringify(response.data)}`);
			return {status: "unknown", contact: null};
		}
		if (response.status === HttpStatus.NOT_FOUND) {
			return {status: "missing", contact: null};
		}

		const contact = this.parseGhlContact(response.data);
		if (!contact) {
			// Logged on purpose: an unknown number and an unexpected payload shape look the
			// same from here, and only the log can tell them apart after a rollout.
			this.gaLogger.debug(`No GHL contact for phone ${formattedPhone} in Location ${ghlUserId}`, response.data);
			return {status: "missing", contact: null};
		}

		return {status: "found", contact};
	}

	/** Reads a contact by phone. Null means it does not exist or could not be looked up. */
	public async getGhlContact(
		ghlUserId: string,
		phone: string,
	): Promise<GhlContact | null> {
		const {contact} = await this.lookupGhlContactByPhone(ghlUserId, phone);

		return contact;
	}

	/**
	 * Reads a contact by its GHL id. This endpoint has a documented response schema — `tags`
	 * included — and cannot miss a contact whose phone is stored in a different format or holds a
	 * WhatsApp group id, so it is the way in whenever GHL hands us the id.
	 */
	public async getGhlContactById(ghlUserId: string, contactId: string): Promise<GhlContact | null> {
		try {
			return await this.requestGhlContactById(ghlUserId, contactId);
		} catch (error) {
			this.gaLogger.error(`Error reading GHL contact ${contactId} in Location ${ghlUserId}: ${error.message}`);
			return null;
		}
	}

	private async requestGhlContactById(ghlUserId: string, contactId: string): Promise<GhlContact | null> {
		const httpClient = await this.getHttpClient(ghlUserId);
		const response = await httpClient.get(`/contacts/${contactId}`, {
			validateStatus: status => status === HttpStatus.NOT_FOUND || (status >= 200 && status < 300),
		});

		if (response.status === HttpStatus.NOT_FOUND) {
			this.gaLogger.warn(`GHL contact ${contactId} does not exist in Location ${ghlUserId}`);
			return null;
		}

		return this.parseGhlContact(response.data);
	}

	/**
	 * The duplicate search has no published response schema, so its payload may be narrower than a
	 * full contact. Tags and name decide what is written next, so a payload without them is
	 * re-read through the documented by-id endpoint instead of being guessed at.
	 */
	private async completeGhlContact(ghlUserId: string, contact: GhlContact): Promise<GhlContact> {
		if (Array.isArray(contact.tags) && "name" in contact) {
			return contact;
		}

		this.gaLogger.warn(`GHL returned a partial contact ${contact.id} in Location ${ghlUserId}, re-reading it by id`, contact);

		return await this.getGhlContactById(ghlUserId, contact.id) || contact;
	}

	/**
	 * Fills in the name of a contact that has none — the empty contacts the old lookup-by-upsert
	 * left behind, or leads imported with nothing but a phone number. A contact that carries any
	 * name is never touched, so nothing a GHL user typed can be lost.
	 */
	private async nameUnnamedGhlContact(ghlUserId: string, contact: GhlContact, name: string): Promise<void> {
		// Fail closed: only a payload that actually carries the name fields can prove they are empty.
		const carriesNameFields = "name" in contact || "firstName" in contact || "lastName" in contact;
		const isUnnamed = !contact.name?.trim() && !contact.firstName?.trim() && !contact.lastName?.trim();
		if (!carriesNameFields || !isUnnamed) return;

		try {
			const httpClient = await this.getHttpClient(ghlUserId);
			await httpClient.put(`/contacts/${contact.id}`, {name});
			contact.name = name;
			this.gaLogger.log(`Named GHL contact ${contact.id} "${name}" in Location ${ghlUserId}: it had no name of its own`);
		} catch (error) {
			this.gaLogger.warn(`Failed to name GHL contact ${contact.id} in Location ${ghlUserId}: ${error.message}`);
		}
	}

	private formatContactPhone(phone: string): string {
		return phone.startsWith("+") ? phone : `+${phone}`;
	}

	/** The only tags the integration owns; every other tag on a contact belongs to the GHL user. */
	private buildIntegrationTags(instanceId?: string, isGroup?: boolean): string[] {
		const tags: string[] = [];
		if (instanceId) tags.push(`${INSTANCE_TAG_PREFIX}${instanceId}`);
		if (isGroup) tags.push(GROUP_TAG);
		return tags;
	}

	/**
	 * WhatsApp does not always know a name: the pushname can be empty, and `chatName` holds the bare
	 * number for chats that are not in the phone's address book. Neither may be treated as a name,
	 * otherwise it would end up written over the name a GHL user gave the lead.
	 */
	private normalizeWhatsappName(name: string | undefined, identifier: string): string | undefined {
		const trimmed = name?.trim();
		if (!trimmed) return undefined;

		const digitsOnly = (value: string) => value.replace(/\D/g, "");
		return digitsOnly(trimmed) === digitsOnly(identifier) ? undefined : trimmed;
	}

	/** The name a contact is created with. It is never applied to a contact that already exists. */
	private buildNewContactName(identifier: string, name?: string, isGroup?: boolean): string {
		const resolvedName = this.normalizeWhatsappName(name, identifier);

		return isGroup
			? `[Group] ${resolvedName || "Unknown Group"}`
			: resolvedName || `WhatsApp ${identifier}`;
	}

	/**
	 * Adds the tags the integration needs while keeping every other tag intact: `tags` in an upsert
	 * or update payload replaces the contact's whole tag list, this endpoint only appends.
	 */
	private async addMissingContactTags(
		ghlUserId: string,
		contact: GhlContact,
		requiredTags: string[],
		tagsAreKnown = false,
	): Promise<void> {
		if (!contact?.id || requiredTags.length === 0) return;

		// Tags are compared case-insensitively, so they are normalised before they reach a Set or a
		// lookup: a Set of raw tags would keep "Name" and "name" apart and let the same tag be
		// written twice.
		const normalizeTag = (tag: string) => tag.trim().toLowerCase();
		// Keeps the first spelling of each tag and drops the rest, so the request below cannot ask
		// GHL to add one tag twice.
		const wantedTags = [...new Map(requiredTags.map(tag => [normalizeTag(tag), tag])).values()];

		const tagsMissingFrom = (source: GhlContact) => {
			const existingTags = new Set((source.tags || []).map(normalizeTag));

			return wantedTags.filter(tag => !existingTags.has(normalizeTag(tag)));
		};

		let missingTags = tagsMissingFrom(contact);
		if (missingTags.length === 0) return;

		if (!tagsAreKnown) {
			// The lookup payload may carry no tags at all, which makes every message look like the
			// first one and rewrites the same tag over and over - and every write fires the
			// contact-tag automations on the GHL side. So a write is only made against a contact
			// read through the endpoint whose schema guarantees `tags`.
			const currentContact = await this.getGhlContactById(ghlUserId, contact.id);
			if (currentContact) {
				contact.tags = currentContact.tags || [];
				missingTags = tagsMissingFrom(currentContact);
				if (missingTags.length === 0) return;
			}
		}

		try {
			const httpClient = await this.getHttpClient(ghlUserId);
			await httpClient.post(`/contacts/${contact.id}/tags`, {tags: missingTags});
			contact.tags = [...(contact.tags || []), ...missingTags];
			this.gaLogger.log(`Added tags [${missingTags.join(", ")}] to GHL contact ${contact.id} in Location ${ghlUserId}`);
		} catch (error) {
			// A missing tag only degrades instance routing for outgoing messages, while a thrown
			// error would cost the message itself, so tagging never fails the webhook.
			this.gaLogger.warn(`Failed to add tags [${missingTags.join(", ")}] to GHL contact ${contact.id} in Location ${ghlUserId}: ${error.message}`);
		}
	}

	/**
	 * Resolves the GHL contact of a WhatsApp chat, creating it only when it does not exist yet.
	 *
	 * An existing contact is never written to: `name` would overwrite a lead the GHL user renamed
	 * and `tags` would wipe its entire tag list, as both fields replace rather than merge. The
	 * instance tag is therefore added through the additive tags endpoint, and a name is filled in
	 * only for a contact that turns out to carry none at all.
	 *
	 * The lookup needs the `contacts.readonly` scope, which a location authorised long ago may not
	 * have granted. If it fails for any reason the contact is still resolved, through an upsert
	 * that carries no name and no tags - it cannot overwrite anything - and the name is applied
	 * afterwards only if the response proves this call is what created the contact.
	 */
	private async findOrCreateGhlContact(
		ghlUserId: string,
		phone: string,
		name?: string,
		instanceId?: string,
		isGroup?: boolean,
	): Promise<GhlContact> {
		const formattedPhone = this.formatContactPhone(phone);
		const subject = isGroup ? "group" : "phone";
		const requiredTags = this.buildIntegrationTags(instanceId, isGroup);
		const newContactName = this.buildNewContactName(phone, name, isGroup);

		const lookup = await this.lookupGhlContactByPhone(ghlUserId, phone);
		if (lookup.status === "found" && lookup.contact) {
			const existingContact = await this.completeGhlContact(ghlUserId, lookup.contact);
			this.gaLogger.log(`Using existing GHL contact ${existingContact.id} for ${subject} ${formattedPhone} in Location ${ghlUserId}; the name it carries is left untouched`);
			await this.nameUnnamedGhlContact(ghlUserId, existingContact, newContactName);
			await this.addMissingContactTags(ghlUserId, existingContact, requiredTags);

			return existingContact;
		}

		// A lookup that could not answer must not lead to a blind write: without `name` and
		// `source` the upsert cannot overwrite anything, and the name is applied afterwards only
		// if the response proves this very call created the contact.
		const lookupFailed = lookup.status === "unknown";
		const httpClient = await this.getHttpClient(ghlUserId);
		const upsertPayload: GhlContactUpsertRequest = {
			locationId: ghlUserId,
			phone: formattedPhone,
		};
		if (!lookupFailed) {
			upsertPayload.name = newContactName;
			upsertPayload.source = "GREEN-API";
		}

		this.gaLogger.info(`Creating GHL contact for ${subject} ${formattedPhone} in Location ${ghlUserId} with payload:`, upsertPayload);

		try {
			// Upsert rather than a plain create: should a concurrent webhook have created the
			// contact a moment ago, this updates that one instead of producing a second lead.
			const response = await httpClient.post("/contacts/upsert", upsertPayload);
			const {contact: upsertedContact, isNew} = this.parseGhlContactUpsert(response.data);

			if (!upsertedContact) {
				this.gaLogger.error("Failed to upsert contact or get ID from response. Response data:", response.data);
				throw new Error("Could not get ID from GHL contact upsert response.");
			}

			let contact = upsertedContact;
			if (lookupFailed && isNew === true) {
				// The response proves the contact did not exist, so naming it overwrites nothing.
				contact = await this.nameCreatedGhlContact(httpClient, upsertPayload, newContactName) || contact;
			} else if (!lookupFailed && isNew === false) {
				this.gaLogger.warn(`GHL contact ${contact.id} for ${subject} ${formattedPhone} in Location ${ghlUserId} already existed although the lookup reported it missing, so its name and source were overwritten with "${newContactName}" / "GREEN-API"`);
			}

			this.gaLogger.log(`Created GHL contact ${contact.id} for ${subject} ${formattedPhone} in Location ${ghlUserId}`);
			await this.addMissingContactTags(ghlUserId, contact, requiredTags, isNew === true);

			return contact;
		} catch (error) {
			this.gaLogger.error(`Error creating GHL contact for ${subject} ${phone} in Location ${ghlUserId}: ${error.message}`);
			throw error;
		}
	}

	/**
	 * Second half of the fallback above: names a contact that was just created without one. A
	 * failure here leaves a nameless contact, which is still better than losing the message, so
	 * the error is only logged.
	 */
	private async nameCreatedGhlContact(
		httpClient: AxiosInstance,
		upsertPayload: GhlContactUpsertRequest,
		name: string,
	): Promise<GhlContact | null> {
		try {
			const response = await httpClient.post("/contacts/upsert", {
				...upsertPayload,
				name,
				source: "GREEN-API",
			});

			return this.parseGhlContact(response.data);
		} catch (error) {
			this.gaLogger.warn(`Failed to set the name "${name}" on the freshly created GHL contact in Location ${upsertPayload.locationId}: ${error.message}`);
			return null;
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
				// No name is passed on purpose: a call carries none, and a placeholder would
				// overwrite the name an existing lead already has in GHL.
				const ghlContact = await this.findOrCreateGhlContact(
					instanceWithUser.userId,
					normalizedPhone,
					undefined,
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
		// Skipped before the outgoing bookkeeping below so no message id is reserved for a
		// notification that is never going to reach the conversation.
		const messageType = webhook.messageData?.typeMessage;
		if (messageType && UNSUPPORTED_MESSAGE_TYPES.includes(messageType)) {
			this.gaLogger.info(`Skipping ${webhook.typeWebhook} ${webhook.idMessage}: ${messageType} is not shown in GHL conversations`);
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
		// The name is only used if the contact has to be created, so no placeholder is built
		// here: an existing lead keeps the name its GHL user gave it.
		let contactName: string | undefined;
		let logContext: string;

		if (isGroup) {
			contactName = webhook.senderData.chatName;
			logContext = `group "${contactName || "Unknown Group"}" (${contactIdentifier})`;
		} else if (isOutgoing) {
			// For outgoing notifications senderData describes the instance itself, the chat partner
			// is in chatName - which holds the bare number for chats outside the address book.
			contactName = webhook.senderData.chatName;
			logContext = `individual ${contactName || contactIdentifier} (${contactIdentifier})`;
		} else {
			contactName = webhook.senderData.senderName || webhook.senderData.senderContactName;
			logContext = `individual ${contactName || contactIdentifier} (${contactIdentifier})`;
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

		// Resolved before the message is sent: with no contact the message id must not be reserved,
		// otherwise the outgoingAPIMessageReceived echo - by then the only way into the GHL
		// conversation - would dismiss the message as one that is already there.
		const ghlContact = await this.getGhlContact(locationId, cleanPhone);

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

		if (!ghlContact) {
			// Nothing was reserved for this message id, so the outgoingAPIMessageReceived
			// notification of this send is free to resolve the contact and post the message itself.
			this.gaLogger.warn(`No GHL contact exists for phone ${cleanPhone}; the message reaches the GHL conversation through the outgoingAPIMessageReceived notification`);
			return {
				success: true,
				messageId: sendResponse.idMessage,
				warning: `${actionType} sent but contact not found in GHL`,
			};
		}

		// Reserved before the GHL round trip so the outgoingAPIMessageReceived echo of this send
		// is recognised even if posting to GHL takes a while.
		this.trackOutboundMessage(sendResponse.idMessage, locationId);

		let ghlMessageId: string | undefined;
		try {
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
