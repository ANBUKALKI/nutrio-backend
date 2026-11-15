import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { buildRoutes } from "./http/routes.js";
import { HttpError } from "./errors.js";

export function createApp({ services, config }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins.includes("*") ? "*" : config.corsOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: "100kb" }));
  app.use("/v1", rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Slow down." } }));
  app.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  app.use("/v1", buildRoutes(services));
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Body must be valid JSON" });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request body too large" });
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Something went wrong on our side" });
  });

  return app;
}
