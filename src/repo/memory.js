import { randomBytes } from "node:crypto";
import { DuplicateError } from "../errors.js";

const hex24 = () => randomBytes(12).toString("hex"); // same look as a Mongo ObjectId
const clone = (x) => (x === undefined ? x : structuredClone(x));

/**
 * In-memory repository. Used by the unit tests and handy for running the API
 * without a database (STORE=memory). Implements exactly the same contract as
 * repo/mongo.js; both are exercised by the same test suite.
 */
export function createMemoryRepo() {
  let seq = 0;
  const users = new Map();
  const days = new Map(); // `${userId}|${date}` -> row
  const entries = [];
  const customFoods = [];
  const payments = [];

  const byUser = (arr, userId) => arr.filter((r) => r.userId === userId);

  return {
    kind: "memory",
    async close() {},

    /* users */
    async createUser({ email, name, passwordHash }) {
      for (const u of users.values()) if (u.email === email) throw new DuplicateError(email);
      const u = {
        id: hex24(), email, name, passwordHash, onboarded: false, plan: "free", profile: null,
        settings: { remindWater: true, remindMeals: false }, bookmarks: [], tokenVersion: 0,
      };
      users.set(u.id, u);
      return clone(u);
    },
    async getUserById(id) { return clone(users.get(id) ?? null); },
    async getUserByEmail(email) {
      for (const u of users.values()) if (u.email === email) return clone(u);
      return null;
    },
    async updateUser(id, patch) {
      const u = users.get(id);
      if (!u) return null;
      Object.assign(u, clone(patch));
      return clone(u);
    },
    async bumpTokenVersion(id) {
      const u = users.get(id);
      if (!u) return null;
      u.tokenVersion += 1;
      return clone(u);
    },
    async toggleBookmark(id, articleId) {
      const u = users.get(id);
      const i = u.bookmarks.indexOf(articleId);
      if (i >= 0) u.bookmarks.splice(i, 1);
      else u.bookmarks.push(articleId);
    },
    async deleteUserCascade(id) {
      users.delete(id);
      for (const arr of [entries, customFoods, payments]) {
        for (let i = arr.length - 1; i >= 0; i--) if (arr[i].userId === id) arr.splice(i, 1);
      }
      for (const k of [...days.keys()]) if (k.startsWith(id + "|")) days.delete(k);
    },

    /* per-day trackers */
    async upsertDay(userId, date, fields) {
      const k = `${userId}|${date}`;
      days.set(k, { ...(days.get(k) ?? { userId, date }), ...fields });
    },
    async listDays(userId) { return clone(byUser([...days.values()], userId)); },
    async hasWeight(userId, date) { return days.get(`${userId}|${date}`)?.weightKg != null; },
    async clearWeight(userId, date) {
      const r = days.get(`${userId}|${date}`);
      if (r) delete r.weightKg;
    },
    async latestWeightDate(userId) {
      const ds = byUser([...days.values()], userId).filter((r) => r.weightKg != null).map((r) => r.date);
      return ds.length ? ds.sort().at(-1) : "";
    },

    /* food log */
    async insertEntry(userId, e) {
      const row = { ...e, id: hex24(), userId, seq: ++seq };
      entries.push(row);
      return clone(row);
    },
    async listEntries(userId, since) {
      return clone(byUser(entries, userId).filter((e) => e.date >= since).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq - b.seq)));
    },
    async updateEntryServings(userId, id, date, servings) {
      const e = entries.find((x) => x.id === id && x.userId === userId && x.date === date);
      if (!e) return false;
      e.servings = servings;
      return true;
    },
    async deleteEntry(userId, id, date) {
      const i = entries.findIndex((x) => x.id === id && x.userId === userId && x.date === date);
      if (i >= 0) entries.splice(i, 1);
    },

    /* custom foods */
    async listCustomFoods(userId) { return clone(byUser(customFoods, userId).sort((a, b) => b.seq - a.seq)); },
    async countCustomFoods(userId) { return byUser(customFoods, userId).length; },
    async insertCustomFood(userId, f) {
      const row = { ...f, id: hex24(), userId, seq: ++seq };
      customFoods.push(row);
      return clone(row);
    },
    async updateCustomFood(userId, id, f) {
      const r = customFoods.find((x) => x.id === id && x.userId === userId);
      if (!r) return false;
      Object.assign(r, f);
      return true;
    },
    async deleteCustomFood(userId, id) {
      const i = customFoods.findIndex((x) => x.id === id && x.userId === userId);
      if (i >= 0) customFoods.splice(i, 1);
    },

    /* payments */
    async insertPayment(userId, p) {
      const row = { ...p, id: "pay_" + hex24(), userId, seq: ++seq };
      payments.push(row);
      return clone(row);
    },
    async listPayments(userId) { return clone(byUser(payments, userId).sort((a, b) => b.seq - a.seq)); },
  };
}
