BEGIN;

INSERT INTO posts (
  author_id,
  title,
  summary,
  content,
  image_url,
  region_id,
  budget_range_id,
  theme_id,
  season,
  companion,
  travel_date,
  tags,
  view_count,
  created_at,
  updated_at
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
    ('1234', 'Jeju sunrise route for two', 'A calm Jeju route with cafe stops and coastal walks.', 'Started near Seongsan at sunrise, had brunch nearby, then moved along the coast for a slow afternoon. Good for couples who want a quiet schedule.', 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80', 'jeju', 'from_100k_to_200k', 'date', '봄', '연인', '2026-04-12', ARRAY['#jeju', '#date', '#couple'], 82, '2026-06-01 09:10:00+09', '2026-06-01 09:10:00+09'),
    ('testuser1', 'Busan one day food crawl', 'Markets, pork soup, and a late-night beach walk.', 'This route worked well with two friends. We stayed light on transport and focused on food spots around Jagalchi and Seomyeon.', 'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80', 'busan', 'from_100k_to_200k', 'gourmet', '여름', '친구', '2026-07-09', ARRAY['#busan', '#food', '#friend'], 131, '2026-06-01 14:30:00+09', '2026-06-01 14:30:00+09'),
    ('signupcheck2', 'Jeonju hanok slow weekend', 'Hanok stay, bibimbap, and a relaxed evening walk.', 'Stayed near the hanok village and planned only two major stops per day. Good for family trips that do not want a tight schedule.', 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=900&q=80', 'jeonju', 'from_200k_to_300k', 'family', '가을', '가족', '2026-10-03', ARRAY['#jeonju', '#family', '#hanok'], 64, '2026-06-02 10:15:00+09', '2026-06-02 10:15:00+09'),
    ('authdemo20260611111435', 'Yeosu night sea with friends', 'Cable car, sea view, and easy night course.', 'The night view was the main point. We moved slowly and kept the budget moderate. This worked well for a small friend group.', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80', 'yeosu', 'from_100k_to_200k', 'healing', '여름', '친구', '2026-08-18', ARRAY['#yeosu', '#healing', '#friend'], 97, '2026-06-02 18:00:00+09', '2026-06-02 18:00:00+09'),
    ('1234', 'Sokcho healing trip under budget', 'Beach, market, and a short mountain view course.', 'Planned for a simple overnight trip. Cheap stay, market breakfast, beach time, and one observatory stop.', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80', 'sokcho', 'under_100k', 'healing', '겨울', '혼자', '2026-12-11', ARRAY['#sokcho', '#healing', '#solo'], 55, '2026-06-03 08:20:00+09', '2026-06-03 08:20:00+09'),
    ('testuser1', 'Namhae drive course for parents', 'Scenic roads and easy cafe stops for a family drive.', 'Best part was that the drive itself was the content. Little walking, lots of viewpoints, and enough time for breaks.', 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', 'namhae', 'from_200k_to_300k', 'drive', '봄', '가족', '2026-05-05', ARRAY['#namhae', '#drive', '#family'], 73, '2026-06-03 16:40:00+09', '2026-06-03 16:40:00+09'),
    ('signupcheck2', 'Chuncheon solo cafe and lake day', 'A quiet solo route around the lake and small cafes.', 'This is good when you want low noise and a simple route. Walking path was easy and the overall pace stayed relaxed.', 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=900&q=80', 'chuncheon', 'under_100k', 'solo_trip', '봄', '혼자', '2026-04-21', ARRAY['#chuncheon', '#solo', '#lake'], 61, '2026-06-04 11:00:00+09', '2026-06-04 11:00:00+09'),
    ('authdemo20260611111435', 'Pohang sunrise and market route', 'Simple morning route with seafood market finish.', 'Woke up early for the coast, kept the route short, and ended with an easy lunch near the market.', 'https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=900&q=80', 'pohang', 'under_100k', 'gourmet', '여름', '친구', '2026-07-14', ARRAY['#pohang', '#sunrise', '#food'], 88, '2026-06-04 15:20:00+09', '2026-06-04 15:20:00+09'),
    ('1234', 'Gyeongju history walk for couples', 'Temple, old town, and evening photo spots.', 'If you like taking photos and moving mostly on foot, this route is balanced and not too tiring.', 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=900&q=80', 'gyeongju', 'from_100k_to_200k', 'date', '가을', '연인', '2026-10-16', ARRAY['#gyeongju', '#date', '#walk'], 112, '2026-06-05 09:45:00+09', '2026-06-05 09:45:00+09'),
    ('testuser1', 'Tongyeong cable car and harbor day', 'Harbor views, art village, and easy seafood dinner.', 'This schedule worked as a light one-day trip. Minimal rushing and enough view points for photos.', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80', 'tongyeong', 'from_100k_to_200k', 'healing', '봄', '친구', '2026-05-22', ARRAY['#tongyeong', '#healing', '#harbor'], 79, '2026-06-05 17:35:00+09', '2026-06-05 17:35:00+09'),
    ('signupcheck2', 'Gapyeong pension trip with family', 'Short pension stay, barbecue, and nearby valley walk.', 'This is less about moving around and more about resting together. Good for one-night family plans.', 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80', 'gapyeong', 'over_300k', 'family', '여름', '가족', '2026-08-02', ARRAY['#gapyeong', '#family', '#pension'], 58, '2026-06-06 10:10:00+09', '2026-06-06 10:10:00+09'),
    ('authdemo20260611111435', 'Gangneung cafe and beach loop', 'Coffee spots, beach walk, and sunset timing.', 'This is an easy route to repeat. Few transfers, decent food nearby, and a reliable sunset finish.', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80', 'gangneung', 'from_100k_to_200k', 'healing', '여름', '친구', '2026-06-20', ARRAY['#gangneung', '#beach', '#cafe'], 143, '2026-06-06 19:20:00+09', '2026-06-06 19:20:00+09'),
    ('1234', 'Jeju family museum and coast plan', 'Indoor and outdoor mix for unstable weather.', 'Added indoor stops so the route still works when the weather turns bad. Family friendly and not too expensive.', 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80', 'jeju', 'from_200k_to_300k', 'family', '겨울', '가족', '2026-01-17', ARRAY['#jeju', '#family', '#museum'], 69, '2026-06-07 09:00:00+09', '2026-06-07 09:00:00+09'),
    ('testuser1', 'Busan date course near the sea', 'Sunset, light dinner, and photo-friendly stops.', 'A simple sea-facing course for couples who want something safe and not overly packed.', 'https://images.unsplash.com/photo-1473116763249-2faaef81ccda?auto=format&fit=crop&w=900&q=80', 'busan', 'from_200k_to_300k', 'date', '봄', '연인', '2026-05-29', ARRAY['#busan', '#date', '#sea'], 118, '2026-06-08 13:10:00+09', '2026-06-08 13:10:00+09'),
    ('signupcheck2', 'Yeosu solo healing overnight', 'Quiet stay, sea walk, and a slow brunch.', 'Good when you want one night alone without a packed schedule. The route is easy to shorten if needed.', 'https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80', 'yeosu', 'from_100k_to_200k', 'solo_trip', '가을', '혼자', '2026-09-12', ARRAY['#yeosu', '#solo', '#healing'], 74, '2026-06-09 08:50:00+09', '2026-06-09 08:50:00+09'),
    ('authdemo20260611111435', 'Jeonju budget foodie route', 'Affordable meals and easy walking line.', 'Built this route for students. The key is that transport cost stays low and food quality is still strong.', 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=900&q=80', 'jeonju', 'under_100k', 'gourmet', '겨울', '친구', '2026-02-06', ARRAY['#jeonju', '#budget', '#food'], 91, '2026-06-09 18:45:00+09', '2026-06-09 18:45:00+09'),
    ('1234', 'Sokcho winter seafood run', 'Market breakfast, hot soup, and short sea walk.', 'Cold season route that keeps outdoor time short. Food-first schedule with easy access.', 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80', 'sokcho', 'from_100k_to_200k', 'gourmet', '겨울', '친구', '2026-12-23', ARRAY['#sokcho', '#winter', '#food'], 67, '2026-06-10 07:30:00+09', '2026-06-10 07:30:00+09'),
    ('testuser1', 'Gyeongju night date and cafe route', 'Night lights, dessert, and quiet streets.', 'The route starts late afternoon and works best when you want a slower evening date.', 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=900&q=80', 'gyeongju', 'from_100k_to_200k', 'date', '봄', '연인', '2026-05-16', ARRAY['#gyeongju', '#night', '#date'], 102, '2026-06-10 20:15:00+09', '2026-06-10 20:15:00+09')
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
    ('Jeju sunrise route for two', 'testuser1', 'The pacing on this one looks good. Was parking easy in the morning?', '2026-06-01 10:00:00+09', '2026-06-01 10:00:00+09'),
    ('Jeju sunrise route for two', 'signupcheck2', 'I like that this route avoids stuffing too many stops into one day.', '2026-06-01 11:30:00+09', '2026-06-01 11:30:00+09'),
    ('Busan one day food crawl', '1234', 'This one feels realistic. Most food posts forget travel time between spots.', '2026-06-01 16:00:00+09', '2026-06-01 16:00:00+09'),
    ('Busan one day food crawl', 'authdemo20260611111435', 'Adding a late beach walk at the end was a good call.', '2026-06-01 17:20:00+09', '2026-06-01 17:20:00+09'),
    ('Jeonju hanok slow weekend', 'testuser1', 'Would this still work with parents who do not like much walking?', '2026-06-02 12:10:00+09', '2026-06-02 12:10:00+09'),
    ('Yeosu night sea with friends', '1234', 'Night view content is always useful. How crowded was it?', '2026-06-02 20:00:00+09', '2026-06-02 20:00:00+09'),
    ('Sokcho healing trip under budget', 'signupcheck2', 'Under 100k and still overnight is solid. Saving this one.', '2026-06-03 09:15:00+09', '2026-06-03 09:15:00+09'),
    ('Namhae drive course for parents', 'authdemo20260611111435', 'This is the kind of route I needed for a parent trip.', '2026-06-03 18:10:00+09', '2026-06-03 18:10:00+09'),
    ('Chuncheon solo cafe and lake day', '1234', 'Good call keeping the route short. Solo day trips get tiring fast otherwise.', '2026-06-04 12:00:00+09', '2026-06-04 12:00:00+09'),
    ('Pohang sunrise and market route', 'testuser1', 'Sunrise plus market is a clean combo. Nice.', '2026-06-04 16:10:00+09', '2026-06-04 16:10:00+09'),
    ('Gyeongju history walk for couples', 'signupcheck2', 'Photo spots matter more than people admit. Helpful post.', '2026-06-05 10:20:00+09', '2026-06-05 10:20:00+09'),
    ('Tongyeong cable car and harbor day', '1234', 'This looks like a good starter route for first-timers.', '2026-06-05 18:00:00+09', '2026-06-05 18:00:00+09'),
    ('Gapyeong pension trip with family', 'testuser1', 'The resting-focused angle is nice. Too many plans overschedule family trips.', '2026-06-06 11:30:00+09', '2026-06-06 11:30:00+09'),
    ('Gangneung cafe and beach loop', 'signupcheck2', 'I can see why this one has high views. Easy to copy and paste into a real trip.', '2026-06-06 20:10:00+09', '2026-06-06 20:10:00+09'),
    ('Jeju family museum and coast plan', 'testuser1', 'Indoor backup stops make this much more usable.', '2026-06-07 10:40:00+09', '2026-06-07 10:40:00+09'),
    ('Busan date course near the sea', '1234', 'Simple is better for date routes. Good balance.', '2026-06-08 14:25:00+09', '2026-06-08 14:25:00+09'),
    ('Yeosu solo healing overnight', 'authdemo20260611111435', 'This one feels calm just reading it.', '2026-06-09 09:30:00+09', '2026-06-09 09:30:00+09'),
    ('Jeonju budget foodie route', 'testuser1', 'Student budget routes are always welcome.', '2026-06-09 20:10:00+09', '2026-06-09 20:10:00+09'),
    ('Sokcho winter seafood run', 'signupcheck2', 'Food-first winter route makes sense.', '2026-06-10 08:10:00+09', '2026-06-10 08:10:00+09'),
    ('Gyeongju night date and cafe route', '1234', 'Evening-first schedules are underrated.', '2026-06-10 21:00:00+09', '2026-06-10 21:00:00+09')
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
    ('Jeju sunrise route for two', 'The pacing on this one looks good. Was parking easy in the morning?', '1234', 'Yes. We parked near the first stop before 7am and had no issue.', '2026-06-01 10:20:00+09', '2026-06-01 10:20:00+09'),
    ('Busan one day food crawl', 'This one feels realistic. Most food posts forget travel time between spots.', 'testuser1', 'That was the main thing I tried to fix.', '2026-06-01 16:30:00+09', '2026-06-01 16:30:00+09'),
    ('Jeonju hanok slow weekend', 'Would this still work with parents who do not like much walking?', 'signupcheck2', 'Yes. A taxi-heavy version still works.', '2026-06-02 12:45:00+09', '2026-06-02 12:45:00+09'),
    ('Yeosu night sea with friends', 'Night view content is always useful. How crowded was it?', 'authdemo20260611111435', 'Manageable on weekdays, much denser on weekends.', '2026-06-02 20:20:00+09', '2026-06-02 20:20:00+09'),
    ('Sokcho healing trip under budget', 'Under 100k and still overnight is solid. Saving this one.', '1234', 'Off-season stay price helped a lot.', '2026-06-03 09:40:00+09', '2026-06-03 09:40:00+09'),
    ('Gangneung cafe and beach loop', 'I can see why this one has high views. Easy to copy and paste into a real trip.', 'authdemo20260611111435', 'That was the intention. Minimal moving parts.', '2026-06-06 20:35:00+09', '2026-06-06 20:35:00+09'),
    ('Busan date course near the sea', 'Simple is better for date routes. Good balance.', 'testuser1', 'Exactly. Overplanning ruins the pace.', '2026-06-08 14:50:00+09', '2026-06-08 14:50:00+09'),
    ('Jeonju budget foodie route', 'Student budget routes are always welcome.', 'authdemo20260611111435', 'I want to add a second version later with more snack stops.', '2026-06-09 20:30:00+09', '2026-06-09 20:30:00+09')
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
