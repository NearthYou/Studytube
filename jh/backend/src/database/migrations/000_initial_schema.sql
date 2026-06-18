BEGIN;

CREATE TABLE IF NOT EXISTS users (
  user_id bigserial PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  nickname varchar(50) NOT NULL UNIQUE,
  created_at timestamp NOT NULL DEFAULT now(),
  profile_image_url text
);

CREATE TABLE IF NOT EXISTS categories (
  category_id bigserial PRIMARY KEY,
  name varchar(50) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  post_id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title varchar(100) NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  views int NOT NULL DEFAULT 0,
  CONSTRAINT posts_views_non_negative CHECK (views >= 0)
);

CREATE TABLE IF NOT EXISTS comments (
  comment_id bigserial PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE IF NOT EXISTS post_categories (
  post_id bigint NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES categories(category_id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);

CREATE TABLE IF NOT EXISTS post_images (
  image_id bigserial PRIMARY KEY,
  post_id bigint REFERENCES posts(post_id) ON DELETE CASCADE,
  user_id bigint REFERENCES users(user_id) ON DELETE CASCADE,
  original_filename varchar(255) NOT NULL,
  stored_filename varchar(255) NOT NULL UNIQUE,
  file_path text NOT NULL UNIQUE,
  file_size bigint NOT NULL,
  mime_type varchar(100) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_likes (
  post_like_id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  post_id bigint NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_post_likes_user_post UNIQUE (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_like_id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  comment_id bigint NOT NULL REFERENCES comments(comment_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_comment_likes_user_comment UNIQUE (user_id, comment_id)
);

CREATE TABLE IF NOT EXISTS email_verifications (
  email varchar(255) PRIMARY KEY,
  code varchar(6) NOT NULL,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  verified_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tags (
  tag_id bigserial PRIMARY KEY,
  name varchar(20) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id bigint NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
  tag_id bigint NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE IF NOT EXISTS social_accounts (
  social_account_id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider varchar(20) NOT NULL,
  provider_user_id varchar(255) NOT NULL,
  email varchar(255),
  profile_image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_social_accounts_provider_user UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_post_categories_category_id ON post_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_post_images_post_id ON post_images(post_id);
CREATE INDEX IF NOT EXISTS idx_post_images_user_id ON post_images(user_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires_at ON email_verifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verifications_verified_expires_at ON email_verifications(verified_expires_at);
CREATE INDEX IF NOT EXISTS idx_social_accounts_user_id ON social_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id);

COMMIT;
