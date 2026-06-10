import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createCorsOptions } from './cors-options';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors(createCorsOptions(process.env.WEB_ORIGIN));
  const server = (await app.listen(process.env.PORT ?? 3000)) as {
    ref?: () => void;
  };
  server.ref?.();
}
void bootstrap();
