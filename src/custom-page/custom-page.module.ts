import { Module } from '@nestjs/common';
import { CustomPageController } from './custom-page.controller';

@Module({
  controllers: [CustomPageController]
})
export class CustomPageModule {}
