import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const BASE_URL = "https://musicalseeya.com"
const SEARCH_URL = `${BASE_URL}/search/all_theater_play/`
const OUTPUT_PATH = path.resolve(
  "apps/web-react/src/features/reviews/theater-seat-map-configs.ts",
)

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function toStringLiteral(value) {
  return JSON.stringify(value)
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 seat-map-importer",
    },
  })

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`)
  }

  return response.text()
}

function extractTheaterLinks(html) {
  const links = []
  const linkPattern =
    /<a\s+class="right-items"\s+href="\/seeyatheater\/(\d+)">([\s\S]*?)<\/a>/g

  for (const match of html.matchAll(linkPattern)) {
    links.push({
      sourceId: match[1],
      sourceUrl: `${BASE_URL}/seeyatheater/${match[1]}`,
      name: decodeHtml(match[2].replace(/<[^>]+>/g, "")),
    })
  }

  return links
}

function extractFloorTypeUrls(html, sourceUrl) {
  const urls = new Set()
  const linkPattern = /<a\s+href="\?type=(\d+)"\s+class="floor-type">/g

  for (const match of html.matchAll(linkPattern)) {
    urls.add(`${sourceUrl}?type=${match[1]}`)
  }

  return Array.from(urls)
}

function segmentByMatches(html, matches, getStart, getEnd = getStart) {
  return matches.map((match, index) => {
    const start = getStart(match)
    const end = index + 1 < matches.length ? getEnd(matches[index + 1]) : html.length
    return { match, html: html.slice(start, end) }
  })
}

function extractText(html, pattern) {
  return decodeHtml(html.match(pattern)?.[1] ?? "")
}

function deriveSectionLabel(sourceClass, fallback) {
  const compactClass = sourceClass.replace(/\s/g, "")

  if (/OP/i.test(compactClass)) {
    return "OP"
  }

  const prefix = compactClass.match(/^[A-Za-z가-힣]+/)?.[0] ?? fallback

  if (/^A+/i.test(prefix)) return "A"
  if (/^B+/i.test(prefix)) return "B"
  if (/^C+/i.test(prefix)) return "C"
  if (/^D+/i.test(prefix)) return "D"
  if (/^E+/i.test(prefix)) return "E"
  if (/^F+/i.test(prefix)) return "F"

  return prefix || fallback
}

function getTheaterAliases(label) {
  const aliasesByLabel = {
    "블루스퀘어 신한카드홀": ["Blue Square", "블루스퀘어"],
    샤롯데씨어터: ["Charlotte Theater"],
    "두산아트센터 연강홀": ["두산아트센터"],
    "홍익대아트센터 대극장": ["홍익대 대학로 아트센터"],
  }

  return aliasesByLabel[label] ?? []
}

function extractCells(rowHtml) {
  const cells = []
  const cellMatches = Array.from(
    rowHtml.matchAll(/<div\s+class='seats'>|<div\s+id='seat'><\/div>/g),
  )

  for (const [index, match] of cellMatches.entries()) {
    if (match[0].includes("id='seat'")) {
      cells.push({ type: "gap" })
      continue
    }

    const nextMatch = cellMatches[index + 1]
    const seatHtml = rowHtml.slice(match.index, nextMatch?.index ?? rowHtml.length)
    const number = extractText(seatHtml, /<p>\s*([\s\S]*?)\s*<\/p>/)

    if (!number || number.toLowerCase().includes("copyright")) {
      cells.push({ type: "gap" })
      continue
    }

    const seatAttributes = seatHtml.match(/<div\s+id='seat'([\s\S]*?)>/)?.[1] ?? ""
    const className =
      seatAttributes.match(/class="([^"]+)"/)?.[1] ??
      seatAttributes.match(/class='([^']+)'/)?.[1] ??
      ""
    const sourcePk = seatHtml.match(/pk='([^']+)'/)?.[1] ?? undefined

    cells.push({
      type: "seat",
      number,
      sourcePk,
      sourceClass: decodeHtml(className),
    })
  }

  return cells
}

function extractRows(blockHtml) {
  const rows = []
  const rowMatches = Array.from(blockHtml.matchAll(/<div\s+class='row'>/g))
  const rowSegments = segmentByMatches(
    blockHtml,
    rowMatches,
    (match) => match.index,
    (match) => match.index,
  )

  for (const [index, { html: rowHtml }] of rowSegments.entries()) {
    const labels = Array.from(
      rowHtml.matchAll(/<div\s+id='row_zone'>[\s\S]*?<p\s+class="seat_num">\s*([\s\S]*?)\s*<\/p>/g),
      (labelMatch) => decodeHtml(labelMatch[1]),
    ).filter(Boolean)
    const row = labels[0] ?? String(index + 1)
    const cells = extractCells(rowHtml)

    if (cells.length > 0) {
      rows.push({ row, cells })
    }
  }

  return rows
}

function parseTheaterPage(html, fallbackName, sourceId, sourceUrl) {
  const titleName = extractText(html, /<title>\s*SeeYa!\s*-\s*([\s\S]*?)\s*<\/title>/)
  const label = titleName || fallbackName

  const floorMatches = Array.from(
    html.matchAll(/<div\s+class="seattable_floor">\s*([\s\S]*?)\s*<\/div>/g),
  )
  const floorSegments = floorMatches.length
    ? segmentByMatches(
        html,
        floorMatches,
        (match) => match.index,
        (match) => match.index,
      )
    : [
        {
          match: ["", "1층"],
          html,
        },
      ]

  const floors = floorSegments.map(({ match, html: floorHtml }) => {
    const floor = decodeHtml(match[1])
    const blockMatches = Array.from(
      floorHtml.matchAll(
        /<div\s+id='(?!seat')([^']+)'\s+class='([^']+)'>\s*(?=(?:[\s\S]*?<div\s+class="seattable_zone_container">)|(?:[\s\S]*?<div\s+class='row'>))/g,
      ),
    )
    const blockSegments = segmentByMatches(
      floorHtml,
      blockMatches,
      (blockMatch) => blockMatch.index,
      (blockMatch) => blockMatch.index,
    )
    const blocks = blockSegments
      .map(({ match: blockMatch, html: blockHtml }, index) => {
        const labelText = extractText(blockHtml, /<div\s+id="seattable_zone">\s*([\s\S]*?)\s*<\/div>/)
        const label = labelText || deriveSectionLabel(blockMatch[2], `구역 ${index + 1}`)

        return {
          section: label,
          label,
          sourceId: blockMatch[1],
          sourceClass: blockMatch[2],
          rows: extractRows(blockHtml),
        }
      })
      .filter((block) => block.rows.length > 0)

    return { floor, label: floor, blocks }
  })

  return {
    theaterNames: [label, ...getTheaterAliases(label)],
    label,
    musicalSeeyaId: sourceId,
    sourceUrl,
    floors: floors.filter((floor) => floor.blocks.length > 0),
  }
}

function mergeTheaterConfigs(configs) {
  const [baseConfig, ...restConfigs] = configs

  for (const config of restConfigs) {
    for (const floor of config.floors) {
      const existingFloorIndex = baseConfig.floors.findIndex((item) => item.floor === floor.floor)

      if (existingFloorIndex >= 0) {
        baseConfig.floors[existingFloorIndex] = floor
      } else {
        baseConfig.floors.push(floor)
      }
    }
  }

  return baseConfig
}

function serializeCell(cell) {
  if (cell.type === "gap") {
    return "{ type: \"gap\" }"
  }

  return [
    "{ type: \"seat\"",
    `, number: ${toStringLiteral(cell.number)}`,
    cell.sourcePk ? `, sourcePk: ${toStringLiteral(cell.sourcePk)}` : "",
    cell.sourceClass ? `, sourceClass: ${toStringLiteral(cell.sourceClass)}` : "",
    " }",
  ].join("")
}

function serializeConfig(config) {
  return `  {
    theaterNames: [${config.theaterNames.map(toStringLiteral).join(", ")}],
    label: ${toStringLiteral(config.label)},
    musicalSeeyaId: ${toStringLiteral(config.musicalSeeyaId)},
    sourceUrl: ${toStringLiteral(config.sourceUrl)},
    floors: [
${config.floors
  .map(
    (floor) => `      {
        floor: ${toStringLiteral(floor.floor)},
        label: ${toStringLiteral(floor.label)},
        blocks: [
${floor.blocks
  .map(
    (block) => `          {
            section: ${toStringLiteral(block.section)},
            label: ${toStringLiteral(block.label)},
            sourceId: ${toStringLiteral(block.sourceId)},
            sourceClass: ${toStringLiteral(block.sourceClass)},
            rows: [
${block.rows
  .map(
    (row) => `              {
                row: ${toStringLiteral(row.row)},
                cells: [${row.cells.map(serializeCell).join(", ")}],
              }`,
  )
  .join(",\n")}
            ],
          }`,
  )
  .join(",\n")}
        ],
      }`,
  )
  .join(",\n")}
    ],
  }`
}

function buildOutput(configs) {
  return `export type SeatMapSeat = {
  floor: string
  section: string
  row: string
  number: string
}

export type SeatMapCell =
  | {
      type: "seat"
      number: string
      sourcePk?: string
      sourceClass?: string
    }
  | {
      type: "gap"
    }

export type SeatMapRow = {
  row: string
  cells: SeatMapCell[]
}

export type TheaterSeatMapBlock = {
  section: string
  label: string
  sourceId: string
  sourceClass: string
  rows: SeatMapRow[]
}

export type TheaterSeatMapFloor = {
  floor: string
  label: string
  blocks: TheaterSeatMapBlock[]
}

export type TheaterSeatMapConfig = {
  theaterNames: string[]
  label: string
  musicalSeeyaId: string
  sourceUrl: string
  floors: TheaterSeatMapFloor[]
}

export const theaterSeatMapConfigs: TheaterSeatMapConfig[] = [
${configs.map(serializeConfig).join(",\n")}
]

export function getTheaterSeatMapConfig(theaterName: string) {
  return theaterSeatMapConfigs.find((config) => config.theaterNames.includes(theaterName))
}
`
}

async function main() {
  const searchHtml = await fetchText(SEARCH_URL)
  const links = extractTheaterLinks(searchHtml)
  const configs = []

  for (const link of links) {
    const html = await fetchText(link.sourceUrl)
    const floorTypeUrls = extractFloorTypeUrls(html, link.sourceUrl)
    const pageUrls = floorTypeUrls.length > 0 ? floorTypeUrls : [link.sourceUrl]
    const configPages = []

    for (const pageUrl of pageUrls) {
      const pageHtml = pageUrl === link.sourceUrl ? html : await fetchText(pageUrl)
      const config = parseTheaterPage(pageHtml, link.name, link.sourceId, pageUrl)

      if (config.floors.length > 0) {
        configPages.push(config)
      }
    }

    if (!configPages.length) {
      continue
    }

    const config = mergeTheaterConfigs(configPages)

    if (config.floors.length > 0) {
      configs.push(config)
      console.log(`Imported ${config.label}`)
    }
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, buildOutput(configs), "utf8")

  console.log(`Wrote ${configs.length} theater seat maps to ${OUTPUT_PATH}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
