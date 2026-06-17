-- CreateIndex
CREATE INDEX "seat_reviews_theater_id_idx" ON "seat_reviews"("theater_id");

-- CreateIndex
CREATE INDEX "seat_reviews_musical_id_idx" ON "seat_reviews"("musical_id");

-- CreateIndex
CREATE INDEX "seat_reviews_performance_id_idx" ON "seat_reviews"("performance_id");

-- CreateIndex
CREATE INDEX "seat_reviews_seat_floor_idx" ON "seat_reviews"("seat_floor");

-- CreateIndex
CREATE INDEX "seat_reviews_seat_section_idx" ON "seat_reviews"("seat_section");

-- CreateIndex
CREATE INDEX "seat_reviews_created_at_idx" ON "seat_reviews"("created_at");

-- CreateIndex
CREATE INDEX "seat_review_tags_tag_id_idx" ON "seat_review_tags"("tag_id");
