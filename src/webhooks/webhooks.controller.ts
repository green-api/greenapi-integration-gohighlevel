import {
	Controller,
	Post,
	Body,
	UseGuards,
	HttpCode,
	HttpStatus, Res, BadRequestException,
	Headers,
} from "@nestjs/common";
import { GhlService, INSTANCE_TAG_PREFIX } from "../ghl/ghl.service";
import type { Instance } from "@prisma/client";
import { GhlContact } from "../types";
import { GreenApiLogger, GreenApiWebhook } from "@green-api/greenapi-integration";
import { GhlWebhookDto } from "../ghl/dto/ghl-webhook.dto";
import { GreenApiWebhookGuard } from "./guards/greenapi-webhook.guard";
import { Response } from "express";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { WorkflowActionDto } from "../ghl/dto/workflow-action.dto";
import { WorkflowTokenGuard } from "./guards/workflow-token.guard";
import { GhlSignatureGuard } from "./guards/ghl-signature.guard";
import { isTransientError } from "../errors";
import { GhlAgencyService } from "../ghl/ghl-agency.service";
import { GREEN_API_WEBHOOK_MAX_ATTEMPTS } from "../constants";

@Controller("webhooks")
export class WebhooksController {
	private readonly logger = GreenApiLogger.getInstance(WebhooksController.name);
	private readonly greenApiWebhookFailures = new Map<string, number>();

	constructor(
		private readonly ghlService: GhlService,
		private configService: ConfigService,
		private prisma: PrismaService,
		private readonly agencyService: GhlAgencyService,
	) {}

	@Post("green-api")
	@UseGuards(GreenApiWebhookGuard)
	@HttpCode(HttpStatus.OK)
	async handleGreenApiWebhook(@Body() webhook: GreenApiWebhook, @Res() res: Response): Promise<void> {
		this.logger.debug(`Green API Webhook Body: ${JSON.stringify(webhook)}`);
		const key = this.greenApiWebhookKey(webhook);
		try {
			await this.ghlService.handleGreenApiWebhook(webhook, [
				"incomingMessageReceived",
				"outgoingMessageReceived",
				"outgoingAPIMessageReceived",
				"outgoingMessageStatus",
				"stateInstanceChanged",
				"incomingCall",
				"outgoingCall",
			]);
			this.greenApiWebhookFailures.delete(key);
			res.status(HttpStatus.OK).send();
		} catch (error) {
			this.logger.error(`Error processing Green API webhook ${key}`, error);
			if (!isTransientError(error)) {
				this.greenApiWebhookFailures.delete(key);
				res.status(HttpStatus.OK).send();
				return;
			}
			const attempts = (this.greenApiWebhookFailures.get(key) ?? 0) + 1;
			if (attempts >= GREEN_API_WEBHOOK_MAX_ATTEMPTS) {
				this.greenApiWebhookFailures.delete(key);
				this.logger.error(`Dropping Green API webhook ${key} after ${attempts} failed attempts`);
				res.status(HttpStatus.OK).send();
				return;
			}
			this.greenApiWebhookFailures.set(key, attempts);
			this.logger.warn(`Green API webhook ${key} failed temporarily (attempt ${attempts}), asking GREEN-API to retry`);
			res.status(HttpStatus.SERVICE_UNAVAILABLE).send();
		}
	}

	private greenApiWebhookKey(webhook: GreenApiWebhook): string {
		const idMessage = "idMessage" in webhook ? webhook.idMessage : "";
		return `${webhook.instanceData?.idInstance}:${webhook.typeWebhook}:${idMessage}:${webhook.timestamp}`;
	}

	@Post("workflow-action")
	@UseGuards(WorkflowTokenGuard)
	@HttpCode(HttpStatus.OK)
	async handleWorkflowAction(
		@Body() workflowAction: WorkflowActionDto,
		@Headers() headers: Record<string, string>,
		@Res() res: Response,
	): Promise<void> {
		// Header values are left out on purpose: the request carries the workflow token.
		this.logger.debug(
			`Workflow action body: ${JSON.stringify(workflowAction)}; header names: ${Object.keys(headers).join(", ")}`,
		);
		try {
			const locationId = headers["locationid"];
			const contactPhone = headers["contactphone"];

			if (!locationId) {
				throw new BadRequestException("Location ID is required in headers");
			}
			if (!contactPhone) {
				throw new BadRequestException("Contact phone is required in headers");
			}
			if (!workflowAction.data.instanceId) {
				throw new BadRequestException("Instance ID is required");
			}

			if (workflowAction.data.audioUrl) {
				const callResult = await this.ghlService.startWorkflowCall(locationId, contactPhone, workflowAction.data);
				res.status(HttpStatus.OK).json(callResult);
				return;
			}

			let actionType: "message" | "file" | "interactive-buttons" | "reply-buttons";
			if (workflowAction.data.url) {
				actionType = "file";
			} else if (workflowAction.data.button1Type) {
				actionType = "interactive-buttons";
			} else if (workflowAction.data.button1Text) {
				actionType = "reply-buttons";
			} else {
				actionType = "message";
			}

			const result = await this.ghlService.handleWorkflowAction(
				locationId,
				contactPhone,
				workflowAction.data,
				actionType,
				workflowAction.extras?.contactId,
			);

			res.status(HttpStatus.OK).json(result);
		} catch (error) {
			this.logger.error(`Error processing workflow action`, error);
			if (error instanceof BadRequestException) {
				res.status(error.getStatus()).json({
					success: false,
					error: error.message,
				});
			} else {
				res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
					success: false,
					error: error.message || "Internal server error while processing workflow action",
				});
			}
		}
	}

	@Post("ghl")
	@UseGuards(GhlSignatureGuard)
	@HttpCode(HttpStatus.OK)
	async handleGhlWebhook(@Body() ghlWebhook: GhlWebhookDto, @Res() res: Response): Promise<void> {
		this.logger.debug(`GHL Webhook Body: ${JSON.stringify(ghlWebhook)}`);

		const locationId = ghlWebhook.locationId;
		const messageId = ghlWebhook.messageId;
		try {
			// App lifecycle events (INSTALL, UNINSTALL) land here too, because the marketplace app
			// has a single webhook address. They are acknowledged rather than rejected: GHL counts
			// a 4xx as a failed delivery and keeps retrying an event there is nothing to do about.
			if (ghlWebhook.type === "INSTALL" || ghlWebhook.type === "UNINSTALL") {
				await this.handleAppLifecycleEvent(ghlWebhook);
				res.status(HttpStatus.OK).send();
				return;
			}
			if (ghlWebhook.type !== "SMS") {
				this.logger.log(`Ignoring GHL webhook type ${ghlWebhook.type}.`);
				res.status(HttpStatus.OK).send();
				return;
			}
			if (messageId && this.ghlService.wasRecentlyPostedByUs(messageId)) {
				this.logger.info(`Skipping echo of self-posted message ${messageId} for location ${locationId}`);
				res.status(HttpStatus.OK).send();
				return;
			}
			if (!ghlWebhook.userId) {
				this.logger.info(`Processing message without userId (likely bot message) for location ${locationId}`);
			}
			const conversationProviderId = ghlWebhook.conversationProviderId === this.configService.get("GHL_CONVERSATION_PROVIDER_ID");

			if (!conversationProviderId) {
				this.logger.error("Conversation provider ID is wrong", ghlWebhook);
				throw new BadRequestException("Conversation provider ID is wrong");
			}

			if (!locationId) {
				this.logger.error("GHL Location ID is missing", ghlWebhook);
				throw new BadRequestException("Location ID is missing");
			}
			if (!ghlWebhook.phone) {
				this.logger.warn(`GHL SMS webhook missing phone, cannot route to WhatsApp`, ghlWebhook);
				res.status(HttpStatus.OK).send();
				return;
			}
			if (!ghlWebhook.message && (!ghlWebhook.attachments || ghlWebhook.attachments.length === 0)) {
				this.logger.warn(`GHL SMS webhook has no message and no attachments, skipping`, ghlWebhook);
				res.status(HttpStatus.OK).send();
				return;
			}
			const instances = await this.prisma.getInstancesByUserId(locationId);
			if (instances.length === 0) {
				this.logger.error(`No instances found for location ${locationId}`);
				res.status(HttpStatus.OK).send();
				return;
			}

			let instanceId: string | bigint | null = null;
			const contact = await this.resolveRoutingContact(locationId, ghlWebhook);
			if (contact?.tags) {
				instanceId = this.selectInstanceIdFromTags(contact.tags, instances);
				if (instanceId) {
					this.logger.log(`Found instance ID from tags: ${instanceId}`);
				}
			}
			if (!instanceId) {
				this.logger.warn(
					`WhatsApp instance ID not found in contact tags for phone ${ghlWebhook.phone}, falling back to location instances`,
					{ghlWebhook, contact},
				);

				if (instances.length === 1) {
					this.logger.log(`Using single instance ${instances[0].idInstance} for location ${locationId}`);
					instanceId = instances[0].idInstance;
				} else {
					const oldestInstance = [...instances].sort((a, b) =>
						a.createdAt.getTime() - b.createdAt.getTime(),
					)[0];
					this.logger.warn(`Multiple instances found for location ${locationId}, using oldest: ${oldestInstance.idInstance}`);
					instanceId = oldestInstance.idInstance;
				}
			}

			const groupChatId = this.ghlService.groupChatIdFromTags(contact?.tags);
			res.status(HttpStatus.OK).send();
			await this.ghlService.handlePlatformWebhook(ghlWebhook, BigInt(instanceId), groupChatId ?? undefined);
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

	/**
	 * The contact id GHL sends with the webhook is the reliable way in: it covers group
	 * conversations too, whose "phone" holds a WhatsApp group id rather than a number and which a
	 * lookup by phone cannot resolve.
	 */
	private async handleAppLifecycleEvent(event: GhlWebhookDto): Promise<void> {
		const {type, installType, locationId, companyId} = event;
		this.logger.info(`GHL app ${type} event`, {installType, locationId, companyId});

		if (type === "INSTALL") {
			if (installType !== "Location" || !locationId || !companyId) return;
			const user = await this.prisma.findUser(locationId);
			if (user?.accessToken) return;
			if (!await this.agencyService.hasCompany(companyId)) {
				this.logger.warn(`No agency tokens for company ${companyId}, location ${locationId} gets its tokens through the OAuth callback`);
				return;
			}
			await this.agencyService.installLocation(companyId, locationId);
			this.logger.log(`Location ${locationId} installed with the agency token of company ${companyId}`);
			return;
		}

		if (locationId) {
			await this.ghlService.uninstallLocation(locationId);
		} else if (companyId) {
			await this.agencyService.removeCompany(companyId);
		}
	}

	private async resolveRoutingContact(locationId: string, ghlWebhook: GhlWebhookDto): Promise<GhlContact | null> {
		if (ghlWebhook.contactId) {
			const contact = await this.ghlService.getGhlContactById(locationId, ghlWebhook.contactId);
			if (contact) return contact;

			this.logger.warn(`GHL contact ${ghlWebhook.contactId} could not be read, falling back to a lookup by phone`);
		}
		if (!ghlWebhook.phone) return null;

		return this.ghlService.getGhlContact(locationId, ghlWebhook.phone);
	}

	/**
	 * Instance tags accumulate on a contact - they are added, never replaced - so a chat served by
	 * several instances carries several of them, including tags of instances that have since been
	 * deleted. Only instances this location still has are considered, and the oldest wins: the
	 * same rule the fallback below uses, so routing stays predictable either way.
	 */
	private selectInstanceIdFromTags(tags: string[], instances: Instance[]): bigint | null {
		const taggedIds = new Set(
			tags
				.filter(tag => tag.toLowerCase().startsWith(INSTANCE_TAG_PREFIX))
				.map(tag => tag.slice(INSTANCE_TAG_PREFIX.length)),
		);
		if (taggedIds.size === 0) return null;

		const tagged = instances.filter(instance => taggedIds.has(instance.idInstance.toString()));
		if (tagged.length === 0) {
			this.logger.warn(`Contact tags point at instances this location no longer has: ${[...taggedIds].join(", ")}`);
			return null;
		}
		if (tagged.length > 1) {
			const oldest = [...tagged].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
			this.logger.warn(`Contact is tagged with several instances (${tagged.map(instance => instance.idInstance).join(", ")}), using the oldest: ${oldest.idInstance}`);
			return oldest.idInstance;
		}

		return tagged[0].idInstance;
	}
}
