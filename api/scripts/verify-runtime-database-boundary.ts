import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { findRuntimeDatabaseBoundaryViolations } from '../src/runtime-database-boundary';

const sourceRoot = resolve(process.cwd(), 'src');

async function main() {
  const files: Array<{ relativePath: string; body: string }> = [];
  for (const path of await TypeScriptFiles(sourceRoot)) {
    if (path.endsWith('.spec.ts')) {
      continue;
    }
    const body = await readFile(path, 'utf8');
    files.push({ relativePath: relative(sourceRoot, path), body });
  }
  const violations = findRuntimeDatabaseBoundaryViolations(files);
  if (violations.length > 0) {
    throw new Error(
      `Runtime database boundary violations:\n${violations.join('\n')}`,
    );
  }
  process.stdout.write('Runtime database boundary verified\n');
}

async function TypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? TypeScriptFiles(path)
        : Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
