require("dotenv").config();

const bcrypt = require("bcrypt");
const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const BASE_URL = "https://musicalseeya.com";
const TARGETS = {
  "phantom-2025": {
    theaterName: "세종문화회관 대극장",
    theaterId: "21",
    playId: "1094",
    playTitle: "팬텀 2025",
    floorTypes: ["1", "2", "3"],
  },
  "laughing-man-2022": {
    theaterName: "세종문화회관 대극장",
    theaterId: "21",
    playId: "651",
    playTitle: "웃는 남자 2022",
    floorTypes: ["1", "2", "3"],
  },
};

const TAG_CATALOG = {
  표정잘보임: "seat_feature",
  전체무대잘보임: "seat_feature",
  시야방해: "seat_feature",
  음향좋음: "seat_feature",
  사이드시야: "seat_feature",
  재관람추천: "viewing_purpose",
  가성비: "viewing_purpose",
};

const requestedTarget = process.argv[2] ?? "all";
const targets =
  requestedTarget === "all"
    ? Object.entries(TARGETS)
    : [[requestedTarget, TARGETS[requestedTarget]]];

if (targets.some(([, target]) => !target)) {
  throw new Error(
    `Unknown target "${requestedTarget}". Use one of: ${[
      "all",
      ...Object.keys(TARGETS),
    ].join(", ")}`,
  );
}

const prisma = createPrismaClient();

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL must be set before running import-seeya-sejong.js.");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value ?? "").replace(/<[^>]+>/g, ""));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 seeya-sejong-importer",
    },
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.text();
}

function segmentByMatches(html, matches, getStart, getEnd = getStart) {
  return matches.map((match, index) => {
    const start = getStart(match);
    const end =
      index + 1 < matches.length ? getEnd(matches[index + 1]) : html.length;
    return { match, html: html.slice(start, end) };
  });
}

function extractText(html, pattern) {
  return stripTags(html.match(pattern)?.[1] ?? "");
}

function extractReviewedSeats(html) {
  const seats = [];
  const floorMatches = Array.from(
    html.matchAll(/<div\s+class="seattable_floor">\s*([\s\S]*?)\s*<\/div>/g),
  );
  const floorSegments = segmentByMatches(
    html,
    floorMatches,
    (match) => match.index,
    (match) => match.index,
  );

  for (const { match: floorMatch, html: floorHtml } of floorSegments) {
    const floor = stripTags(floorMatch[1]);
    const blockMatches = Array.from(
      floorHtml.matchAll(
        /<div\s+id='(?!seat')([^']+)'\s+class='([^']+)'>\s*(?=(?:[\s\S]*?<div\s+class="seattable_zone_container">)|(?:[\s\S]*?<div\s+class='row'>))/g,
      ),
    );
    const blockSegments = segmentByMatches(
      floorHtml,
      blockMatches,
      (blockMatch) => blockMatch.index,
      (blockMatch) => blockMatch.index,
    );

    for (const { match: blockMatch, html: blockHtml } of blockSegments) {
      const section =
        extractText(
          blockHtml,
          /<div\s+id="seattable_zone">\s*([\s\S]*?)\s*<\/div>/,
        ) || null;
      const rowMatches = Array.from(blockHtml.matchAll(/<div\s+class='row'>/g));
      const rowSegments = segmentByMatches(
        blockHtml,
        rowMatches,
        (rowMatch) => rowMatch.index,
        (rowMatch) => rowMatch.index,
      );

      for (const [rowIndex, { html: rowHtml }] of rowSegments.entries()) {
        const row =
          extractText(
            rowHtml,
            /<div\s+id='row_zone'>[\s\S]*?<p\s+class="seat_num">\s*([\s\S]*?)\s*<\/p>/,
          ) || String(rowIndex + 1);
        const cellMatches = Array.from(
          rowHtml.matchAll(/<div\s+class='seats'>|<div\s+id='seat'><\/div>/g),
        );

        for (const [cellIndex, cellMatch] of cellMatches.entries()) {
          if (cellMatch[0].includes("id='seat'")) {
            continue;
          }

          const nextCellMatch = cellMatches[cellIndex + 1];
          const cellHtml = rowHtml.slice(
            cellMatch.index,
            nextCellMatch?.index ?? rowHtml.length,
          );
          const number = extractText(cellHtml, /<p>\s*([\s\S]*?)\s*<\/p>/);
          const seatAttributes =
            cellHtml.match(/<div\s+id='seat'([\s\S]*?)>/)?.[1] ?? "";
          const sourceClass =
            seatAttributes.match(/class="([^"]+)"/)?.[1] ??
            seatAttributes.match(/class='([^']+)'/)?.[1] ??
            "";
          const sourcePk = seatAttributes.match(/pk='([^']+)'/)?.[1];

          if (
            !number ||
            !sourcePk ||
            /\bno_review\b/.test(sourceClass) ||
            /\bdisabled\b/.test(sourceClass)
          ) {
            continue;
          }

          seats.push({
            floor,
            section,
            row,
            number,
            sourcePk,
            sourceClass,
            sourceBlockId: blockMatch[1],
            sourceBlockClass: blockMatch[2],
          });
        }
      }
    }
  }

  return seats;
}

function countStars(value) {
  return Math.max(1, Math.min(5, (value.match(/★/g) ?? []).length));
}

function parseReviewSegments(html) {
  const matches = Array.from(
    html.matchAll(/<div\s+id="review"\s+class="review-(\d+)">/g),
  );

  return segmentByMatches(
    html,
    matches,
    (match) => match.index,
    (match) => match.index,
  );
}

function parseReviews(html, seat, target) {
  return parseReviewSegments(html)
    .map(({ match, html: reviewHtml }) => {
      const profileHtml =
        reviewHtml.match(/<div\s+class="profile">([\s\S]*?)<\/div>/)?.[1] ?? "";
      const profileTexts = Array.from(
        profileHtml.matchAll(/<p>([\s\S]*?)<\/p>/g),
        (profileMatch) => stripTags(profileMatch[1]),
      ).filter(Boolean);
      const starTexts = Array.from(
        reviewHtml.matchAll(/<span\s+class="stars">([\s\S]*?)<\/span>/g),
        (starMatch) => stripTags(starMatch[1]),
      );
      const content = stripTags(
        reviewHtml
          .match(/<pre>([\s\S]*?)<\/pre>/)?.[1]
          ?.replace(/<span\s+class="detail-update">[\s\S]*?<\/span>/g, "") ??
          "",
      );

      if (content.length < 10 || starTexts.length < 4) {
        return null;
      }

      const viewRating = countStars(starTexts[0]);
      const comfortRating = countStars(starTexts[1]);
      const stageVisibilityRating = countStars(starTexts[2]);
      const soundRating = countStars(starTexts[3]);

      return {
        sourceReviewId: match[1],
        sourceNickname: profileTexts[0] || `SeeYa ${match[1]}`,
        sourcePlayTitle:
          profileTexts[1]?.replace(/^\(|\)$/g, "") || target.playTitle,
        seat,
        viewRating,
        comfortRating,
        stageVisibilityRating,
        soundRating,
        expressionRating: viewRating,
        content,
      };
    })
    .filter(Boolean);
}

function splitPlayTitle(title) {
  const seasonMatch = title.match(/\s+(\d{4}(?:-\d{4})?)$/);

  if (!seasonMatch) {
    return { musicalTitle: title, seasonLabel: null };
  }

  return {
    musicalTitle: title.slice(0, seasonMatch.index).trim(),
    seasonLabel: seasonMatch[1],
  };
}

function inferTagNames(review) {
  const tags = new Set();
  const content = review.content;
  const average =
    (review.viewRating +
      review.soundRating +
      review.comfortRating +
      review.expressionRating +
      review.stageVisibilityRating) /
    5;

  if (review.viewRating >= 4) {
    tags.add("전체무대잘보임");
  }

  if (review.expressionRating >= 4 && /표정|얼굴|오글|가깝|눈앞/.test(content)) {
    tags.add("표정잘보임");
  }

  if (review.soundRating >= 4) {
    tags.add("음향좋음");
  }

  if (/가려|가림|시야방해|기둥|난간|등짝|안보|안 보|잘림|사이드/.test(content)) {
    tags.add("시야방해");
  }

  if (/사이드|측면|왼쪽|오른쪽|반대쪽|끝/.test(content)) {
    tags.add("사이드시야");
  }

  if (average >= 4.2) {
    tags.add("재관람추천");
  }

  if (review.comfortRating >= 4 && average <= 4.1) {
    tags.add("가성비");
  }

  return Array.from(tags);
}

async function ensureTagMap() {
  const tagsByName = new Map();

  for (const [name, type] of Object.entries(TAG_CATALOG)) {
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

async function ensureUser(review, passwordHash) {
  const email = `seeya-${review.sourceReviewId}@example.com`;
  const nickname = review.sourceNickname.slice(0, 40);

  return prisma.user.upsert({
    where: { email },
    update: { nickname },
    create: {
      email,
      nickname,
      passwordHash,
    },
  });
}

async function upsertReview(review, author, theater, musical, performance, tagsByName) {
  const existing = await prisma.seatReview.findFirst({
    where: {
      authorId: author.id,
      performanceId: performance.id,
      seatFloor: review.seat.floor,
      seatSection: review.seat.section,
      seatRow: review.seat.row,
      seatNumber: review.seat.number,
    },
  });
  const data = {
    authorId: author.id,
    theaterId: theater.id,
    musicalId: musical.id,
    performanceId: performance.id,
    seatFloor: review.seat.floor,
    seatSection: review.seat.section,
    seatRow: review.seat.row,
    seatNumber: review.seat.number,
    viewRating: review.viewRating,
    soundRating: review.soundRating,
    comfortRating: review.comfortRating,
    expressionRating: review.expressionRating,
    stageVisibilityRating: review.stageVisibilityRating,
    content: review.content,
  };

  const seatReview = existing
    ? await prisma.seatReview.update({
        where: { id: existing.id },
        data,
      })
    : await prisma.seatReview.create({ data });

  const tagIds = inferTagNames(review)
    .map((name) => tagsByName.get(name)?.id)
    .filter(Boolean);

  if (tagIds.length > 0) {
    await prisma.seatReviewTag.createMany({
      data: tagIds.map((tagId) => ({
        seatReviewId: seatReview.id,
        tagId,
      })),
      skipDuplicates: true,
    });
  }

  return { existed: Boolean(existing), tagCount: tagIds.length };
}

async function collectReviews(target) {
  const seatsByPk = new Map();

  for (const floorType of target.floorTypes) {
    const url = `${BASE_URL}/seeyaplay/${target.theaterId}/${target.playId}?type=${floorType}`;
    const html = await fetchText(url);

    for (const seat of extractReviewedSeats(html)) {
      seatsByPk.set(seat.sourcePk, seat);
    }
  }

  const seats = Array.from(seatsByPk.values());
  const reviews = [];

  for (const [index, seat] of seats.entries()) {
    const url = `${BASE_URL}/seeyaplay/${target.theaterId}/${target.playId}/${seat.sourcePk}`;
    const html = await fetchText(url);
    reviews.push(...parseReviews(html, seat, target));

    if ((index + 1) % 25 === 0) {
      console.log(`Fetched ${index + 1}/${seats.length} reviewed seats.`);
    }
  }

  return { seats, reviews };
}

async function importTarget(targetKey, target, tagsByName, passwordHash) {
  const { musicalTitle, seasonLabel } = splitPlayTitle(target.playTitle);
  const theater = await prisma.theater.upsert({
    where: { name: target.theaterName },
    update: {},
    create: { name: target.theaterName },
  });
  const musical =
    (await prisma.musical.findFirst({ where: { title: musicalTitle } })) ??
    (await prisma.musical.create({ data: { title: musicalTitle } }));
  const performance =
    (await prisma.performance.findFirst({
      where: {
        theaterId: theater.id,
        musicalId: musical.id,
        seasonLabel,
      },
    })) ??
    (await prisma.performance.create({
      data: {
        theaterId: theater.id,
        musicalId: musical.id,
        seasonLabel,
      },
    }));
  const { seats, reviews } = await collectReviews(target);
  let insertedReviews = 0;
  let updatedReviews = 0;
  let linkedTags = 0;

  for (const review of reviews) {
    const author = await ensureUser(review, passwordHash);
    const result = await upsertReview(
      review,
      author,
      theater,
      musical,
      performance,
      tagsByName,
    );

    if (result.existed) {
      updatedReviews += 1;
    } else {
      insertedReviews += 1;
    }

    linkedTags += result.tagCount;
  }

  return {
    target: targetKey,
    source: `${BASE_URL}/seeyaplay/${target.theaterId}/${target.playId}`,
    theater: target.theaterName,
    musical: musicalTitle,
    seasonLabel,
    reviewedSeats: seats.length,
    importedReviews: reviews.length,
    insertedReviews,
    updatedReviews,
    linkedTags,
  };
}

async function main() {
  const passwordHash = await bcrypt.hash("password1234", 10);
  const tagsByName = await ensureTagMap();
  const results = [];

  for (const [targetKey, target] of targets) {
    results.push(await importTarget(targetKey, target, tagsByName, passwordHash));
  }

  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((error) => {
    console.error("import-seeya-sejong failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
