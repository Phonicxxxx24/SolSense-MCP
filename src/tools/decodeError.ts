import { Connection, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DecodeErrorResult {
  signature: string;
  network: string;
  status: "failed" | "success" | "not_found";
  programId?: string;
  instructionIndex?: number;
  errorCode?: number;
  errorName?: string;
  errorMessage?: string;
  rawError?: string;
  idlAvailable: boolean;
  suggestion?: string;
  error?: string;
}

interface IdlError {
  code: number;
  name: string;
  msg?: string;
}

interface Idl {
  errors?: IdlError[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse meta.err to extract instruction index and Custom error code.
 * Expected shape: { "InstructionError": [<index>, { "Custom": <code> }] }
 */
function parseInstructionError(
  err: unknown
): { instructionIndex: number; errorCode: number } | null {
  if (!err || typeof err !== "object") return null;

  const obj = err as Record<string, unknown>;
  const ie = obj["InstructionError"];

  if (!Array.isArray(ie) || ie.length < 2) return null;

  const instructionIndex = typeof ie[0] === "number" ? ie[0] : -1;
  const errorPart = ie[1];

  if (typeof errorPart === "object" && errorPart !== null) {
    const ep = errorPart as Record<string, unknown>;
    if (typeof ep["Custom"] === "number") {
      return { instructionIndex, errorCode: ep["Custom"] };
    }
  }

  return null;
}

/**
 * Determine which program threw the error using log messages.
 * Anchor logs emit: "Program <id> invoke [N]" and "Program <id> failed: ..."
 * We look for the last "failed" log and trace it back to the invoking program.
 */
function extractFailingProgramFromLogs(logs: string[]): string | null {
  // Walk logs in reverse — find the last "failed" line
  for (let i = logs.length - 1; i >= 0; i--) {
    const failMatch = logs[i].match(/^Program (\S+) failed/);
    if (failMatch) {
      return failMatch[1];
    }
  }

  // Fallback: last "invoke" line
  for (let i = logs.length - 1; i >= 0; i--) {
    const invokeMatch = logs[i].match(/^Program (\S+) invoke/);
    if (invokeMatch) {
      return invokeMatch[1];
    }
  }

  return null;
}

/**
 * Extract program ID from accountKeys at the given instruction index.
 * accountKeys entries are {pubkey, signer, writable} in jsonParsed encoding.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractProgramIdFromInstructions(tx: any, instructionIndex: number): string | null {
  try {
    const instructions =
      tx?.transaction?.message?.instructions ?? [];
    const ix = instructions[instructionIndex];
    if (!ix) return null;
    const pid = ix.programId ?? ix.program;
    if (typeof pid === "string") return pid;
    if (pid && typeof pid.toBase58 === "function") return pid.toBase58();
  } catch {
    // ignore
  }
  return null;
}

/**
 * Attempt to fetch IDL via @coral-xyz/anchor using a read-only connection.
 * No wallet required — Program.fetchIdl only reads on-chain data.
 */
async function fetchIdlOnChain(
  programId: string,
  rpcUrl: string
): Promise<Idl | null> {
  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const pubkey = new PublicKey(programId);
    // Program.fetchIdl accepts (address, provider) — provider needs only connection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const provider = { connection } as any;
    const idl = await Program.fetchIdl(pubkey, provider);
    return idl as Idl | null;
  } catch {
    return null;
  }
}

/**
 * Fallback: fetch IDL from the DeployDAO public registry.
 */
async function fetchIdlDeployDao(programId: string): Promise<Idl | null> {
  try {
    const url = `https://raw.githubusercontent.com/DeployDAO/solana-program-index/master/idls/${programId}.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()) as Idl;
  } catch {
    return null;
  }
}

/**
 * Resolve a human-readable error entry from an IDL given a Custom error code.
 */
function lookupIdlError(
  idl: Idl,
  errorCode: number
): IdlError | null {
  const entry = idl.errors?.find((e) => e.code === errorCode) ?? null;
  return entry;
}

/**
 * Generate a plain-English suggestion based on the error name.
 */
function buildSuggestion(
  errorName: string | undefined,
  instructionIndex: number
): string {
  if (!errorName) {
    return `Review the program logs and verify all accounts passed to instruction ${instructionIndex} are correct.`;
  }

  const lower = errorName.toLowerCase();

  if (lower.includes("unauthorized") || lower.includes("authority") || lower.includes("signer")) {
    return `Check that the correct signer account is passed to instruction ${instructionIndex}.`;
  }
  if (lower.includes("overflow") || lower.includes("underflow") || lower.includes("arithmetic")) {
    return `An arithmetic overflow/underflow occurred in instruction ${instructionIndex}. Check input amounts.`;
  }
  if (lower.includes("account") && lower.includes("init")) {
    return `The account in instruction ${instructionIndex} may already be initialized, or was not created correctly.`;
  }
  if (lower.includes("constraint") || lower.includes("seeds") || lower.includes("bump")) {
    return `A PDA constraint failed in instruction ${instructionIndex}. Verify seeds and bump derivation.`;
  }
  if (lower.includes("invalid") || lower.includes("notfound") || lower.includes("not_found")) {
    return `An expected account or value was invalid or not found in instruction ${instructionIndex}.`;
  }
  if (lower.includes("already")) {
    return `The operation in instruction ${instructionIndex} was already performed — check for duplicate calls.`;
  }

  return `Review accounts and arguments passed to instruction ${instructionIndex} for error "${errorName}".`;
}

// ── Main exported function ────────────────────────────────────────────────────

export async function decodeError(
  signature: string,
  heliusApiKey: string,
  network: "mainnet" | "devnet" = "devnet"
): Promise<DecodeErrorResult> {
  // Validate signature length
  if (signature.length !== 88) {
    return {
      signature,
      network,
      status: "not_found",
      idlAvailable: false,
      error:
        `Invalid transaction signature — expected 88 characters, got ${signature.length}. ` +
        `Make sure you copied the full signature.`,
    };
  }

  const rpcUrl =
    network === "mainnet"
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
      : `https://devnet.helius-rpc.com/?api-key=${heliusApiKey}`;

  // ── Step 1: Fetch the transaction ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tx: any;
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [
          signature,
          { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
        ],
      }),
    });

    if (!response.ok) {
      return {
        signature,
        network,
        status: "not_found",
        idlAvailable: false,
        error: `RPC HTTP error ${response.status}: ${response.statusText}`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await response.json()) as any;

    if (json.error) {
      return {
        signature,
        network,
        status: "not_found",
        idlAvailable: false,
        error: `RPC error: ${json.error.message ?? JSON.stringify(json.error)}`,
      };
    }

    tx = json.result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      signature,
      network,
      status: "not_found",
      idlAvailable: false,
      error: `RPC error: ${message}`,
    };
  }

  if (!tx) {
    return {
      signature,
      network,
      status: "not_found",
      idlAvailable: false,
      error: `Transaction not found on ${network}. It may have been dropped or not yet confirmed.`,
    };
  }

  // ── Step 2: Check if the transaction actually failed ───────────────────────
  const metaErr = tx?.meta?.err;
  if (!metaErr) {
    return {
      signature,
      network,
      status: "success",
      idlAvailable: false,
      rawError: undefined,
      error: `This transaction succeeded — no error to decode.`,
    };
  }

  const rawError = JSON.stringify(metaErr);

  // ── Step 3: Extract instruction index + Custom error code ─────────────────
  const parsed = parseInstructionError(metaErr);

  if (!parsed) {
    // Not an InstructionError with a Custom code — return raw info
    return {
      signature,
      network,
      status: "failed",
      rawError,
      idlAvailable: false,
      error: `Transaction failed with a non-Custom error: ${rawError}`,
    };
  }

  const { instructionIndex, errorCode } = parsed;

  // ── Step 4: Find the program ID ───────────────────────────────────────────
  const logs: string[] = tx?.meta?.logMessages ?? [];

  let programId =
    extractFailingProgramFromLogs(logs) ??
    extractProgramIdFromInstructions(tx, instructionIndex);

  if (!programId) {
    return {
      signature,
      network,
      status: "failed",
      instructionIndex,
      errorCode,
      rawError,
      idlAvailable: false,
      suggestion: `Custom error code ${errorCode} — could not determine the failing program ID from logs.`,
    };
  }

  // ── Step 5: Fetch IDL (on-chain first, then DeployDAO) ────────────────────
  // Use HTTP for on-chain IDL fetch only if it won't block — Anchor's fetchIdl
  // opens a Connection but immediately closes it after the RPC read.
  let idl: Idl | null = null;
  let idlAvailable = false;

  // Try on-chain via Anchor
  idl = await fetchIdlOnChain(programId, rpcUrl);

  // Fallback: DeployDAO registry
  if (!idl) {
    idl = await fetchIdlDeployDao(programId);
  }

  if (idl) idlAvailable = true;

  // ── Step 6: Look up error code in IDL ─────────────────────────────────────
  let errorName: string | undefined;
  let errorMessage: string | undefined;

  if (idl) {
    const entry = lookupIdlError(idl, errorCode);
    if (entry) {
      errorName = entry.name;
      errorMessage = entry.msg ?? "(no message in IDL)";
    } else {
      errorMessage = `Error code ${errorCode} not found in IDL errors array — IDL may be outdated.`;
    }
  }

  const suggestion = buildSuggestion(errorName, instructionIndex);

  return {
    signature,
    network,
    status: "failed",
    programId,
    instructionIndex,
    errorCode,
    errorName,
    errorMessage,
    rawError,
    idlAvailable,
    suggestion,
  };
}
