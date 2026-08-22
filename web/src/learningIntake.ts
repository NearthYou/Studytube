import { requestJson } from "./api.ts";

export type LearningIntakeInput = {
  videoUrl: string;
  requestedAudioSeconds: number;
};

export type LearningIntakeResult = {
  admission: "created" | "joined";
  workId: string;
  reservedAudioSeconds: number;
  context: { studyContext: { id: string } };
};

export function startLearningIntake(
  input: LearningIntakeInput,
): Promise<LearningIntakeResult> {
  return requestJson<LearningIntakeResult>("/learning/items/intake", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
