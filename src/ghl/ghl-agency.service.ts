import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import { GreenApiLogger } from "@green-api/greenapi-integration";
import { PrismaService } from "../prisma/prisma.service";
import { InstalledLocation, InstalledLocationsResponse, LocationTokenResponse } from "../types";
import {
	GHL_API_VERSION,
	GHL_INSTALLED_LOCATIONS_PAGE_SIZE,
	GHL_SERVICES_URL,
	GHL_TOKEN_REFRESH_MARGIN_MS,
} from "../constants";

export interface CompanyTokens {
	access_token: string;
	refresh_token: string;
	expires_in: number;
}

export interface AgencyInstallResult {
	successful: InstalledLocation[];
	failed: Array<{ location: InstalledLocation; error: string }>;
}

@Injectable()
export class GhlAgencyService {
	private readonly logger = GreenApiLogger.getInstance(GhlAgencyService.name);
	private readonly companyTokenRefreshes = new Map<string, Promise<string>>();

	constructor(
		private readonly configService: ConfigService,
		private readonly prisma: PrismaService,
	) {}

	async saveCompanyTokens(companyId: string, tokens: CompanyTokens): Promise<void> {
		const data = {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
		};
		await this.prisma.company.upsert({
			where: {id: companyId},
			update: data,
			create: {id: companyId, ...data},
		});
		this.logger.log(`Stored agency tokens for company ${companyId}`);
	}

	async removeCompany(companyId: string): Promise<void> {
		await this.prisma.company.deleteMany({where: {id: companyId}});
		this.logger.log(`Removed agency tokens of company ${companyId}`);
	}

	async hasCompany(companyId: string): Promise<boolean> {
		return !!await this.prisma.company.findUnique({where: {id: companyId}});
	}

	async installAllLocations(companyId: string): Promise<AgencyInstallResult> {
		const companyToken = await this.getCompanyAccessToken(companyId);
		const locations = await this.getInstalledLocations(companyToken, companyId);
		this.logger.log(`Found ${locations.length} installed locations for company ${companyId}`);

		const result: AgencyInstallResult = {successful: [], failed: []};
		for (const location of locations) {
			if (!location.isInstalled) continue;
			try {
				await this.installLocation(companyId, location._id);
				result.successful.push(location);
				this.logger.log(`Created user for location ${location._id} (${location.name})`);
			} catch (error) {
				result.failed.push({location, error: error.message});
				this.logger.error(`Failed for location ${location._id}: ${error.message}`);
			}
		}
		return result;
	}

	async installLocation(companyId: string, locationId: string): Promise<void> {
		const companyToken = await this.getCompanyAccessToken(companyId);
		const formData = new URLSearchParams({companyId, locationId});
		const {data: locationToken} = await axios.post<LocationTokenResponse>(
			`${GHL_SERVICES_URL}/oauth/locationToken`,
			formData.toString(),
			{
				headers: {
					Authorization: `Bearer ${companyToken}`,
					Version: GHL_API_VERSION,
					"Content-Type": "application/x-www-form-urlencoded",
				},
			},
		);

		const tokens = {
			accessToken: locationToken.access_token,
			refreshToken: locationToken.refresh_token,
			tokenExpiresAt: new Date(Date.now() + locationToken.expires_in * 1000),
			companyId,
		};
		await this.prisma.user.upsert({
			where: {id: locationId},
			update: tokens,
			create: {id: locationId, ...tokens},
		});
	}

	private async getInstalledLocations(companyToken: string, companyId: string): Promise<InstalledLocation[]> {
		const appId = this.configService.get<string>("GHL_APP_ID");
		if (!appId) {
			throw new Error("GHL_APP_ID not configured");
		}

		const locations: InstalledLocation[] = [];
		for (let skip = 0; ; skip += GHL_INSTALLED_LOCATIONS_PAGE_SIZE) {
			const {data} = await axios.get<InstalledLocationsResponse>(`${GHL_SERVICES_URL}/oauth/installedLocations`, {
				headers: {
					Authorization: `Bearer ${companyToken}`,
					Version: GHL_API_VERSION,
				},
				params: {
					appId,
					companyId,
					isInstalled: true,
					limit: GHL_INSTALLED_LOCATIONS_PAGE_SIZE,
					skip,
				},
			});
			const page = data.locations ?? [];
			locations.push(...page);
			if (page.length < GHL_INSTALLED_LOCATIONS_PAGE_SIZE || (data.count && locations.length >= data.count)) {
				return locations;
			}
		}
	}

	private getCompanyAccessToken(companyId: string): Promise<string> {
		const running = this.companyTokenRefreshes.get(companyId);
		if (running) return running;

		const lookup = this.readCompanyAccessToken(companyId).finally(() => this.companyTokenRefreshes.delete(companyId));
		this.companyTokenRefreshes.set(companyId, lookup);
		return lookup;
	}

	private async readCompanyAccessToken(companyId: string): Promise<string> {
		const company = await this.prisma.company.findUnique({where: {id: companyId}});
		if (!company) {
			throw new Error(`No agency tokens stored for company ${companyId}. Install the app from the agency view again.`);
		}
		const expiring = !!company.tokenExpiresAt
			&& company.tokenExpiresAt.getTime() < Date.now() + GHL_TOKEN_REFRESH_MARGIN_MS;
		if (!expiring) return company.accessToken;

		const body = new URLSearchParams({
			client_id: this.configService.get<string>("GHL_CLIENT_ID")!,
			client_secret: this.configService.get<string>("GHL_CLIENT_SECRET")!,
			grant_type: "refresh_token",
			refresh_token: company.refreshToken,
			user_type: "Company",
		});
		const {data} = await axios.post<CompanyTokens>(`${GHL_SERVICES_URL}/oauth/token`, body.toString(), {
			headers: {"Content-Type": "application/x-www-form-urlencoded"},
		});
		await this.saveCompanyTokens(companyId, data);
		return data.access_token;
	}
}
