import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/* ---- passwords: scrypt (OWASP-approved) with a per-user random salt ---- */
const scryptAsync = (pw, salt) =>
  new Promise((res, rej) => scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const [alg, saltB64, keyB64] = String(stored).split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltB64, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/* ---- signed bearer tokens (HMAC-SHA256). `tv` lets us revoke every token of a user. ---- */
export function signToken({ userId, tokenVersion }, secret, ttlSec) {
  const payload = Buffer.from(
    JSON.stringify({ sub: userId, tv: tokenVersion, exp: Math.floor(Date.now() / 1000) + ttlSec })
  ).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

/** Returns { sub, tv } for a valid, unexpired token, otherwise null. */
export function verifyToken(token, secret) {
  if (typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { sub, tv, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!(exp > Date.now() / 1000) || typeof sub !== "string" || !Number.isInteger(tv)) return null;
    return { sub, tv };
  } catch {
    return null;
  }
}

/* ---- small in-memory sliding-window limiter (per process) ---- */
export class RateLimiter {
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  take(key, now = Date.now()) {
    const fresh = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (fresh.length >= this.max) {
      this.hits.set(key, fresh);
      return false;
    }
    fresh.push(now);
    this.hits.set(key, fresh);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
  reset(key) {
    this.hits.delete(key);
  }
}
