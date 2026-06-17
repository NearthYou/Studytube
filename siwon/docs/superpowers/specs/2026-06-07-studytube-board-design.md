# StudyTube Board Design

## Goal

StudyTube Board is an AI-assisted learning board for people who study from YouTube videos. Users can save video-based study posts, discuss them in comments, organize them into playlists, leave feedback, and ask AI to summarize, translate, retrieve related posts, and recommend a learning path.

## Scope

The app satisfies the assignment requirements with a React frontend, a NestJS backend, PostgreSQL with pgvector, and a FastAPI AI service.

Core board features:

- Sign up and log in with a simple bearer token session.
- Create, read, update, and delete video study posts.
- Add comments to posts.
- Assign tags to posts.
- Search and paginate posts.
- Create playlists and attach posts to them.
- Leave feedback on playlists.

AI features:

- RAG recommends similar posts and summarizes relevant learning context from saved board data.
- MCP exposes a JSON-RPC server with a YouTube metadata tool that integrates an external service when configured and uses a deterministic demo fallback otherwise.
- Agent runs a bounded reasoning loop, chooses tools, and returns a study playlist recommendation.

## Architecture

```txt
web/ React + Vite
  -> api/ NestJS REST API
     -> PostgreSQL + pgvector
     -> ai/ FastAPI service
        -> optional commercial LLM / embedding provider
        -> MCP JSON-RPC endpoint
        -> optional external YouTube metadata service
```

The NestJS API owns user-facing board data and persistence. The FastAPI service owns AI-specific workflows and can read board data directly for RAG, while NestJS proxies AI requests so the frontend has one main API surface.

## Data Model

The PostgreSQL schema includes users, sessions, posts, tags, post_tags, comments, playlists, playlist_items, playlist_feedback, and post_embeddings. `post_embeddings.embedding` is a pgvector column used for similarity search when pgvector is available.

The app also ships deterministic seed data so the frontend and AI demos work in local development even before the user creates content.

## RAG Feature

Trigger points:

- Post detail page: recommend similar study posts.
- AI panel: answer a board knowledge question.

Flow:

1. Build a retrieval query from the current video title, summary, tags, or user question.
2. FastAPI embeds the query using a commercial embedding model when `OPENAI_API_KEY` is available.
3. If an embedding provider is unavailable, FastAPI uses a deterministic local hash embedding for demo reliability.
4. The service searches `post_embeddings` through pgvector when available.
5. The result is returned with related posts, concise summaries, and source links.

## MCP Feature

The FastAPI service implements a JSON-RPC 2.0 endpoint at `/mcp`.

Supported method:

- `youtube.lookup`: accepts a YouTube URL or search query and returns title, channel, thumbnail, duration label, source URL, and summary.

External integration:

- If a URL is supplied, the MCP tool calls YouTube oEmbed to fetch real metadata.
- If a query is supplied, the MCP tool uses `YOUTUBE_API_KEY` for the official YouTube Data API when available, otherwise it parses public YouTube search metadata.
- If external metadata cannot be fetched, it returns `provider: youtube-search-unavailable` with an empty `videos` list instead of fake video data.

Security:

- External API keys live in `.env`.
- Internal calls from NestJS to FastAPI may include `X-INTERNAL-API-KEY`.
- The README documents key rotation, local memory storage, and external metadata failure behavior.

## Agent Feature

The agent endpoint at `/agent/study-plan` accepts a learning goal, language preference, and optional interests.

Loop:

1. Keep state with goal, selected videos, retrieved board context, tool calls, and iteration count.
2. Choose one of the registered tools: `retrieve_posts`, `search_video`, `create_playlist_draft`.
3. Execute tools and append observations to memory.
4. Stop after a final playlist draft is ready or after a fixed maximum number of iterations.
5. Return recommendations, rationale, suggested tags, and a moderation-safe trace for the demo.

Failure handling:

- Max loop count prevents infinite loops.
- Tool failures are converted into observations.
- The final response includes warnings when a source used fallback data.

## Frontend Design

The first screen is the actual app workspace, not a landing page. It uses a dense study dashboard layout:

- Left area: searchable board list, post editor, and selected post details.
- Right area: AI assistant panel with RAG, MCP, and Agent tabs.
- Bottom/side sections: playlist builder and feedback.

The UI uses YouTube thumbnail imagery as the main visual asset. Colors stay work-focused: white surfaces, ink text, warm red accents, and green/blue AI status accents.

## Verification

Minimum checks:

- `npm --prefix api run test`
- `npm --prefix api run build`
- `npm --prefix web run build`
- `python -m compileall ai`
- Browser screenshot of the running React app for README demo.
