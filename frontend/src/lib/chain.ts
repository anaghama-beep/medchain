import { BrowserProvider, Contract, HDNodeWallet, JsonRpcProvider, type Signer } from "ethers";
import type nacl from "tweetnacl";
import deployment from "../contracts/MedChain.json";
import { deriveKeyPair } from "./crypto.mjs";

export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8545";
export const DEPLOYMENT = deployment as { address: string; chainId: number; deployBlock: number; abi: any[] };

// Hardhat's well-known development mnemonic. These accounts only exist on a local chain.
const DEV_MNEMONIC = "test test test test test test test test test test test junk";

export const DEMO_ACCOUNTS = [
  { index: 0, label: "Admin", subtitle: "Verifies healthcare providers" },
  { index: 1, label: "Dr. Meera Rao", subtitle: "City General Hospital" },
  { index: 2, label: "Dr. Arjun Patel", subtitle: "Sunrise Family Clinic" },
  { index: 3, label: "Aanya Sharma", subtitle: "Patient" },
  { index: 4, label: "Rohan Iyer", subtitle: "Patient" },
  { index: 5, label: "New user", subtitle: "Not registered yet" },
];

export type Role = "admin" | "provider" | "patient" | "none";

export interface Session {
  signer: Signer;
  address: string;
  contract: Contract;
  mode: "demo" | "wallet";
  label?: string;
}

let rpcProvider: JsonRpcProvider | undefined;
export function readProvider() {
  rpcProvider ??= new JsonRpcProvider(RPC_URL, DEPLOYMENT.chainId, { staticNetwork: true, polling: true });
  return rpcProvider;
}

export async function isLocalChainUp(): Promise<boolean> {
  try {
    const code = await readProvider().getCode(DEPLOYMENT.address);
    return code !== "0x";
  } catch {
    return false;
  }
}

export function demoSession(index: number): Session {
  const wallet = HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).connect(readProvider());
  return {
    signer: wallet,
    address: wallet.address,
    contract: new Contract(DEPLOYMENT.address, DEPLOYMENT.abi, wallet),
    mode: "demo",
    label: DEMO_ACCOUNTS.find((a) => a.index === index)?.label,
  };
}

export async function walletSession(): Promise<Session> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No browser wallet found. Install MetaMask or use a demo account.");
  await eth.request({ method: "eth_requestAccounts" });
  const hexId = "0x" + DEPLOYMENT.chainId.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err: any) {
    if (err?.code !== 4902) throw err;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: hexId, chainName: "Hardhat Local", rpcUrls: [RPC_URL], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }],
    });
  }
  const signer = await new BrowserProvider(eth).getSigner();
  return {
    signer,
    address: await signer.getAddress(),
    contract: new Contract(DEPLOYMENT.address, DEPLOYMENT.abi, signer),
    mode: "wallet",
  };
}

const keyCache = new Map<string, nacl.BoxKeyPair>();
export async function getKeys(session: Session): Promise<nacl.BoxKeyPair> {
  const cached = keyCache.get(session.address);
  if (cached) return cached;
  const keys = await deriveKeyPair(session.signer);
  keyCache.set(session.address, keys);
  return keys;
}

export const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

export function errorMessage(err: any): string {
  const name = err?.revert?.name ?? err?.info?.error?.data?.message;
  const known: Record<string, string> = {
    NoAccess: "You do not have access to this patient's records.",
    NotAdmin: "Only the admin can do this.",
    NotActiveProvider: "That provider is not verified or has been suspended.",
    NotPatient: "This account is not registered as a patient.",
    AlreadyRegistered: "This account is already registered.",
    MissingEncryptionKey: "That account has not set up its encryption key yet.",
    InvalidInput: "Some of the details are invalid.",
  };
  if (name && known[name]) return known[name];
  if (err?.code === "ACTION_REJECTED") return "Request rejected in the wallet.";
  return err?.shortMessage ?? err?.message ?? String(err);
}

export async function publicKeyOf(session: Session): Promise<string> {
  const { publicKeyHex } = await import("./crypto.mjs");
  return publicKeyHex((await getKeys(session)).publicKey);
}
