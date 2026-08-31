import { MODULE_METADATA } from '@nestjs/common/constants';
import { AuthModule } from './auth.module';
import { GoogleAuthController } from './google/google-auth.controller';
import { GoogleAuthService } from './google/google-auth.service';

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
});

function hasProviderToken(value: unknown): value is { provide: unknown } {
  return typeof value === 'object' && value !== null && 'provide' in value;
}
