import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from './auth.module';
import { AuthController } from './auth.controller';
import { GoogleAuthController } from './google/google-auth.controller';
import { GoogleAuthService } from './google/google-auth.service';
import { LegacyEmailAuthController } from './legacy-email-auth.controller';
import { authControllersForMode } from './auth.module';
import { authServiceDeliveryForMode } from './auth.module';
import { DatabaseModule } from '../database.module';
import { DatabaseService } from '../database.service';
import { LearningModule } from '../learning/learning.module';
import {
  verificationEmailProvidersForMode,
  WorkerModule,
} from '../work/worker.module';

describe('AuthModule Google authentication wiring', () => {
  it('registers the Google controller and service provider', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      AuthModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AuthModule,
    ) as unknown[];

    expect(controllers).toContain(GoogleAuthController);
    expect(
      providers.some(
        (provider) =>
          provider === GoogleAuthService ||
          (hasProviderToken(provider) &&
            provider.provide === GoogleAuthService),
      ),
    ).toBe(true);
  });

  it('removes only legacy email routes in Google-only mode', () => {
    expect(authControllersForMode('google_only')).toEqual([
      AuthController,
      GoogleAuthController,
    ]);
    expect(authControllersForMode('legacy')).toEqual([
      AuthController,
      GoogleAuthController,
      LegacyEmailAuthController,
    ]);
  });

  it('does not require email delivery configuration in Google-only mode', () => {
    expect(
      authServiceDeliveryForMode('google_only', {
        NODE_ENV: 'production',
        STUDYTUBE_PUBLIC_URL: 'https://studytube.test',
      }),
    ).toMatchObject({ enabled: false });
  });

  it('keeps database infrastructure separate from HTTP authentication', () => {
    const authImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AuthModule,
    ) as unknown[];
    const authExports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      AuthModule,
    ) as unknown[];
    const authProviders = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AuthModule,
    ) as unknown[];
    const learningImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      LearningModule,
    ) as unknown[];
    const workerImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      WorkerModule,
    ) as unknown[];

    expect(authImports).toContain(DatabaseModule);
    expect(authExports).toContain(DatabaseModule);
    expect(authProviders).not.toContain(DatabaseService);
    expect(learningImports).toContain(DatabaseModule);
    expect(learningImports).not.toContain(AuthModule);
    expect(workerImports).toContain(DatabaseModule);
    expect(workerImports).not.toContain(AuthModule);
  });

  it('does not start the legacy verification email worker in Google-only mode', () => {
    expect(verificationEmailProvidersForMode('google_only')).toEqual([]);
    expect(verificationEmailProvidersForMode('legacy')).not.toHaveLength(0);
  });
});

function hasProviderToken(value: unknown): value is { provide: unknown } {
  return typeof value === 'object' && value !== null && 'provide' in value;
}
