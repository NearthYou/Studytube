-- AlterTable
ALTER TABLE "comments" ADD COLUMN "moderation_status" TEXT NOT NULL DEFAULT 'VISIBLE',
ADD COLUMN "hidden_at" TIMESTAMP(3),
ADD COLUMN "hidden_by_id" BIGINT,
ADD COLUMN "hidden_reason" TEXT,
ADD COLUMN "deleted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "comment_reports" (
    "id" BIGSERIAL NOT NULL,
    "comment_id" BIGINT NOT NULL,
    "reporter_id" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comment_reports_comment_id_idx" ON "comment_reports"("comment_id");

-- CreateIndex
CREATE INDEX "comment_reports_status_idx" ON "comment_reports"("status");
