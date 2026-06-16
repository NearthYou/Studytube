BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_documents (
    id BIGSERIAL PRIMARY KEY,
    source_type VARCHAR(20) NOT NULL,
    source_id BIGINT NOT NULL,
    post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
    title TEXT,
    content TEXT NOT NULL,
    region_code VARCHAR(50),
    budget_code VARCHAR(50),
    theme_code VARCHAR(50),
    season VARCHAR(20),
    companion VARCHAR(20),
    travel_date DATE,
    tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (source_type, source_id)
);

CREATE TABLE IF NOT EXISTS rag_chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding VECTOR(1536),
    post_id BIGINT REFERENCES posts(id) ON DELETE CASCADE,
    region_code VARCHAR(50),
    budget_code VARCHAR(50),
    theme_code VARCHAR(50),
    season VARCHAR(20),
    companion VARCHAR(20),
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS rag_sync_jobs (
    id BIGSERIAL PRIMARY KEY,
    source_type VARCHAR(20) NOT NULL,
    source_id BIGINT NOT NULL,
    job_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rag_documents_post_id
ON rag_documents (post_id);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_post_id
ON rag_chunks (post_id);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_filters
ON rag_chunks (region_code, budget_code, theme_code, season, companion);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
ON rag_chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

CREATE TABLE IF NOT EXISTS ai_chat_sessions (
    session_id UUID PRIMARY KEY,
    language VARCHAR(2) NOT NULL DEFAULT 'ko',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_ai_chat_sessions_set_updated_at ON ai_chat_sessions;
CREATE TRIGGER trg_ai_chat_sessions_set_updated_at
BEFORE UPDATE ON ai_chat_sessions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES ai_chat_sessions(session_id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (role IN ('user', 'assistant'))
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_session_id
ON ai_chat_messages (session_id, id DESC);

COMMIT;
