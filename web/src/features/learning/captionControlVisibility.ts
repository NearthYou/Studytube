export function shouldScheduleCaptionLowering({
  playing,
  pointerInside,
}: {
  playing: boolean;
  pointerInside: boolean;
}) {
  return playing && !pointerInside;
}
