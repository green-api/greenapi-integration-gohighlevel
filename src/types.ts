import { User } from ".prisma/client";
import { GreenApiWebhook, MessageWebhook, WebhookType } from "@green-api/greenapi-integration";

/**
 * GREEN-API webhook types that carry an actual WhatsApp message.
 * `outgoingMessageReceived` is emitted for messages sent from the phone itself,
 * `outgoingAPIMessageReceived` for messages sent through the API (by us or any other integration).
 */
export const MESSAGE_WEBHOOK_TYPES = [
	"incomingMessageReceived",
	"outgoingMessageReceived",
	"outgoingAPIMessageReceived",
] as const satisfies readonly WebhookType[];

export function isMessageWebhook(webhook: GreenApiWebhook): webhook is MessageWebhook {
	return (MESSAGE_WEBHOOK_TYPES as readonly string[]).includes(webhook.typeWebhook);
}

/** Plain boolean on purpose: a type predicate here would narrow `webhook` to `never` in else-branches. */
export function isOutgoingMessageWebhook(webhook: GreenApiWebhook): boolean {
	return webhook.typeWebhook === "outgoingMessageReceived"
		|| webhook.typeWebhook === "outgoingAPIMessageReceived";
}

interface GhlPlatformAttachment {
	url: string;
	fileName?: string;
	type?: string;
}

export interface MessageStatusPayload {
	status: "delivered" | "read" | "failed" | "pending";
	error?: {
		code: string;
		type: string;
		message: string;
	};
}

export interface AuthReq extends Request {
	locationId: string;
}

export interface GhlUserData {
	userId: string;
	companyId: string;
	role: string;
	type: "location" | "agency";
	userName: string;
	email: string;
	activeLocation?: string;
}

export interface InstalledLocation {
	_id: string;
	name: string;
	address: string;
	isInstalled: boolean;
}

export interface InstalledLocationsResponse {
	locations: InstalledLocation[];
	count: number;
	installToFutureLocations: boolean;
}

export interface LocationTokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	scope: string;
	locationId: string;
	planId: string;
	userId: string;
}

export interface WorkflowActionResult {
	success: boolean;
	messageId: string;
	contactId?: string;
	warning?: string;
}

export interface WorkflowActionData {
	instanceId: string;
	message?: string;
	url?: string;
	fileName?: string;
	caption?: string;
	header?: string;
	body?: string;
	footer?: string;
	button1Type?: string;
	button1Text?: string;
	button1Value?: string;
	button2Type?: string;
	button2Text?: string;
	button2Value?: string;
	button3Type?: string;
	button3Text?: string;
	button3Value?: string;

	[key: string]: any;
}

export interface GhlPlatformMessage {
	contactId: string;
	locationId: string;
	message: string;
	direction: "inbound" | "outbound";
	conversationProviderId?: string;
	attachments?: GhlPlatformAttachment[];
	timestamp?: Date;
	greenApiMessageId?: string;
}

export type UserCreateData = Omit<User, "createdAt" | "instance"> & { id: string };
export type UserUpdateData = Partial<Omit<UserCreateData, "id">>;

interface GhlDndChannelSettings {
	status: string;
	message: string;
	code?: string;
}

interface GhlDndSettings {
	Call: GhlDndChannelSettings;
	Email: GhlDndChannelSettings;
	SMS: GhlDndChannelSettings;
	WhatsApp: GhlDndChannelSettings;
	GMB: GhlDndChannelSettings;
	FB: GhlDndChannelSettings;
}

interface GhlInboundDndSettings {
	all: {
		status: string;
		message: string;
	};
}

interface GhlCustomField {
	id?: string;
	key?: string;
	field_value?: string;
	value?: string;
}

interface GhlAttributionSource {
	url?: string;
	campaign?: string;
	utmSource?: string;
	utmMedium?: string;
	utmContent?: string;
	referrer?: string;
	campaignId?: string;
	fbclid?: string;
	gclid?: string;
	msclikid?: string;
	dclid?: string;
	fbc?: string;
	fbp?: string;
	fbEventId?: string;
	userAgent?: string;
	ip?: string;
	medium?: string;
	mediumId?: string;
}

export interface GhlContactUpsertRequest {
	firstName?: string | null;
	lastName?: string | null;
	name?: string | null;
	email?: string | null;
	locationId: string;
	gender?: string;
	phone?: string | null;
	address1?: string | null;
	city?: string | null;
	state?: string | null;
	postalCode?: string;
	website?: string | null;
	timezone?: string | null;
	dnd?: boolean;
	dndSettings?: GhlDndSettings;
	inboundDndSettings?: GhlInboundDndSettings;
	/**
	 * Replaces the contact's entire tag list, so it is only safe to send while creating a
	 * contact. Use `POST /contacts/{contactId}/tags` to add tags to an existing one.
	 */
	tags?: string[];
	customFields?: GhlCustomField[];
	source?: string;
	country?: string;
	companyName?: string | null;
	assignedTo?: string;
}

export interface GhlContact {
	id: string;
	name: string;
	locationId: string;
	firstName: string;
	lastName: string;
	email: string;
	emailLowerCase: string;
	timezone: string;
	companyName: string;
	phone: string;
	dnd: boolean;
	dndSettings: GhlDndSettings;
	type: string;
	source: string;
	assignedTo: string;
	address1: string;
	city: string;
	state: string;
	country: string;
	postalCode: string;
	website: string;
	tags: string[];
	dateOfBirth: string;
	dateAdded: string;
	dateUpdated: string;
	attachments: string;
	ssn: string;
	keyword: string;
	firstNameLowerCase: string;
	fullNameLowerCase: string;
	lastNameLowerCase: string;
	lastActivity: string;
	customFields: GhlCustomField[];
	businessId: string;
	attributionSource: GhlAttributionSource;
	lastAttributionSource: GhlAttributionSource;
	visitorId: string;
}

export interface GhlContactUpsertResponse {
	new: boolean;
	contact: GhlContact;
	traceId: string;
}

/**
 * Answer of `GET /contacts/search/duplicate`. The endpoint is documented without a response
 * schema, so the bare contact is accepted alongside the wrapped shape.
 */
export interface GhlDuplicateContactResponse {
	contact?: GhlContact | null;
}


/**
 * Outcome of a contact lookup. "unknown" means the question could not be answered - a caller that
 * is about to write must not mistake it for "the contact does not exist".
 */
export interface GhlContactLookup {
	status: "found" | "missing" | "unknown";
	contact: GhlContact | null;
}