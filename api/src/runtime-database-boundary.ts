import ts from 'typescript';

export type RuntimeSourceFile = {
  relativePath: string;
  body: string;
};

const forbiddenSql = new RegExp(
  String.raw`\b(?:` +
    String.raw`CREATE\s+(?:(?:OR\s+REPLACE|GLOBAL|LOCAL|TEMP(?:ORARY)?|UNLOGGED|UNIQUE|MATERIALIZED)\s+)*(?:TABLE|INDEX|TYPE|EXTENSION|SCHEMA|VIEW|FUNCTION|PROCEDURE|TRIGGER|SEQUENCE|DOMAIN|AGGREGATE|COLLATION|POLICY|RULE)|` +
    String.raw`(?:ALTER|DROP)\s+(?:TABLE|INDEX|TYPE|EXTENSION|SCHEMA|VIEW|FUNCTION|PROCEDURE|TRIGGER|SEQUENCE|DOMAIN|AGGREGATE|COLLATION|POLICY|RULE)|` +
    String.raw`TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?[A-Za-z_"\[]|REINDEX\s+(?:TABLE|INDEX|SCHEMA|DATABASE)|` +
    String.raw`(?:GRANT|REVOKE)\s+` +
    String.raw`)\b`,
  'iu',
);
const forbiddenSeedFlag = /\bALLOW_DEMO_SEED\b/u;

export function findRuntimeDatabaseBoundaryViolations(
  files: RuntimeSourceFile[],
): string[] {
  const violations: string[] = [];
  for (const file of files) {
    if (forbiddenSql.test(file.body)) {
      violations.push(`${file.relativePath} contains runtime DDL`);
    }
    if (forbiddenSeedFlag.test(file.body)) {
      violations.push(
        `${file.relativePath} references the demo seed runtime flag`,
      );
    }
    if (containsSilentDatabaseFallback(file.relativePath, file.body)) {
      violations.push(
        `${file.relativePath} silently falls back when DATABASE_URL is missing`,
      );
    }
  }
  return violations;
}

function containsSilentDatabaseFallback(path: string, body: string): boolean {
  const source = ts.createSourceFile(
    path,
    body,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let violation = false;
  const visit = (node: ts.Node): void => {
    if (violation) {
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.BarBarEqualsToken,
        ts.SyntaxKind.QuestionQuestionEqualsToken,
      ].includes(node.operatorToken.kind) &&
      referencesDatabaseUrl(node.left, source)
    ) {
      violation = true;
      return;
    }
    if (
      ts.isConditionalExpression(node) &&
      referencesDatabaseUrl(node.condition, source)
    ) {
      violation = true;
      return;
    }
    if (
      ts.isBindingElement(node) &&
      node.initializer &&
      referencesDatabaseUrl(node.name, source)
    ) {
      violation = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violation;
}

function referencesDatabaseUrl(node: ts.Node, source: ts.SourceFile): boolean {
  return /\bDATABASE_URL\b/u.test(node.getText(source));
}
