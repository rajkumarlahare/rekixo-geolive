import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const N = 32768;
const R = 8;
const P = 1;
const MAXMEM = 128 * 1024 * 1024;
const DUMMY_SALT = Buffer.from("rekixo-geolive-login-dummy-salt", "utf8");

export function normalizeAdminEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("Invalid email."), { code: "invalid_email", status: 400 });
  }
  return email;
}

export function validateAdminPassword(value) {
  const password = String(value || "");
  if (password.length < 12 || password.length > 256) {
    throw Object.assign(new Error("Password must be 12-256 characters."), {
      code: "invalid_password",
      status: 400
    });
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw Object.assign(new Error("Password must contain letters and numbers."), {
      code: "invalid_password",
      status: 400
    });
  }
  return password;
}

async function derive(password, salt) {
  return scrypt(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM
  });
}

export async function hashPassword(value) {
  const password = validateAdminPassword(value);
  const salt = crypto.randomBytes(16);
  const derived = await derive(password, salt);
  return [
    "scrypt",
    `N=${N},r=${R},p=${P}`,
    salt.toString("base64url"),
    Buffer.from(derived).toString("base64url")
  ].join("$");
}

export async function verifyPassword(value, encoded) {
  const password = String(value || "");
  const parts = String(encoded || "").split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") return false;

  const params = Object.fromEntries(
    parts[1].split(",").map((pair) => {
      const [key, raw] = pair.split("=");
      return [key, Number(raw)];
    })
  );
  if (params.N !== N || params.r !== R || params.p !== P) return false;

  let salt;
  let expected;
  try {
    salt = Buffer.from(parts[2], "base64url");
    expected = Buffer.from(parts[3], "base64url");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH || salt.length < 12) return false;

  const actual = Buffer.from(await derive(password, salt));
  return crypto.timingSafeEqual(actual, expected);
}

export async function burnPasswordCheck(value) {
  await derive(String(value || ""), DUMMY_SALT);
}

export function randomSessionToken() {
  return `gla_${crypto.randomBytes(32).toString("base64url")}`;
}

export function randomCsrfToken() {
  return `glcsrf_${crypto.randomBytes(24).toString("base64url")}`;
}

export function sha256Secret(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function timingSafeHexEqual(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(String(a)) || !/^[a-f0-9]{64}$/i.test(String(b))) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(String(a), "hex"),
    Buffer.from(String(b), "hex")
  );
}
