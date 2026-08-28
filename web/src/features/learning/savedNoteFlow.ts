export type SavedNoteState = {
  mode: "view" | "edit";
  originalBody: string;
  draftBody: string;
};

export type SavedNoteEvent =
  | { type: "edit" }
  | { type: "change"; body: string }
  | { type: "cancel" }
  | { type: "sync"; body: string };

export function createSavedNoteState(body: string): SavedNoteState {
  return {
    mode: "view",
    originalBody: body,
    draftBody: body,
  };
}

export function transitionSavedNote(
  state: SavedNoteState,
  event: SavedNoteEvent,
): SavedNoteState {
  if (event.type === "edit") return { ...state, mode: "edit" };
  if (event.type === "change" && state.mode === "edit") {
    return { ...state, draftBody: event.body };
  }
  if (event.type === "cancel") {
    return { ...state, mode: "view", draftBody: state.originalBody };
  }
  if (event.type === "sync") return createSavedNoteState(event.body);
  return state;
}

export function canSaveSavedNote(state: SavedNoteState): boolean {
  return (
    state.mode === "edit" &&
    Boolean(state.draftBody.trim()) &&
    state.draftBody !== state.originalBody
  );
}
