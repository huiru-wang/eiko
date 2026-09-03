/**
 * .env 加载与应用配置。
 */

import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

export interface AppConfig {
  provider: string;
  model: string;
  sqlitePath: string;
  promptsDir: string;
  port: number;
  host: string;
  organizerCron: string;
}

export function loadEnv(path = ".env") {
  try {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* .env 不存在则跳过 */
  }
}

export function loadConfig(): AppConfig {
  const sqlitePath = resolve(process.env.SQLITE_PATH ?? "../../data/eiko.sqlite");
  mkdirSync(dirname(sqlitePath), { recursive: true });

  return {
    provider: process.env.PROVIDER ?? "deepseek",
    model: process.env.MODEL ?? "deepseek-v4-flash",
    sqlitePath,
    promptsDir: resolve(process.env.PROMPTS_DIR ?? "src/agent/prompts"),
    port: parseInt(process.env.PORT ?? "3000", 10),
    host: process.env.HOST ?? "0.0.0.0",
    organizerCron: process.env.ORGANIZER_TRIGGER_CRON ?? "*/5 * * * *",
  };
}
