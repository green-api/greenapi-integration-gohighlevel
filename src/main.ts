import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { ValidationPipe } from "@nestjs/common";
import helmet from "helmet";
import { dirname } from "path";
import { Settings } from "@green-api/greenapi-integration";
import { ValidationExceptionFilter } from "./filters/validation-exception.filter";
import { CALLS_PHONE_CLIENT_PREFIX } from "./constants";

declare global {
	namespace PrismaJson {
		// noinspection JSUnusedGlobalSymbols
		type InstanceSettings = Settings;
	}
}

async function bootstrap() {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, {rawBody: true});
	app.useGlobalFilters(new ValidationExceptionFilter());
	app.useGlobalPipes(new ValidationPipe({whitelist: true, transform: true}));
	app.use(helmet());
	app.useStaticAssets(dirname(require.resolve("@green-api/greenapi-integration/dist/browser/calls-phone.js")), {
		prefix: CALLS_PHONE_CLIENT_PREFIX,
	});
	app.enableShutdownHooks();
	await app.listen(3000);
}

void bootstrap();
