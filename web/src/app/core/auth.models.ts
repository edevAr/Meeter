export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}
