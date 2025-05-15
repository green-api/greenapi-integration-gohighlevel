import {
	Controller,
	Post,
	Body,
	Req,
	UseGuards,
	HttpCode,
	HttpStatus, Res,
} from "@nestjs/common";
import { GhlService } from "../ghl/ghl.service";
import { GreenApiLogger, GreenApiWebhook } from "@green-api/greenapi-integration";
import { GhlWebhookDto } from "../ghl/dto/ghl-webhook.dto";
import { GreenApiWebhookGuard } from "./guards/greenapi-webhook.guard";
import { Response } from "express";
import { ConfigService } from "@nestjs/config";

@Controller("webhooks")
export class WebhooksController {
	private readonly logger = GreenApiLogger.getInstance(WebhooksController.name);

	constructor(private readonly ghlService: GhlService, private configService: ConfigService) {}

	@Post("green-api")
	@UseGuards(GreenApiWebhookGuard)
	@HttpCode(HttpStatus.OK)
	async handleGreenApiWebhook(@Body() webhook: GreenApiWebhook, @Res() res: Response): Promise<void> {
		this.logger.debug(`Green API Webhook Body: ${JSON.stringify(webhook)}`);
		res.status(HttpStatus.OK).send();
		try {
			await this.ghlService.handleGreenApiWebhook(webhook, ["incomingMessageReceived", "stateInstanceChanged"]);
		} catch (error) {
			this.logger.error(`Error processing Green API webhook`, error);
		}
	}

	@Post("ghl")
	@HttpCode(HttpStatus.OK)
	async handleGhlWebhook(@Body() ghlWebhook: GhlWebhookDto, @Req() request: Request, @Res() res: Response): Promise<void> {
		this.logger.debug(`GHL Webhook Body: ${JSON.stringify(ghlWebhook)}`);

		const conversationProviderId = ghlWebhook.conversationProviderId === this.configService.get("GHL_CONVERSATION_PROVIDER_ID");

		if (!conversationProviderId) {
			this.logger.error("Conversation provider ID is wrong", ghlWebhook);
			res.status(HttpStatus.OK).send();
			return;
		}

		const locationId = ghlWebhook.locationId || request.headers["x-location-id"];
		if (!locationId) {
			this.logger.error("GHL Location ID missing", ghlWebhook);
			res.status(HttpStatus.OK).send();
			return;
		}

		const greenApiInstance = await this.ghlService.getInstanceByUserId(locationId);
		if (!greenApiInstance) {
			this.logger.warn(`No Green API instance for GHL Location ${locationId}. Ignoring.`);
			res.status(HttpStatus.OK).send();
			return;
		}
		res.status(HttpStatus.OK).send();
		try {
			if (ghlWebhook.type === "SMS" && (ghlWebhook.message || (ghlWebhook.attachments && ghlWebhook.attachments.length > 0))) {
				await this.ghlService.handlePlatformWebhook(ghlWebhook, greenApiInstance.idInstance);
			} else {
				this.logger.log(`Ignoring GHL webhook type ${ghlWebhook.type}.`);
			}
		} catch (error) {
			this.logger.error(`Error processing GHL webhook for location ${locationId}`, error);
		}
	}
}
