INSERT INTO categories (name)
VALUES ('일상'), ('산책'), ('돌봄'), ('질문')
ON CONFLICT (name) DO NOTHING;
