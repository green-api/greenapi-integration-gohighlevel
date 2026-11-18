import { Module } from "@nestjs/common";
import { CallsController } from "./calls.controller";
import { CallsPhoneService } from "./calls-phone.service";
import { CallsAvailabilityService } from "./calls-availability.service";
import { CallRecordingLinksService } from "./call-recording-links.service";
import { CallRecordingsController } from "./call-recordings.controller";

@Module({
	controllers: [CallsController, CallRecordingsController],
	providers: [CallsPhoneService, CallsAvailabilityService, CallRecordingLinksService],
	exports: [CallsAvailabilityService, CallRecordingLinksService],
})
export class CallsModule {}
