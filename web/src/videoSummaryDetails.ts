import type { VideoSummaryResponse } from "./types.ts";
import type { QueueVideo } from "./watchQueue.ts";

export function formatVideoSummarySections(
  sections: VideoSummaryResponse["sections"],
) {
  return sections
    .map((section) => {
      const label = section.label.trim();
      const body = section.body.trim();

      if (!label || !body) {
        return "";
      }

      return `${label}\n${body}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function buildVideoSummaryDetails(video: QueueVideo) {
  const details: Array<{ label: string; body: string }> = [];
  const summary = normalizeCaptionSource(video.summary);
  const notes = normalizeCaptionSource(video.translatedNotes);

  if (isReadableCaptionSource(summary)) {
    details.push({
      label: "핵심 요약",
      body: summary,
    });
  }

  if (isReadableCaptionSource(notes) && notes !== summary) {
    const timedBlocks = extractTimedSummaryBlocks(notes);

    if (timedBlocks.length > 0) {
      details.push(...timedBlocks);
    } else {
      details.push(
        ...splitSummaryParagraphs(notes).map((body, index) => ({
          label: index === 0 ? "학습 포인트" : `추가 정리 ${index + 1}`,
          body,
        })),
      );
    }
  }

  if (details.length === 0) {
    return [
      {
        label: "요약 준비 중",
        body: "이 영상에는 아직 자세한 요약이 저장되지 않았습니다. 영상의 AI 분석 요약을 보강하면 이 영역에 한국어 학습 정리가 표시됩니다.",
      },
    ];
  }

  return details.slice(0, 12);
}

export function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${seconds}`;
}

export function clipText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
}

function extractTimedSummaryBlocks(text: string) {
  const matches = [...text.matchAll(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/g)];

  return matches
    .map((match, index) => {
      const nextMatch = matches[index + 1];
      const body = text
        .slice(match.index! + match[0].length, nextMatch?.index ?? text.length)
        .replace(/\s+/g, " ")
        .trim();

      return isReadableCaptionSource(body)
        ? {
            label: formatTime(captionTimestampToSeconds(match)),
            body,
          }
        : null;
    })
    .filter((block): block is { label: string; body: string } =>
      Boolean(block),
    );
}

function splitSummaryParagraphs(text: string) {
  const sentences = text
    .split(/(?<=[.!?。]|다\.)\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => isReadableCaptionSource(sentence));
  const chunks: string[] = [];

  for (let index = 0; index < sentences.length; index += 2) {
    chunks.push(sentences.slice(index, index + 2).join(" "));
  }

  return chunks.length > 0 ? chunks : [text];
}

function normalizeCaptionSource(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("AI 분석 요약:"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isReadableCaptionSource(value: string) {
  const compact = value.replace(/\s+/g, "");

  if (compact.length < 3) {
    return false;
  }

  if (/[�\uF900-\uFAFF]/.test(compact)) {
    return false;
  }

  const questionMarks = compact.match(/\?/g)?.length ?? 0;

  if (
    /\?{2,}/.test(compact) ||
    (questionMarks >= 2 && questionMarks / compact.length > 0.12)
  ) {
    return false;
  }

  return /[a-zA-Z가-힣0-9]/.test(compact);
}

function captionTimestampToSeconds(match: RegExpMatchArray) {
  const hoursOrMinutes = Number(match[1] ?? 0);
  const minutesOrSeconds = Number(match[2]);
  const seconds = Number(match[3]);

  return match[1]
    ? hoursOrMinutes * 3600 + minutesOrSeconds * 60 + seconds
    : minutesOrSeconds * 60 + seconds;
}
