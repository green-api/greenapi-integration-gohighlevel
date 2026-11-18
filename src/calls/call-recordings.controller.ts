import { Controller, Get, HttpStatus, Param, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { GreenApiClient, GreenApiLogger } from "@green-api/greenapi-integration";
import { PrismaService } from "../prisma/prisma.service";
import { CallRecordingLinksService } from "./call-recording-links.service";
import {
	CALL_RECORDING_FILE_EXTENSION,
	CALL_RECORDING_REDIRECT_CACHE_MS,
	CALL_RECORDING_SIGNATURE_PARAM,
	CALL_RECORDINGS_PATH,
} from "../constants";

@Controller(CALL_RECORDINGS_PATH)
export class CallRecordingsController {
	private readonly logger = GreenApiLogger.getInstance(CallRecordingsController.name);
	private readonly downloadUrls = new Map<string, {url: string; expiresAt: number}>();

	constructor(
		private readonly prisma: PrismaService,
		private readonly links: CallRecordingLinksService,
	) {}

	@Get(":idInstance/:file")
	async redirectToRecording(
		@Param("idInstance") idInstance: string,
		@Param("file") file: string,
		@Query(CALL_RECORDING_SIGNATURE_PARAM) signature: unknown,
		@Res() res: Response,
	): Promise<void> {
		const callId = file.endsWith(CALL_RECORDING_FILE_EXTENSION) ? file.slice(0, -CALL_RECORDING_FILE_EXTENSION.length) : "";
		if (!/^\d+$/.test(idInstance) || !callId || !this.links.verify(idInstance, callId, signature)) {
			res.status(HttpStatus.NOT_FOUND).end();
			return;
		}

		const cacheKey = `${idInstance}:${callId}`;
		const now = Date.now();
		for (const [key, entry] of this.downloadUrls) {
			if (entry.expiresAt <= now) this.downloadUrls.delete(key);
		}
		const cached = this.downloadUrls.get(cacheKey);
		if (cached) {
			res.setHeader("Cache-Control", "no-store");
			res.redirect(HttpStatus.FOUND, cached.url);
			return;
		}

		const instance = await this.prisma.getInstance(BigInt(idInstance));
		if (!instance) {
			res.status(HttpStatus.NOT_FOUND).end();
			return;
		}

		try {
			const client = new GreenApiClient({idInstance: instance.idInstance, apiTokenInstance: instance.apiTokenInstance});
			const recording = await client.getCallRecording({idMessage: callId});
			if (recording.status === "ready" && recording.downloadUrl) {
				this.downloadUrls.set(cacheKey, {url: recording.downloadUrl, expiresAt: Date.now() + CALL_RECORDING_REDIRECT_CACHE_MS});
				res.setHeader("Cache-Control", "no-store");
				res.redirect(HttpStatus.FOUND, recording.downloadUrl);
				return;
			}
			res.status(recording.status === "processing" ? HttpStatus.CONFLICT : HttpStatus.NOT_FOUND).end();
		} catch (error) {
			this.logger.warn(`Could not get the recording of call ${callId} on instance ${idInstance}: ${error.message}`);
			res.status(HttpStatus.BAD_GATEWAY).end();
		}
	}
}
