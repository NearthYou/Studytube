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
    ('traveler01', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '박민지', 'traveler01@example.com', '바다민지', '주말마다 바다 여행 코스를 모아 기록합니다.', '서울'),
    ('traveler02', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '김지수', 'traveler02@example.com', '카페지수', '카페와 사진 명소를 중심으로 여행을 정리합니다.', '서울'),
    ('traveler03', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '이현우', 'traveler03@example.com', '드라이브현우', '드라이브 코스와 쉬운 동선을 기록합니다.', '수원'),
    ('traveler04', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '최소연', 'traveler04@example.com', '느린여행', '조용한 동네와 느린 여행을 좋아합니다.', '인천'),
    ('traveler05', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '정도윤', 'traveler05@example.com', '혼행도윤', '혼자 가기 편한 여행지를 정리합니다.', '대전'),
    ('traveler06', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '한유진', 'traveler06@example.com', '힐링유진', '쉼이 있는 숙소와 온천 여행을 기록합니다.', '성남'),
    ('traveler07', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '오승민', 'traveler07@example.com', '알뜰승민', '가성비 좋은 여행 루트를 찾습니다.', '부산'),
    ('traveler08', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '강아라', 'traveler08@example.com', '맛집아라', '시장과 맛집 중심 여행을 좋아합니다.', '대구'),
    ('traveler09', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '서준', 'traveler09@example.com', '숙소준', '호텔과 오션뷰 숙소를 모아둡니다.', '울산'),
    ('traveler10', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '임하나', 'traveler10@example.com', '데이트하나', '데이트 코스를 직접 다듬어 공유합니다.', '서울'),
    ('traveler11', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '문태현', 'traveler11@example.com', '산책태현', '산과 호수 주변 코스를 즐깁니다.', '춘천'),
    ('traveler12', '$argon2id$v=19$m=65536,t=3,p=4$4UD3esKbfQg/m5xG9LeoSQ$7LuTAksNknz7NdXgx911F5ssTSfZfFrIb5yoLZeDlaA', '유나리', 'traveler12@example.com', '가족나리', '가족 여행 체크리스트를 기록합니다.', '광주')
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
    ('traveler01', '강릉 쉬어가는 힐링 코스 001', '경포해변, 하슬라아트월드, 동화가든까지 묶은 강릉 실제 여행 기록입니다.', '강릉 여행은 경포해변에서 시작해 하슬라아트월드까지 천천히 이어갔습니다. 식사는 동화가든 근처로 잡고 숙소는 스카이베이호텔 경포 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80', 'gangneung', 'from_100k_to_200k', 'healing', '여름', '친구', '2026-07-12', ARRAY['#강릉', '#힐링', '#경포해변'], 1420, '2026-06-01T09:00:00+09', '2026-06-01T09:00:00+09'),
    ('traveler02', '제주 가족 여행 짧은 동선 002', '성산일출봉, 오설록티뮤지엄, 자매국수까지 묶은 제주 실제 여행 기록입니다.', '제주 여행은 성산일출봉에서 시작해 오설록티뮤지엄까지 천천히 이어갔습니다. 식사는 자매국수 근처로 잡고 숙소는 그랜드하얏트 제주 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 가족 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80', 'jeju', 'over_300k', 'family', '봄', '가족', '2026-05-20', ARRAY['#제주', '#가족', '#성산일출봉'], 2180, '2026-06-01T11:00:00+09', '2026-06-01T11:00:00+09'),
    ('traveler03', '부산 노을 데이트 코스 003', '해운대해수욕장, 해동용궁사, 해운대암소갈비집까지 묶은 부산 실제 여행 기록입니다.', '부산 여행은 해운대해수욕장에서 시작해 해동용궁사까지 천천히 이어갔습니다. 식사는 해운대암소갈비집 근처로 잡고 숙소는 파라다이스호텔 부산 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 데이트 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80', 'busan', 'from_200k_to_300k', 'date', '가을', '연인', '2026-09-18', ARRAY['#부산', '#데이트', '#해운대해수욕장'], 1890, '2026-06-02T10:30:00+09', '2026-06-02T10:30:00+09'),
    ('traveler04', '전주 혼자 걷는 리셋 루트 004', '전주한옥마을, 객리단길, 한국집까지 묶은 전주 실제 여행 기록입니다.', '전주 여행은 전주한옥마을에서 시작해 객리단길까지 천천히 이어갔습니다. 식사는 한국집 근처로 잡고 숙소는 전주한옥스테이 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 혼행 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80', 'jeonju', 'under_100k', 'solo_trip', '가을', '혼자', '2026-10-03', ARRAY['#전주', '#혼행', '#전주한옥마을'], 960, '2026-06-03T08:10:00+09', '2026-06-03T08:10:00+09'),
    ('traveler05', '여수 맛집 중심 하루 코스 005', '여수해상케이블카, 낭만포차거리, 여수당까지 묶은 여수 실제 여행 기록입니다.', '여수 여행은 여수해상케이블카에서 시작해 낭만포차거리까지 천천히 이어갔습니다. 식사는 여수당 근처로 잡고 숙소는 라마다프라자 여수 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 미식 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80', 'yeosu', 'from_100k_to_200k', 'gourmet', '봄', '친구', '2026-04-29', ARRAY['#여수', '#미식', '#여수해상케이블카'], 1540, '2026-06-03T18:20:00+09', '2026-06-03T18:20:00+09'),
    ('traveler06', '속초 쉬어가는 힐링 코스 006', '설악산국립공원, 속초관광수산시장, 만석닭강정까지 묶은 속초 실제 여행 기록입니다.', '속초 여행은 설악산국립공원에서 시작해 속초관광수산시장까지 천천히 이어갔습니다. 식사는 만석닭강정 근처로 잡고 숙소는 롯데리조트 속초 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=900&q=80', 'sokcho', 'from_100k_to_200k', 'healing', '겨울', '혼자', '2026-01-14', ARRAY['#속초', '#힐링', '#설악산국립공원'], 1110, '2026-06-04T09:45:00+09', '2026-06-04T09:45:00+09'),
    ('traveler07', '남해 가족 여행 짧은 동선 007', '독일마을, 상주은모래비치, 남해전통시장까지 묶은 남해 실제 여행 기록입니다.', '남해 여행은 독일마을에서 시작해 상주은모래비치까지 천천히 이어갔습니다. 식사는 남해전통시장 근처로 잡고 숙소는 아난티 남해 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 가족 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80', 'namhae', 'over_300k', 'family', '여름', '가족', '2026-08-08', ARRAY['#남해', '#가족', '#독일마을'], 1320, '2026-06-04T12:00:00+09', '2026-06-04T12:00:00+09'),
    ('traveler08', '춘천 노을 데이트 코스 008', '소양강스카이워크, 레고랜드코리아, 통나무집닭갈비까지 묶은 춘천 실제 여행 기록입니다.', '춘천 여행은 소양강스카이워크에서 시작해 레고랜드코리아까지 천천히 이어갔습니다. 식사는 통나무집닭갈비 근처로 잡고 숙소는 세종호텔 춘천 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 데이트 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80', 'chuncheon', 'under_100k', 'date', '봄', '연인', '2026-05-02', ARRAY['#춘천', '#데이트', '#소양강스카이워크'], 880, '2026-06-05T10:00:00+09', '2026-06-05T10:00:00+09'),
    ('traveler09', '포항 맛집 중심 하루 코스 009', '스페이스워크, 영일대해수욕장, 죽도시장까지 묶은 포항 실제 여행 기록입니다.', '포항 여행은 스페이스워크에서 시작해 영일대해수욕장까지 천천히 이어갔습니다. 식사는 죽도시장 근처로 잡고 숙소는 라한호텔 포항 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 미식 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', 'pohang', 'under_100k', 'gourmet', '여름', '친구', '2026-07-01', ARRAY['#포항', '#미식', '#스페이스워크'], 730, '2026-06-05T14:00:00+09', '2026-06-05T14:00:00+09'),
    ('traveler10', '경주 쉬어가는 힐링 코스 010', '첨성대, 동궁과월지, 도솔마을까지 묶은 경주 실제 여행 기록입니다.', '경주 여행은 첨성대에서 시작해 동궁과월지까지 천천히 이어갔습니다. 식사는 도솔마을 근처로 잡고 숙소는 코모도호텔 경주 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=80', 'gyeongju', 'from_100k_to_200k', 'healing', '봄', '연인', '2026-04-12', ARRAY['#경주', '#힐링', '#첨성대'], 1670, '2026-06-06T09:15:00+09', '2026-06-06T09:15:00+09'),
    ('traveler11', '통영 기념일 숙소 코스 011', '통영케이블카, 이순신공원, 통영굴골목까지 묶은 통영 실제 여행 기록입니다.', '통영 여행은 통영케이블카에서 시작해 이순신공원까지 천천히 이어갔습니다. 식사는 통영굴골목 근처로 잡고 숙소는 한산호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 커플 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80', 'tongyeong', 'from_200k_to_300k', 'couple', '가을', '연인', '2026-10-22', ARRAY['#통영', '#커플', '#통영케이블카'], 1440, '2026-06-06T13:40:00+09', '2026-06-06T13:40:00+09'),
    ('traveler12', '가평 드라이브 한 바퀴 012', '남이섬, 자라섬, 송원막국수까지 묶은 가평 실제 여행 기록입니다.', '가평 여행은 남이섬에서 시작해 자라섬까지 천천히 이어갔습니다. 식사는 송원막국수 근처로 잡고 숙소는 마이다스호텔앤리조트 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 드라이브 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80', 'gapyeong', 'from_100k_to_200k', 'drive', '여름', '친구', '2026-08-15', ARRAY['#가평', '#드라이브', '#남이섬'], 1250, '2026-06-07T08:50:00+09', '2026-06-07T08:50:00+09'),
    ('traveler01', '강릉 기념일 숙소 코스 013', '안목커피거리, 주문진방파제, 대동면옥까지 묶은 강릉 실제 여행 기록입니다.', '강릉 여행은 안목커피거리에서 시작해 주문진방파제까지 천천히 이어갔습니다. 식사는 대동면옥 근처로 잡고 숙소는 세인트존스호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 커플 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80', 'gangneung', 'from_200k_to_300k', 'couple', '봄', '연인', '2026-04-26', ARRAY['#강릉', '#커플', '#안목커피거리'], 1360, '2026-06-07T10:10:00+09', '2026-06-07T10:10:00+09'),
    ('traveler02', '제주 드라이브 한 바퀴 014', '우도, 협재해변, 돈사돈까지 묶은 제주 실제 여행 기록입니다.', '제주 여행은 우도에서 시작해 협재해변까지 천천히 이어갔습니다. 식사는 돈사돈 근처로 잡고 숙소는 메종글래드 제주 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 드라이브 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80', 'jeju', 'from_200k_to_300k', 'drive', '여름', '친구', '2026-07-19', ARRAY['#제주', '#드라이브', '#우도'], 1740, '2026-06-07T15:30:00+09', '2026-06-07T15:30:00+09'),
    ('traveler03', '부산 쉬어가는 힐링 코스 015', '광안리해변, 송도해상케이블카, 금수복국까지 묶은 부산 실제 여행 기록입니다.', '부산 여행은 광안리해변에서 시작해 송도해상케이블카까지 천천히 이어갔습니다. 식사는 금수복국 근처로 잡고 숙소는 시그니엘 부산 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=900&q=80', 'busan', 'from_100k_to_200k', 'healing', '여름', '친구', '2026-07-06', ARRAY['#부산', '#힐링', '#광안리해변'], 910, '2026-06-08T09:00:00+09', '2026-06-08T09:00:00+09'),
    ('traveler04', '전주 노을 데이트 코스 016', '경기전, 남부시장, 베테랑칼국수까지 묶은 전주 실제 여행 기록입니다.', '전주 여행은 경기전에서 시작해 남부시장까지 천천히 이어갔습니다. 식사는 베테랑칼국수 근처로 잡고 숙소는 전주관광호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 데이트 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', 'jeonju', 'under_100k', 'date', '봄', '친구', '2026-04-07', ARRAY['#전주', '#데이트', '#경기전'], 840, '2026-06-08T11:45:00+09', '2026-06-08T11:45:00+09'),
    ('traveler05', '여수 쉬어가는 힐링 코스 017', '오동도, 아쿠아플라넷 여수, 삼학집까지 묶은 여수 실제 여행 기록입니다.', '여수 여행은 오동도에서 시작해 아쿠아플라넷 여수까지 천천히 이어갔습니다. 식사는 삼학집 근처로 잡고 숙소는 소노캄 여수 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80', 'yeosu', 'over_300k', 'healing', '여름', '연인', '2026-08-27', ARRAY['#여수', '#힐링', '#오동도'], 1630, '2026-06-08T14:10:00+09', '2026-06-08T14:10:00+09'),
    ('traveler06', '속초 맛집 중심 하루 코스 018', '아바이마을, 청초호, 팔팔생선구이까지 묶은 속초 실제 여행 기록입니다.', '속초 여행은 아바이마을에서 시작해 청초호까지 천천히 이어갔습니다. 식사는 팔팔생선구이 근처로 잡고 숙소는 라마다 속초호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 미식 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80', 'sokcho', 'under_100k', 'gourmet', '봄', '혼자', '2026-03-21', ARRAY['#속초', '#미식', '#아바이마을'], 690, '2026-06-09T09:25:00+09', '2026-06-09T09:25:00+09'),
    ('traveler07', '남해 드라이브 한 바퀴 019', '다랭이마을, 남해대교, 남해한우프라자까지 묶은 남해 실제 여행 기록입니다.', '남해 여행은 다랭이마을에서 시작해 남해대교까지 천천히 이어갔습니다. 식사는 남해한우프라자 근처로 잡고 숙소는 이제 남해 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 드라이브 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80', 'namhae', 'from_200k_to_300k', 'drive', '가을', '친구', '2026-10-10', ARRAY['#남해', '#드라이브', '#다랭이마을'], 1180, '2026-06-09T12:50:00+09', '2026-06-09T12:50:00+09'),
    ('traveler08', '춘천 혼자 걷는 리셋 루트 020', '삼악산케이블카, 춘천명동닭갈비골목, 남문닭갈비까지 묶은 춘천 실제 여행 기록입니다.', '춘천 여행은 삼악산케이블카에서 시작해 춘천명동닭갈비골목까지 천천히 이어갔습니다. 식사는 남문닭갈비 근처로 잡고 숙소는 잭슨나인스호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 혼행 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80', 'chuncheon', 'under_100k', 'solo_trip', '가을', '혼자', '2026-09-13', ARRAY['#춘천', '#혼행', '#삼악산케이블카'], 770, '2026-06-09T16:10:00+09', '2026-06-09T16:10:00+09'),
    ('traveler09', '포항 맛집 중심 하루 코스 021', '호미곶해맞이광장, 이가리닻전망대, 포항물회거리까지 묶은 포항 실제 여행 기록입니다.', '포항 여행은 호미곶해맞이광장에서 시작해 이가리닻전망대까지 천천히 이어갔습니다. 식사는 포항물회거리 근처로 잡고 숙소는 베니키아호텔 포항 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 미식 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=80', 'pohang', 'from_100k_to_200k', 'gourmet', '겨울', '친구', '2026-12-05', ARRAY['#포항', '#미식', '#호미곶해맞이광장'], 620, '2026-06-10T09:20:00+09', '2026-06-10T09:20:00+09'),
    ('traveler10', '경주 노을 데이트 코스 022', '불국사, 황리단길, 황남밀면까지 묶은 경주 실제 여행 기록입니다.', '경주 여행은 불국사에서 시작해 황리단길까지 천천히 이어갔습니다. 식사는 황남밀면 근처로 잡고 숙소는 힐튼 경주 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 데이트 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80', 'gyeongju', 'from_100k_to_200k', 'date', '봄', '연인', '2026-04-03', ARRAY['#경주', '#데이트', '#불국사'], 2100, '2026-06-10T10:55:00+09', '2026-06-10T10:55:00+09'),
    ('traveler11', '통영 쉬어가는 힐링 코스 023', '동피랑벽화마을, 통영중앙시장, 원조할매충무김밥까지 묶은 통영 실제 여행 기록입니다.', '통영 여행은 동피랑벽화마을에서 시작해 통영중앙시장까지 천천히 이어갔습니다. 식사는 원조할매충무김밥 근처로 잡고 숙소는 스탠포드호텔앤리조트 통영 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80', 'tongyeong', 'over_300k', 'healing', '여름', '가족', '2026-08-03', ARRAY['#통영', '#힐링', '#동피랑벽화마을'], 1570, '2026-06-10T13:00:00+09', '2026-06-10T13:00:00+09'),
    ('traveler12', '가평 기념일 숙소 코스 024', '쁘띠프랑스, 청평호, 잣고을막국수까지 묶은 가평 실제 여행 기록입니다.', '가평 여행은 쁘띠프랑스에서 시작해 청평호까지 천천히 이어갔습니다. 식사는 잣고을막국수 근처로 잡고 숙소는 켄싱턴리조트 가평 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 커플 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80', 'gapyeong', 'from_200k_to_300k', 'couple', '가을', '친구', '2026-10-17', ARRAY['#가평', '#커플', '#쁘띠프랑스'], 1330, '2026-06-10T15:30:00+09', '2026-06-10T15:30:00+09')
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
    ('강릉 쉬어가는 힐링 코스 001', 'traveler02', '동선이 현실적이라 바로 참고하기 좋네요.', '2026-06-11T09:00:00+09', '2026-06-11T09:00:00+09'),
    ('강릉 쉬어가는 힐링 코스 001', 'traveler05', '이동이 짧아서 부모님과 같이 가도 괜찮아 보여요.', '2026-06-11T09:08:00+09', '2026-06-11T09:20:00+09'),
    ('제주 가족 여행 짧은 동선 002', 'traveler12', '숙소 기준으로 정리된 점이 특히 좋았습니다.', '2026-06-11T09:30:00+09', '2026-06-11T09:30:00+09'),
    ('부산 노을 데이트 코스 003', 'traveler10', '식사와 쉬는 시간이 같이 보여서 계획하기 편하네요.', '2026-06-11T09:55:00+09', '2026-06-11T09:55:00+09'),
    ('전주 혼자 걷는 리셋 루트 004', 'traveler08', '사진 찍을 곳과 쉬는 곳의 균형이 좋아 보여요.', '2026-06-11T10:10:00+09', '2026-06-11T10:10:00+09'),
    ('여수 맛집 중심 하루 코스 005', 'traveler09', '비슷한 일정으로 다음 여행에 써보고 싶습니다.', '2026-06-11T10:15:00+09', '2026-06-11T10:15:00+09'),
    ('속초 쉬어가는 힐링 코스 006', 'traveler01', '예산 안에서 무리하지 않는 구성이 마음에 듭니다.', '2026-06-11T10:30:00+09', '2026-06-11T10:30:00+09'),
    ('남해 가족 여행 짧은 동선 007', 'traveler06', '날씨가 애매할 때도 참고하기 좋은 코스네요.', '2026-06-11T10:45:00+09', '2026-06-11T11:00:00+09'),
    ('춘천 노을 데이트 코스 008', 'traveler03', '처음 가는 사람도 따라가기 쉽게 정리됐습니다.', '2026-06-11T11:05:00+09', '2026-06-11T11:05:00+09'),
    ('포항 맛집 중심 하루 코스 009', 'traveler07', '가족 여행에서 놓치기 쉬운 휴식 시간이 잘 보입니다.', '2026-06-11T11:18:00+09', '2026-06-11T11:18:00+09'),
    ('경주 쉬어가는 힐링 코스 010', 'traveler04', '혼자 가도 부담이 적은 일정이라 마음에 들어요.', '2026-06-11T11:22:00+09', '2026-06-11T11:22:00+09'),
    ('통영 기념일 숙소 코스 011', 'traveler02', '맛집만 몰아넣지 않고 걷는 시간이 있어 좋네요.', '2026-06-11T11:30:00+09', '2026-06-11T11:43:00+09'),
    ('가평 드라이브 한 바퀴 012', 'traveler11', '주말에 그대로 옮겨도 무리 없을 것 같습니다.', '2026-06-11T11:40:00+09', '2026-06-11T11:40:00+09'),
    ('제주 드라이브 한 바퀴 014', 'traveler01', '대중교통으로도 조정하기 쉬운 흐름처럼 보여요.', '2026-06-11T11:55:00+09', '2026-06-11T11:55:00+09'),
    ('부산 쉬어가는 힐링 코스 015', 'traveler12', '저녁 시간을 여유 있게 둔 점이 마음에 듭니다.', '2026-06-11T12:03:00+09', '2026-06-11T12:03:00+09'),
    ('여수 쉬어가는 힐링 코스 017', 'traveler03', '짧은 여행인데도 핵심이 잘 잡혀 있습니다.', '2026-06-11T12:10:00+09', '2026-06-11T12:10:00+09'),
    ('남해 드라이브 한 바퀴 019', 'traveler04', '아이와 함께 가도 피로도가 낮을 것 같아요.', '2026-06-11T12:17:00+09', '2026-06-11T12:30:00+09'),
    ('춘천 혼자 걷는 리셋 루트 020', 'traveler05', '친구들과 가볍게 다녀오기 좋은 구성입니다.', '2026-06-11T12:28:00+09', '2026-06-11T12:28:00+09')
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
    ('강릉 쉬어가는 힐링 코스 001', '동선이 현실적이라 바로 참고하기 좋네요.', 'traveler01', '맞아요. 그래서 중간 휴식 시간을 일부러 길게 잡았습니다.', '2026-06-11T12:40:00+09', '2026-06-11T12:40:00+09'),
    ('강릉 쉬어가는 힐링 코스 001', '이동이 짧아서 부모님과 같이 가도 괜찮아 보여요.', 'traveler01', '주말에는 조금 일찍 움직이면 훨씬 편합니다.', '2026-06-11T12:45:00+09', '2026-06-11T12:57:00+09'),
    ('제주 가족 여행 짧은 동선 002', '숙소 기준으로 정리된 점이 특히 좋았습니다.', 'traveler02', '차가 없어도 핵심 구간은 충분히 조정할 수 있습니다.', '2026-06-11T13:00:00+09', '2026-06-11T13:00:00+09'),
    ('통영 기념일 숙소 코스 011', '맛집만 몰아넣지 않고 걷는 시간이 있어 좋네요.', 'traveler11', '점심 뒤에 긴 휴식을 넣은 게 제일 도움이 됐습니다.', '2026-06-11T13:08:00+09', '2026-06-11T13:08:00+09'),
    ('남해 드라이브 한 바퀴 019', '아이와 함께 가도 피로도가 낮을 것 같아요.', 'traveler07', '성수기에는 식당 예약만 먼저 챙기면 괜찮습니다.', '2026-06-11T13:15:00+09', '2026-06-11T13:15:00+09'),
    ('여수 맛집 중심 하루 코스 005', '비슷한 일정으로 다음 여행에 써보고 싶습니다.', 'traveler05', '사진 욕심을 줄이면 더 여유롭게 다녀올 수 있습니다.', '2026-06-11T13:20:00+09', '2026-06-11T13:20:00+09')
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
    ('traveler01', '제주 가족 여행 짧은 동선 002', '2026-06-11T13:30:00+09'),
    ('traveler01', '부산 노을 데이트 코스 003', '2026-06-11T13:31:00+09'),
    ('traveler02', '강릉 쉬어가는 힐링 코스 001', '2026-06-11T13:32:00+09'),
    ('traveler02', '경주 노을 데이트 코스 022', '2026-06-11T13:33:00+09'),
    ('traveler03', '여수 맛집 중심 하루 코스 005', '2026-06-11T13:34:00+09'),
    ('traveler03', '통영 기념일 숙소 코스 011', '2026-06-11T13:35:00+09'),
    ('traveler04', '춘천 노을 데이트 코스 008', '2026-06-11T13:36:00+09'),
    ('traveler05', '속초 쉬어가는 힐링 코스 006', '2026-06-11T13:37:00+09'),
    ('traveler06', '남해 가족 여행 짧은 동선 007', '2026-06-11T13:38:00+09'),
    ('traveler07', '가평 드라이브 한 바퀴 012', '2026-06-11T13:39:00+09'),
    ('traveler08', '전주 혼자 걷는 리셋 루트 004', '2026-06-11T13:40:00+09'),
    ('traveler09', '부산 쉬어가는 힐링 코스 015', '2026-06-11T13:41:00+09'),
    ('traveler10', '여수 쉬어가는 힐링 코스 017', '2026-06-11T13:42:00+09'),
    ('traveler11', '제주 드라이브 한 바퀴 014', '2026-06-11T13:43:00+09'),
    ('traveler12', '강릉 기념일 숙소 코스 013', '2026-06-11T13:44:00+09')
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
    ('traveler01', '강릉 노을 데이트 코스 025', '오죽헌, 선교장, 초당순두부마을까지 묶은 강릉 실제 여행 기록입니다.', '강릉 여행은 오죽헌에서 시작해 선교장까지 천천히 이어갔습니다. 식사는 초당순두부마을 근처로 잡고 숙소는 씨마크호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 데이트 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80', 'gangneung', 'under_100k', 'date', '봄', '친구', '2026-04-19', ARRAY['#강릉', '#데이트', '#오죽헌'], 980, '2026-06-11T14:20:00+09', '2026-06-11T14:20:00+09'),
    ('traveler02', '강릉 맛집 중심 하루 코스 026', '하슬라아트월드, 강릉중앙시장, 동화가든까지 묶은 강릉 실제 여행 기록입니다.', '강릉 여행은 하슬라아트월드에서 시작해 강릉중앙시장까지 천천히 이어갔습니다. 식사는 동화가든 근처로 잡고 숙소는 세인트존스호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 미식 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', 'gangneung', 'from_100k_to_200k', 'gourmet', '여름', '친구', '2026-07-27', ARRAY['#강릉', '#미식', '#하슬라아트월드'], 1260, '2026-06-11T14:30:00+09', '2026-06-11T14:30:00+09'),
    ('traveler03', '제주 쉬어가는 힐링 코스 027', '섭지코지, 월정리해변, 우진해장국까지 묶은 제주 실제 여행 기록입니다.', '제주 여행은 섭지코지에서 시작해 월정리해변까지 천천히 이어갔습니다. 식사는 우진해장국 근처로 잡고 숙소는 신라호텔 제주 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80', 'jeju', 'from_200k_to_300k', 'healing', '봄', '연인', '2026-05-04', ARRAY['#제주', '#힐링', '#섭지코지'], 1470, '2026-06-11T14:40:00+09', '2026-06-11T14:40:00+09'),
    ('traveler04', '제주 가족 여행 짧은 동선 028', '오설록티뮤지엄, 만장굴, 돈사돈까지 묶은 제주 실제 여행 기록입니다.', '제주 여행은 오설록티뮤지엄에서 시작해 만장굴까지 천천히 이어갔습니다. 식사는 돈사돈 근처로 잡고 숙소는 메종글래드 제주 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 가족 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=900&q=80', 'jeju', 'from_100k_to_200k', 'family', '여름', '가족', '2026-07-10', ARRAY['#제주', '#가족', '#오설록티뮤지엄'], 1080, '2026-06-11T14:50:00+09', '2026-06-11T14:50:00+09'),
    ('traveler05', '부산 노을 데이트 코스 029', '감천문화마을, 흰여울문화마을, 해운대암소갈비집까지 묶은 부산 실제 여행 기록입니다.', '부산 여행은 감천문화마을에서 시작해 흰여울문화마을까지 천천히 이어갔습니다. 식사는 해운대암소갈비집 근처로 잡고 숙소는 파라다이스호텔 부산 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 데이트 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80', 'busan', 'from_200k_to_300k', 'date', '봄', '연인', '2026-05-11', ARRAY['#부산', '#데이트', '#감천문화마을'], 1710, '2026-06-11T15:00:00+09', '2026-06-11T15:00:00+09'),
    ('traveler06', '부산 드라이브 한 바퀴 030', '해동용궁사, 동백섬, 할매가야밀면까지 묶은 부산 실제 여행 기록입니다.', '부산 여행은 해동용궁사에서 시작해 동백섬까지 천천히 이어갔습니다. 식사는 할매가야밀면 근처로 잡고 숙소는 파크하얏트 부산 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 드라이브 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80', 'busan', 'from_100k_to_200k', 'drive', '가을', '친구', '2026-09-06', ARRAY['#부산', '#드라이브', '#해동용궁사'], 1390, '2026-06-11T15:10:00+09', '2026-06-11T15:10:00+09'),
    ('traveler07', '전주 맛집 중심 하루 코스 031', '전동성당, 자만벽화마을, 베테랑칼국수까지 묶은 전주 실제 여행 기록입니다.', '전주 여행은 전동성당에서 시작해 자만벽화마을까지 천천히 이어갔습니다. 식사는 베테랑칼국수 근처로 잡고 숙소는 라한호텔 전주 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 미식 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80', 'jeonju', 'under_100k', 'gourmet', '봄', '친구', '2026-04-15', ARRAY['#전주', '#미식', '#전동성당'], 760, '2026-06-11T15:20:00+09', '2026-06-11T15:20:00+09'),
    ('traveler08', '전주 쉬어가는 힐링 코스 032', '객리단길, 전주향교, 길거리야까지 묶은 전주 실제 여행 기록입니다.', '전주 여행은 객리단길에서 시작해 전주향교까지 천천히 이어갔습니다. 식사는 길거리야 근처로 잡고 숙소는 전주관광호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80', 'jeonju', 'from_200k_to_300k', 'healing', '가을', '혼자', '2026-10-08', ARRAY['#전주', '#힐링', '#객리단길'], 920, '2026-06-11T15:30:00+09', '2026-06-11T15:30:00+09'),
    ('traveler09', '여수 노을 데이트 코스 033', '돌산공원, 향일암, 낭만포차거리까지 묶은 여수 실제 여행 기록입니다.', '여수 여행은 돌산공원에서 시작해 향일암까지 천천히 이어갔습니다. 식사는 낭만포차거리 근처로 잡고 숙소는 라마다프라자 여수 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 데이트 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80', 'yeosu', 'from_100k_to_200k', 'date', '여름', '친구', '2026-08-01', ARRAY['#여수', '#데이트', '#돌산공원'], 1180, '2026-06-11T15:40:00+09', '2026-06-11T15:40:00+09'),
    ('traveler10', '여수 가족 여행 짧은 동선 034', '낭만포차거리, 이순신광장, 여수당까지 묶은 여수 실제 여행 기록입니다.', '여수 여행은 낭만포차거리에서 시작해 이순신광장까지 천천히 이어갔습니다. 식사는 여수당 근처로 잡고 숙소는 히든베이호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 가족 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80', 'yeosu', 'from_200k_to_300k', 'family', '봄', '가족', '2026-05-24', ARRAY['#여수', '#가족', '#낭만포차거리'], 1280, '2026-06-11T15:50:00+09', '2026-06-11T15:50:00+09'),
    ('traveler11', '속초 쉬어가는 힐링 코스 035', '영금정, 대포항, 아바이순대타운까지 묶은 속초 실제 여행 기록입니다.', '속초 여행은 영금정에서 시작해 대포항까지 천천히 이어갔습니다. 식사는 아바이순대타운 근처로 잡고 숙소는 라마다 속초호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=80', 'sokcho', 'from_100k_to_200k', 'healing', '가을', '연인', '2026-09-28', ARRAY['#속초', '#힐링', '#영금정'], 1010, '2026-06-11T16:00:00+09', '2026-06-11T16:00:00+09'),
    ('traveler12', '속초 맛집 중심 하루 코스 036', '속초관광수산시장, 속초아이, 팔팔생선구이까지 묶은 속초 실제 여행 기록입니다.', '속초 여행은 속초관광수산시장에서 시작해 속초아이까지 천천히 이어갔습니다. 식사는 팔팔생선구이 근처로 잡고 숙소는 롯데리조트 속초 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 미식 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80', 'sokcho', 'under_100k', 'gourmet', '봄', '친구', '2026-03-30', ARRAY['#속초', '#미식', '#속초관광수산시장'], 860, '2026-06-11T16:10:00+09', '2026-06-11T16:10:00+09'),
    ('traveler01', '남해 드라이브 한 바퀴 037', '보리암, 물건방조어부림, 남해전통시장까지 묶은 남해 실제 여행 기록입니다.', '남해 여행은 보리암에서 시작해 물건방조어부림까지 천천히 이어갔습니다. 식사는 남해전통시장 근처로 잡고 숙소는 사우스케이프 스파앤스위트 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 드라이브 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80', 'namhae', 'from_100k_to_200k', 'drive', '봄', '친구', '2026-04-05', ARRAY['#남해', '#드라이브', '#보리암'], 970, '2026-06-11T16:20:00+09', '2026-06-11T16:20:00+09'),
    ('traveler02', '남해 쉬어가는 힐링 코스 038', '상주은모래비치, 섬이정원, 남해마늘하우스까지 묶은 남해 실제 여행 기록입니다.', '남해 여행은 상주은모래비치에서 시작해 섬이정원까지 천천히 이어갔습니다. 식사는 남해마늘하우스 근처로 잡고 숙소는 이제 남해 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80', 'namhae', 'under_100k', 'healing', '봄', '친구', '2026-04-13', ARRAY['#남해', '#힐링', '#상주은모래비치'], 790, '2026-06-11T16:30:00+09', '2026-06-11T16:30:00+09'),
    ('traveler03', '춘천 노을 데이트 코스 039', '공지천, 의암호, 남문닭갈비까지 묶은 춘천 실제 여행 기록입니다.', '춘천 여행은 공지천에서 시작해 의암호까지 천천히 이어갔습니다. 식사는 남문닭갈비 근처로 잡고 숙소는 세종호텔 춘천 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 데이트 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', 'chuncheon', 'from_100k_to_200k', 'date', '여름', '친구', '2026-07-15', ARRAY['#춘천', '#데이트', '#공지천'], 1140, '2026-06-11T16:40:00+09', '2026-06-11T16:40:00+09'),
    ('traveler04', '춘천 가족 여행 짧은 동선 040', '레고랜드코리아, 제이드가든, 춘천명동닭갈비골목까지 묶은 춘천 실제 여행 기록입니다.', '춘천 여행은 레고랜드코리아에서 시작해 제이드가든까지 천천히 이어갔습니다. 식사는 춘천명동닭갈비골목 근처로 잡고 숙소는 벨라스테이호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 가족 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80', 'chuncheon', 'from_200k_to_300k', 'family', '봄', '가족', '2026-05-16', ARRAY['#춘천', '#가족', '#레고랜드코리아'], 1560, '2026-06-11T16:50:00+09', '2026-06-11T16:50:00+09'),
    ('traveler05', '포항 쉬어가는 힐링 코스 041', '죽도시장, 포항운하, 영일대카페거리까지 묶은 포항 실제 여행 기록입니다.', '포항 여행은 죽도시장에서 시작해 포항운하까지 천천히 이어갔습니다. 식사는 영일대카페거리 근처로 잡고 숙소는 베니키아호텔 포항 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80', 'pohang', 'under_100k', 'healing', '여름', '혼자', '2026-07-08', ARRAY['#포항', '#힐링', '#죽도시장'], 840, '2026-06-11T17:00:00+09', '2026-06-11T17:00:00+09'),
    ('traveler06', '포항 드라이브 한 바퀴 042', '영일대해수욕장, 내연산, 죽도시장까지 묶은 포항 실제 여행 기록입니다.', '포항 여행은 영일대해수욕장에서 시작해 내연산까지 천천히 이어갔습니다. 식사는 죽도시장 근처로 잡고 숙소는 라한호텔 포항 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 드라이브 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=900&q=80', 'pohang', 'from_100k_to_200k', 'drive', '가을', '친구', '2026-10-01', ARRAY['#포항', '#드라이브', '#영일대해수욕장'], 690, '2026-06-11T17:10:00+09', '2026-06-11T17:10:00+09'),
    ('traveler07', '경주 노을 데이트 코스 043', '대릉원, 보문호수, 황남빵까지 묶은 경주 실제 여행 기록입니다.', '경주 여행은 대릉원에서 시작해 보문호수까지 천천히 이어갔습니다. 식사는 황남빵 근처로 잡고 숙소는 라한셀렉트 경주 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 데이트 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=900&q=80', 'gyeongju', 'under_100k', 'date', '가을', '연인', '2026-10-09', ARRAY['#경주', '#데이트', '#대릉원'], 1440, '2026-06-11T17:20:00+09', '2026-06-11T17:20:00+09'),
    ('traveler08', '경주 쉬어가는 힐링 코스 044', '동궁과월지, 경주국립박물관, 황남밀면까지 묶은 경주 실제 여행 기록입니다.', '경주 여행은 동궁과월지에서 시작해 경주국립박물관까지 천천히 이어갔습니다. 식사는 황남밀면 근처로 잡고 숙소는 힐튼 경주 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=80', 'gyeongju', 'from_100k_to_200k', 'healing', '봄', '혼자', '2026-04-17', ARRAY['#경주', '#힐링', '#동궁과월지'], 930, '2026-06-11T17:30:00+09', '2026-06-11T17:30:00+09'),
    ('traveler09', '통영 맛집 중심 하루 코스 045', '미륵산, 남망산조각공원, 통영굴골목까지 묶은 통영 실제 여행 기록입니다.', '통영 여행은 미륵산에서 시작해 남망산조각공원까지 천천히 이어갔습니다. 식사는 통영굴골목 근처로 잡고 숙소는 한산호텔 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 미식 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80', 'tongyeong', 'from_100k_to_200k', 'gourmet', '봄', '친구', '2026-05-09', ARRAY['#통영', '#미식', '#미륵산'], 1070, '2026-06-11T17:40:00+09', '2026-06-11T17:40:00+09'),
    ('traveler10', '통영 가족 여행 짧은 동선 046', '이순신공원, 서호시장, 통영중앙시장까지 묶은 통영 실제 여행 기록입니다.', '통영 여행은 이순신공원에서 시작해 서호시장까지 천천히 이어갔습니다. 식사는 통영중앙시장 근처로 잡고 숙소는 금호통영마리나리조트 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 가족 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80', 'tongyeong', 'from_200k_to_300k', 'family', '여름', '가족', '2026-08-21', ARRAY['#통영', '#가족', '#이순신공원'], 1510, '2026-06-11T17:50:00+09', '2026-06-11T17:50:00+09'),
    ('traveler11', '가평 쉬어가는 힐링 코스 047', '아침고요수목원, 에델바이스스위스테마파크, 잣고을막국수까지 묶은 가평 실제 여행 기록입니다.', '가평 여행은 아침고요수목원에서 시작해 에델바이스스위스테마파크까지 천천히 이어갔습니다. 식사는 잣고을막국수 근처로 잡고 숙소는 켄싱턴리조트 가평 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 힐링 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80', 'gapyeong', 'from_200k_to_300k', 'healing', '여름', '연인', '2026-08-29', ARRAY['#가평', '#힐링', '#아침고요수목원'], 1190, '2026-06-11T18:00:00+09', '2026-06-11T18:00:00+09'),
    ('traveler12', '가평 혼자 걷는 리셋 루트 048', '자라섬, 호명호수, 자라섬카페거리까지 묶은 가평 실제 여행 기록입니다.', '가평 여행은 자라섬에서 시작해 호명호수까지 천천히 이어갔습니다. 식사는 자라섬카페거리 근처로 잡고 숙소는 마이다스호텔앤리조트 주변을 기준으로 정해 이동을 줄였습니다. 사진 찍는 시간과 쉬는 시간을 넉넉히 두어서 혼행 여행으로 쓰기 좋았습니다.', 'https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=900&q=80', 'gapyeong', 'under_100k', 'solo_trip', '봄', '친구', '2026-04-26', ARRAY['#가평', '#혼행', '#자라섬'], 720, '2026-06-11T18:10:00+09', '2026-06-11T18:10:00+09')
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
    ('강릉 노을 데이트 코스 025', 'traveler03', '기념일 코스로도 충분히 분위기가 날 것 같아요.', '2026-06-11T18:20:00+09', '2026-06-11T18:20:00+09'),
    ('강릉 노을 데이트 코스 025', 'traveler08', '시장과 산책을 같이 묶은 점이 실용적입니다.', '2026-06-11T18:22:00+09', '2026-06-11T18:35:00+09'),
    ('강릉 맛집 중심 하루 코스 026', 'traveler11', '성수기에는 시간을 조금 앞당기면 더 좋겠네요.', '2026-06-11T18:24:00+09', '2026-06-11T18:24:00+09'),
    ('제주 쉬어가는 힐링 코스 027', 'traveler06', '숙소 주변 동선이 단순해서 길 찾기 편해 보여요.', '2026-06-11T18:26:00+09', '2026-06-11T18:26:00+09'),
    ('제주 가족 여행 짧은 동선 028', 'traveler09', '사진 명소가 과하지 않아서 오히려 좋습니다.', '2026-06-11T18:28:00+09', '2026-06-11T18:28:00+09'),
    ('부산 노을 데이트 코스 029', 'traveler02', '하루 일정으로 줄여도 핵심은 남을 것 같아요.', '2026-06-11T18:30:00+09', '2026-06-11T18:30:00+09'),
    ('부산 드라이브 한 바퀴 030', 'traveler12', '다음에는 비슷한 코스로 북마크해두겠습니다.', '2026-06-11T18:32:00+09', '2026-06-11T18:32:00+09'),
    ('전주 맛집 중심 하루 코스 031', 'traveler01', '실제 다녀온 느낌이 나서 신뢰가 갑니다.', '2026-06-11T18:34:00+09', '2026-06-11T18:34:00+09'),
    ('전주 쉬어가는 힐링 코스 032', 'traveler05', '걷는 시간이 길지 않아 어르신과도 괜찮겠네요.', '2026-06-11T18:36:00+09', '2026-06-11T18:36:00+09'),
    ('여수 노을 데이트 코스 033', 'traveler04', '카페 휴식이 중간에 있어 일정이 덜 빡빡해 보여요.', '2026-06-11T18:38:00+09', '2026-06-11T18:38:00+09'),
    ('여수 가족 여행 짧은 동선 034', 'traveler07', '아침부터 저녁까지 흐름이 자연스럽습니다.', '2026-06-11T18:40:00+09', '2026-06-11T18:52:00+09'),
    ('속초 쉬어가는 힐링 코스 035', 'traveler10', '처음 보는 지역인데도 감이 잘 잡힙니다.', '2026-06-11T18:42:00+09', '2026-06-11T18:42:00+09'),
    ('속초 맛집 중심 하루 코스 036', 'traveler03', '동선이 현실적이라 바로 참고하기 좋네요.', '2026-06-11T18:44:00+09', '2026-06-11T18:44:00+09'),
    ('남해 드라이브 한 바퀴 037', 'traveler06', '이동이 짧아서 부모님과 같이 가도 괜찮아 보여요.', '2026-06-11T18:46:00+09', '2026-06-11T18:46:00+09'),
    ('남해 쉬어가는 힐링 코스 038', 'traveler08', '숙소 기준으로 정리된 점이 특히 좋았습니다.', '2026-06-11T18:48:00+09', '2026-06-11T19:00:00+09'),
    ('춘천 노을 데이트 코스 039', 'traveler05', '식사와 쉬는 시간이 같이 보여서 계획하기 편하네요.', '2026-06-11T18:50:00+09', '2026-06-11T18:50:00+09'),
    ('춘천 가족 여행 짧은 동선 040', 'traveler09', '사진 찍을 곳과 쉬는 곳의 균형이 좋아 보여요.', '2026-06-11T18:52:00+09', '2026-06-11T18:52:00+09'),
    ('포항 쉬어가는 힐링 코스 041', 'traveler02', '비슷한 일정으로 다음 여행에 써보고 싶습니다.', '2026-06-11T18:54:00+09', '2026-06-11T18:54:00+09'),
    ('포항 드라이브 한 바퀴 042', 'traveler11', '예산 안에서 무리하지 않는 구성이 마음에 듭니다.', '2026-06-11T18:56:00+09', '2026-06-11T18:56:00+09'),
    ('경주 노을 데이트 코스 043', 'traveler01', '날씨가 애매할 때도 참고하기 좋은 코스네요.', '2026-06-11T18:58:00+09', '2026-06-11T18:58:00+09'),
    ('경주 쉬어가는 힐링 코스 044', 'traveler12', '처음 가는 사람도 따라가기 쉽게 정리됐습니다.', '2026-06-11T19:00:00+09', '2026-06-11T19:00:00+09'),
    ('통영 맛집 중심 하루 코스 045', 'traveler04', '가족 여행에서 놓치기 쉬운 휴식 시간이 잘 보입니다.', '2026-06-11T19:02:00+09', '2026-06-11T19:02:00+09'),
    ('통영 가족 여행 짧은 동선 046', 'traveler07', '혼자 가도 부담이 적은 일정이라 마음에 들어요.', '2026-06-11T19:04:00+09', '2026-06-11T19:04:00+09'),
    ('가평 쉬어가는 힐링 코스 047', 'traveler10', '맛집만 몰아넣지 않고 걷는 시간이 있어 좋네요.', '2026-06-11T19:06:00+09', '2026-06-11T19:06:00+09'),
    ('가평 혼자 걷는 리셋 루트 048', 'traveler03', '주말에 그대로 옮겨도 무리 없을 것 같습니다.', '2026-06-11T19:08:00+09', '2026-06-11T19:08:00+09')
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
    ('강릉 노을 데이트 코스 025', '시장과 산책을 같이 묶은 점이 실용적입니다.', 'traveler01', '부모님과 간다면 숙소 가까운 식당을 추천합니다.', '2026-06-11T19:10:00+09', '2026-06-11T19:22:00+09'),
    ('여수 가족 여행 짧은 동선 034', '아침부터 저녁까지 흐름이 자연스럽습니다.', 'traveler10', '비 오는 날에는 실내 코스 하나를 더 넣으면 안정적입니다.', '2026-06-11T19:12:00+09', '2026-06-11T19:12:00+09'),
    ('남해 쉬어가는 힐링 코스 038', '숙소 기준으로 정리된 점이 특히 좋았습니다.', 'traveler02', '저도 다음에는 카페 시간을 조금 더 늘려보려고 합니다.', '2026-06-11T19:14:00+09', '2026-06-11T19:14:00+09'),
    ('부산 노을 데이트 코스 029', '하루 일정으로 줄여도 핵심은 남을 것 같아요.', 'traveler05', '오전 출발 기준으로 잡으면 하루 코스로도 가능합니다.', '2026-06-11T19:16:00+09', '2026-06-11T19:16:00+09'),
    ('경주 노을 데이트 코스 043', '날씨가 애매할 때도 참고하기 좋은 코스네요.', 'traveler07', '맞아요. 그래서 중간 휴식 시간을 일부러 길게 잡았습니다.', '2026-06-11T19:18:00+09', '2026-06-11T19:18:00+09'),
    ('통영 가족 여행 짧은 동선 046', '혼자 가도 부담이 적은 일정이라 마음에 들어요.', 'traveler10', '주말에는 조금 일찍 움직이면 훨씬 편합니다.', '2026-06-11T19:20:00+09', '2026-06-11T19:20:00+09')
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
