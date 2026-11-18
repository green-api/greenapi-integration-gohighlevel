import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import {
	CALL_RECORDING_FILE_EXTENSION,
	CALL_RECORDING_LINK_KEY_LABEL,
	CALL_RECORDING_SIGNATURE_PARAM,
	CALL_RECORDINGS_PATH,
} from "../constants";

@Injectable()
export class CallRecordingLinksService {
	constructor(private readonly configService: ConfigService) {}

	link(idInstance: bigint | number | string, callId: string): string {
		const appUrl = (this.configService.get<string>("APP_URL") ?? "").replace(/\/+$/, "");
		const instance = String(idInstance);
		return `${appUrl}/${CALL_RECORDINGS_PATH}/${instance}/${encodeURIComponent(callId)}${CALL_RECORDING_FILE_EXTENSION}`
			+ `?${CALL_RECORDING_SIGNATURE_PARAM}=${this.sign(instance, callId)}`;
	}

	verify(idInstance: string, callId: string, signature: unknown): boolean {
		const expected = Buffer.from(this.sign(idInstance, callId));
		const given = Buffer.from(typeof signature === "string" ? signature : "");
		return expected.length === given.length && timingSafeEqual(expected, given);
	}

	private sign(idInstance: string, callId: string): string {
		const key = createHash("sha256")
			.update(CALL_RECORDING_LINK_KEY_LABEL)
			.update(this.configService.get<string>("GHL_CLIENT_SECRET") ?? "")
			.digest();
		return createHmac("sha256", key).update(`${idInstance}:${callId}`).digest("base64url");
	}
}
