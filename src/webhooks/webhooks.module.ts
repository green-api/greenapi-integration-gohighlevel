import { Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { GhlModule } from "../ghl/ghl.module";
import { GreenApiWebhookGuard } from "./guards/greenapi-webhook.guard";

@Module({
	imports: [GhlModule],
	controllers: [WebhooksController],
	providers: [GreenApiWebhookGuard],
})
export class WebhooksModule {}
