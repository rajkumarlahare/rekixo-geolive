export class CursorError extends Error {
  constructor(code = "invalid_cursor") {
    super(code);
    this.code = code;
    this.status = 400;
  }
}

export function encodeCursor(value) {
  return Buffer.from(
    JSON.stringify({ v: 1, ...value }),
    "utf8"
  ).toString("base64url");
}

export function decodeCursor(value, required = []) {
  if (!value) return null;
  const raw = String(value);
  if (raw.length > 1024) throw new CursorError();

  let parsed;
  try {
    parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    );
  } catch {
    throw new CursorError();
  }

  if (!parsed || parsed.v !== 1 || typeof parsed !== "object") {
    throw new CursorError();
  }
  for (const key of required) {
    if (parsed[key] === undefined || parsed[key] === null) {
      throw new CursorError();
    }
  }
  return parsed;
}
