import { Controller, Get, Post, Body, Res, HttpCode, HttpStatus } from "@nestjs/common";
import { Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { GreenApiLogger } from "@green-api/greenapi-integration";
import { ConfigService } from "@nestjs/config";
import * as CryptoJS from "crypto-js";
import { CUSTOM_PAGE_HTML } from "./custom-page.html";

@Controller("app")
export class CustomPageController {
	private readonly logger = GreenApiLogger.getInstance(CustomPageController.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly configService: ConfigService,
	) {}

	@Get("whatsapp")
	async getCustomPage(@Res() res: Response) {
		res.setHeader("X-Frame-Options", "ALLOWALL");
		res.setHeader("Content-Security-Policy", "frame-ancestors *");
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "*");

		res.send(CUSTOM_PAGE_HTML);
	}

	@Post("decrypt-user-data")
	@HttpCode(HttpStatus.OK)
	async decryptUserData(@Body() body: { encryptedData: string }, @Res() res: Response) {
		try {
			const sharedSecret = this.configService.get<string>("GHL_SHARED_SECRET");
			if (!sharedSecret) {
				return res.status(400).json({error: "Shared secret not configured"});
			}

			const decrypted = CryptoJS.AES.decrypt(body.encryptedData, sharedSecret).toString(CryptoJS.enc.Utf8);
			const userData = JSON.parse(decrypted);

			this.logger.log("Decrypted user data:", userData);

			const locationId = userData.activeLocation || userData.companyId;

			if (!locationId) {
				return res.status(400).json({
					error: "No location ID found in user data",
					userData,
				});
			}

			const user = await this.prisma.findUser(locationId);

			return res.json({
				success: true,
				locationId,
				userData,
				user: user ? {
					id: user.id,
					companyId: user.companyId,
					hasTokens: !!(user.accessToken && user.refreshToken),
				} : null,
			});

		} catch (error) {
			this.logger.error("Error decrypting user data:", error);
			return res.status(400).json({
				error: "Failed to decrypt user data",
				details: error.message,
			});
		}
	}
}