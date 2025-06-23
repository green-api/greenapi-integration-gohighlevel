import { Injectable, OnModuleInit, NotFoundException } from "@nestjs/common";
import {
	InstanceState,
	PrismaClient,
	User,
	Instance,
	Prisma,
} from "@prisma/client";
import {
	StorageProvider,
	Settings,
} from "@green-api/greenapi-integration";
import { UserCreateData, UserUpdateData } from "../types";

@Injectable()
export class PrismaService
	extends PrismaClient
	implements OnModuleInit,
		StorageProvider<
			User,
			Instance,
			UserCreateData,
			UserUpdateData
		> {
	async onModuleInit() {
		await this.$connect();
	}

	async createUser(data: UserCreateData): Promise<User> {
		return this.user.upsert({
			where: {id: data.id},
			update: {...data},
			create: {...data},
		});
	}

	async findUser(identifier: string): Promise<User | null> {
		return this.user.findUnique({
			where: {id: identifier},
		});
	}

	async updateUser(
		identifier: string,
		data: UserUpdateData,
	): Promise<User> {
		return this.user.update({
			where: {id: identifier},
			data,
		});
	}

	async getUserWithTokens(userId: string): Promise<User | null> {
		return this.user.findUnique({
			where: {id: userId},
		});
	}

	async updateUserTokens(
		userId: string,
		accessToken: string,
		refreshToken: string,
		tokenExpiresAt: Date,
	): Promise<User> {
		return this.user.update({
			where: {id: userId},
			data: {accessToken, refreshToken, tokenExpiresAt},
		});
	}

	async createInstance(instanceData: Prisma.InstanceCreateInput): Promise<Instance> {
		const ghlLocationId = instanceData.user.connect?.id;
		const stateInstance = instanceData.stateInstance;
		const idInstance = BigInt(instanceData.idInstance);

		if (!ghlLocationId) {
			throw new Error("userId (GHL Location ID as string) is required on the instance data to create an Instance.");
		}

		const userExists = await this.user.findUnique({where: {id: ghlLocationId}});
		if (!userExists) {
			throw new NotFoundException(`User (GHL Location) with ID ${ghlLocationId} not found. Cannot create instance.`);
		}

		const existingInstance = await this.instance.findUnique({
			where: {idInstance},
		});

		if (existingInstance) {
			throw new Error(`Instance with ID ${idInstance} already exists.`);
		}

		return this.instance.create({
			data: {
				idInstance,
				apiTokenInstance: instanceData.apiTokenInstance,
				stateInstance: stateInstance || InstanceState.notAuthorized,
				settings: instanceData.settings || {},
				name: instanceData.name,
				user: {
					connect: {id: ghlLocationId},
				},
			},
		});
	}

	async getInstance(idInstance: number | bigint): Promise<(Instance & { user: User }) | null> {
		return this.instance.findUnique({
			where: {idInstance: BigInt(idInstance)},
			include: {user: true},
		});
	}

	async getInstancesByUserId(userId: string): Promise<Instance[]> {
		return this.instance.findMany({
			where: {userId},
			orderBy: {createdAt: "desc"},
		});
	}

	async removeInstance(idInstance: number | bigint): Promise<Instance> {
		return this.instance.delete({
			where: {idInstance: BigInt(idInstance)},
		});
	}

	async updateInstanceSettings(idInstance: number | bigint, settings: Settings): Promise<Instance> {
		return this.instance.update({
			where: {idInstance: BigInt(idInstance)},
			data: {settings: settings || {}},
		});
	}

	async updateInstanceState(idInstance: number | bigint, state: InstanceState): Promise<Instance> {
		return this.instance.update({
			where: {idInstance: BigInt(idInstance)},
			data: {stateInstance: state},
		});
	}

	async updateInstanceName(idInstance: number | bigint, name: string): Promise<Instance & { user: User }> {
		return this.instance.update({
			where: {idInstance: BigInt(idInstance)},
			data: {name},
			include: {user: true},
		});
	}
}