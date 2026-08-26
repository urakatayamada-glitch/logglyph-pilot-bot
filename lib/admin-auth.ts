import { createHmac, timingSafeEqual } from "crypto";

export const ADMIN_COOKIE = "logglyph_admin";

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || "logglyph-pilot-dev-secret";
}

/** Cookieに入れる署名付きトークンを作る */
export function issueToken(): string {
  const payload = String(Date.now());
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** 30日で失効させる */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;

  const expected = createHmac("sha256", secret()).update(payload).digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const issued = Number(payload);
  if (!Number.isFinite(issued)) return false;
  return Date.now() - issued < MAX_AGE_MS;
}

export function checkPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
