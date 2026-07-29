import type { ExecutionTraceContext } from './trace-context';
import { redactTelemetryValue } from './redaction';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type StructuredLoggerOptions = {
  service: string;
  write?: (line: string) => void;
  clock?: () => Date;
  contextProvider?: {
    current(): ExecutionTraceContext | undefined;
  };
  baseFields?: Record<string, unknown>;
};

export class StructuredJsonLogger {
  private readonly writeLine: (line: string) => void;
  private readonly clock: () => Date;

  constructor(private readonly options: StructuredLoggerOptions) {
    this.writeLine =
      options.write ?? ((line) => process.stdout.write(`${line}\n`));
    this.clock = options.clock ?? (() => new Date());
  }

  debug(message: string, fields: Record<string, unknown> = {}): void {
    this.emit('debug', message, fields);
  }

  info(message: string, fields: Record<string, unknown> = {}): void {
    this.emit('info', message, fields);
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.emit('warn', message, fields);
  }

  error(
    message: string,
    error?: unknown,
    fields: Record<string, unknown> = {},
  ): void {
    this.emit('error', message, {
      ...fields,
      ...(error === undefined ? {} : { error }),
    });
  }

  private emit(
    level: LogLevel,
    message: string,
    fields: Record<string, unknown>,
  ): void {
    const trace = this.options.contextProvider?.current();
    const record = {
      ...this.options.baseFields,
      ...fields,
      timestamp: this.clock().toISOString(),
      level,
      service: this.options.service,
      message,
      ...(trace
        ? {
            trace_id: trace.traceId,
            span_id: trace.spanId,
            request_id: trace.requestId,
            ...(trace.jobId ? { job_id: trace.jobId } : {}),
          }
        : {}),
    };
    this.writeLine(JSON.stringify(redactTelemetryValue(record)));
  }
}
