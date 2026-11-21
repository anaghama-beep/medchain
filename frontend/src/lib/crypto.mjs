// @ts-check
/**
 * Client-side encryption for MedChain.
 *
 * Envelope encryption:
 *  1. Each record is serialised to JSON and sealed with XSalsa20-Poly1305 under a
 *     fresh random 32-byte record key (nacl.secretbox).
 *  2. The record key is wrapped for each authorised reader with X25519 + XSalsa20-Poly1305
 *     (nacl.box) using a one-time ephemeral key pair, so wrapped keys reveal nothing
 *     about the sender.
 *  3. Only ciphertext and wrapped keys are sent on-chain.
 *
 * Each account's X25519 key pair is derived deterministically from a wallet signature
 * over a fixed message, so users never manage a separate secret: the same wallet
 * always produces the same encryption key, on any device.
 */
import nacl from "tweetnacl";
import { getBytes, hexlify, keccak256, toUtf8Bytes, toUtf8String } from "ethers";

export const KEY_DERIVATION_MESSAGE =
  "MedChain encryption key v1\n\nSign this message to unlock your medical records. " +
  "It does not send a transaction or cost gas.";

const VERSION = 1;

/**
 * @param {{ signMessage(message: string): Promise<string> }} signer
 * @returns {Promise<nacl.BoxKeyPair>}
 */
export async function deriveKeyPair(signer) {
  const signature = await signer.signMessage(KEY_DERIVATION_MESSAGE);
  return nacl.box.keyPair.fromSecretKey(getBytes(keccak256(signature)));
}

/** @param {Uint8Array} publicKey */
export const publicKeyHex = (publicKey) => hexlify(publicKey);

/**
 * Encrypt a JSON-serialisable record with a new random key.
 * @param {unknown} record
 * @returns {{ ciphertext: string, recordKey: Uint8Array }} ciphertext as 0x-hex: version | nonce | box
 */
export function encryptRecord(record) {
  const recordKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(toUtf8Bytes(JSON.stringify(record)), nonce, recordKey);
  return { ciphertext: hexlify(concat(Uint8Array.of(VERSION), nonce, box)), recordKey };
}

/**
 * @param {string} ciphertext 0x-hex produced by encryptRecord
 * @param {Uint8Array} recordKey
 * @returns {any}
 */
export function decryptRecord(ciphertext, recordKey) {
  const bytes = getBytes(ciphertext);
  if (bytes[0] !== VERSION) throw new Error(`Unsupported record version ${bytes[0]}`);
  const nonce = bytes.slice(1, 1 + nacl.secretbox.nonceLength);
  const box = bytes.slice(1 + nacl.secretbox.nonceLength);
  const plain = nacl.secretbox.open(box, nonce, recordKey);
  if (!plain) throw new Error("Record could not be decrypted (wrong key or tampered data)");
  return JSON.parse(toUtf8String(plain));
}

/**
 * Wrap a record key for a reader's X25519 public key.
 * @param {Uint8Array} recordKey
 * @param {string | Uint8Array} recipientPublicKey
 * @returns {string} 0x-hex: ephemeral public key | nonce | box
 */
export function wrapKey(recordKey, recipientPublicKey) {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(recordKey, nonce, getBytes(recipientPublicKey), ephemeral.secretKey);
  return hexlify(concat(ephemeral.publicKey, nonce, box));
}

/**
 * @param {string} wrapped 0x-hex produced by wrapKey
 * @param {Uint8Array} secretKey reader's X25519 secret key
 * @returns {Uint8Array}
 */
export function unwrapKey(wrapped, secretKey) {
  const bytes = getBytes(wrapped);
  const ephemeralPublic = bytes.slice(0, nacl.box.publicKeyLength);
  const nonce = bytes.slice(nacl.box.publicKeyLength, nacl.box.publicKeyLength + nacl.box.nonceLength);
  const box = bytes.slice(nacl.box.publicKeyLength + nacl.box.nonceLength);
  const key = nacl.box.open(box, nonce, ephemeralPublic, secretKey);
  if (!key) throw new Error("Record key could not be unwrapped");
  return key;
}

/** @param {string} ciphertext */
export const contentHash = (ciphertext) => keccak256(ciphertext);

/** @param {...Uint8Array} parts */
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
