import { HttpError, DuplicateError } from "../errors.js";
import { hashPassword, verifyPassword, signToken, verifyToken, RateLimiter } from "../auth.js";
import { PLANS, FOOD_DB, MEALS, dailyCalorieTarget } from "../catalog.js";
import { charge } from "../payments.js";
import * as v from "../validate.js";

const dayKey = (d) => d.toISOString().slice(0, 10);
const addDays = (key, n) => {
  const d = new Date(key + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return dayKey(d);
};
// A hash to compare against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA";

/**
 * All business rules live here. Services know nothing about Express or MongoDB:
 * they take a repository and return plain objects, so they can be unit-tested
 * (and are — against both the in-memory and the MongoDB repository).
 */
export function createServices({ repo, config, clock = () => new Date() }) {
  const today = () => dayKey(clock());
  const loginLimiter = new RateLimiter(config.rateLimit);
  const signupLimiter = new RateLimiter({ max: config.rateLimit.signupMax ?? 20, windowMs: config.rateLimit.windowMs });

  const issue = (u) => signToken({ userId: u.id, tokenVersion: u.tokenVersion }, config.secret, config.tokenTtlSec);

  async function user(userId) {
    const u = await repo.getUserById(userId);
    if (!u) throw new HttpError(401, "Please sign in again");
    return u;
  }

  /** The full per-user snapshot — the shape both clients consume. */
  async function snapshot(userId, { fullHistory = false } = {}) {
    const u = await repo.getUserById(userId);
    if (!u) return null;
    // Free plan: only the last 7 days of food (+1 day slack for time zones).
    const since = u.plan === "free" && !fullHistory ? addDays(today(), -8) : "0000-00-00";
    const [entries, days, customFoods, payments] = await Promise.all([
      repo.listEntries(userId, since),
      repo.listDays(userId),
      repo.listCustomFoods(userId),
      repo.listPayments(userId),
    ]);
    const foods = {};
    for (const e of entries) {
      (foods[e.date] ??= []).push({
        id: e.id, meal: e.meal, servings: e.servings, foodId: e.foodId, name: e.name, serving: e.serving,
        calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat,
      });
    }
    const water = {}, steps = {}, weights = {};
    for (const d of days) {
      if (d.waterMl != null) water[d.date] = d.waterMl;
      if (d.steps != null) steps[d.date] = d.steps;
      if (d.weightKg != null) weights[d.date] = d.weightKg;
    }
    return {
      user: { id: u.id, name: u.name, email: u.email },
      profile: u.profile ?? null,
      onboarded: !!u.onboarded,
      foods, water, steps, weights,
      customFoods: customFoods.map(customShape),
      bookmarks: u.bookmarks ?? [],
      plan: u.plan,
      payments: payments.map((p) => ({ id: p.id, date: p.date, planId: p.planId, amount: p.amount, last4: p.last4 })),
      settings: { units: "metric", remindWater: !!u.settings?.remindWater, remindMeals: !!u.settings?.remindMeals },
    };
  }

  const customShape = (f) => ({
    id: f.id, name: f.name, serving: f.serving, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat,
    ...(f.barcode ? { barcode: f.barcode } : {}), custom: true,
  });

  const requirePremium = (u, what) => {
    if (u.plan === "free") throw new HttpError(403, `${what} is a Premium feature`);
  };

  return {
    snapshot,

    /* ------------------------------ auth ------------------------------ */
    /** Resolves a bearer token to a user id, or null. Honors revocation (tokenVersion). */
    async authenticate(token) {
      const t = verifyToken(token, config.secret);
      if (!t) return null;
      const u = await repo.getUserById(t.sub);
      return u && u.tokenVersion === t.tv ? u.id : null;
    },

    async signup(body, ip = "?") {
      const name = v.str(body.name, "Name", 2, 60);
      const email = v.email(body.email);
      const password = v.str(body.password, "Password", 8, 128);
      if (!signupLimiter.take(ip)) throw new HttpError(429, "Too many attempts. Try again later.");
      let u;
      try {
        u = await repo.createUser({ email, name, passwordHash: await hashPassword(password) });
      } catch (e) {
        if (e instanceof DuplicateError) throw new HttpError(409, "An account with this email already exists");
        throw e;
      }
      return { token: issue(u), db: await snapshot(u.id) };
    },

    async login(body, ip = "?") {
      const email = v.email(body.email);
      const password = v.str(body.password, "Password", 1, 128);
      const key = `${ip}:${email}`;
      if (!loginLimiter.take(key)) throw new HttpError(429, "Too many attempts. Try again later.");
      const u = await repo.getUserByEmail(email);
      const ok = await verifyPassword(password, u?.passwordHash ?? DUMMY_HASH);
      if (!u || !ok) throw new HttpError(401, "Wrong email or password");
      loginLimiter.reset(key);
      return { token: issue(u), db: await snapshot(u.id) };
    },

    session: (userId) => snapshot(userId),

    /** Signs the account out everywhere (all issued tokens stop working). */
    async logoutAll(userId) {
      await repo.bumpTokenVersion(userId);
    },

    async changePassword(userId, body) {
      const u = await user(userId);
      const current = v.str(body.currentPassword, "Current password", 1, 128);
      const next = v.str(body.newPassword, "New password", 8, 128);
      if (!(await verifyPassword(current, u.passwordHash))) throw new HttpError(401, "Current password is wrong");
      await repo.updateUser(userId, { passwordHash: await hashPassword(next) });
      const fresh = await repo.bumpTokenVersion(userId); // sign out every other device
      return { token: issue(fresh), db: await snapshot(userId) };
    },

    deleteAccount: (userId) => repo.deleteUserCascade(userId),

    /* ---------------------- profile & settings ------------------------ */
    async saveProfile(userId, body) {
      const u = await user(userId);
      const p = v.profileFields(body, u.profile);
      const profile = { ...p, calorieTarget: p.calorieTarget ?? dailyCalorieTarget(p) };
      await repo.updateUser(userId, { profile, onboarded: true });
      const day = body.today ? v.dateKey(body.today, "today") : today();
      if (!(await repo.hasWeight(userId, day))) await repo.upsertDay(userId, day, { weightKg: p.weightKg });
      return snapshot(userId);
    },

    async saveAccount(userId, body) {
      await repo.updateUser(userId, { name: v.str(body.name, "Name", 2, 60) });
      return snapshot(userId);
    },

    async saveSettings(userId, body) {
      const u = await user(userId);
      const flag = (k, cur) => {
        if (body[k] === undefined) return cur;
        if (typeof body[k] !== "boolean") throw new HttpError(400, `${k} must be true or false`);
        return body[k];
      };
      await repo.updateUser(userId, {
        settings: { remindWater: flag("remindWater", u.settings.remindWater), remindMeals: flag("remindMeals", u.settings.remindMeals) },
      });
      return snapshot(userId);
    },

    /* ------------------------------- food ----------------------------- */
    async searchFoods(userId, q) {
      const s = String(q ?? "").trim().toLowerCase().slice(0, 80);
      const custom = (await repo.listCustomFoods(userId)).map(customShape);
      const all = [...custom, ...FOOD_DB];
      return { foods: s ? all.filter((f) => f.name.toLowerCase().includes(s)) : all };
    },

    async lookupBarcode(userId, code) {
      requirePremium(await user(userId), "The barcode scanner");
      const c = v.str(code, "Barcode", 1, 40);
      const all = [...(await repo.listCustomFoods(userId)).map(customShape), ...FOOD_DB];
      return { food: all.find((f) => f.barcode === c) ?? null };
    },

    async addFood(userId, body) {
      const date = v.dateKey(body.date);
      const meal = v.oneOf(body.meal, MEALS, "Meal");
      const servings = v.num(body.servings ?? 1, "Servings", 0.25, 50);
      const f = v.foodFields(body.food);
      const foodId = v.str(String(body.food.id ?? "custom"), "Food id", 1, 40);
      await repo.insertEntry(userId, { date, meal, servings, foodId, ...f });
      return snapshot(userId);
    },

    async updateFood(userId, entryId, body) {
      const ok = await repo.updateEntryServings(userId, entryId, v.dateKey(body.date), v.num(body.servings, "Servings", 0.25, 50));
      if (!ok) throw new HttpError(404, "Entry not found");
      return snapshot(userId);
    },

    async removeFood(userId, entryId, date) {
      await repo.deleteEntry(userId, entryId, v.dateKey(date));
      return snapshot(userId);
    },

    async saveCustomFood(userId, body) {
      const f = v.foodFields(body);
      const barcode = body.barcode ? v.str(String(body.barcode), "Barcode", 1, 40) : null;
      if (body.id) {
        if (!(await repo.updateCustomFood(userId, String(body.id), { ...f, barcode }))) throw new HttpError(404, "Food not found");
      } else {
        if ((await repo.countCustomFoods(userId)) >= 500) throw new HttpError(409, "Custom food limit reached");
        await repo.insertCustomFood(userId, { ...f, barcode });
      }
      return snapshot(userId);
    },

    async deleteCustomFood(userId, id) {
      await repo.deleteCustomFood(userId, id);
      return snapshot(userId);
    },

    /* ----------------------------- trackers --------------------------- */
    async setWater(userId, date, body) {
      await repo.upsertDay(userId, v.dateKey(date), { waterMl: Math.round(v.num(body.ml, "Water", 0, 20000)) });
      return snapshot(userId);
    },

    async setSteps(userId, date, body) {
      await repo.upsertDay(userId, v.dateKey(date), { steps: Math.round(v.num(body.steps, "Steps", 0, 200000)) });
      return snapshot(userId);
    },

    async logWeight(userId, date, body) {
      const d = v.dateKey(date);
      if (d > addDays(today(), 1)) throw new HttpError(400, "Date can't be in the future");
      const kg = +v.num(body.kg, "Weight", 30, 300).toFixed(1);
      await repo.upsertDay(userId, d, { weightKg: kg });
      // The profile's current weight follows the most recent weigh-in.
      const u = await user(userId);
      if (u.profile && d >= (await repo.latestWeightDate(userId))) {
        await repo.updateUser(userId, { profile: { ...u.profile, weightKg: kg } });
      }
      return snapshot(userId);
    },

    async deleteWeight(userId, date) {
      await repo.clearWeight(userId, v.dateKey(date));
      return snapshot(userId);
    },

    /* ----------------------------- content ---------------------------- */
    async toggleBookmark(userId, articleId) {
      await repo.toggleBookmark(userId, v.str(articleId, "Article id", 1, 40));
      return snapshot(userId);
    },

    /* --------------------------- subscription ------------------------- */
    plans: () => ({ plans: Object.values(PLANS) }),

    async subscribe(userId, body) {
      const planId = v.oneOf(body.planId, ["monthly", "yearly"], "Plan");
      const plan = PLANS[planId]; // price always comes from the server
      const result = await charge({ amount: plan.price, card: body.card });
      await repo.insertPayment(userId, { date: today(), planId, amount: plan.price, last4: result.last4 });
      await repo.updateUser(userId, { plan: planId });
      return snapshot(userId);
    },

    async cancelSubscription(userId) {
      await repo.updateUser(userId, { plan: "free" });
      return snapshot(userId);
    },

    async exportData(userId) {
      return { data: await snapshot(userId, { fullHistory: true }) };
    },
  };
}
