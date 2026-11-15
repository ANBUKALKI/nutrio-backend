// Server-owned reference data. Plan prices live HERE, never trusted from clients.
export const FOOD_DB = [
  { id: "f1", name: "Banana", serving: "1 medium", calories: 105, protein: 1.3, carbs: 27, fat: 0.4, barcode: "8901000000011" },
  { id: "f2", name: "Boiled Egg", serving: "1 large", calories: 78, protein: 6.3, carbs: 0.6, fat: 5.3, barcode: "8901000000028" },
  { id: "f3", name: "Idli", serving: "2 pieces", calories: 117, protein: 4, carbs: 24, fat: 0.4, barcode: "8901000000035" },
  { id: "f4", name: "Masala Dosa", serving: "1 piece", calories: 206, protein: 4.5, carbs: 31, fat: 7.5, barcode: "8901000000042" },
  { id: "f5", name: "Cooked Rice", serving: "1 cup", calories: 205, protein: 4.3, carbs: 45, fat: 0.4, barcode: "8901000000059" },
  { id: "f6", name: "Dal Tadka", serving: "1 bowl", calories: 180, protein: 9, carbs: 24, fat: 5, barcode: "8901000000066" },
  { id: "f7", name: "Chicken Curry", serving: "1 bowl", calories: 240, protein: 25, carbs: 6, fat: 13, barcode: "8901000000073" },
  { id: "f8", name: "Chapati", serving: "1 piece", calories: 104, protein: 3.1, carbs: 18, fat: 2.8, barcode: "8901000000080" },
  { id: "f9", name: "Greek Yogurt", serving: "1 cup", calories: 130, protein: 17, carbs: 8, fat: 2.5, barcode: "8901000000097" },
  { id: "f10", name: "Almonds", serving: "28 g", calories: 164, protein: 6, carbs: 6, fat: 14, barcode: "8901000000103" },
  { id: "f11", name: "Apple", serving: "1 medium", calories: 95, protein: 0.5, carbs: 25, fat: 0.3, barcode: "8901000000110" },
  { id: "f12", name: "Oats Porridge", serving: "1 bowl", calories: 158, protein: 5.5, carbs: 27, fat: 3.2, barcode: "8901000000127" },
  { id: "f13", name: "Paneer Tikka", serving: "100 g", calories: 265, protein: 18, carbs: 6, fat: 19, barcode: "8901000000134" },
  { id: "f14", name: "Filter Coffee", serving: "1 cup", calories: 60, protein: 2, carbs: 8, fat: 2, barcode: "8901000000141" },
  { id: "f15", name: "Veg Biryani", serving: "1 plate", calories: 350, protein: 8, carbs: 58, fat: 10, barcode: "8901000000158" },
];

export const PLANS = {
  free: { id: "free", name: "Free", price: 0 },
  monthly: { id: "monthly", name: "Premium", price: 199 },
  yearly: { id: "yearly", name: "Premium Yearly", price: 1499 },
};

export const ACTIVITY = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
export const GOALS = { lose: -500, maintain: 0, gain: 400 };
export const MEALS = ["breakfast", "lunch", "dinner", "snack"];

// Same maths as the clients (Mifflin-St Jeor), so a server-computed target matches theirs.
export function dailyCalorieTarget({ sex, weightKg, heightCm, age, activity, goal }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const bmr = Math.round(sex === "female" ? base - 161 : base + 5);
  const t = Math.round(bmr * (ACTIVITY[activity] ?? 1.2) + (GOALS[goal] ?? 0));
  return Math.max(1200, Math.round(t / 10) * 10);
}
