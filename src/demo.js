import { hashPassword } from "./auth.js";
import { FOOD_DB, dailyCalorieTarget } from "./catalog.js";

export const DEMO_EMAIL = "demo@nutrio.app";
export const DEMO_PASSWORD = "demo1234";

const rnd = (seed) => { let s = seed; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); };
const dayKey = (d) => d.toISOString().slice(0, 10);

/** Creates the demo account with 14 days of data if it doesn't exist yet. */
export async function seedDemo(repo, now = new Date()) {
  if (await repo.getUserByEmail(DEMO_EMAIL)) return false;
  const u = await repo.createUser({ email: DEMO_EMAIL, name: "Demo User", passwordHash: await hashPassword(DEMO_PASSWORD) });
  const base = { sex: "male", age: 29, heightCm: 175, weightKg: 77, goalWeightKg: 72, activity: "moderate", goal: "lose" };
  await repo.updateUser(u.id, {
    onboarded: true,
    profile: { ...base, waterGoalMl: 2500, stepGoal: 8000, calorieTarget: dailyCalorieTarget(base) },
  });
  const r = rnd(42);
  for (let idx = 0; idx < 14; idx++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - (13 - idx));
    const date = dayKey(d);
    await repo.upsertDay(u.id, date, {
      waterMl: Math.round(1200 + r() * 1600),
      steps: Math.round(3500 + r() * 8500),
      weightKg: +(78 - idx * 0.12 + (r() - 0.5) * 0.6).toFixed(1),
    });
    const pick = () => FOOD_DB[Math.floor(r() * FOOD_DB.length)];
    const add = (meal, f) =>
      repo.insertEntry(u.id, { date, meal, servings: 1, foodId: f.id, name: f.name, serving: f.serving, calories: f.calories, protein: f.protein, carbs: f.carbs, fat: f.fat });
    for (const meal of ["breakfast", "lunch", "dinner"]) {
      await add(meal, pick());
      if (r() > 0.5) await add(meal, pick());
    }
  }
  return true;
}
