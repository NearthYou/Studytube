export function canonicalPositiveId(value: string | number): string {
  if (
    typeof value === 'number' &&
    (!Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new RangeError(
      'Numeric retrieval source ID must be a positive safe integer',
    );
  }
  const normalized = String(value);
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new RangeError('Retrieval source ID must be a positive integer');
  }
  return normalized;
}

export function embeddingLiteral(embedding: number[]): string {
  if (
    embedding.length !== 1536 ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new RangeError('Embedding must contain 1536 finite dimensions');
  }
  return `[${embedding.join(',')}]`;
}
