# Video Asset Precompute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare translated captions, full transcript, and Korean summary assets as soon as a video is saved, so watch-page jumps load prepared data instead of waiting for on-demand generation.

**Architecture:** Nest owns asset persistence, job orchestration, and HTTP endpoints. FastAPI remains the caption and summary generation engine through the existing `/youtube/captions` and `/youtube/summary` endpoints. The web app reads prepared assets first and only falls back to current windowed caption generation when prepared ranges are missing.

**Tech Stack:** NestJS, TypeScript, PostgreSQL JSONB, file-backed memory fallback, FastAPI AI service, React/Vite frontend, Node test runner/Jest.

---

## File Structure

- Create `siwon/api/src/video-asset.types.ts`: shared API-side asset status, segment, summary, and repository input types.
- Create `siwon/api/src/video-asset.service.ts`: in-process job queue, AI orchestration, and asset status transitions.
- Create `siwon/api/src/video-asset.controller.ts`: `GET /video-assets/:videoId` and `POST /video-assets/:videoId/prepare`.
- Create `siwon/api/src/video-asset.service.spec.ts`: service/job behavior tests with fake repository and fake AI proxy.
- Create `siwon/api/src/video-asset.controller.spec.ts`: endpoint wiring tests.
- Modify `siwon/api/src/study-board.types.ts`: extend `BoardRepository` with video asset persistence methods.
- Modify `siwon/api/src/memory-board.repository.ts`: store assets in memory and fallback JSON.
- Modify `siwon/api/src/database.service.ts`: add `video_assets` schema, DB persistence, and fallback behavior.
- Modify `siwon/api/src/app.module.ts`: register controller and service.
- Modify `siwon/api/src/study-board.service.ts`: enqueue asset preparation after post creation.
- Modify `siwon/api/src/study-board.service.spec.ts`: verify post creation does not block and enqueues preparation.
- Modify `siwon/web/src/types.ts`: add `VideoAsset` response types.
- Modify `siwon/web/src/api.ts`: add `fetchVideoAsset` and `prepareVideoAsset`.
- Modify `siwon/web/src/captions.ts`: add helpers for converting prepared assets into caption responses and checking range coverage.
- Modify `siwon/web/src/App.tsx`: read asset first on watch page, seed captions/summary, show preparation status, keep window fallback.
- Modify `siwon/web/tests/captions.test.ts` and `siwon/web/tests/videoSummaryDetails.test.ts`: asset helper coverage.
- Modify or add `siwon/web/tests/watchAccessibility.test.ts`: verify watch flow has asset-first calls and preparation status copy.

---

### Task 1: Add Video Asset Types And Repository Contract

**Files:**
- Create: `siwon/api/src/video-asset.types.ts`
- Modify: `siwon/api/src/study-board.types.ts`
- Test: `siwon/api/src/study-board.service.spec.ts`

- [ ] **Step 1: Write the failing type-level repository usage test**

Add this test near existing create-post tests in `siwon/api/src/study-board.service.spec.ts`:

```ts
it('creates posts through a repository that supports video assets', async () => {
  const session = await service.demoSession();
  const post = await service.createPost(session.token, {
    title: 'Asset ready lesson',
    videoUrl: 'https://www.youtube.com/watch?v=novnyCaa7To',
    thumbnailUrl: 'https://i.ytimg.com/vi/novnyCaa7To/hqdefault.jpg',
    channelName: 'The Net Ninja',
    summary: 'React Query server state lesson.',
    translatedNotes: 'React Query 서버 상태 학습 자료입니다.',
    tags: ['react', 'query'],
  });

  const asset = await service.getVideoAsset(session.token, 'novnyCaa7To');

  expect(post.videoUrl).toContain('novnyCaa7To');
  expect(asset.videoId).toBe('novnyCaa7To');
  expect(asset.status).toBe('pending');
});
```

- [ ] **Step 2: Run the focused API test and verify it fails**

Run:

```bash
npm --prefix siwon/api test -- study-board.service.spec.ts --runInBand
```

Expected: FAIL because `getVideoAsset` and repository asset methods do not exist.

- [ ] **Step 3: Create `video-asset.types.ts`**

Add:

```ts
export type VideoAssetStatus = 'pending' | 'processing' | 'ready' | 'partial' | 'failed';
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
```

- [ ] **Step 4: Extend `BoardRepository` contract**

In `siwon/api/src/study-board.types.ts`, import the new types and add these methods to `BoardRepository`:

```ts
import type {
  CreateVideoAssetInput,
  UpdateVideoAssetInput,
  VideoAsset,
} from './video-asset.types';
```

```ts
  findVideoAsset(videoId: string): Promise<VideoAsset | null>;
  upsertVideoAsset(input: CreateVideoAssetInput): Promise<VideoAsset>;
  updateVideoAsset(
    videoId: string,
    input: UpdateVideoAssetInput,
  ): Promise<VideoAsset | null>;
```

- [ ] **Step 5: Add temporary service method signature**

In `siwon/api/src/study-board.service.ts`, add:

```ts
  async getVideoAsset(
    token: string | undefined,
    videoId: string,
  ): Promise<VideoAsset> {
    await this.requireSession(token);
    const asset = await this.repository.findVideoAsset(videoId);

    if (!asset) {
      throw new NotFoundException('Video asset not found');
    }

    return asset;
  }
```

Add `VideoAsset` import from `./video-asset.types`.

- [ ] **Step 6: Run test and keep the expected failure for missing repository implementation**

Run:

```bash
npm --prefix siwon/api test -- study-board.service.spec.ts --runInBand
```

Expected: FAIL because `MemoryBoardRepository` has not implemented the new repository methods yet.

---

### Task 2: Implement Memory And PostgreSQL Video Asset Persistence

**Files:**
- Modify: `siwon/api/src/memory-board.repository.ts`
- Modify: `siwon/api/src/database.service.ts`
- Modify: `siwon/api/src/database-board.mapper.ts`
- Test: `siwon/api/src/database.service.spec.ts`

- [ ] **Step 1: Add failing memory repository assertions**

Add to `siwon/api/src/study-board.service.spec.ts`:

```ts
it('stores and updates video assets in the repository', async () => {
  const asset = await repository.upsertVideoAsset({
    postId: 999,
    videoId: 'asset-test',
    videoUrl: 'https://www.youtube.com/watch?v=asset-test',
    language: 'ko',
  });

  expect(asset.status).toBe('pending');
  expect(asset.sourceSegments).toEqual([]);

  const updated = await repository.updateVideoAsset('asset-test', {
    status: 'ready',
    sourceCaptionStatus: 'ready',
    translationStatus: 'ready',
    summaryStatus: 'ready',
    translatedSegments: [{ start: 0, end: 3, text: '안녕하세요.' }],
    transcriptBody: '00:00 안녕하세요.',
  });

  expect(updated?.status).toBe('ready');
  expect(updated?.translatedSegments).toHaveLength(1);
  expect((await repository.findVideoAsset('asset-test'))?.transcriptBody).toBe(
    '00:00 안녕하세요.',
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm --prefix siwon/api test -- study-board.service.spec.ts --runInBand
```

Expected: FAIL because memory asset storage is missing.

- [ ] **Step 3: Add memory state storage**

In `MemoryBoardState`, add:

```ts
  videoAssets: VideoAsset[];
```

In `nextIds`, add:

```ts
    videoAsset: number;
```

Initialize:

```ts
  protected videoAssets: VideoAsset[] = [];
```

Update `snapshotState()` and `loadState()` so `videoAssets` and `nextIds.videoAsset` persist. Use `[]` and `1` as defaults.

- [ ] **Step 4: Implement memory asset methods**

Add methods to `MemoryBoardRepository`:

```ts
  async findVideoAsset(videoId: string): Promise<VideoAsset | null> {
    return this.videoAssets.find((asset) => asset.videoId === videoId) ?? null;
  }

  async upsertVideoAsset(input: CreateVideoAssetInput): Promise<VideoAsset> {
    const existing = await this.findVideoAsset(input.videoId);
    const timestamp = nowIso();

    if (existing) {
      return this.updateVideoAsset(input.videoId, {
        language: input.language ?? existing.language,
        errorMessage: '',
      }) as Promise<VideoAsset>;
    }

    const asset: VideoAsset = {
      id: this.nextIds.videoAsset++,
      postId: input.postId,
      videoId: input.videoId,
      videoUrl: input.videoUrl,
      language: input.language ?? 'ko',
      sourceLanguage: '',
      status: 'pending',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
      sourceSegments: [],
      translatedSegments: [],
      summarySections: [],
      transcriptBody: '',
      errorMessage: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.videoAssets.push(asset);
    await this.persistState();
    return asset;
  }

  async updateVideoAsset(
    videoId: string,
    input: UpdateVideoAssetInput,
  ): Promise<VideoAsset | null> {
    const asset = await this.findVideoAsset(videoId);

    if (!asset) {
      return null;
    }

    Object.assign(asset, input, { updatedAt: nowIso() });
    await this.persistState();
    return asset;
  }
```

Import `CreateVideoAssetInput`, `UpdateVideoAssetInput`, and `VideoAsset`.

- [ ] **Step 5: Add database schema**

In `DatabaseService.ensureSchema()`, add:

```sql
CREATE TABLE IF NOT EXISTS video_assets (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL UNIQUE,
  video_url TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ko',
  source_language TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  source_caption_status TEXT NOT NULL DEFAULT 'pending',
  translation_status TEXT NOT NULL DEFAULT 'pending',
  summary_status TEXT NOT NULL DEFAULT 'pending',
  source_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  translated_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  transcript_body TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 6: Implement database asset methods**

In `DatabaseService`, add `override findVideoAsset`, `override upsertVideoAsset`, and `override updateVideoAsset`. Use SQL returning the row and a mapper `normalizeVideoAsset(row)`. On DB errors, call `this.fallback(error)` and delegate to `super`.

Expected upsert SQL:

```sql
INSERT INTO video_assets (post_id, video_id, video_url, language)
VALUES ($1, $2, $3, $4)
ON CONFLICT (video_id)
DO UPDATE SET
  post_id = EXCLUDED.post_id,
  video_url = EXCLUDED.video_url,
  language = EXCLUDED.language,
  error_message = '',
  updated_at = now()
RETURNING *
```

- [ ] **Step 7: Add mapper**

In `database-board.mapper.ts`, add `VideoAssetRow` and `normalizeVideoAsset(row)`:

```ts
export type VideoAssetRow = {
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
  sourceSegments: unknown;
  translatedSegments: unknown;
  summarySections: unknown;
  transcriptBody: string;
  errorMessage: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};
```

The mapper should keep only segment objects with numeric `start`, numeric `end`, and string `text`; keep summary sections with string `label` and `body`.

- [ ] **Step 8: Run API tests**

Run:

```bash
npm --prefix siwon/api test -- study-board.service.spec.ts database.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 9: Commit persistence work**

```bash
git add siwon/api/src/video-asset.types.ts siwon/api/src/study-board.types.ts siwon/api/src/memory-board.repository.ts siwon/api/src/database.service.ts siwon/api/src/database-board.mapper.ts siwon/api/src/study-board.service.spec.ts siwon/api/src/database.service.spec.ts
git commit -m "feat: persist video learning assets"
```

---

### Task 3: Add Video Asset Preparation Service

**Files:**
- Create: `siwon/api/src/video-asset.service.ts`
- Create: `siwon/api/src/video-asset.service.spec.ts`
- Modify: `siwon/api/src/study-board.service.ts`
- Modify: `siwon/api/src/app.module.ts`

- [ ] **Step 1: Write failing service tests**

Create `siwon/api/src/video-asset.service.spec.ts` with fake repository and fake AI proxy:

```ts
import { VideoAssetService } from './video-asset.service';
import type { BoardRepository, StudyPost } from './study-board.types';
import type { VideoAsset } from './video-asset.types';

const baseAsset = (input: Partial<VideoAsset> = {}): VideoAsset => ({
  id: 1,
  postId: 1,
  videoId: 'novnyCaa7To',
  videoUrl: 'https://www.youtube.com/watch?v=novnyCaa7To',
  language: 'ko',
  sourceLanguage: '',
  status: 'pending',
  sourceCaptionStatus: 'pending',
  translationStatus: 'pending',
  summaryStatus: 'pending',
  sourceSegments: [],
  translatedSegments: [],
  summarySections: [],
  transcriptBody: '',
  errorMessage: '',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
  ...input,
});

const post: StudyPost = {
  id: 1,
  authorId: 1,
  authorName: 'Demo',
  title: 'React Query Crash Course',
  videoUrl: 'https://www.youtube.com/watch?v=novnyCaa7To',
  thumbnailUrl: '',
  channelName: 'The Net Ninja',
  summary: 'Server state lesson.',
  translatedNotes: '서버 상태 학습 자료입니다.',
  tags: ['react'],
  comments: [],
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
};
```

Add tests:

```ts
it('prepares source captions, translated captions, summary, and transcript', async () => {
  const updates: Array<Partial<VideoAsset>> = [];
  const repository = fakeRepository(updates);
  const ai = fakeAiProxy({
    captions: [
      {
        mode: 'youtube-captions',
        provider: 'openai-caption-translation',
        videoId: 'novnyCaa7To',
        language: 'ko',
        sourceLanguage: 'en',
        translated: true,
        segments: [{ start: 0, end: 4, text: '리액트 쿼리 소개입니다.' }],
        message: 'translated',
      },
    ],
    summary: {
      mode: 'youtube-summary',
      provider: 'openai-transcript-summary',
      videoId: 'novnyCaa7To',
      language: 'ko',
      sections: [{ label: '핵심 요약', body: '서버 상태를 다룹니다.' }],
      message: 'summary',
    },
  });
  const service = new VideoAssetService(repository, ai);

  await service.preparePostAsset(post);

  expect(updates.some((item) => item.status === 'processing')).toBe(true);
  expect(updates.at(-1)).toMatchObject({
    status: 'ready',
    sourceCaptionStatus: 'ready',
    translationStatus: 'ready',
    summaryStatus: 'ready',
    sourceLanguage: 'en',
    transcriptBody: expect.stringContaining('리액트 쿼리 소개입니다.'),
  });
});

it('marks asset failed when caption retrieval has no segments', async () => {
  const updates: Array<Partial<VideoAsset>> = [];
  const service = new VideoAssetService(
    fakeRepository(updates),
    fakeAiProxy({
      captions: [
        {
          mode: 'youtube-captions',
          provider: 'youtube-caption-rate-limited',
          videoId: 'novnyCaa7To',
          language: 'ko',
          sourceLanguage: 'youtube',
          translated: false,
          segments: [],
          message: 'HTTP 429',
        },
      ],
    }),
  );

  await service.preparePostAsset(post);

  expect(updates.at(-1)).toMatchObject({
    status: 'failed',
    sourceCaptionStatus: 'failed',
    errorMessage: 'HTTP 429',
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm --prefix siwon/api test -- video-asset.service.spec.ts --runInBand
```

Expected: FAIL because `VideoAssetService` does not exist.

- [ ] **Step 3: Implement `VideoAssetService`**

Create service with:

```ts
@Injectable()
export class VideoAssetService {
  private readonly activeJobs = new Set<string>();
  private readonly queue: StudyPost[] = [];
  private running = 0;
  private readonly concurrency = 1;

  constructor(
    private readonly repository: BoardRepository,
    private readonly aiProxyService: AiProxyService,
  ) {}

  enqueuePost(post: StudyPost) {
    if (!this.videoIdFromPost(post)) {
      return;
    }

    this.queue.push(post);
    void this.drainQueue();
  }

  async preparePostAsset(post: StudyPost): Promise<VideoAsset | null> {
    const videoId = this.videoIdFromPost(post);

    if (!videoId) {
      return null;
    }

    const asset = await this.repository.upsertVideoAsset({
      postId: post.id,
      videoId,
      videoUrl: post.videoUrl,
      language: 'ko',
    });

    await this.repository.updateVideoAsset(videoId, {
      status: 'processing',
      sourceCaptionStatus: 'pending',
      translationStatus: 'pending',
      summaryStatus: 'pending',
      errorMessage: '',
    });

    const captions = await this.aiProxyService.captions({
      videoId,
      videoUrl: post.videoUrl,
      targetLanguage: 'ko',
      allowFallback: false,
      translateFallback: false,
      durationSeconds: 14400,
    });
    const captionResponse = normalizeCaptionResponse(captions);

    if (!captionResponse.segments.length) {
      return this.repository.updateVideoAsset(videoId, {
        status: 'failed',
        sourceCaptionStatus: 'failed',
        translationStatus: 'failed',
        summaryStatus: 'failed',
        errorMessage: captionResponse.message || 'Caption preparation failed.',
      });
    }

    const translatedSegments = captionResponse.translated
      ? captionResponse.segments
      : [];
    const sourceSegments = captionResponse.segments;
    const partialTranslation = translatedSegments.length === 0;

    await this.repository.updateVideoAsset(videoId, {
      status: partialTranslation ? 'partial' : 'processing',
      sourceCaptionStatus: 'ready',
      translationStatus: partialTranslation ? 'partial' : 'ready',
      sourceLanguage: captionResponse.sourceLanguage,
      sourceSegments,
      translatedSegments,
      errorMessage: partialTranslation ? captionResponse.message : '',
    });

    const summary = await this.aiProxyService.summary({
      videoId,
      title: post.title,
      channelName: post.channelName,
      language: 'ko',
      summary: post.summary,
      translatedNotes: post.translatedNotes,
      segments: translatedSegments.length ? translatedSegments : sourceSegments,
    });
    const summaryResponse = normalizeSummaryResponse(summary);

    return this.repository.updateVideoAsset(videoId, {
      status: partialTranslation ? 'partial' : 'ready',
      summaryStatus: summaryResponse.sections.length ? 'ready' : 'failed',
      summarySections: summaryResponse.sections,
      transcriptBody: transcriptSectionBody(summaryResponse.sections),
      errorMessage: summaryResponse.sections.length
        ? partialTranslation
          ? captionResponse.message
          : ''
        : summaryResponse.message,
    });
  }
}
```

Add local helpers in the same file:

- `videoIdFromPost(post)` using `/[?&]v=([^&]+)/` and `/youtu\.be\/([^?]+)/`.
- `normalizeCaptionResponse(value)` returning an empty response for invalid shapes.
- `normalizeSummaryResponse(value)` returning empty sections for invalid shapes.
- `transcriptSectionBody(sections)` finds `label === '전체 스크립트 전사문'`.

- [ ] **Step 4: Wire service in `app.module.ts`**

Use a factory so `StudyBoardService` receives `VideoAssetService`:

```ts
providers: [
  AppService,
  DatabaseService,
  AiProxyService,
  VideoAssetService,
  {
    provide: StudyBoardService,
    useFactory: (
      databaseService: DatabaseService,
      videoAssetService: VideoAssetService,
    ) => new StudyBoardService(databaseService, videoAssetService),
    inject: [DatabaseService, VideoAssetService],
  },
]
```

- [ ] **Step 5: Trigger enqueue after post creation**

Change `StudyBoardService` constructor:

```ts
constructor(
  private readonly repository: BoardRepository,
  private readonly videoAssetService?: VideoAssetService,
) {}
```

In `createPost`:

```ts
const post = await this.repository.createPost({
  ...input,
  authorId: session.user.id,
  tags: input.tags ?? [],
});

this.videoAssetService?.enqueuePost(post);

return post;
```

- [ ] **Step 6: Run service tests**

Run:

```bash
npm --prefix siwon/api test -- video-asset.service.spec.ts study-board.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit job service**

```bash
git add siwon/api/src/video-asset.service.ts siwon/api/src/video-asset.service.spec.ts siwon/api/src/app.module.ts siwon/api/src/study-board.service.ts siwon/api/src/study-board.service.spec.ts
git commit -m "feat: prepare video assets after saving"
```

---

### Task 4: Add Video Asset API Endpoints

**Files:**
- Create: `siwon/api/src/video-asset.controller.ts`
- Create: `siwon/api/src/video-asset.controller.spec.ts`
- Modify: `siwon/api/src/app.module.ts`

- [ ] **Step 1: Write controller tests**

Create `video-asset.controller.spec.ts`:

```ts
import { VideoAssetController } from './video-asset.controller';

it('returns prepared asset by video id', async () => {
  const controller = new VideoAssetController({
    getAsset: jest.fn().mockResolvedValue({ videoId: 'abc123', status: 'ready' }),
    prepareByVideoId: jest.fn(),
  } as never);

  await expect(controller.getAsset('abc123')).resolves.toMatchObject({
    videoId: 'abc123',
    status: 'ready',
  });
});

it('starts asset preparation retry by video id', async () => {
  const prepareByVideoId = jest.fn().mockResolvedValue({
    videoId: 'abc123',
    status: 'processing',
  });
  const controller = new VideoAssetController({
    getAsset: jest.fn(),
    prepareByVideoId,
  } as never);

  await controller.prepare('abc123');

  expect(prepareByVideoId).toHaveBeenCalledWith('abc123');
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
npm --prefix siwon/api test -- video-asset.controller.spec.ts --runInBand
```

Expected: FAIL because controller does not exist.

- [ ] **Step 3: Implement controller**

Create:

```ts
import { Controller, Get, Param, Post } from '@nestjs/common';
import { VideoAssetService } from './video-asset.service';

@Controller('video-assets')
export class VideoAssetController {
  constructor(private readonly videoAssetService: VideoAssetService) {}

  @Get(':videoId')
  getAsset(@Param('videoId') videoId: string) {
    return this.videoAssetService.getAsset(videoId);
  }

  @Post(':videoId/prepare')
  prepare(@Param('videoId') videoId: string) {
    return this.videoAssetService.prepareByVideoId(videoId);
  }
}
```

- [ ] **Step 4: Add service methods**

In `VideoAssetService`:

```ts
async getAsset(videoId: string): Promise<VideoAsset> {
  const asset = await this.repository.findVideoAsset(videoId);

  if (!asset) {
    throw new NotFoundException('Video asset not found');
  }

  if (asset.status === 'processing') {
    return { ...asset, status: 'pending' };
  }

  return asset;
}

async prepareByVideoId(videoId: string): Promise<VideoAsset> {
  const asset = await this.getAsset(videoId);
  const post = await this.repository.findPost(asset.postId);

  if (!post) {
    throw new NotFoundException('Post not found for video asset');
  }

  this.enqueuePost(post);
  return { ...asset, status: 'processing' };
}
```

Import `NotFoundException`.

- [ ] **Step 5: Register controller**

Add `VideoAssetController` to `AppModule.controllers`.

- [ ] **Step 6: Run API tests**

Run:

```bash
npm --prefix siwon/api test -- video-asset.controller.spec.ts video-asset.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit endpoints**

```bash
git add siwon/api/src/video-asset.controller.ts siwon/api/src/video-asset.controller.spec.ts siwon/api/src/video-asset.service.ts siwon/api/src/app.module.ts
git commit -m "feat: expose video asset endpoints"
```

---

### Task 5: Add Frontend Asset Fetching And Caption Helpers

**Files:**
- Modify: `siwon/web/src/types.ts`
- Modify: `siwon/web/src/api.ts`
- Modify: `siwon/web/src/captions.ts`
- Test: `siwon/web/tests/captions.test.ts`

- [ ] **Step 1: Write failing caption helper tests**

Add to `siwon/web/tests/captions.test.ts`:

```ts
import {
  captionResponseFromVideoAsset,
  videoAssetCoversTime,
} from '../src/captions.ts';

test('builds translated caption response from a ready video asset', () => {
  const response = captionResponseFromVideoAsset({
    videoId: 'abc123',
    language: 'ko',
    sourceLanguage: 'en',
    status: 'ready',
    translatedSegments: [{ start: 120, end: 124, text: '준비된 자막입니다.' }],
  });

  assert.equal(response?.provider, 'prepared-video-asset');
  assert.equal(response?.translated, true);
  assert.equal(response?.segments[0].text, '준비된 자막입니다.');
});

test('detects whether prepared asset covers the current playback time', () => {
  assert.equal(
    videoAssetCoversTime(
      { translatedSegments: [{ start: 120, end: 124, text: '자막' }] },
      122,
    ),
    true,
  );
  assert.equal(
    videoAssetCoversTime(
      { translatedSegments: [{ start: 120, end: 124, text: '자막' }] },
      300,
    ),
    false,
  );
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node --test siwon/web/tests/captions.test.ts
```

Expected: FAIL because helpers and type are missing.

- [ ] **Step 3: Add web types**

In `siwon/web/src/types.ts`:

```ts
export type VideoAsset = {
  id?: number;
  postId?: number;
  videoId: string;
  videoUrl?: string;
  language: string;
  sourceLanguage: string;
  status: 'pending' | 'processing' | 'ready' | 'partial' | 'failed';
  sourceCaptionStatus?: 'pending' | 'ready' | 'partial' | 'failed';
  translationStatus?: 'pending' | 'ready' | 'partial' | 'failed';
  summaryStatus?: 'pending' | 'ready' | 'partial' | 'failed';
  sourceSegments: CaptionSegment[];
  translatedSegments: CaptionSegment[];
  summarySections: VideoSummarySection[];
  transcriptBody: string;
  errorMessage: string;
  updatedAt?: string;
};
```

- [ ] **Step 4: Add API functions**

In `siwon/web/src/api.ts`:

```ts
export function fetchVideoAsset(videoId: string, token?: string) {
  return requestJson<VideoAsset>(
    `/video-assets/${encodeURIComponent(videoId)}`,
    {},
    token,
  );
}

export function prepareVideoAsset(videoId: string, token?: string) {
  return requestJson<VideoAsset>(
    `/video-assets/${encodeURIComponent(videoId)}/prepare`,
    { method: 'POST' },
    token,
  );
}
```

Import `VideoAsset`.

- [ ] **Step 5: Add caption helpers**

In `siwon/web/src/captions.ts`:

```ts
import type { CaptionResponse, VideoAsset } from './types';

export function captionResponseFromVideoAsset(
  asset: Pick<
    VideoAsset,
    'videoId' | 'language' | 'sourceLanguage' | 'status' | 'translatedSegments'
  >,
): CaptionResponse | null {
  if (
    !['ready', 'partial'].includes(asset.status) ||
    asset.translatedSegments.length === 0
  ) {
    return null;
  }

  return {
    mode: 'youtube-captions',
    provider: 'prepared-video-asset',
    videoId: asset.videoId,
    language: asset.language,
    sourceLanguage: asset.sourceLanguage || 'youtube',
    translated: true,
    segments: asset.translatedSegments,
    message: 'Prepared translated captions loaded.',
  };
}

export function videoAssetCoversTime(
  asset: Pick<VideoAsset, 'translatedSegments'> | null | undefined,
  currentTime: number,
) {
  return Boolean(
    asset?.translatedSegments.some(
      (segment) => currentTime >= segment.start && currentTime < segment.end,
    ),
  );
}
```

- [ ] **Step 6: Run web helper tests**

Run:

```bash
node --test siwon/web/tests/captions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit web helper work**

```bash
git add siwon/web/src/types.ts siwon/web/src/api.ts siwon/web/src/captions.ts siwon/web/tests/captions.test.ts
git commit -m "feat: read prepared video assets in web"
```

---

### Task 6: Integrate Asset-First Watch Flow

**Files:**
- Modify: `siwon/web/src/App.tsx`
- Modify: `siwon/web/src/videoSummaryDetails.ts`
- Test: `siwon/web/tests/watchAccessibility.test.ts`
- Test: `siwon/web/tests/videoSummaryDetails.test.ts`

- [ ] **Step 1: Write static flow tests**

Add to `siwon/web/tests/watchAccessibility.test.ts`:

```ts
test('watch page loads prepared video assets before on-demand caption windows', () => {
  assert.match(appSource, /fetchVideoAsset\(currentVideo!\.videoId/);
  assert.match(appSource, /captionResponseFromVideoAsset\(asset\)/);
  assert.match(appSource, /prepared-video-asset/);
});

test('watch page exposes caption preparation status and retry action', () => {
  assert.match(appSource, /자막 준비 중/);
  assert.match(appSource, /자막 준비 재시도/);
  assert.match(appSource, /prepareVideoAsset\(currentVideo\.videoId/);
});
```

Add to `videoSummaryDetails.test.ts`:

```ts
test('formats prepared asset transcript as summary detail', () => {
  const details = buildVideoSummaryDetailsFromAsset({
    summarySections: [{ label: '핵심 요약', body: '준비된 요약입니다.' }],
    transcriptBody: '00:00 전체 전사문입니다.',
  });

  assert.deepEqual(details, [
    { label: '핵심 요약', body: '준비된 요약입니다.' },
    { label: '전체 스크립트 전사문', body: '00:00 전체 전사문입니다.' },
  ]);
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node --test siwon/web/tests/watchAccessibility.test.ts siwon/web/tests/videoSummaryDetails.test.ts
```

Expected: FAIL because imports, state, and helper do not exist.

- [ ] **Step 3: Add summary asset helper**

In `siwon/web/src/videoSummaryDetails.ts`:

```ts
export function buildVideoSummaryDetailsFromAsset(asset: {
  summarySections?: Array<{ label: string; body: string }>;
  transcriptBody?: string;
}) {
  const details = (asset.summarySections ?? [])
    .map((section) => ({
      label: section.label.trim(),
      body: section.body.trim(),
    }))
    .filter((section) => section.label && section.body);

  const transcriptBody = asset.transcriptBody?.trim();

  if (
    transcriptBody &&
    !details.some((section) => section.label === '전체 스크립트 전사문')
  ) {
    details.push({
      label: '전체 스크립트 전사문',
      body: transcriptBody,
    });
  }

  return details;
}
```

- [ ] **Step 4: Import API and helpers in `App.tsx`**

Add imports:

```ts
import { fetchVideoAsset, prepareVideoAsset } from './api';
import {
  captionResponseFromVideoAsset,
  videoAssetCoversTime,
} from './captions';
import { buildVideoSummaryDetailsFromAsset } from './videoSummaryDetails';
import type { VideoAsset } from './types';
```

- [ ] **Step 5: Add watch state**

Near existing watch state:

```ts
const [videoAsset, setVideoAsset] = useState<VideoAsset | null>(null);
const [assetStatusMessage, setAssetStatusMessage] = useState('');
const [isAssetRetrying, setIsAssetRetrying] = useState(false);
```

- [ ] **Step 6: Load asset before captions**

Add an effect before the current initial caption-loading effect:

```ts
useEffect(() => {
  if (!currentVideo) {
    setVideoAsset(null);
    setAssetStatusMessage('');
    return;
  }

  let cancelled = false;

  async function loadAsset() {
    try {
      const asset = await fetchVideoAsset(currentVideo!.videoId, auth.token);

      if (cancelled) {
        return;
      }

      setVideoAsset(asset);
      const preparedCaptionResponse = captionResponseFromVideoAsset(asset);

      if (preparedCaptionResponse) {
        setTranslatedCaptionResponse(preparedCaptionResponse);
        setCaptionResponse(preparedCaptionResponse);
        setCaptionError('');
      }

      setAssetStatusMessage(
        asset.status === 'ready'
          ? ''
          : asset.status === 'failed'
            ? asset.errorMessage || '자막 준비에 실패했습니다.'
            : '자막 준비 중입니다.',
      );
    } catch {
      if (!cancelled) {
        setVideoAsset(null);
        setAssetStatusMessage('');
      }
    }
  }

  void loadAsset();

  return () => {
    cancelled = true;
  };
}, [auth.token, currentVideo]);
```

- [ ] **Step 7: Skip initial on-demand load when asset has useful captions**

At the top of `loadCaptions()` in the existing initial caption effect, after setting loading state:

```ts
if (videoAssetCoversTime(videoAsset, 0)) {
  setIsCaptionLoading(false);
  return;
}
```

Add `videoAsset` to that effect dependency list.

- [ ] **Step 8: Keep window fallback for uncovered jumps**

In the prefetch-window effect, before creating `captionWindows`, compute:

```ts
if (videoAssetCoversTime(videoAsset, currentTime)) {
  return;
}
```

Add `videoAsset` and `currentTime` to dependencies if not already present.

- [ ] **Step 9: Prefer asset summary details**

Change summary details selection:

```ts
const assetSummaryDetails = videoAsset
  ? buildVideoSummaryDetailsFromAsset(videoAsset)
  : [];
const summaryDetails =
  assetSummaryDetails.length > 0
    ? assetSummaryDetails
    : summaryResponseMatchesVideo
      ? summaryResponse!.sections
      : buildVideoSummaryDetails(currentVideo);
```

- [ ] **Step 10: Add status and retry UI**

Inside the watch summary/caption control area, add:

```tsx
{assetStatusMessage ? (
  <div className="caption-asset-status">
    <span>{assetStatusMessage}</span>
    {videoAsset?.status === 'failed' ? (
      <button
        type="button"
        onClick={async () => {
          if (!currentVideo) {
            return;
          }
          setIsAssetRetrying(true);
          try {
            const asset = await prepareVideoAsset(currentVideo.videoId, auth.token);
            setVideoAsset(asset);
            setAssetStatusMessage('자막 준비 중입니다.');
          } finally {
            setIsAssetRetrying(false);
          }
        }}
        disabled={isAssetRetrying}
      >
        자막 준비 재시도
      </button>
    ) : null}
  </div>
) : null}
```

- [ ] **Step 11: Run web tests**

Run:

```bash
node --test siwon/web/tests/watchAccessibility.test.ts siwon/web/tests/videoSummaryDetails.test.ts siwon/web/tests/captions.test.ts
npm --prefix siwon/web run build
```

Expected: PASS.

- [ ] **Step 12: Commit watch integration**

```bash
git add siwon/web/src/App.tsx siwon/web/src/videoSummaryDetails.ts siwon/web/tests/watchAccessibility.test.ts siwon/web/tests/videoSummaryDetails.test.ts
git commit -m "feat: prefer prepared assets on watch page"
```

---

### Task 7: End-To-End Verification And Deployment

**Files:**
- Modify only if tests reveal a gap.

- [ ] **Step 1: Run backend tests**

```bash
npm --prefix siwon/api test -- --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests and build**

```bash
node --test siwon/web/tests/captions.test.ts siwon/web/tests/videoSummaryDetails.test.ts siwon/web/tests/watchAccessibility.test.ts
npm --prefix siwon/web run build
```

Expected: PASS.

- [ ] **Step 3: Run AI regression tests related to captions and summaries**

```bash
cd siwon/ai
python test_main.py -q -k "caption" -k "summary"
```

Expected: PASS in an environment with AI dependencies installed. If the bundled local Python lacks `httpx` or `openai`, run the same command on EC2 venv:

```bash
cd /home/ubuntu/agentic-board/siwon/ai
./.venv/bin/python test_main.py -q -k "caption" -k "summary"
```

- [ ] **Step 4: Run local app smoke test**

```bash
npm run all
```

Expected:

- API health is OK.
- AI health is OK.
- Web opens.
- Saving a YouTube video returns immediately.
- `GET /video-assets/:videoId` moves from `pending` or `processing` toward `ready` or `partial`.

- [ ] **Step 5: Deploy to EC2**

```bash
ssh -i C:\jungler.pem ubuntu@15.164.98.162 "cd /home/ubuntu/agentic-board/siwon && bash scripts/deploy-ec2.sh sw"
```

Expected: deploy script ends with API health and AI health OK.

- [ ] **Step 6: Verify real video behavior**

Use `novnyCaa7To`:

```bash
curl -sS http://15.164.98.162:3000/video-assets/novnyCaa7To
```

Expected after preparation:

- `status` is `ready` or `partial`.
- `translatedSegments` has entries.
- `transcriptBody` contains timestamped lines.
- Watch page can jump from early section to a later section without waiting for a new OpenAI translation call when the prepared asset covers the target time.

- [ ] **Step 7: Final commit if verification changes files**

```bash
git status --short
git add siwon/api/src siwon/web/src siwon/web/tests
git commit -m "fix: stabilize video asset precompute"
```

Only commit if verification required code or test changes.
