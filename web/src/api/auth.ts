import { api } from './client';
import { User } from '../types';

export interface SignupData {
  email: string;
  password: string;
  name: string;
  specialization: string;
  clinicName: string;
  country: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export const authApi = {
  signup: (data: SignupData) =>
    api.post<{ token: string; user: User }>('/auth/signup', data),
  login: (data: LoginData) =>
    api.post<{ token: string; user: User }>('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get<{ user: User }>('/auth/me'),
};



