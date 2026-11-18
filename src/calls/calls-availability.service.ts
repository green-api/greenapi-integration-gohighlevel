import { Injectable } from "@nestjs/common";
import { CallError, CallsRtcConnection, GreenApiClient, GreenApiLogger } from "@green-api/greenapi-integration";
import { Instance } from "@prisma/client";
import {
	CALLS_AVAILABILITY_PROBE_TIMEOUT_MS,
	CALLS_AVAILABILITY_TTL_MS,
	CALLS_REFUSAL_ERROR_CODES,
} from "../constants";

interface CachedAvailability {
	available: boolean;
	checkedAt: number;
}

@Injectable()
export class CallsAvailabilityService {
	private readonly logger = GreenApiLogger.getInstance(CallsAvailabilityService.name);
	private readonly cache = new Map<string, CachedAvailability>();

	async isAvailable(instance: Instance): Promise<boolean> {
		const key = instance.idInstance.toString();
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.checkedAt < CALLS_AVAILABILITY_TTL_MS) {
			return cached.available;
		}

		const available = await this.probe(instance);
		if (available === undefined) {
			return false;
		}
		this.cache.set(key, {available, checkedAt: Date.now()});
		this.logger.info(`Calls are ${available ? "available" : "not available"} on instance ${key}`);
		return available;
	}

	private probe(instance: Instance): Promise<boolean | undefined> {
		const client = new GreenApiClient({idInstance: instance.idInstance, apiTokenInstance: instance.apiTokenInstance});
		const connection = new CallsRtcConnection(client.getCallsRtcUrl());

		return new Promise((resolve) => {
			let settled = false;
			const finish = (available: boolean | undefined) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				connection.removeAllListeners();
				connection.on("closed", () => undefined);
				connection.close();
				resolve(available);
			};
			const timer = setTimeout(() => finish(undefined), CALLS_AVAILABILITY_PROBE_TIMEOUT_MS);

			connection.on("frame", (frame: {type: string}) => {
				if (frame.type === "state") finish(true);
				else if (frame.type === "error") finish(false);
			});
			connection.on("closed", (error: CallError) => finish(CALLS_REFUSAL_ERROR_CODES.includes(error.code) ? false : undefined));
			connection.open().catch((error: unknown) => {
				finish(error instanceof CallError && CALLS_REFUSAL_ERROR_CODES.includes(error.code) ? false : undefined);
			});
		});
	}
}
