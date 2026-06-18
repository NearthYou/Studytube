-- AlterTable
ALTER TABLE "seat_review_embeddings" ADD COLUMN "metadata" JSONB,
ADD COLUMN "document_version" TEXT NOT NULL DEFAULT 'seat-review-v2';

-- CreateTable
CREATE TABLE "rag_query_logs" (
    "id" BIGSERIAL NOT NULL,
    "question" TEXT NOT NULL,
    "filters" JSONB,
    "source_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "answer_preview" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_query_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rag_query_logs_created_at_idx" ON "rag_query_logs"("created_at");
