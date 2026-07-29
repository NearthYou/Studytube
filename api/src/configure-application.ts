import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { AuthExceptionFilter } from './auth/auth-exception.filter';
import { OriginGuard } from './auth/origin.guard';
import { RequestIdMiddleware } from './auth/request-id.middleware';
import { SessionGuard } from './auth/session.guard';
import { createCorsOptions } from './cors-options';

export type ConfigureApplicationOptions = {
  webOrigin?: string;
};

export function configureApplication(
  app: INestApplication,
  options: ConfigureApplicationOptions = {},
): void {
  const webOrigin = options.webOrigin ?? process.env.WEB_ORIGIN;
  if (!webOrigin) {
    throw new RangeError('WEB_ORIGIN must be configured');
  }

  const requestIds = app.get(RequestIdMiddleware);
  app.use(requestIds.use.bind(requestIds));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }),
  );
  app.enableCors(createCorsOptions(webOrigin));
  app.useGlobalFilters(new AuthExceptionFilter());
  app.useGlobalGuards(new OriginGuard(webOrigin), app.get(SessionGuard));
  app.enableShutdownHooks();
}
