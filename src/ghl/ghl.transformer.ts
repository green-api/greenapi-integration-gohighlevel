import { Injectable } from "@nestjs/common";
import {
	MessageTransformer,
	Message,
	GreenApiWebhook,
	MessageWebhook,
	formatPhoneNumber,
	GreenApiLogger,
	extractPhoneNumberFromVCard,
} from "@green-api/greenapi-integration";
import { GhlWebhookDto } from "./dto/ghl-webhook.dto";
import { GhlPlatformMessage, isMessageWebhook, isOutgoingMessageWebhook } from "../types";

@Injectable()
export class GhlTransformer
	implements MessageTransformer<GhlWebhookDto, GhlPlatformMessage> {
	private readonly logger = GreenApiLogger.getInstance(GhlTransformer.name);

	toPlatformMessage(webhook: GreenApiWebhook): GhlPlatformMessage {
		this.logger.debug(`Transforming Green API webhook to GHL Platform Message: ${JSON.stringify(webhook)}`);
		let messageText = "";

		if (isMessageWebhook(webhook)) {
			const isOutgoing = isOutgoingMessageWebhook(webhook);
			const isGroup = webhook.senderData?.chatId?.endsWith("@g.us") || false;
			const senderName = webhook.senderData.senderName || webhook.senderData.senderContactName || "Unknown";
			const senderNumber = webhook.senderData.sender;
			const {text, attachments} = this.renderMessageData(webhook, isOutgoing);
			messageText = text;

			// For incoming group messages the actual author is not the GHL contact (the group is),
			// so the author has to be spelled out. Outgoing group messages are authored by the instance itself.
			if (isGroup && !isOutgoing) {
				messageText = `${senderName} (+${senderNumber.split("@c.us")[0]}):\n\n ${messageText}`;
			}

			return {
				contactId: "placeholder_ghl_contact_id",
				locationId: "placeholder_ghl_location_id",
				message: messageText.trim(),
				direction: isOutgoing ? "outbound" : "inbound",
				attachments: attachments.length > 0 ? attachments : undefined,
				timestamp: new Date(webhook.timestamp * 1000),
				greenApiMessageId: webhook.idMessage,
			};
		}

		if (webhook.typeWebhook === "incomingCall") {
			const callerPhone = webhook.from?.replace("@c.us", "") || "unknown";
			const callStatus = webhook.status;
			switch (callStatus) {
				case "offer":
					messageText = `📞 Incoming call from ${callerPhone}`;
					break;
				case "pickUp":
					messageText = `📞 Call answered from ${callerPhone}`;
					break;
				case "hangUp":
					messageText = `📞 Call ended by recipient - ${callerPhone} (hung up or do not disturb)`;
					break;
				case "missed":
					messageText = `📞 Missed call from ${callerPhone} (caller ended call)`;
					break;
				case "declined":
					messageText = `📞 Call declined from ${callerPhone} (timeout)`;
					break;
				default:
					messageText = `📞 Call event from ${callerPhone} - Status: ${callStatus}`;
			}

			return {
				contactId: "placeholder_ghl_contact_id",
				locationId: "placeholder_ghl_location_id",
				message: messageText,
				direction: "inbound",
				timestamp: new Date(webhook.timestamp * 1000),
			};
		}

		this.logger.error(`Cannot transform unsupported Green API webhook type: ${webhook.typeWebhook}`);
		return {
			contactId: "error_contact_id",
			locationId: "error_location_id",
			message: `Error: Unsupported Green API webhook type ${webhook.typeWebhook}`,
			direction: "inbound",
		};
	}

	/**
	 * Renders the body of a GREEN-API message webhook into GHL message text plus attachments.
	 * Shared by incoming and outgoing (sent from the phone or from the API) notifications;
	 * `isOutgoing` only changes the wording so the GHL conversation reads naturally.
	 */
	private renderMessageData(
		webhook: MessageWebhook,
		isOutgoing: boolean,
	): { text: string; attachments: NonNullable<GhlPlatformMessage["attachments"]> } {
		const attachments: NonNullable<GhlPlatformMessage["attachments"]> = [];
		const actor = isOutgoing ? "You" : "User";
		const fileVerb = isOutgoing ? "Sent" : "Received";
		const msgData = webhook.messageData;
		let messageText = "";

		switch (msgData.typeMessage) {
			case "textMessage":
				messageText = msgData.textMessageData?.textMessage || "";
				break;
			case "extendedTextMessage":
				messageText = msgData.extendedTextMessageData?.text || "";
				break;
			case "quotedMessage":
				messageText = msgData.extendedTextMessageData?.text || "";
				break;
			case "imageMessage":
			case "videoMessage":
			case "documentMessage":
			case "audioMessage":
				messageText = msgData.fileMessageData?.caption || `${fileVerb} a ${msgData.typeMessage.replace("Message", " file")}`;
				if (msgData.fileMessageData?.downloadUrl) {
					attachments.push({
						url: msgData.fileMessageData.downloadUrl,
						fileName: msgData.fileMessageData.fileName,
						type: msgData.fileMessageData.mimeType,
					});
				}
				break;
			case "stickerMessage":
				messageText = msgData.fileMessageData?.caption || `${fileVerb} a sticker`;
				if (msgData.fileMessageData?.downloadUrl) {
					attachments.push({
						url: msgData.fileMessageData.downloadUrl,
						fileName: msgData.fileMessageData.fileName || "sticker.webp",
						type: msgData.fileMessageData.mimeType || "image/webp",
					});
				}
				break;
			case "locationMessage":
				const location = msgData.locationMessageData;
				messageText = [
					`${actor} shared a location:\n`,
					location.nameLocation && `📍 Location: ${location.nameLocation}`,
					location.address && `📮 Address: ${location.address}`,
					`📌 Map: https://www.google.com/maps?q=${location.latitude},${location.longitude}`,
				].filter(Boolean).join("\n");
				break;
			case "contactMessage":
				const contact = msgData.contactMessageData;
				const phone = extractPhoneNumberFromVCard(contact.vcard);
				messageText = [
					`👤 ${actor} shared a contact:`,
					contact.displayName && `Name: ${contact.displayName}`,
					phone && `Phone: ${phone}`,
				].filter(Boolean).join("\n");
				break;
			case "contactsArrayMessage":
				const contactsArray = msgData.messageData.contacts;
				const contactsText = contactsArray
					.map(c => {
						const p = extractPhoneNumberFromVCard(c.vcard);
						return `👤 ${c.displayName}${p ? ` (${p})` : ""}`;
					})
					.join("\n");
				messageText = `${actor} shared multiple contacts:\n${contactsText}`;
				break;
			case "pollMessage":
				const poll = msgData.pollMessageData!;
				messageText = [
					`📊 ${actor} sent a poll: ` + poll.name,
					"Options:",
					...poll.options.map((opt, index) => `${index + 1}. ${opt.optionName}`),
					poll.multipleAnswers ? "(Multiple answers allowed)" : "(Single answer only)",
				].join("\n");
				break;
			case "pollUpdateMessage":
				const pollUpdate = msgData.pollMessageData;
				let updateText = `Poll "${pollUpdate.name}" was updated.\nVotes:\n`;
				pollUpdate.votes.forEach(vote => {
					updateText += `- ${vote.optionName}: ${vote.optionVoters.length} vote(s)\n`;
				});
				messageText = updateText;
				break;
			case "reactionMessage":
				const reaction = msgData.extendedTextMessageData;
				const reactionText = reaction?.text?.trim();
				messageText = reactionText
					? `${reactionText} ${actor} reacted to a message (ID: ${msgData.quotedMessage?.stanzaId || "unknown"})`
					: `${actor} removed a reaction from a message (ID: ${msgData.quotedMessage?.stanzaId || "unknown"})`;
				break;
			case "editedMessage":
				const editedText = msgData.editedMessageData?.textMessage ?? msgData.editedMessageData?.caption ?? "";
				messageText = `✏️ ${actor} edited a message to: "${editedText}" (Original ID: ${msgData.editedMessageData?.stanzaId})`;
				break;
			case "deletedMessage":
				messageText = `🗑️ ${actor} deleted a message (ID: ${msgData.deletedMessageData?.stanzaId || "unknown"})`;
				break;
			case "buttonsMessage":
				const buttons = msgData.buttonsMessage;
				const buttonsList = buttons.buttons.map(button => `• ${button.buttonText}`).join("\n");
				messageText = `🔘 ${actor} sent a message with buttons:\n${buttons.contentText}\n\nButtons:\n${buttonsList}${buttons.footer ? `\n\nFooter: ${buttons.footer}` : ""}`;
				break;
			case "listMessage":
				const list = msgData.listMessage;
				const sectionsList = list.sections
					.map(section => {
						const options = section.rows
							.map(row => `  • ${row.title}${row.description ? `: ${row.description}` : ""}`)
							.join("\n");
						return `${section.title}:\n${options}`;
					})
					.join("\n\n");
				messageText = `📝 ${actor} sent a list message:\n${list.contentText}\n\n${sectionsList}${list.footer ? `\n\nFooter: ${list.footer}` : ""}`;
				break;
			case "templateMessage":
				const template = msgData.templateMessage;
				const templateButtons = template.buttons
					.map(button => {
						if (button.urlButton) return `• Link: ${button.urlButton.displayText}`;
						if (button.callButton) return `• Call: ${button.callButton.displayText}`;
						if (button.quickReplyButton) return `• Reply: ${button.quickReplyButton.displayText}`;
						return null;
					})
					.filter(Boolean)
					.join("\n");
				messageText = `📋 ${actor} sent a template message:\n${template.contentText}${templateButtons ? `\n\nActions:\n${templateButtons}` : ""}${template.footer ? `\n\nFooter: ${template.footer}` : ""}`;
				break;
			case "groupInviteMessage":
				const invite = msgData.groupInviteMessageData;
				messageText = `👥 ${actor} sent a group invitation for "${invite.groupName}".\nCaption: ${invite.caption}`;
				break;

			case "interactiveButtons":
				const interactiveButtons = msgData.interactiveButtons;
				const intButtonsList = interactiveButtons.buttons
					?.map((button) => {
						let buttonDescription = `• ${button.buttonText}`;
						if (button.type === "url" && button.url) {
							buttonDescription += ` (${button.url})`;
						} else if (button.type === "call" && button.phoneNumber) {
							buttonDescription += ` (📞 ${button.phoneNumber})`;
						} else if (button.type === "copy" && button.copyCode) {
							buttonDescription += ` (📋 Copy: "${button.copyCode}")`;
						}
						return buttonDescription;
					})
					.join("\n") || "";

				messageText = [
					"🔘 Interactive message with buttons:",
					interactiveButtons.titleText && `Title: ${interactiveButtons.titleText}`,
					interactiveButtons.contentText,
					intButtonsList && `\nButtons:\n${intButtonsList}`,
					interactiveButtons.footerText && `\nFooter: ${interactiveButtons.footerText}`,
				].filter(Boolean).join("\n");
				break;

			case "interactiveButtonsReply":
				const interactiveButtonsReply = msgData.interactiveButtonsReply;
				const replyButtonsList = interactiveButtonsReply.buttons
					?.map((button) => `• ${button.buttonText}`)
					.join("\n") || "";

				messageText = [
					"💬 Interactive reply message with buttons:",
					interactiveButtonsReply.titleText && `Title: ${interactiveButtonsReply.titleText}`,
					interactiveButtonsReply.contentText,
					replyButtonsList && `\nReply options:\n${replyButtonsList}`,
					interactiveButtonsReply.footerText && `\nFooter: ${interactiveButtonsReply.footerText}`,
				].filter(Boolean).join("\n");
				break;

			case "templateButtonsReplyMessage":
				const templateButtonReply = msgData.templateButtonReplyMessage;
				messageText = `✅ Button clicked:\n\n${templateButtonReply.selectedDisplayText}`;
				break;

			default:
				this.logger.warn(`Unsupported GREEN-API message type`, msgData);
				messageText = isOutgoing
					? "An unsupported message type was sent"
					: "User sent an unsupported message type";
		}

		return {text: messageText, attachments};
	}

	toGreenApiMessage(ghlWebhook: GhlWebhookDto): Message {
		this.logger.debug(`Transforming GHL Webhook to Green API Message: ${JSON.stringify(ghlWebhook)}`);

		if (ghlWebhook.type === "SMS" && ghlWebhook.phone) {
			const isGroupChatId = ghlWebhook.phone.length > 16;
			const chatId = formatPhoneNumber(ghlWebhook.phone, isGroupChatId ? "group" : "private");

			if (ghlWebhook.attachments && ghlWebhook.attachments.length > 0) {
				const attachmentUrl = ghlWebhook.attachments[0];
				this.logger.debug(`GHL webhook has attachments. Processing as url-file. Attachment URL: ${attachmentUrl}`);
				return {
					type: "url-file",
					chatId: chatId,
					file: {
						url: attachmentUrl,
						fileName: `${Date.now()}_${ghlWebhook.messageId || "unknown"}`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
					},
					caption: ghlWebhook.message || "",
				};
			} else if (ghlWebhook.message) {
				this.logger.debug(`GHL webhook has a text message. Processing as text. Message: "${ghlWebhook.message}"`);
				return {
					type: "text",
					chatId: chatId,
					message: ghlWebhook.message,
				};
			} else {
				this.logger.warn(`GHL SMS webhook for ${ghlWebhook.phone} has no text content and no attachments. Ignoring.`);
				throw new Error(`GHL SMS webhook has no message content or attachments for ${ghlWebhook.phone}`);
			}
		}

		this.logger.error(`Cannot transform GHL webhook. Type: ${ghlWebhook.type}, Phone: ${ghlWebhook.phone}, Msg: ${ghlWebhook.message}`);
		throw new Error(`Unsupported GHL webhook for Green API. Type: ${ghlWebhook.type}, Phone: ${ghlWebhook.phone}`);
	}
}
