import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getCorsOptions } from './config/security.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const trustProxy =
    configService.get<string>('TRUST_PROXY')?.toLowerCase() === 'true';

  if (trustProxy) {
    const server = app.getHttpAdapter().getInstance();
    if (typeof server.set === 'function') {
      server.set('trust proxy', 1);
    }
  }

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    }),
  );
  app.enableCors(getCorsOptions(configService));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
