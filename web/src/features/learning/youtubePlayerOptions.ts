export function youtubePlayerVars(
  initialTime: number,
  preferNativeCaptions: boolean,
) {
  const start =
    Number.isFinite(initialTime) && initialTime > 0
      ? Math.floor(initialTime)
      : 0;
  return {
    rel: 0,
    playsinline: 1,
    enablejsapi: 1,
    cc_load_policy: preferNativeCaptions ? 1 : 0,
    start,
  };
}
