import { HttpError } from "./errors.js";
import { ACTIVITY, GOALS, MEALS } from "./catalog.js";

const bad = (msg) => { throw new HttpError(400, msg); };

export function dateKey(v, label = "date") {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`${label} must be YYYY-MM-DD`);
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) bad(`${label} is not a real date`);
  return v;
}

export function num(v, label, min, max) {
  if (typeof v !== "number" || !Number.isFinite(v)) bad(`${label} must be a number`);
  if (v < min || v > max) bad(`${label} must be between ${min} and ${max}`);
  return v;
}
export const int = (v, label, min, max) => {
  num(v, label, min, max);
  if (!Number.isInteger(v)) bad(`${label} must be a whole number`);
  return v;
};

export function str(v, label, min, max) {
  if (typeof v !== "string") bad(`${label} must be text`);
  const t = v.trim();
  if (t.length < min || t.length > max) bad(`${label} must be ${min}–${max} characters`);
  return t;
}

export function email(v) {
  const e = str(v, "Email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) bad("Enter a valid email address");
  return e;
}

export function oneOf(v, allowed, label) {
  if (!allowed.includes(v)) bad(`${label} must be one of: ${allowed.join(", ")}`);
  return v;
}

export function foodFields(f) {
  if (!f || typeof f !== "object") bad("food is required");
  return {
    name: str(f.name, "Food name", 1, 80),
    serving: str(f.serving ?? "1 serving", "Serving", 1, 40),
    calories: num(f.calories, "Calories", 0, 5000),
    protein: num(f.protein ?? 0, "Protein", 0, 500),
    carbs: num(f.carbs ?? 0, "Carbs", 0, 1000),
    fat: num(f.fat ?? 0, "Fat", 0, 500),
  };
}

export function profileFields(input, existing) {
  const p = { ...(existing ?? {}), ...input };
  const out = {
    sex: oneOf(p.sex, ["male", "female"], "Sex"),
    age: int(p.age, "Age", 13, 100),
    heightCm: num(p.heightCm, "Height", 100, 250),
    weightKg: num(p.weightKg, "Weight", 30, 300),
    goalWeightKg: num(p.goalWeightKg, "Goal weight", 30, 300),
    activity: oneOf(p.activity, Object.keys(ACTIVITY), "Activity"),
    goal: oneOf(p.goal, Object.keys(GOALS), "Goal"),
    waterGoalMl: int(p.waterGoalMl ?? 2500, "Water goal", 500, 6000),
    stepGoal: int(p.stepGoal ?? 8000, "Step goal", 1000, 50000),
  };
  // 0 / missing means "let the server work it out".
  out.calorieTarget = p.calorieTarget ? int(p.calorieTarget, "Calories", 1000, 6000) : null;
  return out;
}

export { MEALS };
