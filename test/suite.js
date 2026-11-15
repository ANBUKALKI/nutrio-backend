import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServices } from "../src/services/index.js";
import { HttpError } from "../src/errors.js";
import { seedDemo } from "../src/demo.js";
import { loadConfig } from "../src/config.js";

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const profile = { sex: "male", age: 30, heightCm: 180, weightKg: 80, goalWeightKg: 75, activity: "moderate", goal: "maintain" };
const card = { number: "4242 4242 4242 4242", expiry: "12/39", cvc: "123" };
const banana = { id: "f1", name: "Banana", serving: "1 medium", calories: 105, protein: 1.3, carbs: 27, fat: 0.4 };

/** Rejects unless the promise fails with an HttpError of the given status. */
async function status(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof HttpError, `expected HttpError, got ${e}`);
    assert.equal(e.status, code, e.message);
    return true;
  });
}

/**
 * The behavioural contract of the backend. It runs against the in-memory repo
 * on every `npm test`, and against real MongoDB when TEST_MONGO_URI is set.
 */
export function defineSuite(name, makeRepo) {
  describe(name, () => {
    let repo, svc;
    before(async () => {
      repo = await makeRepo();
      const config = loadConfig({ secret: "s".repeat(40), seedDemo: false, rateLimit: { max: 5, signupMax: 1000, windowMs: 60_000 } });
      svc = createServices({ repo, config });
    });
    after(async () => { await repo.drop?.(); await repo.close(); });

    const signup = async (email = `u${Math.random().toString(36).slice(2)}@t.dev`) => {
      const r = await svc.signup({ name: "Asha", email, password: "secret123" });
      return { token: r.token, db: r.db, id: r.db.user.id, email };
    };

    it("signup → onboarding → snapshot has the shape both clients expect", async () => {
      const { id, db } = await signup();
      assert.equal(db.onboarded, false);
      assert.equal(db.profile, null);
      assert.equal(db.plan, "free");
      const r = await svc.saveProfile(id, { ...profile, today });
      assert.equal(r.onboarded, true);
      assert.equal(r.profile.calorieTarget, 2760); // same Mifflin-St Jeor maths as the clients
      assert.equal(r.weights[today], 80);
      assert.deepEqual(Object.keys(r).sort(), ["bookmarks", "customFoods", "foods", "onboarded", "payments", "plan", "profile", "settings", "steps", "user", "water", "weights"]);
      assert.equal(typeof r.user.id, "string");
    });

    it("explicit calorie target is kept; 0 means 'calculate it'", async () => {
      const { id } = await signup();
      assert.equal((await svc.saveProfile(id, { ...profile, calorieTarget: 2100 })).profile.calorieTarget, 2100);
      assert.equal((await svc.saveProfile(id, { ...profile, calorieTarget: 0 })).profile.calorieTarget, 2760);
    });

    it("rejects duplicate emails, weak passwords and wrong logins", async () => {
      const { email } = await signup();
      await status(svc.signup({ name: "A B", email, password: "secret123" }), 409);
      await status(svc.signup({ name: "A B", email: "new@t.dev", password: "short" }), 400);
      await status(svc.login({ email, password: "wrong-pass" }), 401);
      await status(svc.login({ email: "nobody@t.dev", password: "secret123" }), 401);
      assert.ok((await svc.login({ email: email.toUpperCase(), password: "secret123" })).token);
    });

    it("login attempts are rate limited", async () => {
      const { email } = await signup();
      for (let i = 0; i < 5; i++) await status(svc.login({ email, password: "nope-nope" }, "9.9.9.9"), 401);
      await status(svc.login({ email, password: "nope-nope" }, "9.9.9.9"), 429);
    });

    it("tokens: valid ones authenticate; tampered, foreign and revoked ones don't", async () => {
      const { token, id } = await signup();
      assert.equal(await svc.authenticate(token), id);
      const [p, s] = token.split(".");
      assert.equal(await svc.authenticate(`${p}.${s.slice(0, -2)}AA`), null);
      assert.equal(await svc.authenticate("garbage"), null);
      await svc.logoutAll(id);
      assert.equal(await svc.authenticate(token), null, "logout-all must revoke existing tokens");
    });

    it("change password: needs the current one, signs out other devices, new password works", async () => {
      const { token, id, email } = await signup();
      await status(svc.changePassword(id, { currentPassword: "nope-nope", newPassword: "brand-new-1" }), 401);
      const r = await svc.changePassword(id, { currentPassword: "secret123", newPassword: "brand-new-1" });
      assert.equal(await svc.authenticate(token), null);
      assert.equal(await svc.authenticate(r.token), id);
      await status(svc.login({ email, password: "secret123" }), 401);
      assert.ok((await svc.login({ email, password: "brand-new-1" })).token);
    });

    it("demo account has 14 days of data", async () => {
      await seedDemo(repo);
      assert.equal(await seedDemo(repo), false, "seeding is idempotent");
      const { db } = await svc.login({ email: "demo@nutrio.app", password: "demo1234" });
      assert.equal(Object.keys(db.water).length, 14);
      assert.ok(Object.keys(db.weights).length >= 14);
      assert.ok(db.profile.calorieTarget >= 1200);
      assert.ok(db.foods[today].length >= 3);
    });

    it("food log: add, change servings, remove — and users can't touch each other's data", async () => {
      const a = await signup(), b = await signup();
      let r = await svc.addFood(a.id, { date: today, meal: "breakfast", servings: 2, food: banana });
      const entry = r.foods[today][0];
      assert.equal(entry.foodId, "f1");
      assert.equal(entry.servings, 2);
      await status(svc.updateFood(b.id, entry.id, { date: today, servings: 9 }), 404);
      await svc.removeFood(b.id, entry.id, today);
      assert.equal((await svc.session(a.id)).foods[today][0].servings, 2, "other user's delete must not remove it");
      await status(svc.updateFood(a.id, "not-a-real-id", { date: today, servings: 1 }), 404);
      r = await svc.updateFood(a.id, entry.id, { date: today, servings: 1.5 });
      assert.equal(r.foods[today][0].servings, 1.5);
      r = await svc.removeFood(a.id, entry.id, today);
      assert.equal((r.foods[today] ?? []).length, 0);
    });

    it("entries keep the order they were added in", async () => {
      const { id } = await signup();
      for (const name of ["One", "Two", "Three"]) await svc.addFood(id, { date: today, meal: "lunch", food: { ...banana, name } });
      assert.deepEqual((await svc.session(id)).foods[today].map((e) => e.name), ["One", "Two", "Three"]);
    });

    it("validation: bad dates, meals and numbers are 400s", async () => {
      const { id } = await signup();
      const food = { name: "X", serving: "1", calories: 10, protein: 0, carbs: 0, fat: 0 };
      await status(svc.addFood(id, { date: "2026-13-40", meal: "lunch", food }), 400);
      await status(svc.addFood(id, { date: today, meal: "brunch", food }), 400);
      await status(svc.addFood(id, { date: today, meal: "lunch", food: { ...food, calories: -5 } }), 400);
      await status(svc.addFood(id, { date: today, meal: "lunch", food: { ...food, calories: "10" } }), 400);
      await status(svc.setWater(id, today, { ml: "lots" }), 400);
      await status(svc.saveProfile(id, { ...profile, age: 5 }), 400);
      await status(svc.saveProfile(id, { ...profile, sex: "x" }), 400);
    });

    it("water, steps and weight; profile weight follows the latest weigh-in", async () => {
      const { id } = await signup();
      await svc.saveProfile(id, { ...profile, today });
      assert.equal((await svc.setWater(id, today, { ml: 750 })).water[today], 750);
      assert.equal((await svc.setSteps(id, today, { steps: 4321 })).steps[today], 4321);
      let r = await svc.logWeight(id, today, { kg: 79.46 });
      assert.equal(r.weights[today], 79.5);
      assert.equal(r.profile.weightKg, 79.5);
      r = await svc.logWeight(id, daysAgo(5), { kg: 85 });
      assert.equal(r.profile.weightKg, 79.5, "an older weigh-in must not change the current weight");
      await status(svc.logWeight(id, "2999-01-01", { kg: 70 }), 400);
      r = await svc.deleteWeight(id, daysAgo(5));
      assert.equal(r.weights[daysAgo(5)], undefined);
      assert.equal(r.weights[today], 79.5);
      // water and steps on the same day survive a weight delete
      r = await svc.deleteWeight(id, today);
      assert.equal(r.water[today], 750);
    });

    it("custom foods: create, edit, delete, search; others can't edit mine", async () => {
      const a = await signup(), b = await signup();
      let r = await svc.saveCustomFood(a.id, { name: "Mom's Khichdi", serving: "1 bowl", calories: 220, protein: 8, carbs: 38, fat: 4 });
      const id = r.customFoods[0].id;
      assert.equal(r.customFoods[0].custom, true);
      await status(svc.saveCustomFood(b.id, { id, name: "Hacked", serving: "1", calories: 1 }), 404);
      r = await svc.saveCustomFood(a.id, { id, name: "Mom's Khichdi", serving: "1 bowl", calories: 250, protein: 8, carbs: 38, fat: 4 });
      assert.equal(r.customFoods[0].calories, 250);
      assert.equal((await svc.searchFoods(a.id, "khichdi")).foods[0].id, id);
      assert.equal((await svc.searchFoods(b.id, "khichdi")).foods.length, 0, "custom foods are private");
      assert.equal((await svc.searchFoods(a.id, "banana")).foods[0].name, "Banana");
      await svc.saveCustomFood(a.id, { name: "Newer", serving: "1", calories: 1, protein: 0, carbs: 0, fat: 0 });
      assert.equal((await svc.session(a.id)).customFoods[0].name, "Newer", "newest first");
      r = await svc.deleteCustomFood(a.id, id);
      assert.equal(r.customFoods.length, 1);
    });

    it("premium: barcode is gated; checkout validates the card and uses the server's price", async () => {
      const { id } = await signup();
      await status(svc.lookupBarcode(id, "8901000000011"), 403);
      await status(svc.subscribe(id, { planId: "monthly", card: { ...card, number: "1234" } }), 400);
      await status(svc.subscribe(id, { planId: "monthly", card: { ...card, expiry: "01/20" } }), 400);
      await status(svc.subscribe(id, { planId: "monthly", card: { ...card, expiry: "13/30" } }), 400);
      await status(svc.subscribe(id, { planId: "free", card }), 400);
      assert.equal((await svc.session(id)).plan, "free", "failed payments must not upgrade the plan");
      const r = await svc.subscribe(id, { planId: "yearly", amount: 1, card }); // client-sent amount is ignored
      assert.equal(r.plan, "yearly");
      assert.deepEqual({ amount: r.payments[0].amount, last4: r.payments[0].last4, date: r.payments[0].date }, { amount: 1499, last4: "4242", date: today });
      assert.equal((await svc.lookupBarcode(id, "8901000000011")).food.name, "Banana");
      assert.equal((await svc.lookupBarcode(id, "0000")).food, null);
      assert.equal((await svc.cancelSubscription(id)).plan, "free");
    });

    it("payments are listed newest first", async () => {
      const { id } = await signup();
      await svc.subscribe(id, { planId: "monthly", card });
      await svc.subscribe(id, { planId: "yearly", card });
      assert.deepEqual((await svc.session(id)).payments.map((p) => p.planId), ["yearly", "monthly"]);
    });

    it("free plan only serves 7 days of food; premium serves all; export returns everything", async () => {
      const { id } = await signup();
      const old = daysAgo(30);
      await svc.addFood(id, { date: old, meal: "lunch", food: banana });
      await svc.addFood(id, { date: today, meal: "lunch", food: banana });
      let r = await svc.session(id);
      assert.equal(r.foods[old], undefined);
      assert.ok(r.foods[today]);
      assert.ok((await svc.exportData(id)).data.foods[old], "export includes full history");
      await svc.subscribe(id, { planId: "monthly", card });
      assert.ok((await svc.session(id)).foods[old]);
    });

    it("bookmarks toggle, settings patch, name change", async () => {
      const { id } = await signup();
      assert.deepEqual((await svc.toggleBookmark(id, "a1")).bookmarks, ["a1"]);
      assert.deepEqual((await svc.toggleBookmark(id, "a2")).bookmarks, ["a1", "a2"]);
      assert.deepEqual((await svc.toggleBookmark(id, "a1")).bookmarks, ["a2"]);
      let r = await svc.saveSettings(id, { remindMeals: true });
      assert.deepEqual([r.settings.remindWater, r.settings.remindMeals], [true, true]);
      await status(svc.saveSettings(id, { remindMeals: "yes" }), 400);
      assert.equal((await svc.saveAccount(id, { name: "New Name" })).user.name, "New Name");
      await status(svc.saveAccount(id, { name: "x" }), 400);
    });

    it("deleting the account erases all of the user's data and kills the token", async () => {
      const { token, id, email } = await signup();
      await svc.saveProfile(id, { ...profile, today });
      await svc.addFood(id, { date: today, meal: "lunch", food: banana });
      await svc.saveCustomFood(id, { name: "Mine", serving: "1", calories: 5, protein: 0, carbs: 0, fat: 0 });
      await svc.subscribe(id, { planId: "monthly", card });
      await svc.deleteAccount(id);
      assert.equal(await svc.authenticate(token), null);
      await status(svc.login({ email, password: "secret123" }), 401);
      assert.equal((await repo.listDays(id)).length, 0);
      assert.equal((await repo.listEntries(id, "0000-00-00")).length, 0);
      assert.equal((await repo.listCustomFoods(id)).length, 0);
      assert.equal((await repo.listPayments(id)).length, 0);
      // the email can be registered again
      assert.ok((await svc.signup({ name: "Again", email, password: "secret123" })).token);
    });

    it("concurrent signups with the same email create exactly one account", async () => {
      const email = `race${Math.random().toString(36).slice(2)}@t.dev`;
      const results = await Promise.allSettled([1, 2, 3].map(() => svc.signup({ name: "Race", email, password: "secret123" })));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      for (const r of results.filter((x) => x.status === "rejected")) assert.equal(r.reason.status, 409);
    });

    it("concurrent water updates for the same day don't create duplicates", async () => {
      const { id } = await signup();
      await Promise.all([100, 200, 300, 400].map((ml) => svc.setWater(id, today, { ml })));
      const days = (await repo.listDays(id)).filter((d) => d.date === today);
      assert.equal(days.length, 1);
    });
  });
}
