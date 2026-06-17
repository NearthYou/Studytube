import type { User } from './types';

export const PROFILE_EDIT_VERIFICATION_TTL_MS = 5 * 60 * 1000;

export type ProfileEditDraft = {
  name: string;
  email: string;
  password: string;
  interests: string;
  pace: string;
  goal: string;
};

export function profileEditDraftFromUser(user: User): ProfileEditDraft {
  return {
    name: user.name,
    email: user.email,
    password: '',
    interests: user.preferences.interests.join(', '),
    pace: user.preferences.pace,
    goal: user.preferences.goal,
  };
}

export function isProfileEditVerificationFresh(
  verifiedAt: number | null | undefined,
  now = Date.now(),
  ttlMs = PROFILE_EDIT_VERIFICATION_TTL_MS,
) {
  return typeof verifiedAt === 'number' && now - verifiedAt <= ttlMs;
}
