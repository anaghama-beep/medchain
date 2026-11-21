import { describe, expect, it } from "vitest";
import { Wallet, getBytes, hexlify } from "ethers";
import {
  contentHash,
  decryptRecord,
  deriveKeyPair,
  encryptRecord,
  unwrapKey,
  wrapKey,
} from "./crypto.mjs";

const record = { name: "Aanya Sharma", age: 29, diagnosis: "Seasonal allergic rhinitis" };

describe("crypto", () => {
  it("derives the same key pair from the same wallet, and different ones across wallets", async () => {
    const w = Wallet.createRandom();
    const a = await deriveKeyPair(w);
    const b = await deriveKeyPair(w);
    const c = await deriveKeyPair(Wallet.createRandom());
    expect(hexlify(a.publicKey)).toBe(hexlify(b.publicKey));
    expect(hexlify(a.publicKey)).not.toBe(hexlify(c.publicKey));
  });

  it("round-trips a record through encryption and key wrapping", async () => {
    const reader = await deriveKeyPair(Wallet.createRandom());
    const { ciphertext, recordKey } = encryptRecord(record);
    const wrapped = wrapKey(recordKey, reader.publicKey);
    expect(decryptRecord(ciphertext, unwrapKey(wrapped, reader.secretKey))).toEqual(record);
  });

  it("does not leak plaintext into the ciphertext", () => {
    const { ciphertext } = encryptRecord(record);
    expect(Buffer.from(getBytes(ciphertext)).toString("latin1")).not.toContain("Aanya");
  });

  it("rejects the wrong reader", async () => {
    const reader = await deriveKeyPair(Wallet.createRandom());
    const intruder = await deriveKeyPair(Wallet.createRandom());
    const { recordKey } = encryptRecord(record);
    expect(() => unwrapKey(wrapKey(recordKey, reader.publicKey), intruder.secretKey)).toThrow();
  });

  it("detects tampering", () => {
    const { ciphertext, recordKey } = encryptRecord(record);
    const bytes = getBytes(ciphertext);
    bytes[bytes.length - 1] ^= 1;
    const tampered = hexlify(bytes);
    expect(contentHash(tampered)).not.toBe(contentHash(ciphertext));
    expect(() => decryptRecord(tampered, recordKey)).toThrow();
  });
});
