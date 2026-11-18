import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { randomBytes } from "crypto";
import { CallsRelay, GreenApiLogger, Instance as GreenApiInstance } from "@green-api/greenapi-integration";
import { PrismaService } from "../prisma/prisma.service";
import { CALLS_PHONE_PATH, CALLS_PHONE_TICKET_TTL_MS } from "../constants";

interface PhoneTicket {
	idInstance: bigint;
	locationId: string;
	expiresAt: number;
}

@Injectable()
export class CallsPhoneService implements OnApplicationBootstrap, OnModuleDestroy {
	private readonly logger = GreenApiLogger.getInstance(CallsPhoneService.name);
	private readonly tickets = new Map<string, PhoneTicket>();
	private readonly relay = new CallsRelay({authorize: (request) => this.authorize(request)});

	constructor(
		private readonly adapterHost: HttpAdapterHost,
		private readonly prisma: PrismaService,
	) {}

	onApplicationBootstrap(): void {
		this.adapterHost.httpAdapter.getHttpServer().on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
			if (request.url?.startsWith(CALLS_PHONE_PATH)) {
				this.relay.handleUpgrade(request, socket, head);
			}
		});
	}

	onModuleDestroy(): void {
		this.relay.close();
	}

	issueTicket(idInstance: bigint, locationId: string): string {
		this.pruneTickets();
		const ticket = randomBytes(32).toString("hex");
		this.tickets.set(ticket, {idInstance, locationId, expiresAt: Date.now() + CALLS_PHONE_TICKET_TTL_MS});
		this.logger.log(`Issued a phone ticket for instance ${idInstance} in Location ${locationId}`);
		return ticket;
	}

	private async authorize(request: IncomingMessage): Promise<GreenApiInstance | null> {
		const ticket = new URL(request.url ?? "", "http://localhost").searchParams.get("ticket");
		const entry = ticket ? this.tickets.get(ticket) : undefined;
		if (!entry || entry.expiresAt <= Date.now()) {
			return null;
		}

		const instance = await this.prisma.getInstance(entry.idInstance);
		if (!instance || instance.userId !== entry.locationId) {
			return null;
		}
		return instance;
	}

	private pruneTickets(): void {
		const now = Date.now();
		for (const [ticket, entry] of this.tickets) {
			if (entry.expiresAt <= now) this.tickets.delete(ticket);
		}
	}
}
