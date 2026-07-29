import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeConfigOptions } from './runtime-environment-files';

describe('production runtime environment files', () => {
  it('ignores repository dotenv files when systemd supplies the environment', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'studytube-runtime-env-'));
    const environmentFile = join(workspace, '.env');
    const canaryName = 'ROOT_SNAPSHOT_SECRET_CANARY';
    writeFileSync(environmentFile, `${canaryName}=must-not-load\n`, 'utf8');
    delete process.env[canaryName];

    try {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot(
            runtimeConfigOptions({ NODE_ENV: 'production' }, [environmentFile]),
          ),
        ],
      }).compile();
      const config = module.get(ConfigService);

      expect(config.get(canaryName)).toBeUndefined();
      await module.close();
    } finally {
      delete process.env[canaryName];
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
