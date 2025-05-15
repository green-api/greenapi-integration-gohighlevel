import { User } from ".prisma/client";

interface GhlPlatformAttachment {
	url: string;
	fileName?: string;
	type?: string;
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

export type UserCreateData = Omit<User, 'createdAt' | 'updatedAt' | 'instance'> & { id: string };
export type UserUpdateData = Partial<Omit<UserCreateData, 'id'>>;
