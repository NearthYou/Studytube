import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './configure-application';
import { resolveRuntimeListener } from './runtime-listener';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApplication(app);
  const { host, port } = resolveRuntimeListener(process.env);
  const server = (await (host ? app.listen(port, host) : app.listen(port))) as {
    ref?: () => void;
  };
  server.ref?.();
}
void bootstrap();
