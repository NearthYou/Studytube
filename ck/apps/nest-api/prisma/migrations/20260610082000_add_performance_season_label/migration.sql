ALTER TABLE "performances" ADD COLUMN "season_label" TEXT;

DROP INDEX IF EXISTS "performances_musical_id_theater_id_key";

CREATE UNIQUE INDEX "performances_musical_id_theater_id_season_label_key"
ON "performances"("musical_id", "theater_id", "season_label");
