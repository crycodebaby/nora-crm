export type EncryptedPayload = {
  ciphertext: string;
  nonce: string;
  keyVersion: string;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  if (typeof btoa === "function") {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
};

const fromBase64 = (value: string): Uint8Array => {
  const binary =
    typeof atob === "function"
      ? atob(value)
      : Buffer.from(value, "base64").toString("binary");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const encryptSecret = async (
  plaintext: string,
  keyBytes: Uint8Array,
  keyVersion: string,
): Promise<EncryptedPayload> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cryptoKey,
    new TextEncoder().encode(plaintext),
  );

  return {
    ciphertext: toBase64(new Uint8Array(ciphertextBuffer)),
    nonce: toBase64(nonce),
    keyVersion,
  };
};

export const decryptSecret = async (
  payload: EncryptedPayload,
  keyBytes: Uint8Array,
): Promise<string> => {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.nonce) },
    cryptoKey,
    fromBase64(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintextBuffer);
};
