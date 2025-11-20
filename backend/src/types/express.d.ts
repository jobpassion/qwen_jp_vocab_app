import { AuthUser } from '../services/authService';
import { SessionRecord } from '../db/types';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      session?: SessionRecord;
    }
  }
}

export {};
