import { Injectable } from "@nestjs/common";
import {
	MessageTransformer,
	Message,
	GreenApiWebhook,
	formatPhoneNumber,
	GreenApiLogger,
	extractPhoneNumberFromVCard,
} from "@green-api/greenapi-integration";
import { GhlWebhookDto } from "./dto/ghl-webhook.dto";
import { GhlPlatformMessage } from "../types";

@Injectable()
export class GhlTransformer
	implements MessageTransformer<GhlWebhookDto, GhlPlatformMessage> {
	private readonly logger = GreenApiLogger.getInstance(GhlTransformer.name);

	toPlatformMessage(webhook: GreenApiWebhook): GhlPlatformMessage {
		this.logger.debug(`Transforming Green API webhook to GHL Platform Message: ${JSON.stringify(webhook)}`);
		let messageText = "";
		const attachments: GhlPlatformMessage["attachments"] = [];

		if (webhook.typeWebhook === "incomingMessageReceived") {
			const isGroup = webhook.senderData?.chatId?.endsWith("@g.us") || false;
			const senderName = webhook.senderData.senderName || webhook.senderData.senderContactName || "Unknown";
			const senderNumber = webhook.senderData.sender;
			const msgData = webhook.messageData;
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
					messageText = msgData.fileMessageData?.caption || `Received a ${msgData.typeMessage.replace("Message", " file")}`;
					if (msgData.fileMessageData?.downloadUrl) {
						attachments.push({
							url: msgData.fileMessageData.downloadUrl,
							fileName: msgData.fileMessageData.fileName,
							type: msgData.fileMessageData.mimeType,
						});
					}
					break;
				case "stickerMessage":
					messageText = msgData.fileMessageData?.caption || `Received a sticker`;
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
						"User shared a location:\n",
						location.nameLocation && `📍 Location: ${location.nameLocation}`,
						location.address && `📮 Address: ${location.address}`,
						`📌 Map: https://www.google.com/maps?q=${location.latitude},${location.longitude}`,
					].filter(Boolean).join("\n");
					break;
				case "contactMessage":
					const contact = msgData.contactMessageData;
					const phone = extractPhoneNumberFromVCard(contact.vcard);
					messageText = [
						"👤 User shared a contact:",
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
					messageText = `User shared multiple contacts:\n${contactsText}`;
					break;
				case "pollMessage":
					const poll = msgData.pollMessageData!;
					messageText = [
						"📊 User sent a poll: " + poll.name,
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
				case "editedMessage":
					const editedText = msgData.editedMessageData?.textMessage ?? msgData.editedMessageData?.caption ?? "";
					messageText = `✏️ User edited a message to: "${editedText}" (Original ID: ${msgData.editedMessageData?.stanzaId})`;
					break;
				case "deletedMessage":
					messageText = `🗑️ User deleted a message (ID: ${msgData.deletedMessageData?.stanzaId || "unknown"})`;
					break;
				case "buttonsMessage":
					const buttons = msgData.buttonsMessage;
					const buttonsList = buttons.buttons.map(button => `• ${button.buttonText}`).join("\n");
					messageText = `🔘 User sent a message with buttons:\n${buttons.contentText}\n\nButtons:\n${buttonsList}${buttons.footer ? `\n\nFooter: ${buttons.footer}` : ""}`;
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
					messageText = `📝 User sent a list message:\n${list.contentText}\n\n${sectionsList}${list.footer ? `\n\nFooter: ${list.footer}` : ""}`;
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
					messageText = `📋 User sent a template message:\n${template.contentText}${templateButtons ? `\n\nActions:\n${templateButtons}` : ""}${template.footer ? `\n\nFooter: ${template.footer}` : ""}`;
					break;
				case "groupInviteMessage":
					const invite = msgData.groupInviteMessageData;
					messageText = `👥 User sent a group invitation for "${invite.groupName}".\nCaption: ${invite.caption}`;
					break;
				default:
					this.logger.warn(`Unsupported Green API message type: ${msgData.typeMessage}`);
					messageText = `User sent an unsupported message type`;
			}

			if (isGroup) {
				messageText = `${senderName} (+${senderNumber.split("@c.us")[0]}):\n\n ${messageText}`;
			}

			return {
				contactId: "placeholder_ghl_contact_id",
				locationId: "placeholder_ghl_location_id",
				message: messageText.trim(),
				direction: "inbound",
				attachments: attachments.length > 0 ? attachments : undefined,
				timestamp: new Date(webhook.timestamp * 1000),
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