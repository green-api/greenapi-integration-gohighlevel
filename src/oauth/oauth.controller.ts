import {
	Controller, Get, Query, Res, HttpException, HttpStatus,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import axios from "axios";
import { PrismaService } from "../prisma/prisma.service";
import { GhlOAuthCallbackDto } from "./dto/ghl-oauth-callback.dto";
import { GreenApiLogger } from "@green-api/greenapi-integration";

@Controller("oauth")
export class GhlOauthController {
	private readonly logger = GreenApiLogger.getInstance(GhlOauthController.name);
	private readonly ghlServicesUrl = "https://services.leadconnectorhq.com";

	constructor(
		private readonly configService: ConfigService,
		private readonly prisma: PrismaService,
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
			  <!DOCTYPE html>
			  <html lang="en">
				<head>
				  <meta charset="UTF-8">
				  <meta name="viewport" content="width=device-width, initial-scale=1.0">
				  <title>OAuth Authentication Complete</title>
				  <style>
					* {
					  margin: 0;
					  padding: 0;
					  box-sizing: border-box;
					}
					
					body { 
					  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
					  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
					  min-height: 100vh;
					  display: flex;
					  align-items: center;
					  justify-content: center;
					  padding: 20px;
					}
					
					.container { 
					  background: white;
					  padding: 40px;
					  border-radius: 20px;
					  box-shadow: 0 20px 60px rgba(0,0,0,0.15);
					  text-align: center;
					  max-width: 500px;
					  width: 100%;
					  position: relative;
					  overflow: hidden;
					}
					
					.container::before {
					  content: '';
					  position: absolute;
					  top: 0;
					  left: 0;
					  right: 0;
					  height: 4px;
					  background: linear-gradient(90deg, #3B9702, #25D366);
					}
					
					.logo {
					  width: 80px;
					  height: 80px;
					  margin: 0 auto 30px;
					  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.1));
					}
					
					h1 { 
					  color: #3B9702;
					  font-size: 2rem;
					  font-weight: 700;
					  margin-bottom: 20px;
					}
					
					.success-icon {
					  font-size: 4rem;
					  margin-bottom: 20px;
					  animation: bounce 1s ease-in-out;
					}
					
					@keyframes bounce {
					  0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
					  40% { transform: translateY(-10px); }
					  60% { transform: translateY(-5px); }
					}
					
					p { 
					  font-size: 1.1rem;
					  color: #636e72;
					  line-height: 1.6;
					  margin-bottom: 15px;
					}
					
					.highlight {
					  background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
					  color: #155724;
					  padding: 15px;
					  border-radius: 10px;
					  margin: 20px 0;
					  font-weight: 600;
					}
					
					.close-note {
					  font-size: 0.9rem;
					  color: #a0a0a0;
					  font-style: italic;
					  margin-top: 30px;
					}
					
					@media (max-width: 480px) {
					  .container {
						padding: 30px 20px;
					  }
					  
					  h1 {
						font-size: 1.5rem;
					  }
					  
					  .logo {
						width: 60px;
						height: 60px;
					  }
					}
				  </style>
				</head>
				<body>
				  <div class="container">
					<svg class="logo" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="1000px" height="1000px" version="1.1" style="shape-rendering:geometricPrecision; text-rendering:geometricPrecision; image-rendering:optimizeQuality; fill-rule:evenodd; clip-rule:evenodd" viewBox="0 0 98.822 98.823" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xodm="http://www.corel.com/coreldraw/odm/2003">
					  <defs>
						<style type="text/css">
						  <![CDATA[
						  .fil0 {fill:#3B9702}
						  .fil1 {fill:white}
						  .fil2 {fill:white;fill-rule:nonzero}
						  ]]>
						</style>
					  </defs>
					  <g id="Слой_x0020_1">
						<metadata id="CorelCorpID_0Corel-Layer"/>
						<g id="_2274748282416">
						  <circle class="fil0" cx="49.411" cy="49.411" r="49.411"/>
						  <path class="fil1" d="M80.075 18.748c-7.846,-7.847 -18.688,-12.701 -30.663,-12.701 -11.976,0 -22.818,4.854 -30.664,12.701 -7.847,7.847 -12.701,18.689 -12.701,30.664 0,11.975 4.854,22.817 12.701,30.664 7.847,7.846 18.689,12.7 30.664,12.7 11.975,0 22.816,-4.853 30.663,-12.7 7.847,-7.847 12.701,-18.689 12.701,-30.664 0,-11.975 -4.854,-22.817 -12.701,-30.664zm-3.425 3.425c-6.971,-6.97 -16.601,-11.282 -27.238,-11.282 -10.638,0 -20.269,4.312 -27.239,11.282 -6.97,6.97 -11.282,16.601 -11.282,27.239 0,10.637 4.312,20.268 11.282,27.238 6.97,6.97 16.601,11.282 27.239,11.282 10.637,0 20.267,-4.311 27.238,-11.282 6.97,-6.97 11.281,-16.601 11.281,-27.238 0,-10.638 -4.311,-20.268 -11.281,-27.239z"/>
						  <path class="fil2" d="M50.839 74.623c-3.9,0 -7.417,-0.627 -10.552,-1.88 -3.134,-1.254 -5.838,-3.018 -8.113,-5.293 -2.275,-2.275 -4.016,-4.945 -5.224,-8.01 -1.207,-3.064 -1.81,-6.407 -1.81,-10.029 0,-3.622 0.65,-6.964 1.95,-10.029 1.3,-3.064 3.122,-5.734 5.466,-8.009 2.346,-2.275 5.131,-4.04 8.358,-5.293 3.227,-1.254 6.768,-1.881 10.622,-1.881 2.646,0 5.165,0.348 7.556,1.045 2.391,0.697 4.573,1.648 6.547,2.855 1.973,1.208 3.61,2.577 4.91,4.11l-7.313 7.661c-1.671,-1.579 -3.47,-2.821 -5.397,-3.726 -1.927,-0.906 -4.098,-1.358 -6.513,-1.358 -1.996,0 -3.842,0.359 -5.536,1.079 -1.695,0.72 -3.181,1.741 -4.457,3.065 -1.277,1.323 -2.264,2.878 -2.961,4.666 -0.696,1.787 -1.044,3.726 -1.044,5.815 0,2.09 0.371,4.017 1.114,5.781 0.743,1.765 1.776,3.308 3.1,4.632 1.322,1.323 2.866,2.356 4.631,3.099 1.764,0.743 3.668,1.114 5.711,1.114 1.439,0 2.774,-0.22 4.005,-0.661 1.23,-0.442 2.321,-1.045 3.273,-1.811 0.952,-0.767 1.695,-1.672 2.229,-2.717 0.533,-1.045 0.801,-2.17 0.801,-3.377l0 -1.811 1.532 2.367 -13.303 0 0 -9.402 22.914 0c0.093,0.511 0.163,1.207 0.209,2.09 0.046,0.882 0.081,1.729 0.104,2.542 0.024,0.813 0.035,1.451 0.035,1.915 0,3.157 -0.568,6.047 -1.706,8.671 -1.137,2.624 -2.739,4.887 -4.806,6.791 -2.066,1.903 -4.492,3.378 -7.278,4.422 -2.785,1.045 -5.804,1.567 -9.054,1.567l0 0z"/>
						</g>
					  </g>
					</svg>
					
					<div class="success-icon">✅</div>
					<h1>Authentication Complete!</h1>
					<p>Your workspace has been successfully connected to GREEN-API.</p>
					
					<div class="highlight">
					  You can now manage your WhatsApp instances through the GREEN-API WhatsApp app's page (located in the navigation panel on the left).
					</div>
					
					<div class="close-note">
					  This page can now be safely closed.
					</div>
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
}