import { useState } from "react";
import { apiBaseUrl } from "../../api.ts";
import {
  canApproveNextProposal,
  initialNextProposalSelection,
  proposalFailurePhase,
  type NextProposalPhase,
  type NextProposalSelection,
} from "./nextLearningProposalState.ts";

export type CourseChoice = { id: number; title: string; version: number };
export type NextProposal = {
  id: string;
  candidate: {
    title: string;
    thumbnailUrl: string;
    channelName: string;
    reason: string;
  };
};

export function NextLearningProposal({
  proposal,
  courses,
  onRequestAnother,
}: {
  proposal: NextProposal;
  courses: CourseChoice[];
  onRequestAnother: () => void;
}) {
  const [phase, setPhase] = useState<NextProposalPhase>("pending");
  const [selection, setSelection] = useState<NextProposalSelection>(() =>
    initialNextProposalSelection(courses),
  );
  const [approvedCourseId, setApprovedCourseId] = useState<number | null>(null);

  async function approve() {
    if (!canApproveNextProposal(phase, selection)) return;
    setPhase("processing");
    const body =
      selection.kind === "existing_course"
        ? {
            proposalId: proposal.id,
            targetKind: selection.kind,
            courseId: selection.courseId,
            expectedCourseVersion: selection.expectedCourseVersion,
          }
        : {
            proposalId: proposal.id,
            targetKind: selection.kind,
            title: selection.title.trim(),
          };
    try {
      const response = await fetch(
        `${apiBaseUrl()}/learning/proposals/approve`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as {
        approvedCourseId?: number;
        error?: { code?: string };
        code?: string;
      };
      if (!response.ok || !result.approvedCourseId) {
        setPhase(
          proposalFailurePhase(result.error?.code ?? result.code ?? "CONFLICT"),
        );
        return;
      }
      setApprovedCourseId(result.approvedCourseId);
      setPhase("success");
    } catch {
      setPhase("version_conflict");
    }
  }

  async function dismiss() {
    if (phase !== "pending") return;
    setPhase("processing");
    try {
      const response = await fetch(
        `${apiBaseUrl()}/learning/proposals/${proposal.id}/dismiss`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      setPhase(response.ok ? "rejected" : "version_conflict");
    } catch {
      setPhase("version_conflict");
    }
  }

  if (phase === "success" && approvedCourseId) {
    return (
      <section className="next-learning-proposal" aria-live="polite">
        <h2>다음 학습을 Course에 담았습니다</h2>
        <a href={`/courses/${approvedCourseId}`}>Course 확인하기</a>
      </section>
    );
  }
  if (["rejected", "expired", "version_conflict"].includes(phase)) {
    const messages = {
      rejected: "이 제안은 사용하지 않기로 했습니다.",
      expired: "제안 시간이 지나 새 제안이 필요합니다.",
      version_conflict:
        "Course가 변경되었습니다. 최신 상태에서 다시 선택해주세요.",
    } as const;
    return (
      <section className="next-learning-proposal" aria-live="polite">
        <h2>다음 학습 제안</h2>
        <p>{messages[phase as keyof typeof messages]}</p>
        <button type="button" onClick={onRequestAnother}>
          새 제안 받기
        </button>
      </section>
    );
  }

  return (
    <section className="next-learning-proposal" aria-labelledby="next-title">
      <div>
        {proposal.candidate.thumbnailUrl && (
          <img src={proposal.candidate.thumbnailUrl} alt="" />
        )}
        <div>
          <h2 id="next-title">다음에 학습할 영상</h2>
          <strong>{proposal.candidate.title}</strong>
          <p>{proposal.candidate.channelName}</p>
          <p>{proposal.candidate.reason}</p>
        </div>
      </div>

      {courses.length > 0 && (
        <label>
          저장할 Course
          <select
            disabled={phase === "processing"}
            value={
              selection.kind === "existing_course"
                ? String(selection.courseId)
                : "new"
            }
            onChange={(event) => {
              const course = courses.find(
                ({ id }) => String(id) === event.target.value,
              );
              setSelection(
                course
                  ? {
                      kind: "existing_course",
                      courseId: course.id,
                      expectedCourseVersion: course.version,
                    }
                  : { kind: "new_private_course", title: "" },
              );
            }}
          >
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.title}
              </option>
            ))}
            <option value="new">새 비공개 Course</option>
          </select>
        </label>
      )}
      {selection.kind === "new_private_course" && (
        <label>
          새 Course 이름
          <input
            disabled={phase === "processing"}
            maxLength={200}
            value={selection.title}
            onChange={(event) =>
              setSelection({
                kind: "new_private_course",
                title: event.target.value,
              })
            }
          />
        </label>
      )}
      <div>
        <button
          disabled={!canApproveNextProposal(phase, selection)}
          type="button"
          onClick={() => void approve()}
        >
          {phase === "processing" ? "반영 중" : "Course에 추가"}
        </button>
        <button
          disabled={phase === "processing"}
          type="button"
          onClick={() => void dismiss()}
        >
          사용하지 않기
        </button>
      </div>
    </section>
  );
}
