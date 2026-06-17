# StudyTube Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete AI-assisted YouTube learning board that satisfies the assignment requirements.

**Architecture:** React renders the study board workspace and talks to NestJS REST endpoints. NestJS persists board data in PostgreSQL and proxies AI requests to FastAPI. FastAPI implements RAG, MCP JSON-RPC, and a bounded study-planning agent with deterministic fallbacks.

**Tech Stack:** React, Vite, TypeScript, NestJS, FastAPI, PostgreSQL, pgvector, Prisma schema documentation, OpenAI-compatible optional LLM settings.

---

### Task 1: Backend Board API

**Files:**
- Create: `api/src/database.service.ts`
- Create: `api/src/study-board.service.ts`
- Create: `api/src/study-board.controller.ts`
- Create: `api/src/study-board.service.spec.ts`
- Modify: `api/src/app.module.ts`
- Modify: `api/src/app.controller.ts`
- Modify: `api/src/app.service.ts`
- Modify: `api/prisma/schema.prisma`

- [ ] Write tests for signup/login, post pagination/search, comment creation, playlist feedback, and AI proxy response shaping.
- [ ] Implement PostgreSQL schema initialization with seed data and pgvector support.
- [ ] Implement NestJS services and controllers for auth, posts, comments, tags, playlists, feedback, and AI proxy routes.
- [ ] Run `npm --prefix api run test` and fix failures.

### Task 2: FastAPI AI Service

**Files:**
- Modify: `ai/main.py`
- Modify: `ai/requirements.txt`
- Modify: `ai/.env.example`

- [ ] Implement deterministic embedding, optional commercial embedding calls, and RAG retrieval.
- [ ] Implement `/mcp` JSON-RPC 2.0 with `youtube.lookup`.
- [ ] Implement `/agent/study-plan` with state, tools, max iterations, and exception handling.
- [ ] Run `python -m compileall ai`.

### Task 3: React App Workspace

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/main.tsx`
- Modify: `web/src/index.css`
- Create: `web/src/api.ts`
- Create: `web/src/types.ts`
- Create: `web/src/components/*`

- [ ] Implement board search, pagination, selected post details, editor, comments, tag display, AI tabs, playlist builder, and feedback controls.
- [ ] Add graceful fallback data when the API is unavailable.
- [ ] Run `npm --prefix web run build`.

### Task 4: Submission Package

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `api/.env.example`
- Modify: `web/.env.example`
- Modify: `ai/.env.example`

- [ ] Rewrite README in Korean with project overview, implemented features, architecture, RAG/MCP/Agent details, demo screenshot, retrospective, limitations, and improvement ideas.
- [ ] Start local services if possible and capture at least one screenshot under `docs/demo/`.
- [ ] Run final verification commands and summarize results.

