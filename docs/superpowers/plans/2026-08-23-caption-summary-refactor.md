# Caption and Summary Module Refactor Implementation Plan

Goal: Move caption parsing, caption providers, translation, transcription, quiz, and summary generation out of `ai/main.py` without changing the HTTP contracts or the caption-only production policy.

Architecture: Pure caption utilities form the bottom layer. Provider adapters and translation depend on those utilities. A caption service coordinates providers, cache, and background translation. Summary and quiz modules consume the caption service through injected callables. `main.py` only wires compatibility exports into the app factory.

Constraints:

- Videos without provider captions remain unsupported. Do not restore paid transcription fallback.
- Keep the `/youtube/transcribe` compatibility route disabled by production configuration.
- Never expose provider errors, credentials, cookies, proxy URLs, or query values.
- Keep production Python files below 900 lines and `main.py` below 250 lines.
- Preserve tests that prove progressive caption timing, translation, summary, and quiz behavior.
- Do not modify `docs/presentation`.

## Task 1: Extract pure caption utilities

Files:

- Create `ai/caption_utils.py`
- Modify `ai/main.py`
- Create `ai/tests/test_caption_utils_boundary.py`

Move timed-text parsers, segment normalization, language checks, fallback formatting helpers, and text cleanup. Re-export compatibility names from `main.py`. Run parser-focused tests and the full AI suite.

## Task 2: Extract transcription compatibility adapter

Files:

- Create `ai/transcription.py`
- Modify `ai/main.py`
- Create `ai/tests/test_transcription_boundary.py`

Move capability validation, bounded audio-window download, adapter invocation, normalization, and safe failure responses. Preserve the default-disabled and credential-redaction tests.

## Task 3: Extract video summary generation

Files:

- Create `ai/video_summary.py`
- Modify `ai/main.py`
- Create `ai/tests/test_video_summary_boundary.py`

Move summary cache, transcript selection, OpenAI response parsing, and deterministic fallback sections. Inject the caption loader so tests and the final composition retain a clear seam.

## Task 4: Extract caption provider adapters

Files:

- Create `ai/youtube_caption_tracks.py`
- Create `ai/ytdlp_captions.py`
- Create `ai/transcript_captions.py`
- Modify `ai/main.py`
- Create provider boundary tests

Split YouTube timed-text discovery, yt-dlp recovery, and transcript API access. Keep environment and subprocess handling inside the owning provider module.

## Task 5: Extract translation and caption orchestration

Files:

- Create `ai/caption_translation.py`
- Create `ai/caption_service.py`
- Modify `ai/main.py`
- Create caption service boundary tests

Move translation batching and budget compaction into the translation module. Move cache, provider ordering, response assembly, and background translation into the caption service. Inject providers and translation callables to avoid circular imports.

## Task 6: Extract quiz generation and compact main

Files:

- Create `ai/quiz_generation.py`
- Modify `ai/main.py`
- Create `ai/tests/test_quiz_generation_boundary.py`

Move caption-grounded quiz generation behind an injected caption loader. Reduce `main.py` to environment setup, compatibility exports, and app-factory wiring.

## Verification

- Run every new boundary test in RED and GREEN states.
- Run `python -m unittest discover -s .` after every extraction.
- Confirm all production Python files are below 900 lines and `main.py` is below 250 lines.
- Run the complete repository test, build, security, and deployment contracts before opening the PR.
