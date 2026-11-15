const env = process.env;
export const isProd = env.NODE_ENV === "production";

export function loadConfig(overrides = {}) {
  const secret = overrides.secret ?? env.JWT_SECRET ?? (isProd ? "" : "dev-only-secret-change-me-dev-only-secret");
  if (isProd && secret.length < 32) throw new Error("JWT_SECRET must be set to 32+ random characters in production.");
  return {
    port: Number(overrides.port ?? env.PORT ?? 4000),
    mongoUri: overrides.mongoUri ?? env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/nutrio",
    // Database inside the cluster; keeps Nutrio separate from other apps (e.g. "test").
    mongoDb: overrides.mongoDb ?? env.MONGODB_DB ?? "nutrio",
    secret,
    tokenTtlSec: 60 * 60 * 24 * 30,
    corsOrigins: (overrides.corsOrigins ?? env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean),
    // Number of reverse proxies in front of the API (so rate limits see the real client IP).
    trustProxy: Number(overrides.trustProxy ?? env.TRUST_PROXY ?? 0),
    seedDemo: overrides.seedDemo ?? (env.SEED_DEMO ? env.SEED_DEMO === "1" : !isProd),
    rateLimit: overrides.rateLimit ?? { max: 10, signupMax: 20, windowMs: 15 * 60 * 1000 },
  };
}

//----------- 15.11.2026 -----------------
// const env = process.env;
// export const isProd = env.NODE_ENV === "production";

// export function loadConfig(overrides = {}) {
//   const secret = overrides.secret ?? env.JWT_SECRET ?? (isProd ? "" : "dev-only-secret-change-me-dev-only-secret");
//   if (isProd && secret.length < 32) throw new Error("JWT_SECRET must be set to 32+ random characters in production.");
//   return {
//     port: Number(overrides.port ?? env.PORT ?? 4000),
//     mongoUri: overrides.mongoUri ?? env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/nutrio",
//     secret,
//     tokenTtlSec: 60 * 60 * 24 * 30,
//     corsOrigins: (overrides.corsOrigins ?? env.CORS_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean),
//     // Number of reverse proxies in front of the API (so rate limits see the real client IP).
//     trustProxy: Number(overrides.trustProxy ?? env.TRUST_PROXY ?? 0),
//     seedDemo: overrides.seedDemo ?? (env.SEED_DEMO ? env.SEED_DEMO === "1" : !isProd),
//     rateLimit: overrides.rateLimit ?? { max: 10, signupMax: 20, windowMs: 15 * 60 * 1000 },
//   };
// }
