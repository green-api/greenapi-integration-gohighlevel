import { CanActivate, ExecutionContext, Injectable, RawBodyRequest, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";
import { createPublicKey, verify } from "crypto";
import { GreenApiLogger } from "@green-api/greenapi-integration";
import { GHL_SIGNATURE_HEADER, GHL_WEBHOOK_PUBLIC_KEY } from "../../constants";

@Injectable()
export class GhlSignatureGuard implements CanActivate {
	private readonly logger = GreenApiLogger.getInstance(GhlSignatureGuard.name);
	private readonly publicKey = createPublicKey(GHL_WEBHOOK_PUBLIC_KEY);

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
		const signature = request.headers[GHL_SIGNATURE_HEADER];
		if (typeof signature !== "string" || !request.rawBody) {
			this.logger.warn("Rejected a GHL webhook without a signature");
			throw new UnauthorizedException("Missing GHL signature");
		}
		if (!this.isValid(request.rawBody, signature)) {
			this.logger.warn("Rejected a GHL webhook with an invalid signature");
			throw new UnauthorizedException("Invalid GHL signature");
		}
		return true;
	}

	private isValid(body: Buffer, signature: string): boolean {
		try {
			return verify(null, body, this.publicKey, Buffer.from(signature, "base64"));
		} catch {
			return false;
		}
	}
}
