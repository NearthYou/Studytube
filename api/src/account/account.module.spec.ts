import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../app.module';
import { AccountDeletionController } from './account-deletion.controller';
import { AccountErasureService } from './account-erasure.service';
import { AccountModule } from './account.module';

describe('AccountModule', () => {
  it('registers account deletion as part of the application', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      AccountModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AccountModule,
    ) as unknown[];
    const appImports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    ) as unknown[];

    expect(controllers).toContain(AccountDeletionController);
    expect(
      providers.some(
        (provider) => providerToken(provider) === AccountErasureService,
      ),
    ).toBe(true);
    expect(appImports).toContain(AccountModule);
  });
});

function providerToken(value: unknown) {
  return typeof value === 'object' && value !== null && 'provide' in value
    ? value.provide
    : value;
}
