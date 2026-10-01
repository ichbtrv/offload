import { isExpired } from './session.js';

export function authorize(expiresAt: number, now: number): boolean {
  return !isExpired(expiresAt, now);
}
