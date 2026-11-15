import { defineSuite } from "./suite.js";
import { createMemoryRepo } from "../src/repo/memory.js";

defineSuite("services on the in-memory repository", async () => createMemoryRepo());
