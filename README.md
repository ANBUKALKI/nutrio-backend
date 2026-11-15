# Nutrio API — Express + MongoDB

One backend for the **React web app** and the **Flutter app**. Same `/v1` REST contract the
clients already use, so they work unchanged (see "Connect the clients").

```bash
npm install
# start MongoDB (or use Docker below), then:
npm start                       # http://localhost:4000  — dev seeds demo@nutrio.app / demo1234
npm test                        # service + HTTP tests (in-memory); add TEST_MONGO_URI to test MongoDB too
```

No MongoDB handy? `npm run start:memory` runs entirely in memory (data is lost on restart).

Docker (generate a secret first, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`):

| Shell | Command |
|---|---|
| macOS / Linux | `JWT_SECRET=<secret> SEED_DEMO=1 docker compose up --build` |
| PowerShell | `$env:JWT_SECRET="<secret>"; $env:SEED_DEMO="1"; docker compose up --build` |
| cmd.exe | `set JWT_SECRET=<secret>` then `set SEED_DEMO=1` then `docker compose up --build` |

Test MongoDB itself (runs the full suite against a throwaway database and drops it afterwards):

| Shell | Command |
|---|---|
| macOS / Linux | `TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test` |
| PowerShell | `$env:TEST_MONGO_URI="mongodb://127.0.0.1:27017"; npm test` |
| cmd.exe | `set TEST_MONGO_URI=mongodb://127.0.0.1:27017` then `npm test` |

Settings come from `.env.example` values or environment variables; the app has no `.env` loader,
so on Windows set them in the shell as above (defaults work for local dev).

## Architecture

```
routes (src/http)  →  services (src/services)  →  repository (src/repo)
Express, thin         all business rules          memory.js  |  mongo.js (Mongoose)
```

- **Services** hold every rule (validation, premium gating, pricing, history window) and know nothing
  about Express or MongoDB.
- **Repositories** implement one contract. `test/suite.js` runs the same behavioural tests against both.
- **Collections:** `users` (profile, settings, bookmarks, plan, tokenVersion embedded), `days`
  (water / steps / weight per user+date), `entries` (food log), `customfoods`, `payments`.
  Unique indexes on `users.email` and `days(userId,date)` make concurrent writes safe.

## Connect the clients

| Client  | How |
|---------|-----|
| Web     | `VITE_API_URL=http://localhost:4000 npm run dev` |
| Flutter | `flutter run --dart-define=API_URL=http://10.0.2.2:4000` (Android emulator) · `http://localhost:4000` (iOS simulator / desktop) |

Both send `Authorization: Bearer <token>`; every change returns the **full user snapshot**.
Errors are `{ "error": "message" }` — 400 validation, 401 sign in, 403 Premium, 404, 409, 429.

## Endpoints (`/v1`)

| Method & path | Body → Response |
|---|---|
| `POST /auth/signup` | `{name,email,password}` → `201 {token, db}` |
| `POST /auth/login` | `{email,password}` → `{token, db}` |
| `POST /auth/change-password` | `{currentPassword,newPassword}` → `{token, db}` (signs out other devices) |
| `POST /auth/logout-all` | → `204` (revokes every token of this user) |
| `GET /session` | → `{db}` |
| `DELETE /account` | → `204` (erases all data) |
| `PUT /profile` | profile fields (+ optional `today`) → `db`; `calorieTarget` missing/0 is calculated |
| `PATCH /account` · `PATCH /settings` | `{name}` · `{remindWater?, remindMeals?}` → `db` |
| `GET /foods?q=` | → `{foods}` (your custom foods first) |
| `GET /foods/barcode/:code` | → `{food\|null}` — **Premium** |
| `POST /log` · `PATCH /log/:id` · `DELETE /log/:id?date=` | `{date,meal,servings,food}` · `{date,servings}` → `db` |
| `POST /custom-foods` · `DELETE /custom-foods/:id` | food (`id` to edit) → `db` |
| `PUT /water/:date` · `PUT /steps/:date` | `{ml}` · `{steps}` → `db` |
| `PUT /weights/:date` · `DELETE /weights/:date` | `{kg}` → `db` |
| `POST /bookmarks/:articleId/toggle` | → `db` |
| `GET /plans` | → `{plans}` |
| `POST /subscription` · `DELETE /subscription` | `{planId, card}` → `db` |
| `GET /export` | → `{data}` (full history) |
| `GET /health` | → `{ok:true}` |

## Security notes

scrypt password hashing; HMAC-signed 30-day tokens revocable via `tokenVersion`; per-email login and
per-IP signup limits plus a global 300 req/min limit; helmet; 100 KB body limit; strict validation;
every query scoped to the signed-in user; client-supplied prices ignored; free-plan limits enforced
server-side. Set `JWT_SECRET` (32+ chars) and a real `CORS_ORIGINS`, and serve over HTTPS.

## Before real launch

- **Payments are a demo.** `src/payments.js` checks the card format and stores the last 4 digits;
  subscriptions never renew or expire. Integrate Stripe/Razorpay (server-side checkout + webhooks) and
  stop sending raw card numbers through your own API.
- Password reset and email verification need an email provider.
- Login/signup limiters are per-process; use Redis (or a gateway) if you run several instances.
- Payment + plan change are two writes, not a transaction (Mongo transactions need a replica set).
- Articles and plan descriptions are still bundled in the clients; only prices are server-owned.
