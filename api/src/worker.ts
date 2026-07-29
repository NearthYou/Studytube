import { openTelemetryRegistration } from './observability/worker-instrumentation';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './work/worker.module';
import { assertProductionRuntimeSecrets } from './runtime-secrets';

async function bootstrap(): Promise<void> {
  assertProductionRuntimeSecrets(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
}

for (const signal of ['SIGINT', 'SIGTERM', 'beforeExit'] as const) {
  process.once(signal, () => {
    void openTelemetryRegistration.shutdown().catch(() => undefined);
  });
}

void bootstrap().catch(() => {
  process.stderr.write('StudyTube worker failed to start\n');
  process.exitCode = 1;
});
