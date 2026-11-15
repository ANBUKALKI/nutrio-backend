// npm run seed:demo — (re)creates the demo account's data in the configured database.
import { loadConfig } from "./config.js";
import { createMongoRepo } from "./repo/mongo.js";
import { seedDemo } from "./demo.js";

const repo = await createMongoRepo(loadConfig().mongoUri);
console.log((await seedDemo(repo)) ? "Demo account created: demo@nutrio.app / demo1234" : "Demo account already exists");
await repo.close();
