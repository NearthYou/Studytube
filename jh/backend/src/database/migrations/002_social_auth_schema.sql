BEGIN;

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

CREATE INDEX IF NOT EXISTS idx_social_accounts_user_id
  ON social_accounts (user_id);

COMMIT;
