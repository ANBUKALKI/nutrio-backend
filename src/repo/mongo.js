import mongoose from "mongoose";
import { DuplicateError } from "../errors.js";

const { Schema } = mongoose;
const isId = (s) => typeof s === "string" && /^[a-f\d]{24}$/i.test(s); // stricter than mongoose.isValidObjectId
const num = { type: Number, required: true };
const str = { type: String, required: true };

const profileSchema = new Schema(
  {
    sex: str, age: num, heightCm: num, weightKg: num, goalWeightKg: num, activity: str, goal: str,
    waterGoalMl: num, stepGoal: num, calorieTarget: num,
  },
  { _id: false }
);
const settingsSchema = new Schema(
  { remindWater: { type: Boolean, default: true }, remindMeals: { type: Boolean, default: false } },
  { _id: false }
);

const userSchema = new Schema(
  {
    email: { ...str, unique: true, lowercase: true, trim: true },
    name: str,
    passwordHash: str,
    onboarded: { type: Boolean, default: false },
    plan: { type: String, enum: ["free", "monthly", "yearly"], default: "free" },
    profile: { type: profileSchema, default: null },
    settings: { type: settingsSchema, default: () => ({}) },
    bookmarks: { type: [String], default: [] },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const userRef = { type: Schema.Types.ObjectId, ref: "User", required: true };

const daySchema = new Schema({ userId: userRef, date: str, waterMl: Number, steps: Number, weightKg: Number });
daySchema.index({ userId: 1, date: 1 }, { unique: true });

const entrySchema = new Schema(
  { userId: userRef, date: str, meal: str, servings: num, foodId: str, name: str, serving: str, calories: num, protein: num, carbs: num, fat: num },
  { timestamps: true }
);
entrySchema.index({ userId: 1, date: 1, _id: 1 });

const customFoodSchema = new Schema(
  { userId: userRef, name: str, serving: str, calories: num, protein: num, carbs: num, fat: num, barcode: { type: String, default: null } },
  { timestamps: true }
);
customFoodSchema.index({ userId: 1, _id: -1 });

const paymentSchema = new Schema({ userId: userRef, date: str, planId: str, amount: num, last4: str }, { timestamps: true });
paymentSchema.index({ userId: 1, _id: -1 });

const toUser = (d) =>
  d && {
    id: String(d._id), email: d.email, name: d.name, passwordHash: d.passwordHash, onboarded: !!d.onboarded, plan: d.plan,
    profile: d.profile ?? null, settings: d.settings ?? { remindWater: true, remindMeals: false },
    bookmarks: d.bookmarks ?? [], tokenVersion: d.tokenVersion ?? 0,
  };
const withId = (d) => {
  const { _id, userId, __v, createdAt, updatedAt, ...rest } = d;
  return { id: String(_id), ...rest };
};

/**
 * MongoDB repository (Mongoose). Same contract as repo/memory.js — the shared
 * test suite (test/suite.js) runs against both.
 */
export async function createMongoRepo(uri, { dbName } = {}) {
  const conn = await mongoose.createConnection(uri, { dbName, serverSelectionTimeoutMS: 8000 }).asPromise();
  const User = conn.model("User", userSchema);
  const Day = conn.model("Day", daySchema);
  const Entry = conn.model("Entry", entrySchema);
  const CustomFood = conn.model("CustomFood", customFoodSchema);
  const Payment = conn.model("Payment", paymentSchema);
  // Build indexes (the unique email / (user,date) ones are what make races safe).
  await Promise.all([User, Day, Entry, CustomFood, Payment].map((m) => m.init()));

  return {
    kind: "mongo",
    close: () => conn.close(),
    drop: () => conn.dropDatabase(),
    ping: () => conn.db.admin().ping(),

    /* users */
    async createUser({ email, name, passwordHash }) {
      try {
        return toUser((await User.create({ email, name, passwordHash })).toObject());
      } catch (e) {
        if (e?.code === 11000) throw new DuplicateError(email);
        throw e;
      }
    },
    async getUserById(id) { return isId(id) ? toUser(await User.findById(id).lean()) : null; },
    async getUserByEmail(email) { return toUser(await User.findOne({ email }).lean()); },
    async updateUser(id, patch) {
      return isId(id) ? toUser(await User.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean()) : null;
    },
    async bumpTokenVersion(id) {
      return isId(id) ? toUser(await User.findByIdAndUpdate(id, { $inc: { tokenVersion: 1 } }, { new: true }).lean()) : null;
    },
    async toggleBookmark(id, articleId) {
      if (!isId(id)) return;
      const added = await User.updateOne({ _id: id, bookmarks: { $ne: articleId } }, { $push: { bookmarks: articleId } });
      if (added.modifiedCount === 0) await User.updateOne({ _id: id }, { $pull: { bookmarks: articleId } });
    },
    async deleteUserCascade(id) {
      if (!isId(id)) return;
      await Promise.all([Day, Entry, CustomFood, Payment].map((m) => m.deleteMany({ userId: id })));
      await User.deleteOne({ _id: id });
    },

    /* per-day trackers */
    async upsertDay(userId, date, fields) {
      const run = () => Day.updateOne({ userId, date }, { $set: fields }, { upsert: true });
      try {
        await run();
      } catch (e) {
        if (e?.code === 11000) await run(); // two first-writes raced; the second now just updates
        else throw e;
      }
    },
    async listDays(userId) {
      return (await Day.find({ userId }).lean()).map((d) => ({ date: d.date, waterMl: d.waterMl, steps: d.steps, weightKg: d.weightKg }));
    },
    async hasWeight(userId, date) { return !!(await Day.exists({ userId, date, weightKg: { $ne: null } })); },
    async clearWeight(userId, date) { await Day.updateOne({ userId, date }, { $unset: { weightKg: 1 } }); },
    async latestWeightDate(userId) {
      const d = await Day.findOne({ userId, weightKg: { $ne: null } }).sort({ date: -1 }).select("date").lean();
      return d?.date ?? "";
    },

    /* food log */
    async insertEntry(userId, e) { return withId((await Entry.create({ ...e, userId })).toObject()); },
    async listEntries(userId, since) {
      return (await Entry.find({ userId, date: { $gte: since } }).sort({ date: 1, _id: 1 }).lean()).map(withId);
    },
    async updateEntryServings(userId, id, date, servings) {
      if (!isId(id)) return false;
      return (await Entry.updateOne({ _id: id, userId, date }, { $set: { servings } })).matchedCount > 0;
    },
    async deleteEntry(userId, id, date) {
      if (isId(id)) await Entry.deleteOne({ _id: id, userId, date });
    },

    /* custom foods */
    async listCustomFoods(userId) { return (await CustomFood.find({ userId }).sort({ _id: -1 }).lean()).map(withId); },
    countCustomFoods: (userId) => CustomFood.countDocuments({ userId }),
    async insertCustomFood(userId, f) { return withId((await CustomFood.create({ ...f, userId })).toObject()); },
    async updateCustomFood(userId, id, f) {
      if (!isId(id)) return false;
      return (await CustomFood.updateOne({ _id: id, userId }, { $set: f })).matchedCount > 0;
    },
    async deleteCustomFood(userId, id) {
      if (isId(id)) await CustomFood.deleteOne({ _id: id, userId });
    },

    /* payments */
    async insertPayment(userId, p) { return withId((await Payment.create({ ...p, userId })).toObject()); },
    async listPayments(userId) { return (await Payment.find({ userId }).sort({ _id: -1 }).lean()).map(withId); },
  };
}
