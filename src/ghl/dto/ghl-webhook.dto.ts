import { IsString, IsArray, IsNotEmpty, IsOptional } from "class-validator";

export class GhlWebhookDto {
	@IsString()
	contactId: string;

	@IsString()
	locationId: string;

	@IsString()
	messageId: string;

	@IsString()
	@IsNotEmpty()
	type: string;

	@IsString()
	phone: string;

	@IsString()
	message: string;

	@IsArray()
	@IsString({each: true})
	attachments: string[];

	@IsString()
	@IsOptional()
	userId: string;

	@IsString()
	conversationId: string;

	@IsString()
	customUserId?: string;

	@IsString()
	conversationProviderId?: string;
}
