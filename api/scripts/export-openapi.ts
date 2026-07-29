import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/configure-application';
import { createOpenApiDocument } from '../src/openapi';
import { assertOpenApiContract } from '../src/openapi-contract';

async function main() {
  process.env.WEB_ORIGIN ??= 'https://app.studytube.example.test';
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    configureApplication(app);
    const document = createOpenApiDocument(app);
    assertOpenApiContract(document);
    const outputPath = resolve(
      process.env.OPENAPI_OUTPUT_PATH ?? 'openapi/current.json',
    );
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify(sortObject(document), null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(`${outputPath}\n`);
  } finally {
    await app.close();
  }
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortObject(nested)]),
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `OpenAPI export failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
