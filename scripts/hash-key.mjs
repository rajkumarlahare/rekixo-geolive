import crypto from "node:crypto";

const value = process.argv[2];
if (!value) {
  console.error("Usage: npm run hash-key -- <secret>");
  process.exit(1);
}

console.log(crypto.createHash("sha256").update(value).digest("hex"));
