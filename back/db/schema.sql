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

INSERT INTO users (login_id, password_hash, name, email, nickname, bio, location)
SELECT *
FROM (
    VALUES
    ('traveler01', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Minji Park', 'traveler01@example.com', 'sea_minji', 'Weekend sea route collector.', 'Seoul'),
    ('traveler02', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Jisoo Kim', 'traveler02@example.com', 'cafe_jisoo', 'Cafe and photo spot enthusiast.', 'Seoul'),
    ('traveler03', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Hyunwoo Lee', 'traveler03@example.com', 'drive_hyun', 'Drive course note taker.', 'Suwon'),
    ('traveler04', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Soyeon Choi', 'traveler04@example.com', 'soft_trip', 'Quiet town and slow trip fan.', 'Incheon'),
    ('traveler05', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Doyoon Jung', 'traveler05@example.com', 'solo_doyoon', 'Solo trip planner.', 'Daejeon'),
    ('traveler06', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Yujin Han', 'traveler06@example.com', 'healing_yujin', 'Healing staycation and spa notes.', 'Seongnam'),
    ('traveler07', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Seungmin Oh', 'traveler07@example.com', 'budget_seung', 'Low budget route hunter.', 'Busan'),
    ('traveler08', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Ara Kang', 'traveler08@example.com', 'ara_foodie', 'Food and market focused traveler.', 'Daegu'),
    ('traveler09', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Joon Seo', 'traveler09@example.com', 'stay_joon', 'Hotel and ocean view collector.', 'Ulsan'),
    ('traveler10', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Hana Lim', 'traveler10@example.com', 'hana_date', 'Date course editor.', 'Seoul'),
    ('traveler11', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Taehyun Moon', 'traveler11@example.com', 'moon_trip', 'Mountain and lake route fan.', 'Chuncheon'),
    ('traveler12', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', 'Nari Yoo', 'traveler12@example.com', 'nari_fam', 'Family trip checklist maker.', 'Gwangju')
) AS seed(login_id, password_hash, name, email, nickname, bio, location)
WHERE NOT EXISTS (
    SELECT 1
    FROM users u
    WHERE LOWER(u.login_id) = LOWER(seed.login_id)
);

INSERT INTO posts (
    author_id, title, summary, content, image_url, region_id, budget_range_id, theme_id,
    season, companion, travel_date, tags, view_count, created_at, updated_at
)
SELECT
    u.id,
    seed.title,
    seed.summary,
    seed.content,
    seed.image_url,
    r.id,
    b.id,
    t.id,
    seed.season::season_enum,
    seed.companion::companion_enum,
    seed.travel_date::date,
    seed.tags,
    seed.view_count,
    seed.created_at::timestamptz,
    seed.updated_at::timestamptz
FROM (
    VALUES
    ('traveler01','Gangneung sunrise cafe route','Easy ocean cafe route for a short weekend.','Started with a sunrise walk, moved to a quiet bakery, then stayed near the beach for sunset photos.','https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80','gangneung','from_100k_to_200k','healing',U&'\C5EC\B984',U&'\CE5C\AD6C','2026-07-12',ARRAY['#gangneung','#cafe','#sea'],1420,'2026-06-01T09:00:00+09','2026-06-01T09:00:00+09'),
    ('traveler02','Jeju family drive plan','Relaxed west Jeju drive for parents and kids.','The route keeps the drive short and mixes beach, museum, and meal stops for a low stress family day.','https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80','jeju','over_300k','family',U&'\BD04',U&'\AC00\C871','2026-05-20',ARRAY['#jeju','#family','#drive'],2180,'2026-06-01T11:00:00+09','2026-06-01T11:00:00+09'),
    ('traveler03','Busan one night date course','Simple one night date plan around Gwanganri.','Walked the beach road, had dinner with bridge view, and stayed in a hotel close to the sea.','https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80','busan','from_200k_to_300k','date',U&'\AC00\C744',U&'\C5F0\C778','2026-09-18',ARRAY['#busan','#date','#gwanganri'],1890,'2026-06-02T10:30:00+09','2026-06-02T10:30:00+09'),
    ('traveler04','Jeonju slow solo alley walk','Quiet alley and bookshop route in Jeonju.','Skipped packed tourist places and moved around old alleys, local bookshops, and tea houses.','https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80','jeonju','under_100k','solo_trip',U&'\AC00\C744',U&'\D63C\C790','2026-10-03',ARRAY['#jeonju','#solo','#alley'],960,'2026-06-03T08:10:00+09','2026-06-03T08:10:00+09'),
    ('traveler05','Yeosu night sea and food route','Food focused one night route in Yeosu.','You can keep moving distance short and spend most of the budget on dinner, snacks, and night view cafes.','https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80','yeosu','from_100k_to_200k','gourmet',U&'\BD04',U&'\CE5C\AD6C','2026-04-29',ARRAY['#yeosu','#food','#nightview'],1540,'2026-06-03T18:20:00+09','2026-06-03T18:20:00+09'),
    ('traveler06','Sokcho winter sea stay','Compact winter sea stay with warm food stops.','This route keeps you indoors often and makes the sea view the main point instead of moving too much.','https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=900&q=80','sokcho','from_100k_to_200k','healing',U&'\ACA8\C6B8',U&'\D63C\C790','2026-01-14',ARRAY['#sokcho','#winter','#stay'],1110,'2026-06-04T09:45:00+09','2026-06-04T09:45:00+09'),
    ('traveler07','Namhae pension family weekend','Pension centered family weekend in Namhae.','Instead of many attractions, the stay itself was the key and the route stayed very simple around the pension.','https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80','namhae','over_300k','family',U&'\C5EC\B984',U&'\AC00\C871','2026-08-08',ARRAY['#namhae','#pension','#family'],1320,'2026-06-04T12:00:00+09','2026-06-04T12:00:00+09'),
    ('traveler08','Chuncheon lake brunch course','Brunch and lake walk date route in Chuncheon.','The plan was built for photos, light walking, and easy cafe hopping near the lake.','https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80','chuncheon','under_100k','date',U&'\BD04',U&'\C5F0\C778','2026-05-02',ARRAY['#chuncheon','#lake','#brunch'],880,'2026-06-05T10:00:00+09','2026-06-05T10:00:00+09'),
    ('traveler09','Pohang market and ocean morning','Sea market route for an early trip.','Went to the market first, had breakfast, and then moved to a quiet ocean road before noon.','https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80','pohang','under_100k','gourmet',U&'\C5EC\B984',U&'\CE5C\AD6C','2026-07-01',ARRAY['#pohang','#market','#ocean'],730,'2026-06-05T14:00:00+09','2026-06-05T14:00:00+09'),
    ('traveler10','Gyeongju calm history walk','Half day route mixing history and quiet cafes.','I kept the route short enough to avoid heat and added one museum and two calm rest stops.','https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=80','gyeongju','from_100k_to_200k','healing',U&'\BD04',U&'\C5F0\C778','2026-04-12',ARRAY['#gyeongju','#history','#walk'],1670,'2026-06-06T09:15:00+09','2026-06-06T09:15:00+09'),
    ('traveler11','Tongyeong cable car and harbor','Classic Tongyeong harbor route with viewpoint.','Good for first time visitors who want one clear scenic point and a harbor dinner after sunset.','https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80','tongyeong','from_200k_to_300k','couple',U&'\AC00\C744',U&'\C5F0\C778','2026-10-22',ARRAY['#tongyeong','#harbor','#view'],1440,'2026-06-06T13:40:00+09','2026-06-06T13:40:00+09'),
    ('traveler12','Gapyeong budget friend camp','Cheap friend trip with pension and barbecue.','The route skips expensive attractions and focuses on a simple pension night with river walk and barbecue.','https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80','gapyeong','from_100k_to_200k','drive',U&'\C5EC\B984',U&'\CE5C\AD6C','2026-08-15',ARRAY['#gapyeong','#budget','#camp'],1250,'2026-06-07T08:50:00+09','2026-06-07T08:50:00+09'),
    ('traveler01','Gangneung hotel and bakery list','One night hotel stay and bakery hopping.','This route is for people who want a comfortable room first and then move between three calm bakeries.','https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80','gangneung','from_200k_to_300k','couple',U&'\BD04',U&'\C5F0\C778','2026-04-26',ARRAY['#gangneung','#hotel','#bakery'],1360,'2026-06-07T10:10:00+09','2026-06-07T10:10:00+09'),
    ('traveler02','Jeju east coast cafe run','East coast cafes and a short coast drive.','The route is designed for half day movement with many photo stops and one sunset point.','https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80','jeju','from_200k_to_300k','drive',U&'\C5EC\B984',U&'\CE5C\AD6C','2026-07-19',ARRAY['#jeju','#eastcoast','#cafe'],1740,'2026-06-07T15:30:00+09','2026-06-07T15:30:00+09'),
    ('traveler03','Busan rainy day indoor route','Indoor route for a wet weekend in Busan.','Good when the weather is not reliable because museums, cafe stops, and dinner are close together.','https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=900&q=80','busan','from_100k_to_200k','healing',U&'\C5EC\B984',U&'\CE5C\AD6C','2026-07-06',ARRAY['#busan','#rainyday','#indoor'],910,'2026-06-08T09:00:00+09','2026-06-08T09:00:00+09'),
    ('traveler04','Jeonju hanok morning course','Morning hanok route before the crowd arrives.','I recommend starting early, taking photos before lunch, and moving to a quiet dessert cafe.','https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80','jeonju','under_100k','date',U&'\BD04',U&'\CE5C\AD6C','2026-04-07',ARRAY['#jeonju','#hanok','#morning'],840,'2026-06-08T11:45:00+09','2026-06-08T11:45:00+09'),
    ('traveler05','Yeosu ocean view brunch stay','Brunch stay with ocean view hotel and short walking.','This is ideal for people who care more about rest and view than tourist checklist spots.','https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80','yeosu','over_300k','healing',U&'\C5EC\B984',U&'\C5F0\C778','2026-08-27',ARRAY['#yeosu','#brunch','#stay'],1630,'2026-06-08T14:10:00+09','2026-06-08T14:10:00+09'),
    ('traveler06','Sokcho market lunch map','Simple lunch route around Sokcho market.','Kept the plan cheap and easy, with noodle lunch, dessert, and a sea walk nearby.','https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80','sokcho','under_100k','gourmet',U&'\BD04',U&'\D63C\C790','2026-03-21',ARRAY['#sokcho','#market','#lunch'],690,'2026-06-09T09:25:00+09','2026-06-09T09:25:00+09'),
    ('traveler07','Namhae drive with friends','Scenic drive route with two photo stops and dinner.','The route works best if you leave early and avoid the late afternoon traffic near the coast.','https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80','namhae','from_200k_to_300k','drive',U&'\AC00\C744',U&'\CE5C\AD6C','2026-10-10',ARRAY['#namhae','#drive','#friends'],1180,'2026-06-09T12:50:00+09','2026-06-09T12:50:00+09'),
    ('traveler08','Chuncheon solo reading day','Book cafe and quiet walk for a solo day.','A calm route for one person, built around reading time, brunch, and slow walking.','https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80','chuncheon','under_100k','solo_trip',U&'\AC00\C744',U&'\D63C\C790','2026-09-13',ARRAY['#chuncheon','#solo','#reading'],770,'2026-06-09T16:10:00+09','2026-06-09T16:10:00+09'),
    ('traveler09','Pohang late night snack route','Late night snack route after check-in.','This route is useful when you arrive late and still want one solid meal plus a short sea walk.','https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=80','pohang','from_100k_to_200k','gourmet',U&'\ACA8\C6B8',U&'\CE5C\AD6C','2026-12-05',ARRAY['#pohang','#snack','#night'],620,'2026-06-10T09:20:00+09','2026-06-10T09:20:00+09'),
    ('traveler10','Gyeongju spring blossom route','Spring blossom walk with light history stops.','The walking path is simple and matches well with one museum and one dessert stop.','https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80','gyeongju','from_100k_to_200k','date',U&'\BD04',U&'\C5F0\C778','2026-04-03',ARRAY['#gyeongju','#spring','#blossom'],2100,'2026-06-10T10:55:00+09','2026-06-10T10:55:00+09'),
    ('traveler11','Tongyeong healing pension note','Rest centered Tongyeong pension route.','I wrote this for people who want one viewpoint, one seafood dinner, and long rest time.','https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80','tongyeong','over_300k','healing',U&'\C5EC\B984',U&'\AC00\C871','2026-08-03',ARRAY['#tongyeong','#pension','#healing'],1570,'2026-06-10T13:00:00+09','2026-06-10T13:00:00+09'),
    ('traveler12','Gapyeong autumn pension review','Autumn friend trip with pension and cafe loop.','A balanced route with simple drive time, brunch, pension check-in, and one calm viewpoint.','https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80','gapyeong','from_200k_to_300k','couple',U&'\AC00\C744',U&'\CE5C\AD6C','2026-10-17',ARRAY['#gapyeong','#autumn','#pension'],1330,'2026-06-10T15:30:00+09','2026-06-10T15:30:00+09')
) AS seed(login_id, title, summary, content, image_url, region_code, budget_code, theme_code, season, companion, travel_date, tags, view_count, created_at, updated_at)
JOIN users u
  ON LOWER(u.login_id) = LOWER(seed.login_id)
JOIN regions r
  ON r.code = seed.region_code
JOIN budget_ranges b
  ON b.code = seed.budget_code
JOIN themes t
  ON t.code = seed.theme_code
WHERE NOT EXISTS (
    SELECT 1
    FROM posts p
    WHERE p.author_id = u.id
      AND p.title = seed.title
);

INSERT INTO comments (post_id, author_id, content, created_at, updated_at)
SELECT
    p.id,
    u.id,
    seed.content,
    seed.created_at::timestamptz,
    seed.updated_at::timestamptz
FROM (
    VALUES
    ('Gangneung sunrise cafe route','traveler02','This route looks perfect for a first summer weekend.','2026-06-11T09:00:00+09','2026-06-11T09:00:00+09'),
    ('Gangneung sunrise cafe route','traveler05','Did you book the cafe in advance or just walk in?','2026-06-11T09:08:00+09','2026-06-11T09:20:00+09'),
    ('Jeju family drive plan','traveler12','Saved this for my parents trip next month.','2026-06-11T09:30:00+09','2026-06-11T09:30:00+09'),
    ('Busan one night date course','traveler10','The bridge view hotel tip was useful.','2026-06-11T09:55:00+09','2026-06-11T09:55:00+09'),
    ('Jeonju slow solo alley walk','traveler08','I like the quiet alley focus more than the main tourist spots.','2026-06-11T10:10:00+09','2026-06-11T10:10:00+09'),
    ('Yeosu night sea and food route','traveler09','Which dinner place had the best night view?','2026-06-11T10:15:00+09','2026-06-11T10:15:00+09'),
    ('Sokcho winter sea stay','traveler01','Winter sea routes always feel underrated.','2026-06-11T10:30:00+09','2026-06-11T10:30:00+09'),
    ('Namhae pension family weekend','traveler06','Was the pension kitchen good enough for kids meals?','2026-06-11T10:45:00+09','2026-06-11T11:00:00+09'),
    ('Chuncheon lake brunch course','traveler03','Adding this to my spring date list.','2026-06-11T11:05:00+09','2026-06-11T11:05:00+09'),
    ('Pohang market and ocean morning','traveler07','Morning market plus sea walk is a strong combo.','2026-06-11T11:18:00+09','2026-06-11T11:18:00+09'),
    ('Gyeongju calm history walk','traveler04','I need routes like this when traveling with parents.','2026-06-11T11:22:00+09','2026-06-11T11:22:00+09'),
    ('Tongyeong cable car and harbor','traveler02','How long was the cable car waiting line on weekend?','2026-06-11T11:30:00+09','2026-06-11T11:43:00+09'),
    ('Gapyeong budget friend camp','traveler11','Budget routes with barbecue are always welcome.','2026-06-11T11:40:00+09','2026-06-11T11:40:00+09'),
    ('Jeju east coast cafe run','traveler01','This would be great with a rental car and one free afternoon.','2026-06-11T11:55:00+09','2026-06-11T11:55:00+09'),
    ('Busan rainy day indoor route','traveler12','Indoor alternatives are really helpful in rainy season.','2026-06-11T12:03:00+09','2026-06-11T12:03:00+09'),
    ('Yeosu ocean view brunch stay','traveler03','The rest focused routes are my favorite type.','2026-06-11T12:10:00+09','2026-06-11T12:10:00+09'),
    ('Namhae drive with friends','traveler04','Do you think this still works as a one day route?','2026-06-11T12:17:00+09','2026-06-11T12:30:00+09'),
    ('Chuncheon solo reading day','traveler05','Quiet reading day trips need more posts like this.','2026-06-11T12:28:00+09','2026-06-11T12:28:00+09')
) AS seed(post_title, login_id, content, created_at, updated_at)
JOIN posts p
  ON p.title = seed.post_title
JOIN users u
  ON LOWER(u.login_id) = LOWER(seed.login_id)
WHERE NOT EXISTS (
    SELECT 1
    FROM comments c
    WHERE c.post_id = p.id
      AND c.author_id = u.id
      AND c.content = seed.content
);

INSERT INTO comment_replies (comment_id, author_id, content, created_at, updated_at)
SELECT
    c.id,
    u.id,
    seed.content,
    seed.created_at::timestamptz,
    seed.updated_at::timestamptz
FROM (
    VALUES
    ('Gangneung sunrise cafe route','This route looks perfect for a first summer weekend.','traveler01','Sunrise timing matters a lot there, so leaving early helps.','2026-06-11T12:40:00+09','2026-06-11T12:40:00+09'),
    ('Gangneung sunrise cafe route','Did you book the cafe in advance or just walk in?','traveler01','I walked in early, but after noon it gets crowded.','2026-06-11T12:45:00+09','2026-06-11T12:57:00+09'),
    ('Jeju family drive plan','Saved this for my parents trip next month.','traveler02','Try to keep one long break after lunch. That helped a lot.','2026-06-11T13:00:00+09','2026-06-11T13:00:00+09'),
    ('Tongyeong cable car and harbor','How long was the cable car waiting line on weekend?','traveler11','Around forty minutes when I went on Saturday afternoon.','2026-06-11T13:08:00+09','2026-06-11T13:08:00+09'),
    ('Namhae drive with friends','Do you think this still works as a one day route?','traveler07','Yes, but you should leave before 8 in the morning.','2026-06-11T13:15:00+09','2026-06-11T13:15:00+09'),
    ('Yeosu night sea and food route','Which dinner place had the best night view?','traveler05','The second seafood place near the bridge was the best one.','2026-06-11T13:20:00+09','2026-06-11T13:20:00+09')
) AS seed(post_title, parent_content, login_id, content, created_at, updated_at)
JOIN posts p
  ON p.title = seed.post_title
JOIN comments c
  ON c.post_id = p.id
 AND c.content = seed.parent_content
JOIN users u
  ON LOWER(u.login_id) = LOWER(seed.login_id)
WHERE NOT EXISTS (
    SELECT 1
    FROM comment_replies r
    WHERE r.comment_id = c.id
      AND r.author_id = u.id
      AND r.content = seed.content
);

INSERT INTO post_bookmarks (user_id, post_id, created_at)
SELECT
    u.id,
    p.id,
    seed.created_at::timestamptz
FROM (
    VALUES
    ('traveler01','Jeju family drive plan','2026-06-11T13:30:00+09'),
    ('traveler01','Busan one night date course','2026-06-11T13:31:00+09'),
    ('traveler02','Gangneung sunrise cafe route','2026-06-11T13:32:00+09'),
    ('traveler02','Gyeongju spring blossom route','2026-06-11T13:33:00+09'),
    ('traveler03','Yeosu night sea and food route','2026-06-11T13:34:00+09'),
    ('traveler03','Tongyeong cable car and harbor','2026-06-11T13:35:00+09'),
    ('traveler04','Chuncheon lake brunch course','2026-06-11T13:36:00+09'),
    ('traveler05','Sokcho winter sea stay','2026-06-11T13:37:00+09'),
    ('traveler06','Namhae pension family weekend','2026-06-11T13:38:00+09'),
    ('traveler07','Gapyeong budget friend camp','2026-06-11T13:39:00+09'),
    ('traveler08','Jeonju slow solo alley walk','2026-06-11T13:40:00+09'),
    ('traveler09','Busan rainy day indoor route','2026-06-11T13:41:00+09'),
    ('traveler10','Yeosu ocean view brunch stay','2026-06-11T13:42:00+09'),
    ('traveler11','Jeju east coast cafe run','2026-06-11T13:43:00+09'),
    ('traveler12','Gangneung hotel and bakery list','2026-06-11T13:44:00+09')
) AS seed(login_id, post_title, created_at)
JOIN users u
  ON LOWER(u.login_id) = LOWER(seed.login_id)
JOIN posts p
  ON p.title = seed.post_title
ON CONFLICT (user_id, post_id) DO NOTHING;

INSERT INTO user_follows (follower_id, following_id, created_at)
SELECT
    follower.id,
    following.id,
    seed.created_at::timestamptz
FROM (
    VALUES
    ('traveler01','traveler02','2026-06-11T13:50:00+09'),
    ('traveler01','traveler03','2026-06-11T13:51:00+09'),
    ('traveler02','traveler01','2026-06-11T13:52:00+09'),
    ('traveler02','traveler10','2026-06-11T13:53:00+09'),
    ('traveler03','traveler05','2026-06-11T13:54:00+09'),
    ('traveler03','traveler11','2026-06-11T13:55:00+09'),
    ('traveler04','traveler08','2026-06-11T13:56:00+09'),
    ('traveler05','traveler04','2026-06-11T13:57:00+09'),
    ('traveler06','traveler12','2026-06-11T13:58:00+09'),
    ('traveler07','traveler03','2026-06-11T13:59:00+09'),
    ('traveler08','traveler02','2026-06-11T14:00:00+09'),
    ('traveler09','traveler05','2026-06-11T14:01:00+09'),
    ('traveler10','traveler01','2026-06-11T14:02:00+09'),
    ('traveler11','traveler07','2026-06-11T14:03:00+09'),
    ('traveler12','traveler06','2026-06-11T14:04:00+09')
) AS seed(follower_login_id, following_login_id, created_at)
JOIN users follower
  ON LOWER(follower.login_id) = LOWER(seed.follower_login_id)
JOIN users following
  ON LOWER(following.login_id) = LOWER(seed.following_login_id)
ON CONFLICT (follower_id, following_id) DO NOTHING;

INSERT INTO posts (
    author_id, title, summary, content, image_url, region_id, budget_range_id, theme_id,
    season, companion, travel_date, tags, view_count, created_at, updated_at
)
SELECT
    u.id,
    seed.title,
    seed.summary,
    seed.content,
    seed.image_url,
    r.id,
    b.id,
    t.id,
    seed.season::season_enum,
    seed.companion::companion_enum,
    seed.travel_date::date,
    seed.tags,
    seed.view_count,
    seed.created_at::timestamptz,
    seed.updated_at::timestamptz
FROM (
    VALUES
    ('traveler01','Gangneung afternoon sea walk and dessert','Short afternoon route with dessert cafe and sea walk.','This route works when you arrive late and still want one cafe, one beach walk, and an easy dinner nearby.','https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80','gangneung','under_100k','date',U&'\BD04',U&'\CE5C\AD6C','2026-04-19',ARRAY['#gangneung','#dessert','#walk'],980,'2026-06-11T14:20:00+09','2026-06-11T14:20:00+09'),
    ('traveler02','Gangneung one day ocean bakery map','Compact bakery route with ocean photo spots.','I grouped three bakeries and one breakwater stop so the route stays simple even without a car.','https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80','gangneung','from_100k_to_200k','gourmet',U&'\C5EC\B984',U&'\CE5C\AD6C','2026-07-27',ARRAY['#gangneung','#bakery','#oneday'],1260,'2026-06-11T14:30:00+09','2026-06-11T14:30:00+09'),
    ('traveler03','Jeju early morning coast route','Early morning Jeju route before the crowd arrives.','This is good when you want calm coast roads, one brunch stop, and a slower pace around the east side.','https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80','jeju','from_200k_to_300k','healing',U&'\BD04',U&'\C5F0\C778','2026-05-04',ARRAY['#jeju','#morning','#coast'],1470,'2026-06-11T14:40:00+09','2026-06-11T14:40:00+09'),
    ('traveler04','Jeju rainy day museum and cafe plan','Indoor focused Jeju route for rainy weather.','Kept the route safe from weather with museums, one bakery, and a hotel close to dinner places.','https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=900&q=80','jeju','from_100k_to_200k','family',U&'\C5EC\B984',U&'\AC00\C871','2026-07-10',ARRAY['#jeju','#rain','#museum'],1080,'2026-06-11T14:50:00+09','2026-06-11T14:50:00+09'),
    ('traveler05','Busan brunch and blue line combo','Brunch and blue line route with low walking load.','This route is useful if you want one famous rail spot but do not want to rush between too many places.','https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80','busan','from_200k_to_300k','date',U&'\BD04',U&'\C5F0\C778','2026-05-11',ARRAY['#busan','#brunch','#blueline'],1710,'2026-06-11T15:00:00+09','2026-06-11T15:00:00+09'),
    ('traveler06','Busan cheap one night friend trip','Low budget one night plan around Seomyeon and beach.','Built for students and friends with simple transit, one hotel, one night snack stop, and next day brunch.','https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80','busan','from_100k_to_200k','drive',U&'\AC00\C744',U&'\CE5C\AD6C','2026-09-06',ARRAY['#busan','#budget','#friends'],1390,'2026-06-11T15:10:00+09','2026-06-11T15:10:00+09'),
    ('traveler07','Jeonju dessert crawl in hanok area','Light dessert crawl around hanok village.','The route skips heavy meals and focuses on small dessert stops, photos, and one calm tea house.','https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80','jeonju','under_100k','gourmet',U&'\BD04',U&'\CE5C\AD6C','2026-04-15',ARRAY['#jeonju','#dessert','#hanok'],760,'2026-06-11T15:20:00+09','2026-06-11T15:20:00+09'),
    ('traveler08','Jeonju quiet stay near old town','Stay focused route with old town night walk.','This route works best when the goal is one calm stay, one local dinner, and a short old town walk after sunset.','https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80','jeonju','from_200k_to_300k','healing',U&'\AC00\C744',U&'\D63C\C790','2026-10-08',ARRAY['#jeonju','#stay','#nightwalk'],920,'2026-06-11T15:30:00+09','2026-06-11T15:30:00+09'),
    ('traveler09','Yeosu cable car and snack route','Snack first, cable car later route for better timing.','I moved the cable car after snacks so the sunset wait felt shorter and the walking order was more natural.','https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80','yeosu','from_100k_to_200k','date',U&'\C5EC\B984',U&'\CE5C\AD6C','2026-08-01',ARRAY['#yeosu','#cablecar','#snack'],1180,'2026-06-11T15:40:00+09','2026-06-11T15:40:00+09'),
    ('traveler10','Yeosu family dinner and aquarium route','Family route with aquarium and easy dinner stop.','This one keeps the moving distance short and is good if you are traveling with younger kids.','https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80','yeosu','from_200k_to_300k','family',U&'\BD04',U&'\AC00\C871','2026-05-24',ARRAY['#yeosu','#family','#aquarium'],1280,'2026-06-11T15:50:00+09','2026-06-11T15:50:00+09'),
    ('traveler11','Sokcho cafe stay with mountain view','Mountain view cafe stay with short downtown route.','This route is not just sea focused and works well when you want a calmer inland cafe atmosphere too.','https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=80','sokcho','from_100k_to_200k','healing',U&'\AC00\C744',U&'\C5F0\C778','2026-09-28',ARRAY['#sokcho','#cafe','#mountainview'],1010,'2026-06-11T16:00:00+09','2026-06-11T16:00:00+09'),
    ('traveler12','Sokcho one day seafood market plan','Simple one day market plan with seafood lunch.','The route is good for a short visit because almost everything sits in one compact cluster.','https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80','sokcho','under_100k','gourmet',U&'\BD04',U&'\CE5C\AD6C','2026-03-30',ARRAY['#sokcho','#market','#seafood'],860,'2026-06-11T16:10:00+09','2026-06-11T16:10:00+09'),
    ('traveler01','Namhae spring flower drive memo','Flower drive memo around Namhae back roads.','I wrote down the calmer side roads and timing because the main roads can get too crowded in spring.','https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80','namhae','from_100k_to_200k','drive',U&'\BD04',U&'\CE5C\AD6C','2026-04-05',ARRAY['#namhae','#flower','#drive'],970,'2026-06-11T16:20:00+09','2026-06-11T16:20:00+09'),
    ('traveler02','Namhae ocean picnic route','Picnic route with one overlook and one bakery stop.','Bring food early and move before lunch because the best picnic points fill up fast.','https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80','namhae','under_100k','healing',U&'\BD04',U&'\CE5C\AD6C','2026-04-13',ARRAY['#namhae','#picnic','#overlook'],790,'2026-06-11T16:30:00+09','2026-06-11T16:30:00+09'),
    ('traveler03','Chuncheon sunset bike and cafe route','Sunset bike path plus cafe finish.','This route works best in dry weather and gives enough breaks for photos without rushing too much.','https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80','chuncheon','from_100k_to_200k','date',U&'\C5EC\B984',U&'\CE5C\AD6C','2026-07-15',ARRAY['#chuncheon','#bike','#sunset'],1140,'2026-06-11T16:40:00+09','2026-06-11T16:40:00+09'),
    ('traveler04','Chuncheon family noodle and rail bike day','Rail bike and noodle day trip with family.','This is a classic route but the order matters a lot if you want to avoid waiting too long with children.','https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80','chuncheon','from_200k_to_300k','family',U&'\BD04',U&'\AC00\C871','2026-05-16',ARRAY['#chuncheon','#railbike','#family'],1560,'2026-06-11T16:50:00+09','2026-06-11T16:50:00+09'),
    ('traveler05','Pohang lighthouse dawn route','Dawn route around lighthouse and breakfast stop.','If you like quiet early hours, this route is far better than arriving after the main crowd builds up.','https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80','pohang','under_100k','healing',U&'\C5EC\B984',U&'\D63C\C790','2026-07-08',ARRAY['#pohang','#dawn','#lighthouse'],840,'2026-06-11T17:00:00+09','2026-06-11T17:00:00+09'),
    ('traveler06','Pohang steel yard and cafe stop','Industrial view route with one strong cafe stop.','This is a more unusual route for people who like city texture and not only classic sea sightseeing.','https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=900&q=80','pohang','from_100k_to_200k','drive',U&'\AC00\C744',U&'\CE5C\AD6C','2026-10-01',ARRAY['#pohang','#cafe','#industrial'],690,'2026-06-11T17:10:00+09','2026-06-11T17:10:00+09'),
    ('traveler07','Gyeongju night photo walk','Night photo route around calm lit streets.','The route avoids the noon heat and works much better if you want a slower date atmosphere.','https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80','gyeongju','under_100k','date',U&'\AC00\C744',U&'\C5F0\C778','2026-10-09',ARRAY['#gyeongju','#night','#photo'],1440,'2026-06-11T17:20:00+09','2026-06-11T17:20:00+09'),
    ('traveler08','Gyeongju museum and tea room course','Museum and tea room route for a quiet afternoon.','I paired one larger museum with two small tea stops so the day stays calm and not too crowded.','https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=80','gyeongju','from_100k_to_200k','healing',U&'\BD04',U&'\D63C\C790','2026-04-17',ARRAY['#gyeongju','#museum','#tea'],930,'2026-06-11T17:30:00+09','2026-06-11T17:30:00+09'),
    ('traveler09','Tongyeong brunch and harbor stroll','Easy brunch route with short harbor stroll.','The whole route stays compact so it works well when you only have half a day in town.','https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80','tongyeong','from_100k_to_200k','gourmet',U&'\BD04',U&'\CE5C\AD6C','2026-05-09',ARRAY['#tongyeong','#brunch','#harbor'],1070,'2026-06-11T17:40:00+09','2026-06-11T17:40:00+09'),
    ('traveler10','Tongyeong family cable car route','Cable car route with easy meal breaks for family.','This was planned around low walking load and clear rest points for older family members.','https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80','tongyeong','from_200k_to_300k','family',U&'\C5EC\B984',U&'\AC00\C871','2026-08-21',ARRAY['#tongyeong','#cablecar','#family'],1510,'2026-06-11T17:50:00+09','2026-06-11T17:50:00+09'),
    ('traveler11','Gapyeong river cafe and pension route','River cafe and pension route for a calm overnight.','One brunch stop, one riverside cafe, and early check-in made this route feel much less rushed.','https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80','gapyeong','from_200k_to_300k','healing',U&'\C5EC\B984',U&'\C5F0\C778','2026-08-29',ARRAY['#gapyeong','#river','#pension'],1190,'2026-06-11T18:00:00+09','2026-06-11T18:00:00+09'),
    ('traveler12','Gapyeong cheap friend brunch trip','Low budget brunch trip before pension check-in.','A simple route meant for friend groups that want one cafe stop and more time to rest at the stay.','https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80','gapyeong','under_100k','solo_trip',U&'\BD04',U&'\CE5C\AD6C','2026-04-26',ARRAY['#gapyeong','#budget','#brunch'],720,'2026-06-11T18:10:00+09','2026-06-11T18:10:00+09')
) AS seed(login_id, title, summary, content, image_url, region_code, budget_code, theme_code, season, companion, travel_date, tags, view_count, created_at, updated_at)
JOIN users u
  ON LOWER(u.login_id) = LOWER(seed.login_id)
JOIN regions r
  ON r.code = seed.region_code
JOIN budget_ranges b
  ON b.code = seed.budget_code
JOIN themes t
  ON t.code = seed.theme_code
WHERE NOT EXISTS (
    SELECT 1
    FROM posts p
    WHERE p.author_id = u.id
      AND p.title = seed.title
);

INSERT INTO comments (post_id, author_id, content, created_at, updated_at)
SELECT
    p.id,
    u.id,
    seed.content,
    seed.created_at::timestamptz,
    seed.updated_at::timestamptz
FROM (
    VALUES
    ('Gangneung afternoon sea walk and dessert','traveler03','This is exactly the kind of short route I need after work on Friday.','2026-06-11T18:20:00+09','2026-06-11T18:20:00+09'),
    ('Gangneung afternoon sea walk and dessert','traveler08','Did you have enough time before sunset for all stops?','2026-06-11T18:22:00+09','2026-06-11T18:35:00+09'),
    ('Gangneung one day ocean bakery map','traveler11','Bakery route posts are always dangerous for me.','2026-06-11T18:24:00+09','2026-06-11T18:24:00+09'),
    ('Jeju early morning coast route','traveler06','Morning coast drives in Jeju are the best when roads are empty.','2026-06-11T18:26:00+09','2026-06-11T18:26:00+09'),
    ('Jeju rainy day museum and cafe plan','traveler09','Useful backup plan for bad weather weekends.','2026-06-11T18:28:00+09','2026-06-11T18:28:00+09'),
    ('Busan brunch and blue line combo','traveler02','I was looking for a route with less walking, this helps a lot.','2026-06-11T18:30:00+09','2026-06-11T18:30:00+09'),
    ('Busan cheap one night friend trip','traveler12','Nice to see a real low budget Busan route.','2026-06-11T18:32:00+09','2026-06-11T18:32:00+09'),
    ('Jeonju dessert crawl in hanok area','traveler01','Saving this for a spring day trip.','2026-06-11T18:34:00+09','2026-06-11T18:34:00+09'),
    ('Jeonju quiet stay near old town','traveler05','The night walk idea sounds much calmer than the usual routes.','2026-06-11T18:36:00+09','2026-06-11T18:36:00+09'),
    ('Yeosu cable car and snack route','traveler04','The timing tip is great because I always get stuck waiting there.','2026-06-11T18:38:00+09','2026-06-11T18:38:00+09'),
    ('Yeosu family dinner and aquarium route','traveler07','Did the aquarium feel too crowded on weekend?','2026-06-11T18:40:00+09','2026-06-11T18:52:00+09'),
    ('Sokcho cafe stay with mountain view','traveler10','I like that this is not the usual sea-only Sokcho route.','2026-06-11T18:42:00+09','2026-06-11T18:42:00+09'),
    ('Sokcho one day seafood market plan','traveler03','Perfect for a quick day trip from Seoul.','2026-06-11T18:44:00+09','2026-06-11T18:44:00+09'),
    ('Namhae spring flower drive memo','traveler06','Back road notes are super helpful in flower season.','2026-06-11T18:46:00+09','2026-06-11T18:46:00+09'),
    ('Namhae ocean picnic route','traveler08','Would this still work well in early summer?','2026-06-11T18:48:00+09','2026-06-11T19:00:00+09'),
    ('Chuncheon sunset bike and cafe route','traveler05','This sounds really nice for late spring weather.','2026-06-11T18:50:00+09','2026-06-11T18:50:00+09'),
    ('Chuncheon family noodle and rail bike day','traveler09','Great to have the order explained for family trips.','2026-06-11T18:52:00+09','2026-06-11T18:52:00+09'),
    ('Pohang lighthouse dawn route','traveler02','Early morning routes always feel more special than daytime lists.','2026-06-11T18:54:00+09','2026-06-11T18:54:00+09'),
    ('Pohang steel yard and cafe stop','traveler11','I actually like industrial city view spots too.','2026-06-11T18:56:00+09','2026-06-11T18:56:00+09'),
    ('Gyeongju night photo walk','traveler01','Night atmosphere routes are exactly what I wanted in Gyeongju.','2026-06-11T18:58:00+09','2026-06-11T18:58:00+09'),
    ('Gyeongju museum and tea room course','traveler12','The museum plus tea room combination feels very clean.','2026-06-11T19:00:00+09','2026-06-11T19:00:00+09'),
    ('Tongyeong brunch and harbor stroll','traveler04','Half day harbor routes are more useful than huge checklists.','2026-06-11T19:02:00+09','2026-06-11T19:02:00+09'),
    ('Tongyeong family cable car route','traveler07','Thanks for writing this with older family members in mind.','2026-06-11T19:04:00+09','2026-06-11T19:04:00+09'),
    ('Gapyeong river cafe and pension route','traveler10','Looks like a solid overnight date course.','2026-06-11T19:06:00+09','2026-06-11T19:06:00+09'),
    ('Gapyeong cheap friend brunch trip','traveler03','Good to see a really cheap Gapyeong route.','2026-06-11T19:08:00+09','2026-06-11T19:08:00+09')
) AS seed(post_title, login_id, content, created_at, updated_at)
JOIN posts p
  ON p.title = seed.post_title
JOIN users u
  ON LOWER(u.login_id) = LOWER(seed.login_id)
WHERE NOT EXISTS (
    SELECT 1
    FROM comments c
    WHERE c.post_id = p.id
      AND c.author_id = u.id
      AND c.content = seed.content
);

INSERT INTO comment_replies (comment_id, author_id, content, created_at, updated_at)
SELECT
    c.id,
    u.id,
    seed.content,
    seed.created_at::timestamptz,
    seed.updated_at::timestamptz
FROM (
    VALUES
    ('Gangneung afternoon sea walk and dessert','Did you have enough time before sunset for all stops?','traveler01','Yes, but I skipped one extra dessert place to keep it relaxed.','2026-06-11T19:10:00+09','2026-06-11T19:22:00+09'),
    ('Yeosu family dinner and aquarium route','Did the aquarium feel too crowded on weekend?','traveler10','It was crowded after 2 PM, so I recommend going before lunch.','2026-06-11T19:12:00+09','2026-06-11T19:12:00+09'),
    ('Namhae ocean picnic route','Would this still work well in early summer?','traveler02','Yes, but I would go earlier in the day before the heat gets strong.','2026-06-11T19:14:00+09','2026-06-11T19:14:00+09'),
    ('Busan brunch and blue line combo','I was looking for a route with less walking, this helps a lot.','traveler05','That was the main goal, so I kept transfers and stairs as low as possible.','2026-06-11T19:16:00+09','2026-06-11T19:16:00+09'),
    ('Gyeongju night photo walk','Night atmosphere routes are exactly what I wanted in Gyeongju.','traveler07','The lighting was much nicer after 8 PM than I expected.','2026-06-11T19:18:00+09','2026-06-11T19:18:00+09'),
    ('Tongyeong family cable car route','Thanks for writing this with older family members in mind.','traveler10','I tried to keep every long walk optional for that reason.','2026-06-11T19:20:00+09','2026-06-11T19:20:00+09')
) AS seed(post_title, parent_content, login_id, content, created_at, updated_at)
JOIN posts p
  ON p.title = seed.post_title
JOIN comments c
  ON c.post_id = p.id
 AND c.content = seed.parent_content
JOIN users u
  ON LOWER(u.login_id) = LOWER(seed.login_id)
WHERE NOT EXISTS (
    SELECT 1
    FROM comment_replies r
    WHERE r.comment_id = c.id
      AND r.author_id = u.id
      AND r.content = seed.content
);

COMMIT;
