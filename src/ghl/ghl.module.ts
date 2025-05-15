import { Module } from "@nestjs/common";
import { GhlService } from "./ghl.service";
import { GhlTransformer } from "./ghl.transformer";

@Module({
	providers: [GhlService, GhlTransformer],
	exports: [GhlService, GhlTransformer],
})
export class GhlModule {}
