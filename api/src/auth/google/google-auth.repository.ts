import type { AuthPublicUser, SessionMaterial } from '../auth.types';

export type GoogleAuthAttemptPurpose = 'login' | 'delete_account';

export type CreateGoogleAuthAttemptCommand = {
  id: string;
  purpose: GoogleAuthAttemptPurpose;
  stateDigest: Buffer;
  nonceDigest: Buffer;
  encryptedCodeVerifier: Buffer;
  userId?: number;
  sessionId?: string;
  returnPath: string;
  createdAt: Date;
  expiresAt: Date;
};

export type StoredGoogleAuthAttempt = {
  id: string;
  purpose: GoogleAuthAttemptPurpose;
  nonceDigest: Buffer;
  encryptedCodeVerifier: Buffer;
  userId?: number;
  sessionId?: string;
  returnPath: string;
};

export type ConsumeGoogleAuthAttemptResult =
  | { status: 'consumed'; attempt: StoredGoogleAuthAttempt }
  | { status: 'invalid' };

export type CommitGoogleLoginCommand = SessionMaterial & {
  googleSubject: string;
  email: string;
  emailCanonical: string;
  name: string;
  profileImageUrl: string | null;
  authenticatedAt: Date;
};

export type CommitGoogleLoginResult =
  | {
      status: 'committed';
      user: AuthPublicUser;
      newUser: boolean;
    }
  | { status: 'invalid' };

export interface GoogleAuthRepository {
  createGoogleAuthAttempt(
    command: CreateGoogleAuthAttemptCommand,
  ): Promise<void>;
  consumeGoogleAuthAttempt(
    stateDigest: Buffer,
    consumedAt: Date,
  ): Promise<ConsumeGoogleAuthAttemptResult>;
  commitGoogleLogin(
    command: CommitGoogleLoginCommand,
  ): Promise<CommitGoogleLoginResult>;
}
