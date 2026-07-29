import { startOpenTelemetry } from './telemetry';

export const openTelemetryRegistration = startOpenTelemetry({
  ...process.env,
  OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME?.trim() || 'studytube-api',
});
