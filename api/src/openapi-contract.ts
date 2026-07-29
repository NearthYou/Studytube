type OpenApiSchema = {
  $ref?: string;
  type?: string;
  properties?: Record<string, OpenApiSchema>;
  additionalProperties?: unknown;
  items?: OpenApiSchema;
  allOf?: OpenApiSchema[];
  maxLength?: number;
};

type OpenApiResponse = {
  content?: Record<string, { schema?: OpenApiSchema }>;
};

type OpenApiOperation = {
  operationId?: string;
  parameters?: Array<{
    in?: string;
    name?: string;
    required?: boolean;
    schema?: OpenApiSchema;
  }>;
  responses?: Record<string, OpenApiResponse>;
};

type OpenApiDocument = {
  'x-studytube-contract-version'?: number;
  security?: Array<Record<string, unknown>>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
};

const operationMethods = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
]);

const learningIdempotencyOperationIds = new Set([
  'LearningController_createRun',
  'LearningController_recordProgress',
  'LearningController_submitQuiz',
]);

export function assertOpenApiContract(documentValue: unknown): void {
  if (typeof documentValue !== 'object' || documentValue === null) {
    throw new Error('OpenAPI contract is not an object');
  }
  const document = documentValue as OpenApiDocument;
  const failures: string[] = [];
  const componentSchemas = document.components?.schemas ?? {};
  if (document['x-studytube-contract-version'] !== 1) {
    failures.push('contract version 1 marker is missing');
  }
  if (
    !document.security?.some((requirement) =>
      Object.prototype.hasOwnProperty.call(requirement, 'session'),
    )
  ) {
    failures.push('global session cookie security requirement is missing');
  }
  for (const [name, schema] of Object.entries(componentSchemas)) {
    if (
      schema.type === 'object' &&
      !schema.$ref &&
      Object.keys(schema.properties ?? {}).length === 0
    ) {
      failures.push(`schema ${name} has no documented properties`);
    }
  }
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!operationMethods.has(method) || !operation.responses) {
        continue;
      }
      if (learningIdempotencyOperationIds.has(operation.operationId ?? '')) {
        const header = operation.parameters?.find(
          (parameter) =>
            parameter.in === 'header' &&
            parameter.name?.toLowerCase() === 'idempotency-key',
        );
        if (
          header?.required !== true ||
          header.schema?.type !== 'string' ||
          header.schema.maxLength !== 200
        ) {
          failures.push(
            `${method.toUpperCase()} ${path} Idempotency-Key header must be required with maxLength 200`,
          );
        }
      }
      for (const [status, response] of Object.entries(operation.responses)) {
        if (!/^2\d\d$/u.test(status) || status === '204') {
          continue;
        }
        const hasSchema = Object.values(response.content ?? {}).some((media) =>
          isDocumentedResponseSchema(media.schema, componentSchemas),
        );
        if (!hasSchema) {
          failures.push(
            `${method.toUpperCase()} ${path} response ${status} has no schema`,
          );
        }
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`OpenAPI contract is incomplete:\n${failures.join('\n')}`);
  }
}

function isDocumentedResponseSchema(
  schema: OpenApiSchema | undefined,
  components: Record<string, OpenApiSchema>,
  seen = new Set<string>(),
): boolean {
  if (!schema || Object.keys(schema).length === 0) {
    return false;
  }
  if (schema.$ref) {
    const prefix = '#/components/schemas/';
    if (!schema.$ref.startsWith(prefix)) {
      return false;
    }
    const name = schema.$ref.slice(prefix.length);
    if (seen.has(name)) {
      return true;
    }
    const target = components[name];
    if (!target) {
      return false;
    }
    const nestedSeen = new Set(seen);
    nestedSeen.add(name);
    return isDocumentedResponseSchema(target, components, nestedSeen);
  }
  if (schema.type === 'array') {
    return isDocumentedResponseSchema(schema.items, components, seen);
  }
  if (schema.type !== 'object') {
    return (
      schema.type !== undefined ||
      (schema.allOf?.some((item) =>
        isDocumentedResponseSchema(item, components, seen),
      ) ??
        false)
    );
  }
  const properties = Object.values(schema.properties ?? {});
  return (
    (properties.length > 0 &&
      properties.every((property) =>
        isDocumentedResponseSchema(property, components, seen),
      )) ||
    schema.additionalProperties !== undefined ||
    (schema.allOf?.some((item) =>
      isDocumentedResponseSchema(item, components, seen),
    ) ??
      false)
  );
}
