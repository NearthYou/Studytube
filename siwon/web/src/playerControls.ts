const PLAYER_CONTROLS_HOVER_MIN_HEIGHT = 64;
const PLAYER_CONTROLS_HOVER_MAX_HEIGHT = 112;
const PLAYER_CONTROLS_HOVER_RATIO = 0.18;

export function isPointerInPlayerControlsHoverZone({
  bottom,
  clientY,
  top,
}: {
  bottom: number;
  clientY: number;
  top: number;
}) {
  const playerHeight = Math.max(0, bottom - top);
  const hoverZoneHeight = Math.min(
    PLAYER_CONTROLS_HOVER_MAX_HEIGHT,
    Math.max(
      PLAYER_CONTROLS_HOVER_MIN_HEIGHT,
      playerHeight * PLAYER_CONTROLS_HOVER_RATIO,
    ),
  );

  return clientY >= bottom - hoverZoneHeight && clientY <= bottom;
}
