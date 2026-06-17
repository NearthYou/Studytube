BEGIN;

CREATE TABLE IF NOT EXISTS tags (
  tag_id bigserial PRIMARY KEY,
  name varchar(20) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tags_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id bigint NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  tag_id bigint NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id
  ON post_tags (tag_id);

CREATE INDEX IF NOT EXISTS idx_tags_name
  ON tags (name);

COMMIT;
