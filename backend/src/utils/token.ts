import crypto from 'crypto';

export const generateSessionToken = () => crypto.randomBytes(48).toString('hex');
