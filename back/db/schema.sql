BEGIN;

DO $$
BEGIN
    CREATE TYPE season_enum AS ENUM (
        U&'\BD04',
        U&'\C5EC\B984',
        U&'\AC00\C744',
        U&'\ACA8\C6B8'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE companion_enum AS ENUM (
        U&'\D63C\C790',
        U&'\CE5C\AD6C',
        U&'\C5F0\C778',
        U&'\AC00\C871'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    login_id VARCHAR(50) NOT NULL,
    password_hash TEXT NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    bio TEXT,
    location VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_login_id_ci ON users (LOWER(login_id));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci ON users (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_nickname_ci ON users (LOWER(nickname));

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS regions (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS themes (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS budget_ranges (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL UNIQUE,
    min_amount INTEGER,
    max_amount INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CHECK (
        min_amount IS NULL
        OR max_amount IS NULL
        OR min_amount <= max_amount
    )
);

CREATE TABLE IF NOT EXISTS posts (
    id BIGSERIAL PRIMARY KEY,
    author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    title VARCHAR(200) NOT NULL,
    summary VARCHAR(300),
    content TEXT,
    image_url TEXT,
    region_id BIGINT NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
    budget_range_id BIGINT NOT NULL REFERENCES budget_ranges(id) ON DELETE RESTRICT,
    theme_id BIGINT NOT NULL REFERENCES themes(id) ON DELETE RESTRICT,
    season season_enum NOT NULL,
    companion companion_enum NOT NULL,
    travel_date DATE NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
    comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at_desc
ON posts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_view_count_desc
ON posts (view_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_comment_count_desc
ON posts (comment_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_author_created_at_desc
ON posts (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_region_id
ON posts (region_id);

CREATE INDEX IF NOT EXISTS idx_posts_budget_range_id
ON posts (budget_range_id);

CREATE INDEX IF NOT EXISTS idx_posts_theme_id
ON posts (theme_id);

CREATE INDEX IF NOT EXISTS idx_posts_season
ON posts (season);

CREATE INDEX IF NOT EXISTS idx_posts_companion
ON posts (companion);

CREATE INDEX IF NOT EXISTS idx_posts_filter_combo
ON posts (region_id, budget_range_id, theme_id, season, companion);

CREATE INDEX IF NOT EXISTS idx_posts_search_text
ON posts
USING GIN (
    to_tsvector(
        'simple',
        COALESCE(title, '') || ' ' ||
        COALESCE(summary, '') || ' ' ||
        COALESCE(content, '')
    )
);

DROP TRIGGER IF EXISTS trg_posts_set_updated_at ON posts;
CREATE TRIGGER trg_posts_set_updated_at
BEFORE UPDATE ON posts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS comments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    content TEXT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post_created_at_desc
ON comments (post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comments_author_created_at_desc
ON comments (author_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_comments_set_updated_at ON comments;
CREATE TRIGGER trg_comments_set_updated_at
BEFORE UPDATE ON comments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS comment_replies (
    id BIGSERIAL PRIMARY KEY,
    comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    author_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    content TEXT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comment_replies_comment_created_at_asc
ON comment_replies (comment_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_comment_replies_author_created_at_desc
ON comment_replies (author_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_comment_replies_set_updated_at ON comment_replies;
CREATE TRIGGER trg_comment_replies_set_updated_at
BEFORE UPDATE ON comment_replies
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS post_bookmarks (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_post_bookmarks_user_created_at_desc
ON post_bookmarks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_follows (
    follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_following_id
ON user_follows (following_id);

CREATE OR REPLACE FUNCTION recalc_post_comment_count(p_post_id BIGINT)
RETURNS VOID AS $$
BEGIN
    UPDATE posts
    SET comment_count = (
        SELECT COUNT(*)
        FROM (
            SELECT c.id
            FROM comments c
            WHERE c.post_id = p_post_id
              AND c.is_deleted = FALSE

            UNION ALL

            SELECT r.id
            FROM comments c
            JOIN comment_replies r
              ON r.comment_id = c.id
            WHERE c.post_id = p_post_id
              AND c.is_deleted = FALSE
              AND r.is_deleted = FALSE
        ) x
    )
    WHERE id = p_post_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_comments_recalc_post_comment_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM recalc_post_comment_count(NEW.post_id);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM recalc_post_comment_count(OLD.post_id);
        RETURN OLD;
    ELSE
        IF NEW.post_id <> OLD.post_id THEN
            PERFORM recalc_post_comment_count(OLD.post_id);
            PERFORM recalc_post_comment_count(NEW.post_id);
        ELSE
            PERFORM recalc_post_comment_count(NEW.post_id);
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comments_recalc_post_comment_count_aiud ON comments;
CREATE TRIGGER trg_comments_recalc_post_comment_count_aiud
AFTER INSERT OR UPDATE OR DELETE ON comments
FOR EACH ROW
EXECUTE FUNCTION trg_comments_recalc_post_comment_count();

CREATE OR REPLACE FUNCTION trg_comment_replies_recalc_post_comment_count()
RETURNS TRIGGER AS $$
DECLARE
    v_post_id BIGINT;
    v_old_post_id BIGINT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT post_id INTO v_post_id
        FROM comments
        WHERE id = NEW.comment_id;

        PERFORM recalc_post_comment_count(v_post_id);
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        SELECT post_id INTO v_old_post_id
        FROM comments
        WHERE id = OLD.comment_id;

        PERFORM recalc_post_comment_count(v_old_post_id);
        RETURN OLD;

    ELSE
        SELECT post_id INTO v_post_id
        FROM comments
        WHERE id = NEW.comment_id;

        SELECT post_id INTO v_old_post_id
        FROM comments
        WHERE id = OLD.comment_id;

        IF v_post_id IS NOT NULL THEN
            PERFORM recalc_post_comment_count(v_post_id);
        END IF;

        IF v_old_post_id IS NOT NULL AND v_old_post_id <> v_post_id THEN
            PERFORM recalc_post_comment_count(v_old_post_id);
        END IF;

        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comment_replies_recalc_post_comment_count_aiud ON comment_replies;
CREATE TRIGGER trg_comment_replies_recalc_post_comment_count_aiud
AFTER INSERT OR UPDATE OR DELETE ON comment_replies
FOR EACH ROW
EXECUTE FUNCTION trg_comment_replies_recalc_post_comment_count();

INSERT INTO regions (code, name, sort_order, is_active) VALUES
('gangneung', U&'\AC15\B989', 1, TRUE),
('jeju', U&'\C81C\C8FC', 2, TRUE),
('busan', U&'\BD80\C0B0', 3, TRUE),
('jeonju', U&'\C804\C8FC', 4, TRUE),
('yeosu', U&'\C5EC\C218', 5, TRUE),
('sokcho', U&'\C18D\CD08', 6, TRUE),
('namhae', U&'\B0A8\D574', 7, TRUE),
('chuncheon', U&'\CD98\CC9C', 8, TRUE),
('pohang', U&'\D3EC\D56D', 9, TRUE),
('gyeongju', U&'\ACBD\C8FC', 10, TRUE),
('tongyeong', U&'\D1B5\C601', 11, TRUE),
('gapyeong', U&'\AC00\D3C9', 12, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO themes (code, name, sort_order, is_active) VALUES
('healing', U&'\D790\B9C1', 1, TRUE),
('family', U&'\AC00\C871', 2, TRUE),
('couple', U&'\CEE4\D50C', 3, TRUE),
('solo_trip', U&'\D63C\D589', 4, TRUE),
('gourmet', U&'\BBF8\C2DD', 5, TRUE),
('drive', U&'\B4DC\B77C\C774\BE0C', 6, TRUE),
('date', U&'\B370\C774\D2B8', 7, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO budget_ranges (code, label, min_amount, max_amount, sort_order, is_active) VALUES
('under_100k', U&'\0031\0030\B9CC\C6D0\0020\C774\D558', 0, 100000, 1, TRUE),
('from_100k_to_200k', U&'\0031\0030\002D\0032\0030\B9CC\C6D0', 100001, 200000, 2, TRUE),
('from_200k_to_300k', U&'\0032\0030\002D\0033\0030\B9CC\C6D0', 200001, 300000, 3, TRUE),
('over_300k', U&'\0033\0030\B9CC\C6D0\0020\C774\C0C1', 300001, NULL, 4, TRUE)
ON CONFLICT (code) DO NOTHING;

COMMIT;
