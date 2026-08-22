export type VideoAssetStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'partial'
  | 'failed';

export type VideoAssetStepStatus = 'pending' | 'ready' | 'partial' | 'failed';

export type VideoAssetSegment = {
  start: number;
  end: number;
  text: string;
};

export type VideoAssetSummarySection = {
  label: string;
  body: string;
};

export type VideoAsset = {
  id: number;
  postId: number;
  videoId: string;
  videoUrl: string;
  language: string;
  sourceLanguage: string;
  status: VideoAssetStatus;
  sourceCaptionStatus: VideoAssetStepStatus;
  translationStatus: VideoAssetStepStatus;
  summaryStatus: VideoAssetStepStatus;
  sourceSegments: VideoAssetSegment[];
  translatedSegments: VideoAssetSegment[];
  summarySections: VideoAssetSummarySection[];
  transcriptBody: string;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateVideoAssetInput = {
  postId: number;
  videoId: string;
  videoUrl: string;
  language?: string;
};

export type UpdateVideoAssetInput = Partial<
  Pick<
    VideoAsset,
    | 'language'
    | 'sourceLanguage'
    | 'status'
    | 'sourceCaptionStatus'
    | 'translationStatus'
    | 'summaryStatus'
    | 'sourceSegments'
    | 'translatedSegments'
    | 'summarySections'
    | 'transcriptBody'
    | 'errorMessage'
  >
>;

export type CaptionArtifactKind =
  | 'youtube_caption'
  | 'transcription'
  | 'translation';

export type CaptionPipelineRequest = Readonly<{
  eventId: string;
  handlerVersion: string;
  leaseToken: string;
  canonicalVideoId: string;
  targetLanguage: 'ko';
  durationSeconds: number;
}>;

export type CaptionGeneration = Readonly<{
  id: string;
  generation: number;
}>;

export type CaptionArtifactSegment = VideoAssetSegment & {
  ordinal: number;
};

export type CaptionSegmentBatch = Readonly<{
  artifactId: string;
  request: CaptionPipelineRequest;
  segments: CaptionArtifactSegment[];
}>;

export interface CaptionArtifactRepository {
  hasActiveSttApproval(model: string): Promise<boolean>;
  createGeneration(input: {
    kind: CaptionArtifactKind;
    parentArtifactId?: string;
    sourceLanguage: string;
    targetLanguage?: string;
    request: CaptionPipelineRequest;
  }): Promise<CaptionGeneration>;
  appendSegments(input: CaptionSegmentBatch): Promise<boolean>;
  publishGeneration(input: {
    artifactId: string;
    request: CaptionPipelineRequest;
  }): Promise<boolean>;
  failGeneration(input: {
    request: CaptionPipelineRequest;
    errorCode: CaptionSafeErrorCode;
  }): Promise<void>;
  commitWork(input: {
    request: CaptionPipelineRequest;
    actualCostMicrounits: number;
  }): Promise<void>;
}

export type CaptionSafeErrorCode =
  | 'STT_NOT_APPROVED'
  | 'STT_DISABLED'
  | 'VIDEO_LIVE_UNSUPPORTED'
  | 'VIDEO_RESTRICTED'
  | 'VIDEO_AUTH_REQUIRED'
  | 'VIDEO_TOO_LONG'
  | 'CAPTION_PROVIDER_UNAVAILABLE'
  | 'TRANSCRIPTION_PROVIDER_UNAVAILABLE'
  | 'TRANSLATION_PROVIDER_UNAVAILABLE';

export type LearningCaptionResult = Readonly<{
  sourceArtifactId: string | null;
  translationArtifactId: string | null;
  source: 'youtube_caption' | 'transcription' | 'none';
  status: 'partial' | 'ready' | 'failed';
  errorCode?: CaptionSafeErrorCode;
}>;
