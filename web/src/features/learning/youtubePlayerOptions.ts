export function youtubePlayerVars(initialTime: number) {
  const start =
    Number.isFinite(initialTime) && initialTime > 0
      ? Math.floor(initialTime)
      : 0;
  return {
    rel: 0,
    playsinline: 1,
    enablejsapi: 1,
    cc_load_policy: 0,
    start,
  };
}
