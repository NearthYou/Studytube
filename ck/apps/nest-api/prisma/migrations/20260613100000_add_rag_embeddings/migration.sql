CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "seat_review_embeddings" (
    "seat_review_id" BIGINT PRIMARY KEY,
    "document" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seat_review_embeddings_seat_review_id_fkey"
        FOREIGN KEY ("seat_review_id")
        REFERENCES "seat_reviews"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX "seat_review_embeddings_embedding_idx"
ON "seat_review_embeddings"
USING ivfflat ("embedding" vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX "seat_review_embeddings_updated_at_idx"
ON "seat_review_embeddings"("updated_at");