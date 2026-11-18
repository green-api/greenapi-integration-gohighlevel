import { HttpException, HttpStatus } from "@nestjs/common";
import axios from "axios";
import { IntegrationError } from "@green-api/greenapi-integration";
import { PRISMA_TRANSIENT_ERROR_CODES } from "./constants";

function statusOf(error: unknown): number | undefined {
	if (error instanceof HttpException) return error.getStatus();
	if (error instanceof IntegrationError) return error.statusCode;
	if (axios.isAxiosError(error)) return error.response?.status;
	return undefined;
}

export function isTransientError(error: unknown): boolean {
	const status = statusOf(error);
	if (status !== undefined) {
		return status === HttpStatus.TOO_MANY_REQUESTS || status >= HttpStatus.INTERNAL_SERVER_ERROR;
	}
	if (axios.isAxiosError(error)) {
		return true;
	}
	const code = (error as { code?: unknown } | null)?.code;
	if (typeof code === "string" && PRISMA_TRANSIENT_ERROR_CODES.includes(code)) {
		return true;
	}
	return (error as Error | null)?.name === "PrismaClientInitializationError";
}
