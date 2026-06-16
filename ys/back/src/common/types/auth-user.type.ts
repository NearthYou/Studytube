export type AuthUser = {
  id: number;
  loginId: string;
  name: string;
  email: string;
  nickname: string;
  bio: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
};
