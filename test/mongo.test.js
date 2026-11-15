import { test } from "node:test";
import { defineSuite } from "./suite.js";

const uri = process.env.TEST_MONGO_URI;
if (uri) {
  const { createMongoRepo } = await import("../src/repo/mongo.js");
  // A throwaway database per run, dropped afterwards.
  defineSuite("services on MongoDB", () => createMongoRepo(uri, { dbName: `nutrio_test_${Date.now()}` }));
} else {
  test("MongoDB suite", { skip: "set TEST_MONGO_URI=mongodb://127.0.0.1:27017 to run it" }, () => {});
}
