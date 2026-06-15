export const DEFAULT_PLAYLIST_DRAFT_TITLE = "나만의 학습 플레이리스트";

export type PlaylistDraft<TVideo> = {
  id: string;
  title: string;
  description: string;
  videos: TVideo[];
  createdAt: string;
  updatedAt: string;
};

export type PlaylistDraftState<TVideo> = {
  drafts: PlaylistDraft<TVideo>[];
  activeDraftId: string;
};

type NormalizeOptions<TVideo> = {
  activeDraftId?: string | null;
  fallbackVideos?: TVideo[];
  normalizeVideo: (video: unknown) => TVideo | null;
  createId?: () => string;
  now?: string;
};

type DraftPatch<TVideo> = Partial<
  Pick<PlaylistDraft<TVideo>, "title" | "description" | "videos">
>;

export function createPlaylistDraft<TVideo>({
  id = createPlaylistDraftId(),
  title = DEFAULT_PLAYLIST_DRAFT_TITLE,
  description = "",
  videos = [],
  now = new Date().toISOString(),
}: {
  id?: string;
  title?: string;
  description?: string;
  videos?: TVideo[];
  now?: string;
} = {}): PlaylistDraft<TVideo> {
  return {
    id,
    title,
    description,
    videos,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizePlaylistDraftState<TVideo>(
  input: unknown,
  options: NormalizeOptions<TVideo>,
): PlaylistDraftState<TVideo> {
  const parsedActiveDraftId =
    isRecord(input) && typeof input.activeDraftId === "string"
      ? input.activeDraftId
      : null;
  const rawDrafts = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.drafts)
      ? input.drafts
      : [];
  const now = options.now ?? new Date().toISOString();
  const drafts = rawDrafts
    .map((draft, index) =>
      normalizePlaylistDraft(
        draft,
        index,
        options.normalizeVideo,
        now,
        options.createId,
      ),
    )
    .filter((draft): draft is PlaylistDraft<TVideo> => Boolean(draft));

  if (drafts.length === 0) {
    drafts.push(
      createPlaylistDraft({
        id: options.createId?.(),
        videos: options.fallbackVideos ?? [],
        now,
      }),
    );
  }

  const preferredActiveId = options.activeDraftId ?? parsedActiveDraftId;
  const activeDraftId = drafts.some((draft) => draft.id === preferredActiveId)
    ? preferredActiveId!
    : drafts[0].id;

  return { drafts, activeDraftId };
}

export function selectActivePlaylistDraft<TVideo>(
  state: PlaylistDraftState<TVideo>,
): PlaylistDraft<TVideo> {
  return (
    state.drafts.find((draft) => draft.id === state.activeDraftId) ??
    state.drafts[0]
  );
}

export function patchActivePlaylistDraft<TVideo>(
  state: PlaylistDraftState<TVideo>,
  patch: DraftPatch<TVideo>,
  now = new Date().toISOString(),
): PlaylistDraftState<TVideo> {
  return {
    ...state,
    drafts: state.drafts.map((draft) =>
      draft.id === state.activeDraftId
        ? {
            ...draft,
            ...patch,
            updatedAt: now,
          }
        : draft,
    ),
  };
}

export function removePlaylistDraft<TVideo>(
  state: PlaylistDraftState<TVideo>,
  draftId: string,
  replacementDraft: PlaylistDraft<TVideo>,
): PlaylistDraftState<TVideo> {
  const remainingDrafts = state.drafts.filter((draft) => draft.id !== draftId);
  const drafts =
    remainingDrafts.length > 0 ? remainingDrafts : [replacementDraft];
  const activeDraftId =
    state.activeDraftId === draftId
      ? drafts[0].id
      : drafts.some((draft) => draft.id === state.activeDraftId)
        ? state.activeDraftId
        : drafts[0].id;

  return { drafts, activeDraftId };
}

function normalizePlaylistDraft<TVideo>(
  draft: unknown,
  index: number,
  normalizeVideo: (video: unknown) => TVideo | null,
  now: string,
  createId?: () => string,
) {
  if (!isRecord(draft)) {
    return null;
  }

  const videos = Array.isArray(draft.videos)
    ? draft.videos
        .map((video) => normalizeVideo(video))
        .filter((video): video is TVideo => Boolean(video))
    : [];

  return createPlaylistDraft({
    id: typeof draft.id === "string" && draft.id ? draft.id : createId?.(),
    title:
      typeof draft.title === "string" && draft.title.trim()
        ? draft.title
        : index === 0
          ? DEFAULT_PLAYLIST_DRAFT_TITLE
          : `작성 중인 플레이리스트 ${index + 1}`,
    description: typeof draft.description === "string" ? draft.description : "",
    videos,
    now:
      typeof draft.createdAt === "string" && draft.createdAt
        ? draft.createdAt
        : now,
  });
}

function createPlaylistDraftId() {
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
