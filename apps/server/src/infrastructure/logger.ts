import { nowIso } from "./time.js";

export function logInfo(scope: string, message: string, details?: Record<string, unknown>) {
  console.log(formatLog("info", scope, message, details));
}

export function logWarn(scope: string, message: string, details?: Record<string, unknown>) {
  console.warn(formatLog("warn", scope, message, details));
}

export function logError(scope: string, message: string, details?: Record<string, unknown>) {
  console.error(formatLog("error", scope, message, details));
}

function formatLog(level: string, scope: string, message: string, details?: Record<string, unknown>) {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  return `[${nowIso()}] [${level}] [${scope}] ${message}${payload}`;
}
