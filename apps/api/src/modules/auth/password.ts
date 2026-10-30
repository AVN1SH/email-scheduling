import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const cost = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, cost, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${cost.N}$${cost.r}$${cost.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | null,
) {
  const fields = storedHash?.split("$");
  const valid =
    fields?.length === 6 &&
    fields[0] === "scrypt" &&
    fields[1] === String(cost.N) &&
    fields[2] === String(cost.r) &&
    fields[3] === String(cost.p);
  const salt = valid ? Buffer.from(fields[4]!, "base64url") : Buffer.alloc(16);
  const expected = valid
    ? Buffer.from(fields[5]!, "base64url")
    : Buffer.alloc(64);
  const actual = await derive(
    password,
    salt.length === 16 ? salt : Buffer.alloc(16),
  );
  return (
    Boolean(valid) &&
    expected.length === actual.length &&
    salt.length === 16 &&
    timingSafeEqual(actual, expected)
  );
}
