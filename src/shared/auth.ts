export type AuthUser = {
  id: number;
  email: string;
};

export type AuthCredentials = {
  email: string;
  password: string;
};

export type AuthResponse = {
  user: AuthUser;
};
