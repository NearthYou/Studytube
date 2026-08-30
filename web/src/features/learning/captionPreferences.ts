export type CaptionSize = "small" | "medium" | "large";

export type CaptionPreferences = {
  visible: boolean;
  backgroundOpacity: number;
  size: CaptionSize;
};

type CaptionStorage = Pick<Storage, "getItem" | "setItem">;

const STORAGE_KEY = "studytube:caption-preferences:v1";
const CAPTION_SIZES = new Set<CaptionSize>(["small", "medium", "large"]);

export const DEFAULT_CAPTION_PREFERENCES: CaptionPreferences = {
  visible: true,
  backgroundOpacity: 0.74,
  size: "medium",
};

export function loadCaptionPreferences(
  storage: CaptionStorage = window.localStorage,
): CaptionPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") as
      | Partial<CaptionPreferences>
      | null;
    if (
      !parsed ||
      typeof parsed.visible !== "boolean" ||
      typeof parsed.backgroundOpacity !== "number" ||
      parsed.backgroundOpacity < 0 ||
      parsed.backgroundOpacity > 1 ||
      !CAPTION_SIZES.has(parsed.size as CaptionSize)
    ) {
      return { ...DEFAULT_CAPTION_PREFERENCES };
    }
    return {
      visible: parsed.visible,
      backgroundOpacity: parsed.backgroundOpacity,
      size: parsed.size as CaptionSize,
    };
  } catch {
    return { ...DEFAULT_CAPTION_PREFERENCES };
  }
}

export function saveCaptionPreferences(
  preferences: CaptionPreferences,
  storage: CaptionStorage = window.localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Playback controls still work when browser storage is unavailable.
  }
}
