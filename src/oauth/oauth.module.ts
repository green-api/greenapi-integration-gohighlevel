import { Module } from "@nestjs/common";
import { GhlOauthController } from "./oauth.controller";

@Module({
	controllers: [GhlOauthController],
})
export class OauthModule {}
