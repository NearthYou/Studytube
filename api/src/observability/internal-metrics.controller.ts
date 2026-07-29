import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { OBSERVABILITY_RUNTIME, type ObservabilityRuntime } from './runtime';

@Public()
@Controller('internal/metrics')
export class InternalMetricsController {
  constructor(
    @Inject(OBSERVABILITY_RUNTIME)
    private readonly runtime: ObservabilityRuntime,
    private readonly config: ConfigService,
  ) {}

  @Get()
  metrics(
    @Headers('x-internal-api-key') suppliedKey: string | undefined,
    @Res() response: Response,
  ): void {
    const expectedKey = this.config.get<string>('INTERNAL_AI_API_KEY');
    if (!expectedKey || !secureEqual(suppliedKey, expectedKey)) {
      throw new NotFoundException();
    }
    response
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(this.runtime.registry.toPrometheus());
  }
}

function secureEqual(left: string | undefined, right: string): boolean {
  if (!left) {
    return false;
  }
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
