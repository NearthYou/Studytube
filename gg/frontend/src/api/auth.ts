import { apiRequest, getStoredToken } from './client';
import type {
  LoginRequest,
  LoginResponse,
  SignupRequest,
  User,
} from '../types/auth';

export function signup(data: SignupRequest) {
  return apiRequest<User>('/auth/signup', {
    method: 'POST',
    body: data,
  });
}

export function login(data: LoginRequest) {
  return apiRequest<LoginResponse>('/auth/login', {
    method: 'POST',
    body: data,
  });
}

export function getMe() {
  return apiRequest<User>('/auth/me', {
    token: getStoredToken(),
  });
}