import { openTelemetryRegistration } from './observability/api-instrumentation';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './configure-application';
import { resolveRuntimeListener } from './runtime-listener';
import { assertProductionRuntimeSecrets } from './runtime-secrets';

async function bootstrap() {
  assertProductionRuntimeSecrets(process.env, 'api');
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  configureApplication(app);
  const listener = resolveRuntimeListener(process.env);
  const server = (await ('socketPath' in listener
    ? app.listen(listener.socketPath)
    : listener.host
      ? app.listen(listener.port, listener.host)
      : app.listen(listener.port))) as {
    ref?: () => void;
  };
  server.ref?.();
}

for (const signal of ['SIGINT', 'SIGTERM', 'beforeExit'] as const) {
  process.once(signal, () => {
    void openTelemetryRegistration.shutdown().catch(() => undefined);
  });
}

void bootstrap().catch(() => {
  process.stderr.write('StudyTube API failed to start\n');
  process.exitCode = 1;
});
