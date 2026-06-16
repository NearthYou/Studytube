BEGIN;

ALTER TABLE post_images ALTER COLUMN post_id DROP NOT NULL;
ALTER TABLE post_images ADD COLUMN IF NOT EXISTS user_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = current_schema()
      AND table_name = 'post_images'
      AND constraint_name = 'post_images_user_id_fkey'
  ) THEN
    ALTER TABLE post_images
      ADD CONSTRAINT post_images_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_post_id_fkey;
ALTER TABLE comments
  ADD CONSTRAINT comments_post_id_fkey
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE;

INSERT INTO categories (name)
VALUES ('일상'), ('산책'), ('돌봄'), ('질문')
ON CONFLICT (name) DO NOTHING;

COMMIT;
