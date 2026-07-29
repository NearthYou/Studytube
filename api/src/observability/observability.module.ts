import {
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpObservabilityMiddleware } from './http-observability.middleware';
import { InternalMetricsController } from './internal-metrics.controller';
import { OBSERVABILITY_RUNTIME, observabilityRuntime } from './runtime';

@Module({
  imports: [ConfigModule],
  controllers: [InternalMetricsController],
  providers: [
    {
      provide: OBSERVABILITY_RUNTIME,
      useValue: observabilityRuntime,
    },
    HttpObservabilityMiddleware,
  ],
  exports: [OBSERVABILITY_RUNTIME],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(HttpObservabilityMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
