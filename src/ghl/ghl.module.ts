import { Module } from "@nestjs/common";
import { GhlService } from "./ghl.service";
import { GhlTransformer } from "./ghl.transformer";
import { GhlController } from './ghl.controller';

@Module({
	providers: [GhlService, GhlTransformer],
	exports: [GhlService, GhlTransformer],
	controllers: [GhlController],
})
export class GhlModule {}
