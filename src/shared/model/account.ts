export interface AccountView {
  id: string;
  username: string;
}

export const USERNAME_PATTERN = /^\p{L}{1,16}$/u;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
