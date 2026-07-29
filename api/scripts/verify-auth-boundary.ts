import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

type Rule = {
  name: string;
  pattern: RegExp;
};

type AllowedRuleMatch = {
  ruleName: string;
  relativePath: string;
  sourceText: string;
};

const sourceRoot = resolve(__dirname, '../src');
const rules: Rule[] = [
  {
    name: 'Authorization or Bearer credential consumer',
    pattern:
      /@Headers\s*\(\s*['"`]authorization['"`]\s*\)|\bnormalizeBearerToken\b|\bheaders\s*\[\s*['"`]authorization['"`]\s*\]|\bheaders\.authorization\b/giu,
  },
  {
    name: 'legacy sessions.token SQL',
    pattern:
      /\bINSERT\s+INTO\s+sessions\s*\(\s*token\b|\bSELECT\s+(?:s\.)?token\b[\s\S]{0,240}?\bFROM\s+sessions\b|\b(?:WHERE|AND)\s+(?:s\.)?token\s*=|\bRETURNING\s+token\s*,\s*user_id\b/giu,
  },
];
// This guard consumes an internal service credential, never a browser session.
// Keep the exception path, source text, and allowed occurrence count exact.
const allowedRuleMatches: AllowedRuleMatch[] = [
  {
    ruleName: 'Authorization or Bearer credential consumer',
    relativePath: 'mcp/mcp-service-assertion.guard.ts',
    sourceText: 'headers.authorization',
  },
];

async function main(): Promise<void> {
  const files = await productionTypeScriptFiles(sourceRoot);
  const violations: string[] = [];
  const allowedMatchCounts = new Map<AllowedRuleMatch, number>();

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const sourcePath = relative(sourceRoot, file).replaceAll('\\', '/');
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      for (const match of source.matchAll(rule.pattern)) {
        const allowed = allowedRuleMatches.find(
          (candidate) =>
            candidate.ruleName === rule.name &&
            candidate.relativePath === sourcePath &&
            candidate.sourceText === match[0],
        );
        if (allowed && (allowedMatchCounts.get(allowed) ?? 0) === 0) {
          allowedMatchCounts.set(allowed, 1);
          continue;
        }
        violations.push(
          `${sourcePath}:${lineNumber(source, match.index ?? 0)} ${rule.name}`,
        );
      }
    }
  }

  for (const allowed of allowedRuleMatches) {
    if ((allowedMatchCounts.get(allowed) ?? 0) !== 1) {
      violations.push(
        `${allowed.relativePath} expected one explicit internal service assertion credential consumer`,
      );
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `Authentication boundary verification failed:\n${violations
        .map((violation) => `- ${violation}`)
        .join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Authentication boundary verification passed (${files.length} production TypeScript files).\n`,
  );
}

async function productionTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await productionTypeScriptFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      if (!entry.name.endsWith('.spec.ts')) {
        files.push(path);
      }
    }
  }
  return files.sort();
}

function lineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ error: 'auth_boundary_verification_failed', message })}\n`,
  );
  process.exitCode = 1;
});
