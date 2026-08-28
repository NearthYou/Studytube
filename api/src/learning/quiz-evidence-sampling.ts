export function buildQuizEvidencePassages<
  T extends {
    content: string;
    startSeconds: number;
    endSeconds: number;
  },
>(rows: T[], count: number, maxCharacters = 3_000): T[] {
  if (!Number.isInteger(count) || count < 1 || rows.length < count) return [];
  const ordered = [...rows].sort(
    (left, right) =>
      left.startSeconds - right.startSeconds ||
      left.endSeconds - right.endSeconds,
  );

  return Array.from({ length: count }, (_, index) => {
    const bucketStart = Math.floor((index * ordered.length) / count);
    const bucketEnd = Math.floor(((index + 1) * ordered.length) / count);
    const bucket = ordered.slice(bucketStart, bucketEnd);
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    const content = bucket
      .map((row) => row.content.trim())
      .filter(Boolean)
      .join(' ')
      .slice(0, maxCharacters)
      .trim();

    return {
      ...first,
      content,
      startSeconds: first.startSeconds,
      endSeconds: last.endSeconds,
    };
  });
}
