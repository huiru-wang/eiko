function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

export function encodeTopicCursor(topic: { updatedAt: string; id: string }): string {
  return Buffer.from(JSON.stringify({ updatedAt: topic.updatedAt, id: topic.id })).toString("base64url");
}

export function decodeTopicCursor(cursor: string): { updatedAt: string; id?: string } {
  if (isTimestamp(cursor)) return { updatedAt: cursor };
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (isTimestamp(value?.updatedAt) && typeof value.id === "string" && value.id.trim()) return value;
  } catch { /* The HTTP route returns INVALID_INPUT for malformed cursors. */ }
  throw new Error("Invalid topic cursor");
}
