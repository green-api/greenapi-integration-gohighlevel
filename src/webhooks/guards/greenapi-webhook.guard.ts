import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { BaseGreenApiAuthGuard } from "@green-api/greenapi-integration";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class GreenApiWebhookGuard extends BaseGreenApiAuthGuard<Request> implements CanActivate {
	constructor(protected readonly storageService: PrismaService) {super(storageService);}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest();
		return this.validateRequest(request);
	}
}
