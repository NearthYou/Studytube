export function evenlySampleQuizEvidence<
  T extends { startSeconds: number; endSeconds: number },
>(rows: T[], count: number): T[] {
  if (!Number.isInteger(count) || count < 1 || rows.length < count) return [];
  const ordered = [...rows].sort(
    (left, right) =>
      left.startSeconds - right.startSeconds ||
      left.endSeconds - right.endSeconds,
  );
  if (count === 1) return [ordered[0]];
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (ordered.length - 1)) / (count - 1),
    );
    return ordered[sourceIndex];
  });
}
