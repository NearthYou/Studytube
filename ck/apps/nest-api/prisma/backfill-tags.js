require("dotenv").config();

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL must be set before running backfill-tags.js.");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

const prisma = createPrismaClient();

const tagCatalog = {
  표정잘보임: "seat_feature",
  전체무대잘보임: "seat_feature",
  시야방해: "seat_feature",
  음향좋음: "seat_feature",
  사이드시야: "seat_feature",
  첫관람추천: "viewing_purpose",
  재관람추천: "viewing_purpose",
  가성비: "viewing_purpose",
};

function averageRating(review) {
  return (
    review.viewRating +
    review.soundRating +
    review.comfortRating +
    review.expressionRating +
    review.stageVisibilityRating
  ) / 5;
}

function normalizeSeatText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function inferTagNames(review) {
  const tags = new Set();
  const floor = normalizeSeatText(review.seatFloor);
  const section = normalizeSeatText(review.seatSection);
  const average = averageRating(review);

  if (review.expressionRating >= 5 || (review.viewRating >= 5 && review.expressionRating >= 4)) {
    tags.add("표정잘보임");
  }

  if (review.stageVisibilityRating >= 5) {
    tags.add("전체무대잘보임");
  }

  if (review.soundRating >= 5) {
    tags.add("음향좋음");
  }

  if (review.viewRating <= 3 || section === "a" || section === "c" || section.includes("side")) {
    tags.add("사이드시야");
  }

  if (review.stageVisibilityRating >= 5 && review.expressionRating <= 3) {
    tags.add("첫관람추천");
  }

  if (average >= 4.6) {
    tags.add("재관람추천");
  }

  if (review.comfortRating >= 4 && average <= 4.2) {
    tags.add("가성비");
  }

  if (tags.size === 0) {
    tags.add("가성비");
  }

  return Array.from(tags);
}

async function ensureTags() {
  const tagsByName = new Map();

  for (const [name, type] of Object.entries(tagCatalog)) {
    const tag = await prisma.tag.upsert({
      where: {
        name_type: {
          name,
          type,
        },
      },
      update: {},
      create: {
        name,
        type,
      },
    });

    tagsByName.set(name, tag);
  }

  return tagsByName;
}

async function main() {
  const tagsByName = await ensureTags();
  const reviews = await prisma.seatReview.findMany({
    include: {
      seatReviewTags: {
        include: {
          tag: true,
        },
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  let taggedReviews = 0;
  let insertedLinks = 0;

  for (const review of reviews) {
    const existingTagNames = new Set(review.seatReviewTags.map(({ tag }) => tag.name));
    const missingTagIds = inferTagNames(review)
      .filter((name) => !existingTagNames.has(name))
      .map((name) => tagsByName.get(name)?.id)
      .filter(Boolean);

    if (missingTagIds.length === 0) {
      continue;
    }

    const result = await prisma.seatReviewTag.createMany({
      data: missingTagIds.map((tagId) => ({
        seatReviewId: review.id,
        tagId,
      })),
      skipDuplicates: true,
    });

    if (result.count > 0) {
      taggedReviews += 1;
      insertedLinks += result.count;
    }
  }

  console.log(
    JSON.stringify(
      {
        reviewedRows: reviews.length,
        taggedReviews,
        insertedLinks,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("backfill-tags failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
