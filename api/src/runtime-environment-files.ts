import type { ConfigModuleOptions } from '@nestjs/config';

export function runtimeConfigOptions(
  environment: Readonly<Record<string, string | undefined>>,
  environmentFiles: string[] = ['api/.env', '.env'],
): ConfigModuleOptions {
  return {
    isGlobal: true,
    envFilePath: environmentFiles,
    ignoreEnvFile: environment.NODE_ENV === 'production',
  };
}
