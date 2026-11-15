import { Router } from "express";
import { HttpError } from "../errors.js";

/** Thin HTTP layer: parse the request, call a service, send the result. */
export function buildRoutes(svc) {
  const r = Router();

  // Wrap an async handler: its return value becomes the JSON body (undefined -> 204).
  const h = (fn, okStatus = 200) => async (req, res, next) => {
    try {
      const out = await fn(req);
      if (out === undefined) return res.status(204).end();
      res.status(okStatus).json(out);
    } catch (e) {
      next(e);
    }
  };

  const auth = async (req, _res, next) => {
    try {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
      const id = m ? await svc.authenticate(m[1]) : null;
      if (!id) throw new HttpError(401, "Please sign in again");
      req.userId = id;
      next();
    } catch (e) {
      next(e);
    }
  };

  // Every body must be a JSON object.
  r.use((req, _res, next) =>
    Array.isArray(req.body) || (req.body !== undefined && typeof req.body !== "object")
      ? next(new HttpError(400, "Body must be a JSON object"))
      : next()
  );

  /* public */
  r.get("/health", h(async () => ({ ok: true })));
  r.get("/plans", h(async () => svc.plans()));
  r.post("/auth/signup", h((req) => svc.signup(req.body, req.ip), 201));
  r.post("/auth/login", h((req) => svc.login(req.body, req.ip)));

  /* everything below needs a valid token */
  r.use(auth);

  r.get("/session", h(async (req) => ({ db: await svc.session(req.userId) })));
  r.post("/auth/logout-all", h(async (req) => svc.logoutAll(req.userId)));
  r.post("/auth/change-password", h((req) => svc.changePassword(req.userId, req.body)));
  r.delete("/account", h((req) => svc.deleteAccount(req.userId)));

  r.put("/profile", h((req) => svc.saveProfile(req.userId, req.body)));
  r.patch("/account", h((req) => svc.saveAccount(req.userId, req.body)));
  r.patch("/settings", h((req) => svc.saveSettings(req.userId, req.body)));

  r.get("/foods", h((req) => svc.searchFoods(req.userId, req.query.q)));
  r.get("/foods/barcode/:code", h((req) => svc.lookupBarcode(req.userId, req.params.code)));
  r.post("/log", h((req) => svc.addFood(req.userId, req.body)));
  r.patch("/log/:id", h((req) => svc.updateFood(req.userId, req.params.id, req.body)));
  r.delete("/log/:id", h((req) => svc.removeFood(req.userId, req.params.id, req.query.date)));
  r.post("/custom-foods", h((req) => svc.saveCustomFood(req.userId, req.body)));
  r.delete("/custom-foods/:id", h((req) => svc.deleteCustomFood(req.userId, req.params.id)));

  r.put("/water/:date", h((req) => svc.setWater(req.userId, req.params.date, req.body)));
  r.put("/steps/:date", h((req) => svc.setSteps(req.userId, req.params.date, req.body)));
  r.put("/weights/:date", h((req) => svc.logWeight(req.userId, req.params.date, req.body)));
  r.delete("/weights/:date", h((req) => svc.deleteWeight(req.userId, req.params.date)));

  r.post("/bookmarks/:articleId/toggle", h((req) => svc.toggleBookmark(req.userId, req.params.articleId)));

  r.post("/subscription", h((req) => svc.subscribe(req.userId, req.body)));
  r.delete("/subscription", h((req) => svc.cancelSubscription(req.userId)));

  r.get("/export", h((req) => svc.exportData(req.userId)));

  return r;
}
