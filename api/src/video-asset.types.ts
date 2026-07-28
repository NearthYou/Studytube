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
