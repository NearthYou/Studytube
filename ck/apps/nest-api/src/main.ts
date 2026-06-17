import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createCorsOptions } from './common/cors-options';
import { createRequestLoggingMiddleware } from './common/request-logging.middleware';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors(createCorsOptions(process.env.CORS_ORIGINS));
  app.use(createRequestLoggingMiddleware());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
