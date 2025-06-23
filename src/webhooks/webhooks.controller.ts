import {
	Controller,
	Post,
	Body,
	Req,
	UseGuards,
	HttpCode,
	HttpStatus, Res, BadRequestException,
} from "@nestjs/common";
import { GhlService } from "../ghl/ghl.service";
import { GreenApiLogger, GreenApiWebhook } from "@green-api/greenapi-integration";
import { GhlWebhookDto } from "../ghl/dto/ghl-webhook.dto";
import { GreenApiWebhookGuard } from "./guards/greenapi-webhook.guard";
import { Response } from "express";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";

@Controller("webhooks")
export class WebhooksController {
	private readonly logger = GreenApiLogger.getInstance(WebhooksController.name);

	constructor(private readonly ghlService: GhlService, private configService: ConfigService, private prisma: PrismaService) {}

	@Post("green-api")
	@UseGuards(GreenApiWebhookGuard)
	@HttpCode(HttpStatus.OK)
	async handleGreenApiWebhook(@Body() webhook: GreenApiWebhook, @Res() res: Response): Promise<void> {
		this.logger.debug(`Green API Webhook Body: ${JSON.stringify(webhook)}`);
		res.status(HttpStatus.OK).send();
		try {
			await this.ghlService.handleGreenApiWebhook(webhook, ["incomingMessageReceived", "stateInstanceChanged", "incomingCall"]);
		} catch (error) {
			this.logger.error(`Error processing Green API webhook`, error);
		}
	}

	@Post("ghl")
	@HttpCode(HttpStatus.OK)
	async handleGhlWebhook(@Body() ghlWebhook: GhlWebhookDto, @Req() request: Request, @Res() res: Response): Promise<void> {
		this.logger.debug(`GHL Webhook Body: ${JSON.stringify(ghlWebhook)}`);

		const locationId = ghlWebhook.locationId || request.headers["x-location-id"];
		const messageId = ghlWebhook.messageId;
		try {
			const conversationProviderId = ghlWebhook.conversationProviderId === this.configService.get("GHL_CONVERSATION_PROVIDER_ID");

			if (!conversationProviderId) {
				this.logger.error("Conversation provider ID is wrong", ghlWebhook);
				throw new BadRequestException("Conversation provider ID is wrong");
			}

			const locationId = ghlWebhook.locationId || request.headers["x-location-id"];
			if (!locationId) {
				this.logger.error("GHL Location ID is missing", ghlWebhook);
				throw new BadRequestException("Location ID is missing");
			}
			let instanceId: string | bigint | null = null;
			const contact = await this.ghlService.getGhlContact(locationId, ghlWebhook.phone);
			if (contact?.tags) {
				instanceId = this.extractInstanceIdFromTags(contact.tags);
				if (instanceId) {
					this.logger.log(`Found instance ID from tags: ${instanceId}`);
				}
			}
			if (!instanceId) {
				this.logger.warn(
					`WhatsApp instance ID not found in contact custom fields for phone ${ghlWebhook.phone}, falling back to location instances`,
					{ghlWebhook, contact},
				);

				const instances = await this.prisma.getInstancesByUserId(locationId);

				if (instances.length === 0) {
					this.logger.error(`No instances found for location ${locationId}`);
					res.status(HttpStatus.OK).send();
					return;
				}
				if (instances.length === 1) {
					this.logger.log(`Using single instance ${instances[0].idInstance} for location ${locationId}`);
					instanceId = instances[0].idInstance;
				} else {
					const oldestInstance = instances.sort((a, b) =>
						a.createdAt.getTime() - b.createdAt.getTime(),
					)[0];
					this.logger.warn(`Multiple instances found for location ${locationId}, using oldest: ${oldestInstance.idInstance}`);
					instanceId = oldestInstance.idInstance;
				}
			}

			res.status(HttpStatus.OK).send();
			if (ghlWebhook.type === "SMS" && (ghlWebhook.message || (ghlWebhook.attachments && ghlWebhook.attachments.length > 0))) {
				await this.ghlService.handlePlatformWebhook(ghlWebhook, BigInt(instanceId));
			} else {
				this.logger.log(`Ignoring GHL webhook type ${ghlWebhook.type}.`);
			}
		} catch (error) {
			this.logger.error(`Error processing GHL webhook for location ${locationId}`, error);
			if (locationId && messageId) {
				try {
					await this.ghlService.updateGhlMessageStatus(locationId, messageId, "failed", {
						code: "500",
						type: "message_processing_error",
						message: error.message || "Failed to process outbound message",
					});
				} catch (statusUpdateError) {
					this.logger.error(
						`Failed to update GHL message ${messageId} status to "failed" for location ${locationId}. Error: ${statusUpdateError.message}`,
						statusUpdateError,
					);
				}
			}
			res.status(HttpStatus.OK).send();
		}
	}

	private extractInstanceIdFromTags(tags: string[]): string | null {
		if (!tags || tags.length === 0) return null;

		const instanceTag = tags.find(tag => tag.startsWith("whatsapp-instance-"));
		if (instanceTag) {
			return instanceTag.replace("whatsapp-instance-", "");
		}
		return null;
	}
}
