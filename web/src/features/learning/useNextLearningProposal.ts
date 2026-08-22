import { useEffect, useRef, useState } from "react";
import {
  createNextLearningProposal,
  createNextLearningRun,
  fetchNextLearningRun,
  type LearningProposal,
} from "../../api.ts";
import { fetchOwnerCourses } from "../../courseApi.ts";
import type { CourseChoice } from "./NextLearningProposal.tsx";

export function useNextLearningProposal({
  contextId,
  currentTime,
  evaluated,
  videoTitle,
}: {
  contextId: string;
  currentTime: number;
  evaluated: boolean;
  videoTitle: string;
}) {
  const [proposal, setProposal] = useState<LearningProposal | null>(null);
  const [courses, setCourses] = useState<CourseChoice[]>([]);
  const [status, setStatus] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const activeRequestRef = useRef<{
    controller: AbortController;
    idempotencyKey: string;
  } | null>(null);

  useEffect(
    () => () => {
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
    },
    [],
  );

  async function request() {
    if (!contextId || !evaluated || activeRequestRef.current) return;
    const activeRequest = {
      controller: new AbortController(),
      idempotencyKey: crypto.randomUUID(),
    };
    activeRequestRef.current = activeRequest;
    const { signal } = activeRequest.controller;
    setInFlight(true);
    setStatus("다음 학습을 찾고 있습니다.");
    setProposal(null);
    try {
      const [run, ownerCourses] = await Promise.all([
        createNextLearningRun(
          {
            objective: `${videoTitle} 다음에 학습할 내용`,
            studyContextId: contextId,
            watchedRanges: [
              { start: 0, end: Math.max(1, Math.floor(currentTime)) },
            ],
            idempotencyKey: activeRequest.idempotencyKey,
          },
          { signal },
        ),
        fetchOwnerCourses(),
      ]);
      if (signal.aborted) return;
      setCourses(
        ownerCourses
          .filter((course) => course.status !== "archived")
          .map(({ id, title, version }) => ({ id, title, version })),
      );
      const readyRun = await waitForProposalRun(run, signal);
      if (signal.aborted) return;
      if (readyRun.state !== "awaiting_approval") {
        throw new Error("다음 학습을 찾지 못했습니다. 다시 시도해주세요.");
      }
      const nextProposal = await createNextLearningProposal(readyRun.id, {
        signal,
      });
      if (signal.aborted) return;
      setProposal(nextProposal);
      setStatus("");
    } catch (error) {
      if (signal.aborted) return;
      setStatus(
        error instanceof Error
          ? error.message
          : "다음 학습을 찾지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      if (activeRequestRef.current === activeRequest) {
        activeRequestRef.current = null;
        if (!signal.aborted) setInFlight(false);
      }
    }
  }

  return { courses, inFlight, proposal, request, status };
}

async function waitForProposalRun(
  initial: { id: string; state: string; failureCode: string | null },
  signal: AbortSignal,
) {
  let current = initial;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (
      current.state === "awaiting_approval" ||
      ["failed", "cancelled"].includes(current.state)
    ) {
      return current;
    }
    if (!(await waitForPoll(1_000, signal))) return current;
    current = await fetchNextLearningRun(current.id, { signal });
  }
  return current;
}

function waitForPoll(delayMs: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve(true);
    }, delayMs);
    function stop() {
      window.clearTimeout(timeout);
      resolve(false);
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}
