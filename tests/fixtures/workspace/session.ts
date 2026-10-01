export function isExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}
