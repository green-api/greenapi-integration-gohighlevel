import {
	Controller,
	Get,
	Post,
	Delete,
	Patch,
	Body,
	Param,
	HttpException,
	HttpStatus,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { GhlService } from "./ghl.service";
import { GreenApiLogger } from "@green-api/greenapi-integration";

interface CreateInstanceDto {
	locationId: string;
	instanceId: string;
	apiToken: string;
	name?: string;
}

interface UpdateInstanceDto {
	name?: string;
}

@Controller("api/instances")
export class GhlController {
	private readonly logger = GreenApiLogger.getInstance(GhlController.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly ghlService: GhlService,
	) {}

	@Get(":locationId")
	async getInstances(@Param("locationId") locationId: string) {
		this.logger.log(`Getting instances for location: ${locationId}`);

		const user = await this.prisma.findUser(locationId);
		if (!user) {
			throw new HttpException("Location not found", HttpStatus.NOT_FOUND);
		}

		const instances = await this.prisma.getInstancesByUserId(locationId);
		
		return {
			success: true,
			instances: instances.map(instance => ({
				id: instance.idInstance.toString(),
				name: instance.name || `Instance ${instance.idInstance}`,
				state: instance.stateInstance,
				createdAt: instance.createdAt,
				settings: instance.settings
			}))
		};
	}

	@Post()
	async createInstance(@Body() dto: CreateInstanceDto) {
		this.logger.log(`Creating instance for location: ${dto.locationId}`);

		const user = await this.prisma.findUser(dto.locationId);
		if (!user) {
			throw new HttpException("Location not found. Please ensure OAuth is completed.", HttpStatus.BAD_REQUEST);
		}

		if (!user.accessToken || !user.refreshToken) {
			throw new HttpException("OAuth authentication required", HttpStatus.UNAUTHORIZED);
		}

		try {
			const instance = await this.ghlService.createGreenApiInstanceForUser(
				dto.locationId,
				BigInt(dto.instanceId),
				dto.apiToken,
				dto.name
			);

			return {
				success: true,
				instance: {
					id: instance.idInstance.toString(),
					name: instance.name || `Instance ${instance.idInstance}`,
					state: instance.stateInstance,
					createdAt: instance.createdAt
				}
			};
		} catch (error) {
			this.logger.error(`Error creating instance: ${error.message}`, error.stack);
			
			if (error.message.includes("already exists")) {
				throw new HttpException("Instance ID already exists", HttpStatus.CONFLICT);
			}
			
			if (error.code === "INVALID_CREDENTIALS") {
				throw new HttpException("Invalid GREEN-API credentials", HttpStatus.BAD_REQUEST);
			}
			
			throw new HttpException(
				error.message || "Failed to create instance",
				HttpStatus.INTERNAL_SERVER_ERROR
			);
		}
	}

	@Delete(":instanceId")
	async deleteInstance(@Param("instanceId") instanceId: string) {
		this.logger.log(`Deleting instance: ${instanceId}`);

		try {
			const instance = await this.prisma.getInstance(BigInt(instanceId));
			if (!instance) {
				throw new HttpException("Instance not found", HttpStatus.NOT_FOUND);
			}

			await this.prisma.removeInstance(BigInt(instanceId));

			return {
				success: true,
				message: "Instance deleted successfully"
			};
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			
			this.logger.error(`Error deleting instance: ${error.message}`, error.stack);
			throw new HttpException(
				"Failed to delete instance",
				HttpStatus.INTERNAL_SERVER_ERROR
			);
		}
	}

	@Patch(":instanceId")
	async updateInstance(
		@Param("instanceId") instanceId: string,
		@Body() dto: UpdateInstanceDto
	) {
		this.logger.log(`Updating instance: ${instanceId}`);
		try {
			let instance = await this.prisma.getInstance(BigInt(instanceId));
			if (!instance) {
				throw new HttpException("Instance not found", HttpStatus.NOT_FOUND);
			}
			if (dto.name) {
				instance = await this.prisma.updateInstanceName(BigInt(instanceId), dto.name);
			}

			return {
				success: true,
				instance: {
					id: instance.idInstance.toString(),
					name: instance.name || `Instance ${instance.idInstance}`,
					state: instance.stateInstance,
					createdAt: instance.createdAt,
				}
			};
		} catch (error) {
			if (error instanceof HttpException) {
				throw error;
			}
			
			this.logger.error(`Error updating instance: ${error.message}`, error.stack);
			throw new HttpException(
				"Failed to update instance",
				HttpStatus.INTERNAL_SERVER_ERROR
			);
		}
	}
}