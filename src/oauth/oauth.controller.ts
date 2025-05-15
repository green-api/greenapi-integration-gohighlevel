import {
	Controller, Get, Post, Query, Res, HttpException, HttpStatus, Body, UsePipes, ValidationPipe, HttpCode,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import axios from "axios";
import { PrismaService } from "../prisma/prisma.service";
import { GhlOAuthCallbackDto } from "./dto/ghl-oauth-callback.dto";
import { GhlService } from "../ghl/ghl.service";
import { GhlExternalAuthPayloadDto } from "./dto/external-auth-payload.dto";
import { GreenApiLogger, IntegrationError } from "@green-api/greenapi-integration";

@Controller("oauth")
export class GhlOauthController {
	private readonly logger = GreenApiLogger.getInstance(GhlOauthController.name);
	private readonly ghlServicesUrl = "https://services.leadconnectorhq.com";

	constructor(
		private readonly configService: ConfigService,
		private readonly prisma: PrismaService,
		private readonly ghlService: GhlService,
	) {}

	@Get("callback")
	async callback(@Query() query: GhlOAuthCallbackDto, @Res() res: Response) {
		const {code} = query;

		this.logger.log(`GHL OAuth callback received. Code: ${code ? "present" : "MISSING"}`);

		if (!code) {
			this.logger.error("GHL OAuth callback missing code.");
			throw new HttpException("Invalid OAuth callback from GHL (missing code).", HttpStatus.BAD_REQUEST);
		}

		const clientId = this.configService.get<string>("GHL_CLIENT_ID")!;
		const clientSecret = this.configService.get<string>("GHL_CLIENT_SECRET")!;
		const appUrl = this.configService.get<string>("APP_URL")!;

		const tokenRequestBody = new URLSearchParams({
			client_id: clientId, client_secret: clientSecret,
			grant_type: "authorization_code",
			code: code,
			redirect_uri: appUrl + "/oauth/callback",
			user_type: "Location",
		});

		try {
			const tokenResponse = await axios.post(
				`${this.ghlServicesUrl}/oauth/token`,
				tokenRequestBody.toString(),
				{headers: {"Content-Type": "application/x-www-form-urlencoded"}},
			);

			const {
				access_token, refresh_token, expires_in, scope, companyId: respCompanyId, locationId: respLocationId,
			} = tokenResponse.data;

			if (!respLocationId) {
				this.logger.error("GHL Token response did not include locationId!", tokenResponse.data);
				throw new HttpException("Failed to get Location ID from GHL token response.", HttpStatus.INTERNAL_SERVER_ERROR);
			}

			this.logger.log(`GHL Tokens obtained for Location ${respLocationId}, Company ${respCompanyId}. Scopes: ${scope}`);
			const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

			await this.prisma.user.upsert({
				where: {id: respLocationId},
				update: {
					accessToken: access_token,
					refreshToken: refresh_token,
					tokenExpiresAt,
					companyId: respCompanyId,
				},
				create: {
					id: respLocationId,
					accessToken: access_token,
					refreshToken: refresh_token,
					tokenExpiresAt,
					companyId: respCompanyId,
				},
			});
			this.logger.log(`Stored/updated GHL tokens for User (Location ID): ${respLocationId}`);
			return res.status(200).send(`
			  <html lang="en">
				<head>
				  <title>OAuth Complete</title>
				  <style>
					body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
					.container { padding: 20px; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
					h1 { color: #4CAF50; }
					p { font-size: 1.1em; }
				  </style>
				</head>
				<body>
				  <div class="container">
					<h1>Almost There!</h1>
					<p>GREEN-API app has been successfully installed for your account.</p>
					<p>Please return to the previous tab where you started the app installation to complete the final authentication step.</p>
					<p>This page can now be closed.</p>
				  </div>
				</body>
			  </html>
			`);
		} catch (error) {
			this.logger.error("Error exchanging GHL OAuth code for tokens:", error);
			const errorDesc = (error.response?.data as any)?.error_description || (error.response?.data as any)?.error || "Unknown GHL OAuth error";
			throw new HttpException(
				`Failed to obtain GHL tokens: ${errorDesc}`,
				error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
			);
		}
	}

	@Post("external-auth-credentials")
	@HttpCode(HttpStatus.OK)
	@UsePipes(new ValidationPipe({transform: true, whitelist: true, forbidNonWhitelisted: true}))
	async handleExternalAuthCredentials(
		@Body() data: GhlExternalAuthPayloadDto,
	): Promise<{ success: boolean; message?: string; error?: string }> {
		this.logger.log(`Received external authentication credentials for locationId: ${data.locationId}`);
		this.logger.debug(`External Auth Payload: ${JSON.stringify(data)}`);

		const ghlUser = await this.prisma.findUser(data.locationId[0]);
		if (!ghlUser) {
			this.logger.error(`External auth received for locationId ${data.locationId}, but no corresponding user (OAuth tokens) found. OAuth step might have failed or been skipped.`);
			throw new HttpException(
				{
					success: false,
					message: "User authentication (OAuth) for this location not found. Please ensure OAuth is completed first.",
				},
				HttpStatus.BAD_REQUEST,
			);
		}

		try {
			await this.ghlService.createGreenApiInstanceForUser(
				data.locationId[0],
				BigInt(data.instance_id),
				data.api_token_instance,
			);
			this.logger.log(`Successfully linked Green-API instance for location ${data.locationId} via external auth.`);
			return {success: true, message: "Green-API instance connected successfully."};
		} catch (error) {
			this.logger.error(`Error linking Green-API instance for location ${data.locationId} via external auth: ${error.message}`, error.stack);
			let errorMessage = "Failed to connect Green-API instance.";
			let errorCode = "CONNECTION_FAILED";
			let httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;

			if (error instanceof IntegrationError && error.code === "INVALID_CREDENTIALS") {
				errorMessage = "Invalid Green-API Instance ID or API Token provided. Please check your credentials and try installing the app again.";
				errorCode = error.code;
				httpStatus = HttpStatus.BAD_REQUEST;
			} else if (error instanceof HttpException) {
				errorMessage = error.message;
				httpStatus = error.getStatus();
			}
			throw new HttpException(
				{success: false, message: errorMessage, error: errorCode},
				httpStatus,
			);
		}
	}
}
