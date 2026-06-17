import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "comments",
      "seat_review_tags",
      "seat_reviews",
      "performances",
      "tags",
      "musicals",
      "theaters",
      "users"
    RESTART IDENTITY CASCADE
  `);

  const passwordHash = await bcrypt.hash("password1234", 10);

  const users = {
    minji: await prisma.user.create({
      data: {
        email: "minji@example.com",
        passwordHash,
        nickname: "MinjiFan",
      },
    }),
    seoyeon: await prisma.user.create({
      data: {
        email: "seoyeon@example.com",
        passwordHash,
        nickname: "StageLover",
      },
    }),
    jiwoo: await prisma.user.create({
      data: {
        email: "jiwoo@example.com",
        passwordHash,
        nickname: "SeatScout",
      },
    }),
  };

  const theaters = {
    blueSquare: await prisma.theater.create({
      data: { name: "Blue Square" },
    }),
    charlotte: await prisma.theater.create({
      data: { name: "Charlotte Theater" },
    }),
  };

  const musicals = {
    hadestown: await prisma.musical.create({
      data: { title: "Hadestown" },
    }),
    moulinRouge: await prisma.musical.create({
      data: { title: "Moulin Rouge" },
    }),
  };

  const performances = {
    hadestownBlueSquare: await prisma.performance.create({
      data: {
        musicalId: musicals.hadestown.id,
        theaterId: theaters.blueSquare.id,
        seasonLabel: "25시즌",
      },
    }),
    moulinRougeCharlotte: await prisma.performance.create({
      data: {
        musicalId: musicals.moulinRouge.id,
        theaterId: theaters.charlotte.id,
        seasonLabel: "25시즌",
      },
    }),
  };

  const tags = {
    greatView: await prisma.tag.create({
      data: { name: "시야좋음", type: "seat_feature" },
    }),
    obstructedView: await prisma.tag.create({
      data: { name: "시야방해", type: "seat_feature" },
    }),
    strongSound: await prisma.tag.create({
      data: { name: "음향좋음", type: "seat_feature" },
    }),
    firstTimer: await prisma.tag.create({
      data: { name: "첫관람추천", type: "viewing_purpose" },
    }),
    budgetPick: await prisma.tag.create({
      data: { name: "가성비", type: "viewing_purpose" },
    }),
  };

  const seatReviewA = await prisma.seatReview.create({
    data: {
      authorId: users.minji.id,
      theaterId: theaters.blueSquare.id,
      musicalId: musicals.hadestown.id,
      performanceId: performances.hadestownBlueSquare.id,
      seatFloor: "1F",
      seatSection: "Center",
      seatRow: "F",
      seatNumber: "18",
      viewRating: 5,
      soundRating: 5,
      comfortRating: 4,
      expressionRating: 5,
      stageVisibilityRating: 5,
      content:
        "Close enough to catch facial expressions, with a clear full-stage view and very balanced sound.",
    },
  });

  const seatReviewB = await prisma.seatReview.create({
    data: {
      authorId: users.seoyeon.id,
      theaterId: theaters.blueSquare.id,
      musicalId: musicals.hadestown.id,
      performanceId: performances.hadestownBlueSquare.id,
      seatFloor: "2F",
      seatSection: "Center",
      seatRow: "B",
      seatNumber: "12",
      viewRating: 4,
      soundRating: 5,
      comfortRating: 4,
      expressionRating: 3,
      stageVisibilityRating: 5,
      content:
        "Great for taking in the whole set design and lighting, even if performer detail is a bit farther away.",
    },
  });

  const seatReviewC = await prisma.seatReview.create({
    data: {
      authorId: users.jiwoo.id,
      theaterId: theaters.charlotte.id,
      musicalId: musicals.moulinRouge.id,
      performanceId: performances.moulinRougeCharlotte.id,
      seatFloor: "1F",
      seatSection: "Left",
      seatRow: "H",
      seatNumber: "7",
      viewRating: 4,
      soundRating: 4,
      comfortRating: 4,
      expressionRating: 4,
      stageVisibilityRating: 3,
      content:
        "A good side angle for actor movement, though some stage corners are slightly harder to follow.",
    },
  });

  await prisma.seatReviewTag.createMany({
    data: [
      { seatReviewId: seatReviewA.id, tagId: tags.greatView.id },
      { seatReviewId: seatReviewA.id, tagId: tags.strongSound.id },
      { seatReviewId: seatReviewB.id, tagId: tags.firstTimer.id },
      { seatReviewId: seatReviewC.id, tagId: tags.budgetPick.id },
      { seatReviewId: seatReviewC.id, tagId: tags.strongSound.id },
    ],
  });

  await prisma.comment.createMany({
    data: [
      {
        seatReviewId: seatReviewA.id,
        authorId: users.seoyeon.id,
        content: "This matches my experience too. Center seats here are very reliable.",
      },
      {
        seatReviewId: seatReviewB.id,
        authorId: users.minji.id,
        content: "Helpful review for first-timers who want the full stage picture.",
      },
      {
        seatReviewId: seatReviewC.id,
        authorId: users.jiwoo.id,
        content: "Good value pick if you do not mind a side view.",
      },
    ],
  });

  console.log("Prisma seed completed.");
}

main()
  .catch((error) => {
    console.error("Prisma seed failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
