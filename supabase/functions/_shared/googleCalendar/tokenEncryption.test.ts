// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./tokenEncryption.ts";

const KEY = Uint8Array.from({ length: 32 }, (_, i) => i + 1);

describe("tokenEncryption", () => {
  it("roundtrips plaintext", async () => {
    const encrypted = await encryptSecret("refresh-token-value", KEY, "v1");
    const plain = await decryptSecret(encrypted, KEY);
    expect(plain).toBe("refresh-token-value");
  });

  it("uses different ciphertext for repeated encryptions", async () => {
    const a = await encryptSecret("same-token", KEY, "v1");
    const b = await encryptSecret("same-token", KEY, "v1");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("fails with wrong key", async () => {
    const encrypted = await encryptSecret("secret", KEY, "v1");
    const wrongKey = Uint8Array.from({ length: 32 }, () => 9);
    await expect(decryptSecret(encrypted, wrongKey)).rejects.toThrow();
  });

  it("fails with tampered ciphertext", async () => {
    const encrypted = await encryptSecret("secret", KEY, "v1");
    const tampered = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -4) + "AAAA",
    };
    await expect(decryptSecret(tampered, KEY)).rejects.toThrow();
  });
});
