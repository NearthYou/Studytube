export type User = {
    id: number;
    email: string;
    nickname: string;
};

export type SignupRequest = {
    email: string;
    password: string;
    nickname: string;
};

export type LoginRequest = {
    email: string;
    password: string;
};

export type LoginResponse = {
    accessToken: string;
    user: User;
};
