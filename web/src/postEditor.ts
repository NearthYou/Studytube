export type PostEditorLike = {
  title: string;
  videoUrl: string;
  summary: string;
};

export function hasPostEditorVideoUrl(editor: Pick<PostEditorLike, 'videoUrl'>) {
  return Boolean(editor.videoUrl.trim());
}

export function isPostEditorReadyToSave(editor: PostEditorLike) {
  return Boolean(
    editor.videoUrl.trim() && editor.title.trim() && editor.summary.trim(),
  );
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
    return readyToSave ? '수정 저장' : '분석하고 수정 저장';
  }

  return readyToSave ? '영상 추가하기' : '분석하고 영상 추가하기';
}
