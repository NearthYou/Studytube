BEGIN;

ALTER TABLE post_images
  ADD COLUMN IF NOT EXISTS thumbnail_path text,
  ADD COLUMN IF NOT EXISTS card_path text,
  ADD COLUMN IF NOT EXISTS detail_path text;

COMMIT;
