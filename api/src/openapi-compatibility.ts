const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export type OpenApiOperation = {
  security?: Array<Record<string, unknown>>;
  parameters?: Array<{
    in?: string;
    name?: string;
    required?: boolean;
    schema?: OpenApiSchema;
  }>;
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: OpenApiSchema }>;
  };
  responses?: Record<
    string,
    { content?: Record<string, { schema?: OpenApiSchema }> }
  >;
};

type OpenApiSchema = {
  $ref?: string;
  type?: string;
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
};

export type OpenApiDocument = {
  'x-studytube-contract-version'?: number;
  'x-studytube-baseline-source'?: OpenApiBaselineSource;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, OpenApiSchema> };
};

export type OpenApiBaselineSource = {
  commit: string;
  apiSourceTree: string;
};

export function assertBootstrapBaselineProvenance(
  baseline: OpenApiDocument,
  expected: OpenApiBaselineSource,
): void {
  const source = baseline['x-studytube-baseline-source'];
  if (!source) {
    throw new Error('OpenAPI bootstrap baseline provenance is missing');
  }
  if (
    source.commit !== expected.commit ||
    source.apiSourceTree !== expected.apiSourceTree
  ) {
    throw new Error(
      `OpenAPI bootstrap baseline does not match base commit ${expected.commit}`,
    );
  }
}

export function findBreakingChanges(
  baseline: OpenApiDocument,
  current: OpenApiDocument,
): string[] {
  const breaks: string[] = [];
  const enforceDocumentedRequiredInputs =
    baseline['x-studytube-contract-version'] === 1;
  for (const [path, baselinePath] of Object.entries(baseline.paths)) {
    const currentPath = current.paths[path];
    if (!currentPath) {
      breaks.push(`removed path ${path}`);
      continue;
    }
    for (const method of methods) {
      const previous = baselinePath[method];
      if (!previous) {
        continue;
      }
      const next = currentPath[method];
      if (!next) {
        breaks.push(`removed operation ${method.toUpperCase()} ${path}`);
        continue;
      }
      if (
        previous.requestBody?.required !== true &&
        next.requestBody?.required
      ) {
        breaks.push(
          `made request body required for ${method.toUpperCase()} ${path}`,
        );
      }
      if (securityFingerprint(previous) !== securityFingerprint(next)) {
        breaks.push(
          `changed authentication requirement for ${method.toUpperCase()} ${path}`,
        );
      }
      const oldParameters = new Map(
        (previous.parameters ?? []).map((parameter) => [
          `${parameter.in}:${parameter.name}`,
          parameter,
        ]),
      );
      const nextParameters = new Map(
        (next.parameters ?? []).map((parameter) => [
          `${parameter.in}:${parameter.name}`,
          parameter,
        ]),
      );
      for (const [key, parameter] of oldParameters) {
        const nextParameter = nextParameters.get(key);
        if (!nextParameter) {
          breaks.push(
            `removed parameter ${key} from ${method.toUpperCase()} ${path}`,
          );
          continue;
        }
        if (parameter.schema && nextParameter.schema) {
          compareSchema(
            `parameter ${key} on ${method.toUpperCase()} ${path}`,
            parameter.schema,
            nextParameter.schema,
            breaks,
          );
        }
      }
      for (const parameter of next.parameters ?? []) {
        const key = `${parameter.in}:${parameter.name}`;
        if (
          enforceDocumentedRequiredInputs &&
          parameter.required &&
          !oldParameters.get(key)?.required
        ) {
          breaks.push(
            `added required parameter ${key} to ${method.toUpperCase()} ${path}`,
          );
        }
      }
      compareContent(
        `request body for ${method.toUpperCase()} ${path}`,
        previous.requestBody?.content,
        next.requestBody?.content,
        breaks,
      );
      const nextResponses = next.responses ?? {};
      for (const status of Object.keys(previous.responses ?? {}).filter(
        (code) => /^2\d\d$/u.test(code),
      )) {
        if (!(status in nextResponses)) {
          breaks.push(
            `removed success response ${status} from ${method.toUpperCase()} ${path}`,
          );
          continue;
        }
        compareContent(
          `response ${status} for ${method.toUpperCase()} ${path}`,
          previous.responses?.[status]?.content,
          nextResponses[status]?.content,
          breaks,
        );
      }
    }
  }
  compareSchemas(baseline, current, breaks, enforceDocumentedRequiredInputs);
  return breaks;
}

function securityFingerprint(operation: OpenApiOperation): string {
  return operation.security === undefined
    ? 'inherit'
    : JSON.stringify(operation.security);
}

function compareContent(
  context: string,
  previous: Record<string, { schema?: OpenApiSchema }> | undefined,
  next: Record<string, { schema?: OpenApiSchema }> | undefined,
  breaks: string[],
): void {
  for (const [mediaType, previousMedia] of Object.entries(previous ?? {})) {
    const nextMedia = next?.[mediaType];
    if (!nextMedia) {
      breaks.push(`removed media type ${mediaType} from ${context}`);
      continue;
    }
    if (previousMedia.schema && !nextMedia.schema) {
      breaks.push(`removed schema from ${mediaType} ${context}`);
      continue;
    }
    if (previousMedia.schema && nextMedia.schema) {
      compareSchema(
        `${context} ${mediaType}`,
        previousMedia.schema,
        nextMedia.schema,
        breaks,
      );
    }
  }
}

function compareSchemas(
  baseline: OpenApiDocument,
  current: OpenApiDocument,
  breaks: string[],
  enforceRequiredProperties: boolean,
): void {
  const previousSchemas = baseline.components?.schemas ?? {};
  const nextSchemas = current.components?.schemas ?? {};
  for (const name of Object.keys(previousSchemas)) {
    if (!(name in nextSchemas)) {
      breaks.push(`removed schema ${name}`);
    }
  }
  for (const [name, previous] of Object.entries(previousSchemas)) {
    const next = nextSchemas[name];
    if (!next) {
      continue;
    }
    compareSchema(name, previous, next, breaks, enforceRequiredProperties);
  }
}

function compareSchema(
  context: string,
  previous: OpenApiSchema,
  next: OpenApiSchema,
  breaks: string[],
  enforceRequiredProperties = true,
): void {
  if (previous.$ref && previous.$ref !== next.$ref) {
    breaks.push(
      `changed schema reference ${context} from ${previous.$ref} to ${next.$ref ?? 'inline schema'}`,
    );
  }
  if (previous.type && next.type && previous.type !== next.type) {
    breaks.push(
      `changed type of schema ${context} from ${previous.type} to ${next.type}`,
    );
  }
  if (previous.items && !next.items) {
    breaks.push(`removed array item schema from ${context}`);
  } else if (previous.items && next.items) {
    compareSchema(
      `${context} items`,
      previous.items,
      next.items,
      breaks,
      enforceRequiredProperties,
    );
  }
  const nextEnum = new Set(next.enum ?? []);
  for (const value of previous.enum ?? []) {
    if (next.enum && !nextEnum.has(value)) {
      breaks.push(`removed enum value ${String(value)} from schema ${context}`);
    }
  }
  const previousProperties = previous.properties ?? {};
  const nextProperties = next.properties ?? {};
  for (const property of Object.keys(previousProperties)) {
    const previousProperty = previousProperties[property];
    const nextProperty = nextProperties[property];
    if (!nextProperty) {
      breaks.push(`removed schema ${context} property ${property}`);
      continue;
    }
    compareSchema(
      `${context} property ${property}`,
      previousProperty,
      nextProperty,
      breaks,
      enforceRequiredProperties,
    );
  }
  if (enforceRequiredProperties) {
    const previouslyRequired = new Set(previous.required ?? []);
    for (const property of next.required ?? []) {
      if (!previouslyRequired.has(property)) {
        breaks.push(`made schema ${context} property ${property} required`);
      }
    }
  }
}
