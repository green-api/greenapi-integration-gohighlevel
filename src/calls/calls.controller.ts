import { Body, Controller, Get, HttpException, HttpStatus, Post, Req, UseGuards } from "@nestjs/common";
import { GhlContextGuard } from "../ghl/guards/ghl-context.guard";
import { PrismaService } from "../prisma/prisma.service";
import { AuthReq } from "../types";
import { CallsPhoneService } from "./calls-phone.service";
import { CallsAvailabilityService } from "./calls-availability.service";
import { CALLS_PHONE_PATH } from "../constants";

interface PhoneTicketDto {
	instanceId: string;
}

@Controller("api/calls")
@UseGuards(GhlContextGuard)
export class CallsController {
	constructor(
		private readonly prisma: PrismaService,
		private readonly phoneService: CallsPhoneService,
		private readonly availabilityService: CallsAvailabilityService,
	) {}

	@Get("availability")
	async getAvailability(@Req() req: AuthReq) {
		const instances = await this.prisma.getInstancesByUserId(req.locationId);
		const results = await Promise.all(instances.map(async (instance) => [
			instance.idInstance.toString(),
			await this.availabilityService.isAvailable(instance),
		] as const));
		return {success: true, instances: Object.fromEntries(results)};
	}

	@Post("phone-ticket")
	async createPhoneTicket(@Body() dto: PhoneTicketDto, @Req() req: AuthReq) {
		if (!/^\d+$/.test(String(dto?.instanceId ?? ""))) {
			throw new HttpException("Instance ID is required", HttpStatus.BAD_REQUEST);
		}
		const instance = await this.prisma.getInstance(BigInt(dto.instanceId));
		if (!instance || instance.userId !== req.locationId) {
			throw new HttpException("Unauthorized", HttpStatus.FORBIDDEN);
		}
		if (!(await this.availabilityService.isAvailable(instance))) {
			throw new HttpException("Calls are not available on this instance's plan", HttpStatus.FORBIDDEN);
		}

		const ticket = this.phoneService.issueTicket(instance.idInstance, req.locationId);
		return {success: true, url: `${CALLS_PHONE_PATH}?ticket=${ticket}`};
	}
}
