import { config } from '../config/env';
import {
  createSession,
  deleteSessionByToken,
  getSessionByToken,
  purgeExpiredSessions,
} from '../repositories/sessionRepository';
import { createUser, getUserByEmail, getUserById } from '../repositories/userRepository';
import { hashPassword, verifyPassword } from '../utils/password';
import { generateSessionToken } from '../utils/token';
import { SessionRecord, UserRecord } from '../db/types';

const sessionDurationMs = config.sessionDurationHours * 60 * 60 * 1000;

export type AuthUser = Pick<UserRecord, 'id' | 'email' | 'createdAt'>;

const toAuthUser = (user: UserRecord): AuthUser => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt,
});

const isSessionExpired = (session: SessionRecord) => new Date(session.expiresAt).getTime() <= Date.now();

export const register = async (email: string, password: string): Promise<AuthUser> => {
  const existing = getUserByEmail(email);
  if (existing) {
    throw new Error('Email already registered');
  }
  const passwordHash = await hashPassword(password);
  const user = createUser(email, passwordHash);
  return toAuthUser(user);
};

export const login = async (
  email: string,
  password: string
): Promise<{ token: string; expiresAt: string; user: AuthUser }> => {
  const user = getUserByEmail(email);
  if (!user) {
    throw new Error('Invalid credentials');
  }
  const isValid = await verifyPassword(password, user.passwordHash);
  if (!isValid) {
    throw new Error('Invalid credentials');
  }
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + sessionDurationMs);
  const session = createSession(user.id, token, expiresAt);
  return {
    token: session.token,
    expiresAt: session.expiresAt,
    user: toAuthUser(user),
  };
};

export const logout = (token: string) => {
  deleteSessionByToken(token);
};

export const authenticateToken = (
  token: string
): { user: AuthUser; session: SessionRecord } | undefined => {
  purgeExpiredSessions();
  const session = getSessionByToken(token);
  if (!session || isSessionExpired(session)) {
    return undefined;
  }
  const user = getUserById(session.userId);
  if (!user) {
    deleteSessionByToken(token);
    return undefined;
  }
  return {
    user: toAuthUser(user),
    session,
  };
};
