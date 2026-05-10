import { ParsedTransactionWithMeta } from "@solana/web3.js";

export interface ExplainResult {
  signature: string;
  network: string;
  explanation: string;
  error?: string;
}

function formatLamports(lamports: number): string {
  const sol = Math.abs(lamports) / 1_000_000_000;
  return `${sol.toFixed(6)} SOL`;
}

function buildExplanation(tx: ParsedTransactionWithMeta, sig: string): string {
  const lines: string[] = [];

  // ── Status ───────────────────────────────────────────────────────────────
  const failed = tx.meta?.err != null;
  lines.push(`Status:     ${failed ? "❌ FAILED" : "✅ SUCCESS"}`);
  lines.push(`Signature:  ${sig}`);

  if (tx.blockTime) {
    const date = new Date(tx.blockTime * 1000).toUTCString();
    lines.push(`Confirmed:  ${date}`);
  }

  lines.push(`Slot:       ${tx.slot}`);

  // ── Fee ──────────────────────────────────────────────────────────────────
  if (tx.meta?.fee != null) {
    lines.push(`Fee:        ${formatLamports(tx.meta.fee)}`);
  }

  lines.push("");

  // ── Failure reason ───────────────────────────────────────────────────────
  if (failed && tx.meta?.err) {
    const errStr =
      typeof tx.meta.err === "object"
        ? JSON.stringify(tx.meta.err)
        : String(tx.meta.err);
    lines.push(`Failure Reason:`);
    lines.push(`  ${errStr}`);
    lines.push("");
  }

  // ── Accounts involved ────────────────────────────────────────────────────
  // accountKeys[].pubkey is a plain string in raw JSON (our fetch path),
  // but a PublicKey object when coming through the SDK. Handle both safely.
  const accounts =
    (tx.transaction.message.accountKeys ?? []).map((k) => {
      const key = k as unknown as { pubkey?: unknown };
      if (!key.pubkey) return String(k);
      const p = key.pubkey;
      if (typeof p === "string") return p;
      if (typeof (p as { toBase58?: () => string }).toBase58 === "function") {
        return (p as { toBase58: () => string }).toBase58();
      }
      return String(p);
    });


  if (accounts.length > 0) {
    lines.push(`Accounts Involved (${accounts.length}):`);
    accounts.slice(0, 6).forEach((addr, i) => {
      lines.push(`  [${i}] ${addr}`);
    });
    if (accounts.length > 6) {
      lines.push(`  ... and ${accounts.length - 6} more`);
    }
    lines.push("");
  }

  // ── SOL balance changes ───────────────────────────────────────────────────
  const preBalances = tx.meta?.preBalances ?? [];
  const postBalances = tx.meta?.postBalances ?? [];
  const balanceChanges: string[] = [];

  for (let i = 0; i < preBalances.length && i < accounts.length; i++) {
    const delta = postBalances[i] - preBalances[i];
    if (delta !== 0) {
      const sign = delta > 0 ? "+" : "-";
      balanceChanges.push(
        `  ${accounts[i].slice(0, 20)}...  ${sign}${formatLamports(delta)}`
      );
    }
  }

  if (balanceChanges.length > 0) {
    lines.push("SOL Balance Changes:");
    lines.push(...balanceChanges);
    lines.push("");
  }

  // ── Log messages ─────────────────────────────────────────────────────────
  const logs = tx.meta?.logMessages ?? [];
  if (logs.length > 0) {
    lines.push("Program Logs (first 8):");
    logs.slice(0, 8).forEach((log) => lines.push(`  ${log}`));
    if (logs.length > 8) {
      lines.push(`  ... (${logs.length - 8} more lines omitted)`);
    }
    lines.push("");
  }

  // ── Plain-English summary ─────────────────────────────────────────────────
  lines.push("Summary:");

  if (failed) {
    lines.push(
      "  This transaction was submitted to the network but was rejected on-chain."
    );
    const errStr =
      typeof tx.meta?.err === "object"
        ? JSON.stringify(tx.meta.err)
        : String(tx.meta?.err);

    if (errStr.includes("InsufficientFundsForFee")) {
      lines.push("  The sender did not have enough SOL to cover the tx fee.");
    } else if (errStr.includes("InstructionError")) {
      lines.push(
        "  A program instruction failed — check the logs above for details."
      );
    } else if (errStr.includes("AccountNotFound")) {
      lines.push("  One of the accounts referenced does not exist on-chain.");
    } else {
      lines.push(`  Error code: ${errStr}`);
    }
  } else {
    const senders = balanceChanges
      .filter((l) => l.includes(" -"))
      .map((l) => l.trim().split("  ")[0]);
    const receivers = balanceChanges
      .filter((l) => l.includes(" +"))
      .map((l) => l.trim().split("  ")[0]);

    if (senders.length > 0 && receivers.length > 0) {
      lines.push(
        `  SOL moved from ${senders.length} account(s) to ${receivers.length} account(s).`
      );
    } else if (balanceChanges.length === 0) {
      lines.push(
        "  No SOL balance changes detected — likely a program interaction."
      );
    } else {
      lines.push("  Transaction completed successfully.");
    }
  }

  return lines.join("\n");
}

export async function explainTransaction(
  signature: string,
  heliusApiKey: string,
  network: "mainnet" | "devnet" = "devnet"
): Promise<ExplainResult> {
  // Solana signatures are always 88-character base58 strings.
  // Reject anything else before hitting the RPC to avoid a cryptic "WrongSize" error.
  if (signature.length !== 88) {
    return {
      signature,
      network,
      explanation: "",
      error:
        `Invalid transaction signature — expected 88 characters, got ${signature.length}. ` +
        `Make sure you copied the full signature from the explorer or the balance output.`,
    };
  }

  const rpcUrl =
    network === "mainnet"
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
      : `https://devnet.helius-rpc.com/?api-key=${heliusApiKey}`;

  try {
    // Use a raw HTTP JSON-RPC call instead of new Connection() to avoid
    // creating a persistent WebSocket that keeps libuv handles open on Windows.
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
        explanation: "",
        error: `RPC HTTP error ${response.status}: ${response.statusText}`,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await response.json()) as any;

    if (json.error) {
      return {
        signature,
        network,
        explanation: "",
        error: `RPC error: ${json.error.message ?? JSON.stringify(json.error)}`,
      };
    }

    const tx = json.result as ParsedTransactionWithMeta | null;

    if (!tx) {
      return {
        signature,
        network,
        explanation: "",
        error: `Transaction not found. It may have been dropped or not yet confirmed on ${network}.`,
      };
    }

    return {
      signature,
      network,
      explanation: buildExplanation(tx, signature),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      signature,
      network,
      explanation: "",
      error: `RPC error: ${message}`,
    };
  }
}
