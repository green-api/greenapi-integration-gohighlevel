import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as CryptoJS from "crypto-js";
import { GhlUserData } from "../../types";

@Injectable()
export class GhlContextGuard implements CanActivate {
	constructor(private configService: ConfigService) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest();
		const encryptedData = request.headers["x-ghl-context"];
		
		if (!encryptedData) {
			throw new UnauthorizedException("No GHL context provided");
		}
		
		try {
			const sharedSecret = this.configService.get<string>("GHL_SHARED_SECRET")!;
			const decrypted = CryptoJS.AES.decrypt(encryptedData, sharedSecret).toString(CryptoJS.enc.Utf8);
			const userData: GhlUserData = JSON.parse(decrypted);
			if (!("activeLocation" in userData)) {
				throw new UnauthorizedException("This app requires location context access");
			}

			const locationId = userData.activeLocation;
			if (!locationId) {
				throw new UnauthorizedException("No location ID in user context");
			}

			request.locationId = locationId;
			return true;
		} catch (error) {
			throw new UnauthorizedException("Invalid GHL context");
		}
	}
}