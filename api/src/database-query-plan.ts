export type ExplainPlan = {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: ExplainPlan[];
};

export type QueryPlanContract = {
  requiredIndexes: RegExp[];
  forbiddenSequentialScanRelations: string[];
};

// This verifier proves that each protected query shape has a usable indexed
// access path. PostgreSQL's default choice on a synthetic fixture depends on
// sampled statistics and is not a production performance measurement.
export const QUERY_PLAN_VERIFICATION_SESSION_SETTINGS = [
  "SET LOCAL lock_timeout = '5s'",
  "SET LOCAL statement_timeout = '90s'",
  'SET LOCAL jit = off',
  'SET LOCAL enable_seqscan = off',
] as const;

export function extractExplainPlan(value: unknown): ExplainPlan {
  const root: unknown = Array.isArray(value)
    ? (value as unknown[])[0]
    : undefined;
  const plan: unknown = isRecord(root) ? root.Plan : undefined;
  if (
    typeof plan !== 'object' ||
    plan === null ||
    !('Node Type' in plan) ||
    typeof plan['Node Type'] !== 'string'
  ) {
    throw new Error('PostgreSQL returned an invalid JSON query plan');
  }
  return plan as ExplainPlan;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function assertQueryPlanContract(
  name: string,
  plan: ExplainPlan,
  contract: QueryPlanContract,
): void {
  const nodes = flattenPlan(plan);
  const indexes = nodes
    .map((node) => node['Index Name'])
    .filter((index): index is string => typeof index === 'string');
  const failures = contract.requiredIndexes
    .filter((pattern) => !indexes.some((index) => pattern.test(index)))
    .map((pattern) => `missing index ${String(pattern)}`);
  const protectedRelations = new Set(contract.forbiddenSequentialScanRelations);
  for (const node of nodes) {
    const relation = node['Relation Name'];
    if (
      node['Node Type'] === 'Seq Scan' &&
      relation &&
      protectedRelations.has(relation)
    ) {
      failures.push(`sequential scan on ${relation}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${name} query plan contract failed: ${failures.join('; ')}`,
    );
  }
}

function flattenPlan(plan: ExplainPlan): ExplainPlan[] {
  return [plan, ...(plan.Plans ?? []).flatMap(flattenPlan)];
}
