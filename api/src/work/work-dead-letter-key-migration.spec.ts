import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('work dead-letter handler key migration', () => {
  it('aligns dead-letter identity with event and handler execution identity', async () => {
    const path = join(
      process.cwd(),
      'migrations',
      '1753660812000_work-dead-letter-handler-key.cjs',
    );

    expect(existsSync(path)).toBe(true);
    const migration = await readFile(path, 'utf8');

    expect(migration).toContain(
      'DROP CONSTRAINT work_dead_letters_event_id_key',
    );
    expect(migration).toContain(
      'CONSTRAINT work_dead_letters_event_handler_key',
    );
    expect(migration).toContain('UNIQUE (event_id, handler_version)');
    expect(migration).toContain(
      'work dead-letter handler key rollback refused',
    );
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/iu);
  });
});
