# Python Core Module Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move embeddings, study generation, YouTube lookup, and FastAPI composition out of `ai/main.py` while preserving all HTTP and import compatibility contracts.

**Architecture:** Each feature module owns its provider client, cache, validation, and response assembly. `main.py` re-exports public compatibility names but does not own feature implementation; `app_factory.py` owns FastAPI and MCP HTTP composition.

**Tech Stack:** Python 3.14, FastAPI, OpenAI SDK, httpx, psycopg, unittest

**Spec:** `docs/superpowers/specs/2026-08-23-large-module-refactor-design.md`

## Global Constraints

- Preserve every existing HTTP path and response shape.
- Preserve safe error codes and never return raw provider errors, credentials, or URL query values.
- Feature modules must not import `main`.
- Production Python files must remain below 900 lines.
- Compatibility exports in `main` are for callers only; tests patch the owning module.
- Do not modify `docs/presentation`.

---

### Task 1: Extract embeddings

**Files:**
- Create: `ai/embeddings.py`
- Modify: `ai/main.py`
- Modify: `ai/test_main.py`
- Test: `ai/tests/test_embeddings_boundary.py`

**Interfaces:**
- Produces: `create_embedding_response(payload)`, `EmbeddingProviderUnavailable`, cache constants, and cache helpers.
- Consumes: only environment variables and the OpenAI SDK.

- [ ] Write a failing test asserting `embeddings.py` owns `create_embedding_response` and `main.py` only imports it.
- [ ] Run `python -m unittest tests.test_embeddings_boundary` and confirm RED.
- [ ] Move embedding validation, pricing metadata, cache, and provider call without changing values.
- [ ] Change embedding tests from `main.OpenAI` and `main.EMBEDDING_RESPONSE_CACHE` to `embeddings.OpenAI` and `embeddings.EMBEDDING_RESPONSE_CACHE`.
- [ ] Run focused embedding tests and full `test_main`.
- [ ] Commit with `refactor(ai): 임베딩 모듈 분리`.

### Task 2: Extract study-plan and quiz generation

**Files:**
- Create: `ai/study_generation.py`
- Modify: `ai/main.py`
- Modify: `ai/test_main.py`
- Test: `ai/tests/test_study_generation_boundary.py`

**Interfaces:**
- Produces: `build_study_plan(payload)`, `build_quiz_response(payload)`, `choose_agent_tool`, playlist recommendation helpers, and `AGENT_TOOLS`.
- Consumes: a callable YouTube lookup seam supplied by `build_study_plan` instead of importing `main`.

- [ ] Write the boundary RED test.
- [ ] Move deterministic generation helpers and OpenAI tool selection.
- [ ] Keep `main.build_study_plan` and `main.build_quiz_response` as direct imports.
- [ ] Patch `study_generation.OpenAI` and lookup seams in tests.
- [ ] Run focused and full AI tests.
- [ ] Commit with `refactor(ai): 학습 생성 모듈 분리`.

### Task 3: Extract YouTube lookup

**Files:**
- Create: `ai/youtube_search.py`
- Modify: `ai/main.py`
- Modify: `ai/test_main.py`
- Test: `ai/tests/test_youtube_search_boundary.py`

**Interfaces:**
- Produces: `lookup_youtube(params)` plus oEmbed, Data API, page fallback, metadata normalization, and text extraction helpers.
- Consumes: httpx and environment variables only.

- [ ] Write the boundary RED test.
- [ ] Move lookup and search helpers with one local `extract_video_hint` implementation.
- [ ] Update tests to patch `youtube_search.httpx`.
- [ ] Run lookup, MCP bridge, and full AI tests.
- [ ] Commit with `refactor(ai): YouTube 검색 모듈 분리`.

### Task 4: Extract FastAPI composition

**Files:**
- Create: `ai/app_factory.py`
- Modify: `ai/main.py`
- Modify: `ai/test_main.py`
- Test: `ai/tests/test_app_boundary.py`

**Interfaces:**
- Produces: `create_application()` returning `app`, `mcp_server`, `mcp_application`, and telemetry runtime handles.
- Consumes: feature callables imported from their owning modules and later caption and summary modules.

- [ ] Write a RED test asserting route ownership and `uvicorn main:app` compatibility.
- [ ] Move lifespan, middleware, health, DB health, route registration, and MCP mounting.
- [ ] Keep `main.app`, `main.mcp_server`, and route functions as compatibility exports.
- [ ] Run app, MCP, runtime environment, and full AI tests.
- [ ] Commit with `refactor(ai): FastAPI 조립 경계 분리`.

## Self-review result

- The plan covers Python core only; captions, summaries, transcription, MCP gateway internals, and test-file splitting remain separate follow-up plans.
- Public names and patch locations are explicit and consistent.
- Each task has a focused RED/GREEN gate and a full AI regression gate.
