import {
  deriveTags,
  extractYouTubeId,
  youtubeThumbnailUrl,
} from './videoMetadata.ts';

export type PostEditorLike = {
  title: string;
  videoUrl: string;
  summary: string;
};

export type VideoRegistrationEditor = PostEditorLike & {
  thumbnailUrl: string;
  channelName: string;
  translatedNotes: string;
  tags: string;
};

export function hasPostEditorVideoUrl(editor: Pick<PostEditorLike, 'videoUrl'>) {
  return Boolean(editor.videoUrl.trim());
}

export function isPostEditorReadyToSave(editor: PostEditorLike) {
  return Boolean(
    editor.videoUrl.trim() && editor.title.trim() && editor.summary.trim(),
  );
}

export function postRegistrationRefreshSearch(currentSearch: string) {
  void currentSearch;

  return '';
}

export function fallbackPostEditorFromVideoUrl(
  inputUrl: string,
  baseEditor: VideoRegistrationEditor,
): VideoRegistrationEditor | null {
  const videoUrl = inputUrl.trim();
  const videoId = extractYouTubeId(videoUrl);

  if (!videoUrl || !videoId) {
    return null;
  }

  const title = baseEditor.title.trim() || `YouTube 영상 ${videoId}`;
  const channelName = baseEditor.channelName.trim() || 'YouTube';
  const summary =
    baseEditor.summary.trim() ||
    'YouTube 링크로 등록한 학습 영상입니다. 저장 후 세부 정보에서 제목과 요약을 보강할 수 있습니다.';
  const translatedNotes =
    baseEditor.translatedNotes.trim() ||
    `${summary}\n\nAI 분석 요약: 분석을 완료하지 못했지만 영상은 먼저 저장했습니다. 핵심 개념과 복습 질문은 필요할 때 직접 보강하세요.`;
  const tags =
    baseEditor.tags.trim() ||
    deriveTags(`${title} ${channelName} ${summary}`).join(', ');

  return {
    ...baseEditor,
    title,
    videoUrl,
    thumbnailUrl: baseEditor.thumbnailUrl.trim() || youtubeThumbnailUrl(videoId),
    channelName,
    summary,
    translatedNotes,
    tags,
  };
}

export function videoRegistrationSubmitLabel({
  isEditing,
  isFetchingMetadata,
  isSaving,
  readyToSave,
}: {
  isEditing: boolean;
  isFetchingMetadata: boolean;
  isSaving: boolean;
  readyToSave: boolean;
}) {
  if (isFetchingMetadata) {
    return '분석 중';
  }

  if (isSaving) {
    return '저장 중';
  }

  if (isEditing) {
    return readyToSave ? '수정 저장' : '분석 후 저장';
  }

  return readyToSave ? '영상 추가' : '분석 후 추가';
}
