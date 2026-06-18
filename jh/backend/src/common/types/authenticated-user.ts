export interface AuthenticatedUser {
  id: string;
  email: string;
  nickname: string;
  profileImageUrl: string | null;
}
