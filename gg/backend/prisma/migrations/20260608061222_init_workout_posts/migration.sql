-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutPost" (
    "id" SERIAL NOT NULL,
    "authorId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "workoutDate" TIMESTAMP(3) NOT NULL,
    "bodyPart" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "exerciseName" TEXT NOT NULL,
    "normalizedName" TEXT,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "targetReps" INTEGER,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "WorkoutExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSet" (
    "id" SERIAL NOT NULL,
    "exerciseId" INTEGER NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "perceivedDifficulty" INTEGER,

    CONSTRAINT "WorkoutSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "WorkoutPost_authorId_idx" ON "WorkoutPost"("authorId");

-- CreateIndex
CREATE INDEX "WorkoutPost_workoutDate_idx" ON "WorkoutPost"("workoutDate");

-- CreateIndex
CREATE INDEX "WorkoutPost_bodyPart_idx" ON "WorkoutPost"("bodyPart");

-- CreateIndex
CREATE INDEX "WorkoutExercise_postId_idx" ON "WorkoutExercise"("postId");

-- CreateIndex
CREATE INDEX "WorkoutExercise_exerciseName_idx" ON "WorkoutExercise"("exerciseName");

-- CreateIndex
CREATE INDEX "WorkoutSet_exerciseId_idx" ON "WorkoutSet"("exerciseId");

-- AddForeignKey
ALTER TABLE "WorkoutPost" ADD CONSTRAINT "WorkoutPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutExercise" ADD CONSTRAINT "WorkoutExercise_postId_fkey" FOREIGN KEY ("postId") REFERENCES "WorkoutPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSet" ADD CONSTRAINT "WorkoutSet_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "WorkoutExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
