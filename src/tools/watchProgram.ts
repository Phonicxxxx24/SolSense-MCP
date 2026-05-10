import { PublicKey } from "@solana/web3.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProgramActivity {
  signature: string;
  slot: number;
  blockTime: number | null | undefined;
  status: "success" | "failed";
}

export interface WatchProgramResult {
  programId: string;
  network: string;
  limit: number;
  /** Activities returned — may be a subset of `limit` if fewer exist. */
  activities: ProgramActivity[];
  /** If `since` was provided, only activities newer than that slot are included. */
  filteredBySince: boolean;
  /** Slot of the most recent activity — pass as `since` on next call to get only new events. */
  latestSlot?: number;
  error?: string;
}

// Raw RPC response types
interface RpcResponse<T> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
  memo: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Fetch recent transaction signatures for a Solana program address.
 *
 * @param programId   - Base58 program address to monitor.
 * @param heliusApiKey - Helius API key for RPC access.
 * @param network     - "devnet" or "mainnet" (default: "devnet").
 * @param limit       - Max number of signatures to return (1–50, default: 10).
 * @param since       - Optional slot number; if provided, only signatures with
 *                      slot > since are returned (useful for polling new activity).
 */
export async function watchProgram(
  programId: string,
  heliusApiKey: string,
  network: "mainnet" | "devnet" = "devnet",
  limit = 10,
  since?: number
): Promise<WatchProgramResult> {
  // Clamp limit
  const safeLimit = Math.min(Math.max(1, limit), 50);

  // Validate program ID
  try {
    new PublicKey(programId);
  } catch {
    return {
      programId,
      network,
      limit: safeLimit,
      activities: [],
      filteredBySince: false,
      error: `Invalid Solana program address: ${programId}`,
    };
  }

  const rpcUrl =
    network === "mainnet"
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
      : `https://devnet.helius-rpc.com/?api-key=${heliusApiKey}`;

  try {
    // Fetch up to `safeLimit` recent signatures for this program address.
    // We request slightly more when `since` is set so we can filter after.
    const fetchLimit = since !== undefined ? Math.min(safeLimit * 3, 50) : safeLimit;

    const signatures = await rpcRequest<SignatureInfo[]>(
      rpcUrl,
      "getSignaturesForAddress",
      [
        programId,
        {
          limit: fetchLimit,
          commitment: "confirmed",
        },
      ]
    );

    // Filter by `since` slot if provided
    let filtered = since !== undefined
      ? signatures.filter((s) => s.slot > since)
      : signatures;

    // Trim to requested limit
    filtered = filtered.slice(0, safeLimit);

    const activities: ProgramActivity[] = filtered.map((sig) => ({
      signature: sig.signature,
      slot: sig.slot,
      blockTime: sig.blockTime,
      status: sig.err ? "failed" : "success",
    }));

    const latestSlot = activities.length > 0 ? activities[0].slot : undefined;

    return {
      programId,
      network,
      limit: safeLimit,
      activities,
      filteredBySince: since !== undefined,
      latestSlot,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      programId,
      network,
      limit: safeLimit,
      activities: [],
      filteredBySince: false,
      error: `RPC error: ${message}`,
    };
  }
}
