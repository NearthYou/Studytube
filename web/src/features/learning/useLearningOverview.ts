import { useEffect, useState } from "react";
import { fetchLearningOverview } from "../../api.ts";
import type { LearningOverviewResponse } from "../../types.ts";
import {
  runLearningOverviewPolling,
  waitForOverviewPoll,
} from "./overviewPolling.ts";

const EMPTY_COVERAGE = {
  scope: "study_range" as const,
  startSeconds: 0,
  endSeconds: 0,
};

export function useLearningOverview(contextId: string, active: boolean) {
  const [overview, setOverview] = useState<LearningOverviewResponse>({
    contextId,
    status: "pending",
    coverage: EMPTY_COVERAGE,
  });

  useEffect(() => {
    if (!active || !contextId) return;
    const controller = new AbortController();
    void runLearningOverviewPolling({
      contextId,
      signal: controller.signal,
      fetchOverview: (activeContextId, signal) =>
        fetchLearningOverview(activeContextId, { signal }),
      wait: waitForOverviewPoll,
      onUpdate: setOverview,
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setOverview({
        contextId,
        status: "failed",
        coverage: EMPTY_COVERAGE,
        errorCode: error instanceof Error ? error.name : "OVERVIEW_FAILED",
      });
    });
    return () => {
      controller.abort();
    };
  }, [active, contextId]);

  return !active || overview.contextId !== contextId
    ? { contextId, status: "pending" as const, coverage: EMPTY_COVERAGE }
    : overview;
}
