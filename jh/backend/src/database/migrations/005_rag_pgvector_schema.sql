BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_documents (
  id bigserial PRIMARY KEY,
  source_title text NOT NULL,
  species varchar(20),
  year int,
  pmid varchar(32),
  pmcid varchar(32),
  doi text,
  url text,
  source_type varchar(50) NOT NULL DEFAULT 'sourcebook',
  priority numeric(4, 2) NOT NULL DEFAULT 0.70,
  license_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rag_documents_source_year UNIQUE (source_title, year)
);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  chunk_id varchar(160) NOT NULL UNIQUE,
  species varchar(20) NOT NULL,
  topic varchar(120) NOT NULL,
  subtopic varchar(120),
  safety_level varchar(30) NOT NULL,
  chunk_text text NOT NULL,
  embedding vector(3072),
  token_count int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rag_chunks_document_index UNIQUE (document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS rag_queries (
  id bigserial PRIMARY KEY,
  user_id bigint REFERENCES users(user_id) ON DELETE SET NULL,
  question text NOT NULL,
  species varchar(20),
  primary_topic varchar(120),
  risk_level varchar(30) NOT NULL,
  query_terms text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rag_answers (
  id bigserial PRIMARY KEY,
  query_id bigint REFERENCES rag_queries(id) ON DELETE SET NULL,
  user_id bigint REFERENCES users(user_id) ON DELETE SET NULL,
  question text NOT NULL,
  risk_level varchar(30) NOT NULL,
  retrieved_chunk_ids text[],
  answer text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rag_citations (
  id bigserial PRIMARY KEY,
  answer_id bigint REFERENCES rag_answers(id) ON DELETE CASCADE,
  document_id bigint REFERENCES rag_documents(id) ON DELETE SET NULL,
  chunk_id bigint REFERENCES rag_chunks(id) ON DELETE SET NULL,
  citation_order int NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rag_safety_events (
  id bigserial PRIMARY KEY,
  query_id bigint REFERENCES rag_queries(id) ON DELETE SET NULL,
  risk_level varchar(30) NOT NULL,
  triggered_rules text[],
  blocked_patterns text[],
  action varchar(50) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rag_feedback (
  id bigserial PRIMARY KEY,
  answer_id bigint REFERENCES rag_answers(id) ON DELETE CASCADE,
  rating int,
  safety_issue boolean NOT NULL DEFAULT false,
  usefulness varchar(30),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_topic_safety
  ON rag_chunks (topic, safety_level);

CREATE INDEX IF NOT EXISTS idx_rag_documents_source_type_priority
  ON rag_documents (source_type, priority);

CREATE INDEX IF NOT EXISTS idx_rag_queries_user_created_at
  ON rag_queries (user_id, created_at DESC);

COMMIT;
