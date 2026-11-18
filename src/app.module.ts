import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { GhlModule } from './ghl/ghl.module';
import { OauthModule } from './oauth/oauth.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomPageModule } from './custom-page/custom-page.module';
import { CallsModule } from './calls/calls.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true, envFilePath: '.env',
        }),
        PrismaModule,
        GhlModule,
        OauthModule,
        WebhooksModule,
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
        CustomPageModule,
        CallsModule,
    ],
})
export class AppModule {}
