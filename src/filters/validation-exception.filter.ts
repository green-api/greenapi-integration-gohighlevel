import {
	ExceptionFilter,
	Catch,
	ArgumentsHost,
	BadRequestException,
} from "@nestjs/common";
import { Request, Response } from "express";
import { GreenApiLogger } from "@green-api/greenapi-integration";

@Catch(BadRequestException)
export class ValidationExceptionFilter implements ExceptionFilter {
	private readonly logger = GreenApiLogger.getInstance(ValidationExceptionFilter.name);

	catch(exception: BadRequestException, host: ArgumentsHost) {
		const ctx = host.switchToHttp();
		const response = ctx.getResponse<Response>();
		const request = ctx.getRequest<Request>();
		const status = exception.getStatus();
		const exceptionResponse = exception.getResponse();
		const validationErrors = typeof exceptionResponse === "object"
			? (exceptionResponse as any)
			: {message: exceptionResponse};

		const isValidationError = Array.isArray(validationErrors.message);

		if (isValidationError) {
			this.logger.error(`Validation failed for ${request.method} ${request.url}`, {
				validationErrors: validationErrors.message,
				requestBody: request.body,
				requestHeaders: {
					"content-type": request.headers["content-type"],
					"user-agent": request.headers["user-agent"],
					"x-forwarded-for": request.headers["x-forwarded-for"],
				},
				timestamp: new Date().toISOString(),
			});
		} else {
			this.logger.error(`Bad Request for ${request.method} ${request.url}`, {
				error: validationErrors,
				requestBody: request.body,
				timestamp: new Date().toISOString(),
			});
		}

		response.status(status).json({
			statusCode: status,
			timestamp: new Date().toISOString(),
			path: request.url,
			method: request.method,
			message: isValidationError ? "Validation failed" : validationErrors.message,
			...(isValidationError && {validationErrors: validationErrors.message}),
		});
	}
}