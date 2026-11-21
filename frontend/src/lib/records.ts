import type { Contract } from "ethers";
import { DEPLOYMENT, readProvider } from "./chain";
import { contentHash, decryptRecord, unwrapKey, encryptRecord, wrapKey } from "./crypto.mjs";

export interface RecordData {
  title: string;
  patientName?: string;
  age?: number;
  gender?: string;
  bloodType?: string;
  allergies?: string;
  diagnosis?: string;
  treatment?: string;
  notes?: string;
}

export interface LoadedRecord {
  id: number;
  timestamp: number;
  supersedes: number;
  redacted: boolean;
  patient: string;
  author: string;
  contentHash: string;
  category: string;
  ciphertext: string;
  verified: boolean;
  data?: RecordData;
  locked?: boolean;
  error?: string;
}

export const CATEGORIES = ["Consultation", "Lab results", "Prescription", "Imaging", "Vitals", "Allergies", "Other"];

function toPlain(r: any) {
  return {
    id: Number(r.id),
    timestamp: Number(r.timestamp),
    supersedes: Number(r.supersedes),
    redacted: Boolean(r.redacted),
    patient: r.patient as string,
    author: r.author as string,
    contentHash: r.contentHash as string,
    category: r.category as string,
  };
}

/** Fetch a patient's records, verify each ciphertext against its on-chain hash, and decrypt what we can. */
export async function loadRecords(contract: Contract, patient: string, secretKey: Uint8Array): Promise<LoadedRecord[]> {
  const [raw, logs] = await Promise.all([
    contract.getPatientRecords(patient),
    contract.queryFilter(contract.filters.RecordAdded(null, patient), DEPLOYMENT.deployBlock),
  ]);
  const ciphertexts = new Map<number, string>();
  for (const log of logs as any[]) ciphertexts.set(Number(log.args.id), log.args.ciphertext);

  return Promise.all(
    (raw as any[]).map(async (r) => {
      const rec = toPlain(r);
      const ciphertext = ciphertexts.get(rec.id) ?? "0x";
      const out: LoadedRecord = { ...rec, ciphertext, verified: contentHash(ciphertext) === rec.contentHash };
      const wrapped: string = await contract.myWrappedKey(rec.id);
      if (wrapped === "0x") return { ...out, locked: true };
      try {
        out.data = decryptRecord(ciphertext, unwrapKey(wrapped, secretKey));
      } catch (err: any) {
        out.error = err.message;
      }
      return out;
    }),
  ).then((list) => list.sort((a, b) => b.timestamp - a.timestamp));
}

/**
 * Encrypt a record and add it for `patient`. It is readable by the patient, the author, and
 * every provider the patient currently grants access to.
 */
export async function addRecord(
  contract: Contract,
  patient: string,
  category: string,
  data: RecordData,
  author: string,
  supersedes = 0,
) {
  const grantees: string[] = await contract.getGrantees(patient);
  const active = (await Promise.all(grantees.map(async (g) => ((await contract.hasAccess(patient, g)) ? g : null)))).filter(
    (g): g is string => g !== null,
  );
  const unique = Array.from(new Set([patient, author, ...active].map((a) => a.toLowerCase())));
  const { ciphertext, recordKey } = encryptRecord(data);
  const wrapped = await Promise.all(
    unique.map(async (reader) => {
      const pub: string = await contract.encryptionKey(reader);
      return wrapKey(recordKey, pub);
    }),
  );
  const tx = await contract.addRecord(patient, category, ciphertext, supersedes, unique, wrapped);
  return tx.wait();
}

/** Grant access, re-wrapping the keys of every record the patient can read for the provider. */
export async function grantAccess(contract: Contract, patient: string, provider: string, days: number, secretKey: Uint8Array) {
  const providerKey: string = await contract.encryptionKey(provider);
  const ids: number[] = [];
  const wrapped: string[] = [];
  for (const r of (await contract.getPatientRecords(patient)) as any[]) {
    const mine: string = await contract.myWrappedKey(r.id);
    if (mine === "0x") continue;
    ids.push(Number(r.id));
    wrapped.push(wrapKey(unwrapKey(mine, secretKey), providerKey));
  }
  const latest = await readProvider().getBlock("latest");
  const expiry = (latest?.timestamp ?? Math.floor(Date.now() / 1000)) + days * 86400;
  const tx = await contract.grantAccess(provider, expiry, ids, wrapped);
  return tx.wait();
}

export interface ActivityItem {
  kind: "granted" | "revoked" | "added" | "redacted";
  timestamp: number;
  block: number;
  tx: string;
  actor: string;
  provider?: string;
  recordId?: number;
  category?: string;
  expiry?: number;
}

const blockTimes = new Map<number, number>();
async function blockTime(n: number) {
  if (!blockTimes.has(n)) blockTimes.set(n, (await readProvider().getBlock(n))!.timestamp);
  return blockTimes.get(n)!;
}

/** Audit trail for a patient, rebuilt from contract events. */
export async function loadActivity(contract: Contract, patient: string): Promise<ActivityItem[]> {
  const from = DEPLOYMENT.deployBlock;
  const f = contract.filters;
  const [granted, revoked, added, redacted] = await Promise.all([
    contract.queryFilter(f.AccessGranted(patient), from),
    contract.queryFilter(f.AccessRevoked(patient), from),
    contract.queryFilter(f.RecordAdded(null, patient), from),
    contract.queryFilter(f.RecordRedacted(null, patient), from),
  ]);
  const items: ActivityItem[] = [];
  const base = async (log: any) => ({ timestamp: await blockTime(log.blockNumber), block: log.blockNumber, tx: log.transactionHash });
  for (const l of granted as any[])
    items.push({ kind: "granted", ...(await base(l)), actor: patient, provider: l.args.provider, expiry: Number(l.args.expiry) });
  for (const l of revoked as any[]) items.push({ kind: "revoked", ...(await base(l)), actor: patient, provider: l.args.provider });
  for (const l of added as any[])
    items.push({ kind: "added", ...(await base(l)), actor: l.args.author, recordId: Number(l.args.id), category: l.args.category });
  for (const l of redacted as any[]) items.push({ kind: "redacted", ...(await base(l)), actor: patient, recordId: Number(l.args.id) });
  return items.sort((a, b) => b.block - a.block);
}

export interface ProviderInfo {
  address: string;
  name: string;
  organisation: string;
  active: boolean;
  hasKey: boolean;
}

export async function loadProviders(contract: Contract): Promise<ProviderInfo[]> {
  const list: string[] = await contract.getProviders();
  return Promise.all(
    list.map(async (address) => {
      const [p, key] = await Promise.all([contract.getProvider(address), contract.encryptionKey(address)]);
      return { address, name: p.name, organisation: p.organisation, active: p.active, hasKey: key !== "0x" + "0".repeat(64) };
    }),
  );
}

/** Patients who currently grant this provider access. */
export async function loadMyPatients(contract: Contract, provider: string) {
  const logs = (await contract.queryFilter(contract.filters.AccessGranted(null, provider), DEPLOYMENT.deployBlock)) as any[];
  const patients = Array.from(new Set(logs.map((l) => l.args.patient as string)));
  const rows = await Promise.all(
    patients.map(async (p) => ({ address: p, expiry: Number(await contract.accessExpiry(p, provider)), active: await contract.hasAccess(p, provider) })),
  );
  return rows.filter((r) => r.active);
}
