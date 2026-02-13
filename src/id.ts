/**
 * stable ID generation for memory entries.
 * uses 6-char base58 hash derived from content + timestamp.
 * per unkey's UUID UX principles: short + collision-resistant.
 */

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function toBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }

  let result = "";
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }

  return result;
}

async function sha256(data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  return new Uint8Array(hashBuffer);
}

export const ID_PATTERN = /^id__[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6}$/;

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export async function generateId(title: string, createdAt: number): Promise<string> {
  const seed = `${title}:${createdAt}`;
  const hash = await sha256(seed);
  const base58 = toBase58(hash);
  return `id__${base58.slice(0, 6)}`;
}
