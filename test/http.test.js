import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepo } from "../src/repo/memory.js";
import { createServices } from "../src/services/index.js";
import { loadConfig } from "../src/config.js";

// The HTTP layer needs express/helmet/cors installed (`npm install`); skip cleanly if it isn't.
let createApp = null;
try { ({ createApp } = await import("../src/app.js")); } catch (e) { console.warn("HTTP tests skipped:", e.code ?? e.message); }

const skip = createApp ? false : "dependencies not installed (run npm install)";
let server, base;
const today = new Date().toISOString().slice(0, 10);

before(async () => {
  if (skip) return;
  const config = loadConfig({ secret: "h".repeat(40), seedDemo: false, corsOrigins: "http://localhost:5173" });
  const app = createApp({ services: createServices({ repo: createMemoryRepo(), config }), config });
  await new Promise((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => server?.close());

async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body || raw ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
}

test("full flow over HTTP: signup → profile → log → premium → delete", { skip }, async () => {
  const s = await call("POST", "/auth/signup", { body: { name: "Asha", email: "asha@t.dev", password: "secret123" } });
  assert.equal(s.status, 201);
  const token = s.json.token;
  let r = await call("PUT", "/profile", { token, body: { sex: "female", age: 28, heightCm: 165, weightKg: 62, goalWeightKg: 58, activity: "light", goal: "lose", today } });
  assert.equal(r.status, 200);
  assert.equal(r.json.onboarded, true);
  r = await call("POST", "/log", { token, body: { date: today, meal: "lunch", servings: 2, food: { id: "f1", name: "Banana", serving: "1", calories: 105, protein: 1, carbs: 27, fat: 0 } } });
  const entry = r.json.foods[today][0];
  assert.equal(entry.servings, 2);
  r = await call("DELETE", `/log/${entry.id}?date=${today}`, { token });
  assert.equal(r.json.foods[today].length, 0);
  assert.equal((await call("GET", "/foods/barcode/8901000000011", { token })).status, 403);
  r = await call("POST", "/subscription", { token, body: { planId: "monthly", card: { number: "4242424242424242", expiry: "12/39", cvc: "123" } } });
  assert.equal(r.json.payments[0].amount, 199);
  assert.equal((await call("GET", "/foods/barcode/8901000000011", { token })).json.food.name, "Banana");
  assert.equal((await call("GET", "/session", { token })).json.db.user.email, "asha@t.dev");
  assert.equal((await call("DELETE", "/account", { token })).status, 204);
  assert.equal((await call("GET", "/session", { token })).status, 401);
});

test("auth, validation, parsing and CORS errors are JSON with the right status", { skip }, async () => {
  assert.equal((await call("GET", "/health")).json.ok, true);
  assert.equal((await call("GET", "/session")).status, 401);
  assert.equal((await call("GET", "/session", { token: "x.y" })).status, 401);
  assert.equal((await call("POST", "/auth/login", { raw: "{not json" })).status, 400);
  assert.equal((await call("POST", "/auth/login", { raw: "[1,2]" })).status, 400);
  const bad = await call("POST", "/auth/signup", { body: { name: "A", email: "nope", password: "x" } });
  assert.equal(bad.status, 400);
  assert.equal(typeof bad.json.error, "string");
  assert.equal((await call("GET", "/nope")).status, 404);
  const pre = await fetch(base + "/session", { method: "OPTIONS", headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "GET" } });
  assert.equal(pre.headers.get("access-control-allow-origin"), "http://localhost:5173");
});
