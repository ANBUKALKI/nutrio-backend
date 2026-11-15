import { loadConfig } from "./config.js";
import { createMemoryRepo } from "./repo/memory.js";
import { createMongoRepo } from "./repo/mongo.js";
import { createServices } from "./services/index.js";
import { createApp } from "./app.js";
import { seedDemo, DEMO_EMAIL, DEMO_PASSWORD } from "./demo.js";

const config = loadConfig();
const useMemory = process.env.STORE === "memory" || process.argv.includes("--memory");
const repo = useMemory ? createMemoryRepo() : await createMongoRepo(config.mongoUri, { dbName: config.mongoDb });
if (config.seedDemo && (await seedDemo(repo))) console.log(`Seeded demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

const app = createApp({ services: createServices({ repo, config }), config });
const server = app.listen(config.port, () =>
  console.log(`Nutrio API on http://localhost:${config.port}  (store: ${useMemory ? "memory — data is lost on restart" : `mongodb, db: ${config.mongoDb}`})`)
);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close(async () => {
    await repo.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

//------ 15.11.2026 ----------------
// import { loadConfig } from "./config.js";
// import { createMemoryRepo } from "./repo/memory.js";
// import { createMongoRepo } from "./repo/mongo.js";
// import { createServices } from "./services/index.js";
// import { createApp } from "./app.js";
// import { seedDemo, DEMO_EMAIL, DEMO_PASSWORD } from "./demo.js";

// const config = loadConfig();
// const useMemory = process.env.STORE === "memory" || process.argv.includes("--memory");
// const repo = useMemory
//   ? createMemoryRepo()
//   : await createMongoRepo(config.mongoUri, { dbName: config.mongoDb });
// if (config.seedDemo && (await seedDemo(repo))) console.log(`Seeded demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

// const app = createApp({ services: createServices({ repo, config }), config });
// const server = app.listen(config.port, () =>
//   console.log(`Nutrio API on http://localhost:${config.port}  (store: ${useMemory ? "memory — data is lost on restart" : "mongodb"})`)
// );

// let closing = false;
// async function shutdown() {
//   if (closing) return;
//   closing = true;
//   server.close(async () => {
//     await repo.close();
//     process.exit(0);
//   });
//   setTimeout(() => process.exit(1), 10_000).unref();
// }
// process.on("SIGINT", shutdown);
// process.on("SIGTERM", shutdown);
