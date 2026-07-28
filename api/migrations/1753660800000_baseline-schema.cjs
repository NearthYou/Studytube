/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createExtension('vector', { ifNotExists: true });

  pgm.sql(`
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

  `);
};

exports.down = () => {
  throw new Error(
    'baseline-schema is irreversible: it may have adopted pre-existing service tables and must never drop them',
  );
};
