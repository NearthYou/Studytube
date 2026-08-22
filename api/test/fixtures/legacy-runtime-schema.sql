CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  preferences JSONB NOT NULL DEFAULT '{"interests":[],"pace":"","goal":""}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  translated_notes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS video_assets (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playlists (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (playlist_id, post_id)
);

CREATE TABLE IF NOT EXISTS playlist_feedback (
  id SERIAL PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_embeddings (
  post_id INTEGER PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL
  DEFAULT '{"interests":[],"pace":"","goal":""}'::jsonb;

INSERT INTO users (
  id, name, email, password_hash, preferences, created_at
) VALUES
  (
    41,
    'Legacy Owner',
    'legacy-owner@example.test',
    'legacy-owner-hash',
    '{"interests":["databases"],"pace":"steady","goal":"migration adoption"}'::jsonb,
    '2025-07-28T01:00:00Z'
  ),
  (
    42,
    'Legacy Collaborator',
    'legacy-collaborator@example.test',
    'legacy-collaborator-hash',
    '{"interests":["postgresql"],"pace":"fast","goal":"concurrent writes"}'::jsonb,
    '2025-07-28T01:01:00Z'
  );

INSERT INTO sessions (token, user_id, created_at)
VALUES ('legacy-session-token', 41, '2025-07-28T01:02:00Z');

INSERT INTO posts (
  id, author_id, title, video_url, thumbnail_url, channel_name,
  summary, translated_notes, created_at, updated_at
) VALUES (
  51,
  41,
  'Legacy PostgreSQL lesson',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=private-query-must-not-leak',
  'https://image.example.test/legacy-postgresql.jpg',
  'Legacy Database Channel',
  'A row that predates migration ownership.',
  '기존 데이터 보존 검증용 노트 private-note-must-not-leak',
  '2025-07-28T01:03:00Z',
  '2025-07-28T01:04:00Z'
);

INSERT INTO video_assets (
  id, post_id, video_id, video_url, language, source_language, status,
  source_caption_status, translation_status, summary_status,
  source_segments, translated_segments, summary_sections,
  transcript_body, error_message, created_at, updated_at
) VALUES (
  61,
  51,
  'dQw4w9WgXcQ',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=private-query-must-not-leak',
  'ko',
  'en',
  'ready',
  'ready',
  'ready',
  'ready',
  '[{"start":0,"end":4,"text":"legacy source private-caption-must-not-leak"}]'::jsonb,
  '[{"start":0,"end":4,"text":"기존 번역"}]'::jsonb,
  '[{"title":"Adoption","body":"Preserve every row."}]'::jsonb,
  'legacy source transcript',
  '',
  '2025-07-28T01:05:00Z',
  '2025-07-28T01:06:00Z'
);

INSERT INTO tags (id, name)
VALUES (71, 'legacy-adoption');

INSERT INTO post_tags (post_id, tag_id)
VALUES (51, 71);

INSERT INTO comments (id, post_id, author_id, body, created_at)
VALUES (
  81,
  51,
  42,
  'This relationship must survive baseline adoption.',
  '2025-07-28T01:07:00Z'
);

INSERT INTO playlists (id, owner_id, title, description, created_at)
VALUES (
  91,
  41,
  'Legacy migration playlist',
  'Created before migration history existed.',
  '2025-07-28T01:08:00Z'
);

INSERT INTO playlist_items (playlist_id, post_id, position)
VALUES (91, 51, 7);

INSERT INTO playlist_feedback (
  id, playlist_id, author_id, rating, body, created_at
) VALUES (
  101,
  91,
  42,
  5,
  'The fixture keeps foreign keys observable.',
  '2025-07-28T01:09:00Z'
);

INSERT INTO post_embeddings (post_id, content, embedding, updated_at)
VALUES (
  51,
  'legacy embedding content',
  (
    '[' || array_to_string(array_fill('0.125'::text, ARRAY[64]), ',') || ']'
  )::vector(64),
  '2025-07-28T01:10:00Z'
);

SELECT setval('users_id_seq', 410, true);
SELECT setval('posts_id_seq', 510, true);
SELECT setval('video_assets_id_seq', 610, true);
SELECT setval('tags_id_seq', 710, false);
SELECT setval('comments_id_seq', 810, true);
SELECT setval('playlists_id_seq', 910, false);
SELECT setval('playlist_feedback_id_seq', 1010, true);
