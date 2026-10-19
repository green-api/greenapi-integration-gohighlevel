import { IsString, IsArray, IsNotEmpty, IsOptional } from "class-validator";

export class GhlWebhookDto {
	@IsString()
	@IsOptional()
	contactId?: string;

	@IsString()
	locationId: string;

	/**
	 * Absent on the app lifecycle events (INSTALL, UNINSTALL) GHL delivers to this same address:
	 * the marketplace app has only one webhook URL. Requiring it would fail validation before the
	 * handler can acknowledge them.
	 */
	@IsString()
	@IsOptional()
	messageId?: string;

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
