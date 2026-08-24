import { useCallback, useEffect, useState } from "react";
import type { LearningNote } from "../../types.ts";
import {
  EMPTY_CAPTION_STATE,
  type ProgressiveCaptionState,
} from "./captionState.ts";

export type LearningTab = "current" | "overview" | "notes" | "quiz";

export type LearningSessionState = {
  videoId: string;
  contextId: string;
  workId: string;
  selectedTab: LearningTab;
  currentTime: number;
  noteDraft: string;
  notePositionSeconds: number | null;
  notes: LearningNote[];
  captions: ProgressiveCaptionState;
};

const STORAGE_KEY = "studytube.learningSession";

export function learningSessionStorageKey(userId: number, videoId: string) {
  return `${STORAGE_KEY}:user-${userId}:${videoId}`;
}

export function readLearningSession(
  userId: number,
  videoId: string,
  storage: Storage = window.sessionStorage,
): LearningSessionState {
  try {
    const raw = storage.getItem(learningSessionStorageKey(userId, videoId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LearningSessionState>;
      if (parsed.videoId === videoId) {
        return normalizeLearningSession(parsed, videoId);
      }
    }
  } catch {
    // Start with a safe empty session when browser state is malformed.
  }
  return normalizeLearningSession({}, videoId);
}

export function saveLearningSession(
  userId: number,
  state: LearningSessionState,
  storage: Storage = window.sessionStorage,
) {
  storage.setItem(
    learningSessionStorageKey(userId, state.videoId),
    JSON.stringify(state),
  );
}

export function patchLearningSession(
  userId: number,
  videoId: string,
  patch: Partial<LearningSessionState>,
  storage: Storage = window.sessionStorage,
) {
  const next = normalizeLearningSession(
    { ...readLearningSession(userId, videoId, storage), ...patch, videoId },
    videoId,
  );
  saveLearningSession(userId, next, storage);
  return next;
}

export function useLearningSession(userId: number, videoId: string) {
  const [state, setState] = useState<LearningSessionState>(() =>
    readLearningSession(userId, videoId),
  );

  useEffect(() => {
    if (state.videoId === videoId) saveLearningSession(userId, state);
  }, [state, userId, videoId]);

  const update = useCallback(
    (patch: Partial<LearningSessionState>) => {
      setState((current) =>
        normalizeLearningSession({ ...current, ...patch }, videoId),
      );
    },
    [videoId],
  );

  return { state, update };
}

function normalizeLearningSession(
  value: Partial<LearningSessionState>,
  videoId: string,
): LearningSessionState {
  const storedTab = value.selectedTab;
  const selectedTab: LearningTab = ["current", "overview", "notes", "quiz"].includes(
    storedTab ?? "",
  )
    ? (storedTab as LearningTab)
    : "current";
  const currentTime =
    typeof value.currentTime === "number" && Number.isFinite(value.currentTime)
      ? Math.max(0, value.currentTime)
      : 0;
  const noteDraft = typeof value.noteDraft === "string" ? value.noteDraft : "";
  const notePositionSeconds =
    typeof value.notePositionSeconds === "number" &&
    Number.isFinite(value.notePositionSeconds)
      ? Math.max(0, value.notePositionSeconds)
      : noteDraft
        ? currentTime
        : null;
  return {
    videoId,
    contextId: typeof value.contextId === "string" ? value.contextId : "",
    workId: typeof value.workId === "string" ? value.workId : "",
    selectedTab,
    currentTime,
    noteDraft,
    notePositionSeconds,
    notes: Array.isArray(value.notes) ? value.notes : [],
    captions: value.captions
      ? { ...EMPTY_CAPTION_STATE, ...value.captions }
      : EMPTY_CAPTION_STATE,
  };
}
