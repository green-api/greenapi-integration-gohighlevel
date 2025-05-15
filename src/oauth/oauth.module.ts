import { Module } from '@nestjs/common';
import { GhlOauthController } from './oauth.controller';
import { GhlModule } from "../ghl/ghl.module";

@Module({
    imports: [GhlModule],
    controllers: [GhlOauthController],
})
export class OauthModule {}
