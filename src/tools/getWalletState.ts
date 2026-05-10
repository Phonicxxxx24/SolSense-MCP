import { PublicKey } from "@solana/web3.js";

export interface WalletStateResult {
  address: string;
  network: string;
  balanceSOL: number;
  balanceLamports: number;
  recentTransactions: RecentTx[];
  error?: string;
}

interface RecentTx {
  signature: string;
  slot: number;
  blockTime: number | null | undefined;
  status: "success" | "failed";
}

// Raw JSON-RPC response shapes
interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface GetBalanceResult {
  context: { slot: number };
  value: number; // lamports
}

interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
}

async function rpcRequest<T>(
  url: string,
  method: string,
  params: unknown[]
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const json = (await response.json()) as RpcResponse<T>;

  if (json.error) {
    throw new Error(json.error.message);
  }

  return json.result as T;
}

export async function getWalletState(
  address: string,
  heliusApiKey: string,
  network: "mainnet" | "devnet" = "devnet"
): Promise<WalletStateResult> {
  // Validate the address up-front using the SDK's PublicKey — no Connection needed.
  try {
    new PublicKey(address);
  } catch {
    return {
      address,
      network,
      balanceSOL: 0,
      balanceLamports: 0,
      recentTransactions: [],
      error: `Invalid Solana address: ${address}`,
    };
  }

  const rpcUrl =
    network === "mainnet"
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
      : `https://devnet.helius-rpc.com/?api-key=${heliusApiKey}`;

  try {
    // Fire both RPC calls in parallel over plain HTTP — no WebSocket created.
    const [balanceResult, signatures] = await Promise.all([
      rpcRequest<GetBalanceResult>(rpcUrl, "getBalance", [
        address,
        { commitment: "confirmed" },
      ]),
      rpcRequest<SignatureInfo[]>(rpcUrl, "getSignaturesForAddress", [
        address,
        { limit: 5, commitment: "confirmed" },
      ]),
    ]);

    const lamports = balanceResult.value;

    const recentTransactions: RecentTx[] = signatures.map((sig) => ({
      signature: sig.signature,
      slot: sig.slot,
      blockTime: sig.blockTime,
      status: sig.err ? "failed" : "success",
    }));

    return {
      address,
      network,
      balanceSOL: lamports / 1_000_000_000,
      balanceLamports: lamports,
      recentTransactions,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      address,
      network,
      balanceSOL: 0,
      balanceLamports: 0,
      recentTransactions: [],
      error: `RPC error: ${message}`,
    };
  }
}
