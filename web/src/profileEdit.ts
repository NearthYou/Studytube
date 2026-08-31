import type { User } from "./types";

export type ProfileEditDraft = {
  name: string;
  email: string;
};

export function profileEditDraftFromUser(user: User): ProfileEditDraft {
  return {
    name: user.name,
    email: user.email,
  };
}
