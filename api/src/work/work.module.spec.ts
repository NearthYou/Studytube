import { ConfigService } from '@nestjs/config';
import {
  resolveOutboxPollInterval,
  resolveOutboxPublishTimeout,
  resolveValkeyUrl,
} from './work.module';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (name: string) => values[name],
  } as ConfigService;
}

describe('work runtime configuration', () => {
  it('uses an explicit Valkey URL', () => {
    expect(
      resolveValkeyUrl(
        config({
          VALKEY_URL: 'redis://valkey.internal:6379',
          NODE_ENV: 'production',
        }),
      ),
    ).toBe('redis://valkey.internal:6379');
  });

  it('defaults to loopback outside production and fails closed in production', () => {
    expect(resolveValkeyUrl(config({ NODE_ENV: 'test' }))).toBe(
      'redis://127.0.0.1:6379',
    );
    expect(() => resolveValkeyUrl(config({ NODE_ENV: 'production' }))).toThrow(
      'VALKEY_URL must be configured in production',
    );
  });

  it('accepts only positive relay polling intervals', () => {
    expect(
      resolveOutboxPollInterval(config({ OUTBOX_POLL_INTERVAL_MS: '250' })),
    ).toBe(250);
    expect(
      resolveOutboxPollInterval(config({ OUTBOX_POLL_INTERVAL_MS: '0' })),
    ).toBe(1000);
  });

  it('keeps queue publish timeout positive and below the database lease', () => {
    expect(
      resolveOutboxPublishTimeout(
        config({ OUTBOX_PUBLISH_TIMEOUT_MS: '15000' }),
      ),
    ).toBe(15_000);
    expect(
      resolveOutboxPublishTimeout(
        config({ OUTBOX_PUBLISH_TIMEOUT_MS: '30000' }),
      ),
    ).toBe(20_000);
  });
});
