import { Module } from "@nestjs/common";
import { GhlService } from "./ghl.service";
import { GhlTransformer } from "./ghl.transformer";
import { GhlController } from './ghl.controller';
import { GhlAgencyService } from "./ghl-agency.service";
import { CallsModule } from "../calls/calls.module";

@Module({
	imports: [CallsModule],
	providers: [GhlService, GhlTransformer, GhlAgencyService],
	exports: [GhlService, GhlTransformer, GhlAgencyService],
	controllers: [GhlController],
})
export class GhlModule {}
