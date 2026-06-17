import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt parameters. The defaults are deliberately conservative for an
// interactive login on a local demo; the cost factor (N) dominates the work.
const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N
const SCRYPT_BLOCK_SIZE = 8; // r
const SCRYPT_PARALLELIZATION = 1; // p
// scrypt needs enough memory for the chosen cost; 128 * N * r bytes ~= 16 MiB.
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const TOKEN_BYTES = 32;

const scryptOptions = {
  N: SCRYPT_COST,
  r: SCRYPT_BLOCK_SIZE,
  p: SCRYPT_PARALLELIZATION,
  maxmem: SCRYPT_MAXMEM
};

const derive = (password: string, salt: Buffer, keylen: number) =>
  scryptSync(password, salt, keylen, scryptOptions);

// Stored format: "scrypt:<saltHex>:<hashHex>". Self-describing so the verifier
// reads the salt and key length back without separate columns.
export const hashPassword = (password: string): string => {
  const salt = randomBytes(SALT_BYTES);
  const hash = derive(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }

  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  const actual = derive(password, salt, expected.length);
  // timingSafeEqual throws on length mismatch, so guard first.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

// A pre-computed hash used to verify a password even when no account matches the
// email. Running scrypt anyway keeps login timing roughly constant whether or
// not the email exists, so failures don't leak which emails are registered.
const DECOY_PASSWORD_HASH = hashPassword(randomBytes(32).toString("hex"));

export const runDecoyPasswordVerification = (password: string): void => {
  verifyPassword(password, DECOY_PASSWORD_HASH);
};

export const generateSessionToken = (): string => randomBytes(TOKEN_BYTES).toString("base64url");

// The cookie carries the raw token; only this hash is persisted, so the stored
// value is useless to an attacker who reads the database.
export const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
