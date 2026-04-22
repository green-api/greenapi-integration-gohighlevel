import { IsString, IsArray, IsNotEmpty, IsOptional } from "class-validator";

export class GhlWebhookDto {
	@IsString()
	@IsOptional()
	contactId?: string;

	@IsString()
	locationId: string;

	@IsString()
	messageId: string;

	@IsString()
	@IsNotEmpty()
	type: string;

	@IsString()
	@IsOptional()
	phone?: string;

	@IsString()
	@IsOptional()
	message?: string;

	@IsArray()
	@IsString({each: true})
	@IsOptional()
	attachments?: string[];

	@IsString()
	@IsOptional()
	userId?: string;

	@IsString()
	@IsOptional()
	conversationId?: string;

	@IsString()
	@IsOptional()
	customUserId?: string;

	@IsString()
	@IsOptional()
	conversationProviderId?: string;
}
