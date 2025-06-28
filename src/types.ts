import { User } from ".prisma/client";

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
	activeLocation: string;
}

export interface GhlPlatformMessage {
	contactId: string;
	locationId: string;
	message: string;
	direction: "inbound";
	conversationProviderId?: string;
	attachments?: GhlPlatformAttachment[];
	timestamp?: Date;
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