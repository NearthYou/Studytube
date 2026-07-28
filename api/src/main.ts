import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './configure-application';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  const server = (await app.listen(process.env.PORT ?? 3000)) as {
    ref?: () => void;
  };
  server.ref?.();
}
void bootstrap();
