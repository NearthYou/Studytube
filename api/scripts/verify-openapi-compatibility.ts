import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertBootstrapBaselineProvenance,
  findBreakingChanges,
  type OpenApiBaselineSource,
  type OpenApiDocument,
} from '../src/openapi-compatibility';

async function main() {
  const current = parseDocument(
    await readFile(
      resolve(process.env.OPENAPI_CURRENT_PATH ?? 'openapi/current.json'),
      'utf8',
    ),
  );
  const baseline = await readBaseline();
  const breaks = findBreakingChanges(baseline, current);
  if (breaks.length > 0) {
    throw new Error(
      `Unapproved OpenAPI breaking changes:\n${breaks.map((item) => `- ${item}`).join('\n')}`,
    );
  }
  process.stdout.write('OpenAPI compatibility verified\n');
}

async function readBaseline(): Promise<OpenApiDocument> {
  const reference = process.env.OPENAPI_BASELINE_REF?.trim();
  if (reference) {
    try {
      return parseDocument(
        execFileSync('git', ['show', `${reference}:api/openapi/current.json`], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      );
    } catch {
      if (process.env.OPENAPI_REQUIRE_BASELINE_REF === '1') {
        throw new Error(`OpenAPI baseline is missing from ${reference}`);
      }
    }
  }
  const baseline = parseDocument(
    await readFile(
      resolve(process.env.OPENAPI_BASELINE_PATH ?? 'openapi/baseline.json'),
      'utf8',
    ),
  );
  const bootstrapReference = process.env.OPENAPI_BOOTSTRAP_BASELINE_REF?.trim();
  if (bootstrapReference) {
    assertBootstrapBaselineProvenance(
      baseline,
      resolveBaselineSource(bootstrapReference),
    );
  }
  return baseline;
}

function resolveBaselineSource(reference: string): OpenApiBaselineSource {
  try {
    const commit = execFileSync(
      'git',
      ['rev-parse', '--verify', `${reference}^{commit}`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
    const apiSourceTree = execFileSync(
      'git',
      ['rev-parse', '--verify', `${commit}:api/src`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
    return { commit, apiSourceTree };
  } catch {
    throw new Error(
      `OpenAPI bootstrap source is unavailable from ${reference}`,
    );
  }
}

function parseDocument(body: string): OpenApiDocument {
  const value: unknown = JSON.parse(body);
  if (
    typeof value !== 'object' ||
    value === null ||
    !('paths' in value) ||
    typeof value.paths !== 'object' ||
    value.paths === null
  ) {
    throw new Error('Invalid OpenAPI document');
  }
  return value as OpenApiDocument;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
