# Video Asset Precompute Design

## Problem

Live caption translation currently depends on 60-second on-demand windows. When a learner jumps to a distant section, the app has to fetch source captions and translate that new window before the overlay can show Korean subtitles. The summary panel has the same weakness: it may request transcript or summary data only when the watch page needs it, so long transcripts can appear incomplete while generation is still catching up.

The product should behave as if saved videos already have learning assets attached: translated captions, full transcript, and Korean summary should load from prepared data whenever possible.

## Goals

- Start caption, transcript, and summary preparation as soon as a video is saved.
- Store source caption segments and Korean translated segments so watch-page jumps do not wait for fresh generation.
- Store the full transcript as long timestamp intervals instead of selected excerpts.
- Keep the watch page responsive while preparation is still running.
- Make failures visible as asset status instead of silently falling back to native YouTube captions.
- Keep the first implementation small enough for the current Nest/FastAPI/PostgreSQL stack.

## Non-Goals

- Do not add Redis, BullMQ, SQS, or a separate worker service in the first implementation.
- Do not block post creation until all AI assets are finished.
- Do not translate an entire long video in one OpenAI call.
- Do not remove the existing on-demand caption endpoints; they remain fallback paths.

## Recommended Approach

Use a server-side video asset precompute pipeline.

When `POST /posts` succeeds, Nest creates or updates a video asset record and enqueues a lightweight in-process job. The job calls the existing AI service to retrieve source captions, translate captions in bounded chunks, and generate Korean summary sections plus a full timestamped transcript. The watch page first asks for the prepared asset. If the asset is ready, it uses stored translated segments immediately. If the asset is pending or partially failed, the watch page shows preparation status and may fall back to current on-demand caption windows.

This approach fixes the jump problem at the right layer: playback reads prepared data instead of generating data in the critical path.

## Data Model

Add a video asset record scoped to a saved post. `videoId` remains stored for
YouTube requests and display, but repository lookups and public APIs must use
`postId` so duplicate saved posts for the same YouTube video do not cross user
ownership boundaries.

Fields:

- `id`
- `postId`
- `videoId`
- `videoUrl`
- `language`
- `sourceLanguage`
- `status`: `pending`, `processing`, `ready`, `partial`, `failed`
- `sourceCaptionStatus`: `pending`, `ready`, `failed`
- `translationStatus`: `pending`, `ready`, `partial`, `failed`
- `summaryStatus`: `pending`, `ready`, `failed`
- `sourceSegmentsJson`
- `translatedSegmentsJson`
- `summarySectionsJson`
- `transcriptBody`
- `errorMessage`
- `createdAt`
- `updatedAt`

For PostgreSQL this should be a new `video_assets` table with JSONB columns for segment arrays and summary sections. For file-backed fallback, add a matching `videoAssets` array to the persisted memory state.

## API Design

Nest API:

- `GET /posts/:postId/video-asset`
  - Returns prepared asset data and status.
  - Requires the caller to own the post.
  - Used by the watch page before requesting on-demand captions when the
    current queue item maps to a saved post.

- `POST /posts/:postId/video-asset/prepare`
  - Starts or retries asset preparation for a saved post.
  - Requires the caller to own the post.
  - Used after post creation, and by a retry button when preparation fails.

FastAPI AI service:

- Reuse `/youtube/captions` for source and translated caption retrieval.
- Reuse `/youtube/summary` for Korean summary and transcript generation.
- Prefer adding a later `/youtube/assets/prepare` only if the Nest orchestrator becomes too thin or repetitive.

## Job Flow

1. User saves a post.
2. `StudyBoardService.createPost` persists the post immediately.
3. Nest enqueues `prepareVideoAsset(post)`.
4. Job creates or marks the asset as `processing`.
5. Job calls AI captions with no narrow playback window to obtain a broad source caption set.
6. Job stores source segments.
7. Job translates captions in bounded windows or batches and merges results by timestamp.
8. Job stores translated segments.
9. Job calls AI summary using the stored translated or source segments.
10. Job stores Korean summary sections and full transcript body.
11. Job marks the asset `ready`, `partial`, or `failed`.

The first version can run jobs in the Nest process with a simple concurrency limit of one or two jobs. This is enough for the local and EC2 deployment. A durable external queue can be added later without changing the API shape.

## Watch Page Flow

1. On video load, resolve the current queue item to a saved post and call
   `GET /posts/:postId/video-asset`.
2. If `status` is `ready` or `partial` and translated segments exist, seed `translatedCaptionResponse` from the asset.
3. Use stored summary sections and transcript body in the summary panel.
4. If the current playback position has no prepared translated segment, fall back to `/ai/youtube/captions` for that window.
5. If the asset is `pending` or `processing`, show a small caption preparation state and poll asset status.
6. If the asset is `failed`, show the failure reason and a retry action.
7. If the current video is not backed by a saved post yet, keep the existing
   on-demand caption and summary flow.

## Error Handling

- YouTube 429 or bot challenge:
  - Store `sourceCaptionStatus = failed`.
  - Preserve the sanitized error message.
  - Do not cache this as a successful empty asset.

- OpenAI translation failure:
  - Store source segments and mark asset `partial`.
  - Watch page can still show source-derived status and retry translation.

- Summary failure:
  - Keep translated captions usable.
  - Store `summaryStatus = failed`.
  - Allow summary retry without re-downloading captions.

- App restart:
  - Any asset left in `processing` should be treated as retryable `pending` or `partial` on next request.

## Testing Strategy

Backend tests:

- Creating a post enqueues asset preparation without blocking post creation.
- Asset preparation stores source segments, translated segments, summary sections, and transcript body.
- Failed source caption retrieval marks the asset failed with a sanitized message.
- Partial translation keeps source segments and marks asset partial.
- `GET /posts/:postId/video-asset` returns a stable shape for pending, ready, partial, and failed assets, and rejects access to posts not owned by the caller.

Frontend tests:

- Watch page prefers ready asset translated segments over on-demand caption requests.
- Watch page falls back to on-demand window translation for missing prepared ranges.
- Summary panel renders stored full transcript from the asset.
- Pending and failed asset statuses render clear Korean UI states.

## Rollout

1. Add data types, database schema, and memory fallback support.
2. Add Nest asset service and API endpoints.
3. Trigger preparation after post creation.
4. Update watch page to read assets first.
5. Keep existing on-demand caption and summary paths as fallback.
6. Deploy and verify with an English video that prepared translated captions remain visible after jumping between distant sections.

## Implementation Decisions

- Use 60-second translation batches first, matching the current watch window size.
- Store the full transcript as 60-second timestamp intervals, matching current summary transcript formatting.
- Keep a one-process in-memory queue for the first version.
