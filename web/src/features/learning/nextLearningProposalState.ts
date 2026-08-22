export type NextProposalPhase =
  | "pending"
  | "processing"
  | "success"
  | "rejected"
  | "expired"
  | "version_conflict";

export type NextProposalSelection =
  | {
      kind: "existing_course";
      courseId: number;
      expectedCourseVersion: number;
    }
  | { kind: "new_private_course"; title: string };

export function initialNextProposalSelection(
  courses: Array<{ id: number; version: number }>,
): NextProposalSelection {
  const first = courses[0];
  return first
    ? {
        kind: "existing_course",
        courseId: first.id,
        expectedCourseVersion: first.version,
      }
    : { kind: "new_private_course", title: "" };
}

export function canApproveNextProposal(
  phase: NextProposalPhase,
  selection: NextProposalSelection,
) {
  if (phase !== "pending") return false;
  if (selection.kind === "existing_course") {
    return selection.courseId > 0 && selection.expectedCourseVersion > 0;
  }
  return selection.title.trim().length > 0 && selection.title.trim().length <= 200;
}

export function proposalFailurePhase(code: string): NextProposalPhase {
  if (code === "LEARNING_PROPOSAL_EXPIRED") return "expired";
  if (code === "LEARNING_PROPOSAL_REJECTED") return "rejected";
  return "version_conflict";
}
