export type AnalysisResult = {
  summary: string;
  recommendation: string;
  nextGoal: string;
  referencedPostCount: number;
  referencedPosts: {
    id: number;
    title: string;
    date: string;
    matchedExercises: string[];
  }[];
  basis: string[];
  analysisMode: string;
  toolCalls: {
    toolName: string;
    input: string;
    output: string;
    status: string;
    source: string;
  }[];
  workflowSteps: {
    step: number;
    name: string;
    status: string;
    detail: string;
  }[];
};
