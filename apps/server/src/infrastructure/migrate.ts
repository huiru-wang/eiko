/**
 * 独立迁移脚本：tsx src/infrastructure/migrate.ts
 */

import { loadEnv, loadConfig } from "../env.js";
import { createDatabase, runMigrations } from "./database.js";

loadEnv();
const config = loadConfig();
const db = createDatabase(config.sqlitePath);

console.log("[migrate] Running migrations...");
await runMigrations(db);
console.log("[migrate] Done.");

db.destroy();
