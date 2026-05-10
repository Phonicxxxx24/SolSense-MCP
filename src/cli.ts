#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { getWalletState } from "./tools/getWalletState.js";
import { explainTransaction } from "./tools/explainTransaction.js";
import { airdropSol } from "./tools/airdropSol.js";
import { decodeError } from "./tools/decodeError.js";
import { watchProgram } from "./tools/watchProgram.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? "";

if (!HELIUS_API_KEY) {
  console.error(
    "Error: HELIUS_API_KEY environment variable is required.\n" +
    "  1. Copy .env.example to .env\n" +
    "  2. Replace 'your-helius-api-key-here' with your real key from https://helius.dev\n" +
    "  3. Re-run the command."
  );
  process.exit(1);
}

function resolveNetwork(opt: string | undefined): "mainnet" | "devnet" {
  const net = (opt ?? process.env.SOLANA_NETWORK ?? "devnet").toLowerCase();
  if (net === "mainnet") return "mainnet";
  return "devnet";
}

/** Dim grey separator line */
function sep() {
  console.log("\x1b[90m" + "─".repeat(56) + "\x1b[0m");
}

function bold(s: string) {
  return `\x1b[1m${s}\x1b[0m`;
}

function green(s: string) {
  return `\x1b[32m${s}\x1b[0m`;
}

function red(s: string) {
  return `\x1b[31m${s}\x1b[0m`;
}

function cyan(s: string) {
  return `\x1b[36m${s}\x1b[0m`;
}

function yellow(s: string) {
  return `\x1b[33m${s}\x1b[0m`;
}

// ── CLI setup ─────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name("solsense")
  .description("SolSense CLI — Solana wallet & transaction tools")
  .version("0.1.0");

// ── Command: balance ──────────────────────────────────────────────────────────

program
  .command("balance <wallet-address>")
  .description("Get the SOL balance and recent transactions for a wallet")
  .option("-n, --network <network>", "Network: mainnet or devnet", "devnet")
  .option("-s, --short", "Truncate signatures for compact display")
  .action(async (walletAddress: string, opts: { network?: string; short?: boolean }) => {
    const network = resolveNetwork(opts.network);
    console.log(`\n${bold("SolSense")} · ${cyan("balance")}\n`);
    console.log(`Wallet:   ${yellow(walletAddress)}`);
    console.log(`Network:  ${network}`);
    sep();

    const result = await getWalletState(walletAddress, HELIUS_API_KEY, network);

    if (result.error) {
      console.error(red(`Error: ${result.error}`));
      process.exit(1);
    }

    console.log(
      `Balance:  ${bold(green(result.balanceSOL.toFixed(6) + " SOL"))}  (${result.balanceLamports.toLocaleString()} lamports)`
    );

    sep();
    console.log(`Recent Transactions (last ${result.recentTransactions.length}):\n`);

    if (result.recentTransactions.length === 0) {
      console.log("  No recent transactions found.");
    } else {
      result.recentTransactions.forEach((tx, i) => {
        const icon = tx.status === "success" ? green("✓") : red("✗");
        const time = tx.blockTime
          ? new Date(tx.blockTime * 1000).toLocaleString()
          : "unknown time";
        const sig = opts.short
          ? tx.signature.slice(0, 24) + "…"
          : tx.signature;
        console.log(
          `  ${i + 1}. ${icon}  ${cyan(sig)}  slot ${tx.slot}  (${time})`
        );
      });
    }

    console.log("");
    setImmediate(() => process.exit(0));
  });

// ── Command: explain ──────────────────────────────────────────────────────────

program
  .command("explain <tx-signature>")
  .description("Fetch a transaction and explain what happened in plain English")
  .option("-n, --network <network>", "Network: mainnet or devnet", "devnet")
  .action(async (txSignature: string, opts: { network?: string }) => {
    const network = resolveNetwork(opts.network);
    console.log(`\n${bold("SolSense")} · ${cyan("explain")}\n`);
    console.log(`Signature: ${yellow(txSignature)}`);
    console.log(`Network:   ${network}`);
    sep();

    const result = await explainTransaction(txSignature, HELIUS_API_KEY, network);

    if (result.error) {
      console.error(red(`Error: ${result.error}`));
      process.exit(1);
    }

    console.log(result.explanation);
    console.log("");
    setImmediate(() => process.exit(0));
  });

// ── Command: airdrop ──────────────────────────────────────────────────────────

program
  .command("airdrop <wallet-address>")
  .description("Request a devnet SOL airdrop (always targets devnet)")
  .option("-a, --amount <sol>", "Amount of SOL to airdrop", "1")
  .action(async (walletAddress: string, opts: { amount?: string }) => {
    const amountSOL = parseFloat(opts.amount ?? "1");

    if (isNaN(amountSOL) || amountSOL <= 0) {
      console.error(red("Error: --amount must be a positive number"));
      process.exit(1);
    }

    console.log(`\n${bold("SolSense")} · ${cyan("airdrop")}\n`);
    console.log(`Wallet:   ${yellow(walletAddress)}`);
    console.log(`Amount:   ${amountSOL} SOL`);
    console.log(`Network:  devnet (airdrops are devnet-only)`);
    sep();
    console.log("Requesting airdrop… this may take a few seconds.");

    const result = await airdropSol(walletAddress, HELIUS_API_KEY, amountSOL);

    if (result.error) {
      console.log("");
      sep();
      console.log(red(bold("  ✗ Airdrop failed")));
      sep();

      // Try to extract structured info from the error string
      const jsonMatch = result.error.match(/\{[\s\S]*\}$/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const rpcErr = parsed.error ?? parsed;
          if (rpcErr.code) console.log(`  Code:      ${yellow(String(rpcErr.code))}`);
          if (rpcErr.message) console.log(`  Reason:    ${rpcErr.message}`);
        } catch {
          // Not valid JSON — show raw message below
        }
        // Show the HTTP status portion if present (e.g. "403 Forbidden")
        const httpMatch = result.error.match(/(\d{3}\s+\w+)/);
        if (httpMatch) console.log(`  HTTP:      ${httpMatch[1]}`);
      } else {
        console.log(`  Reason:    ${result.error}`);
      }

      console.log(`  Wallet:    ${walletAddress}`);
      console.log(`  Amount:    ${amountSOL} SOL`);
      console.log(`  Network:   devnet`);
      sep();
      console.log("");
      process.exit(1);
    }

    console.log("");
    sep();
    console.log(green(bold("  ✓ Airdrop successful!")));
    sep();
    console.log(`  Amount:    ${bold(result.amountSOL + " SOL")}`);
    console.log(`  Wallet:    ${walletAddress}`);
    console.log(`  Signature: ${cyan(result.signature ?? "")}`);
    console.log(`  Explorer:  https://explorer.solana.com/tx/${result.signature}?cluster=devnet`);
    sep();
    console.log("");
    setImmediate(() => process.exit(0));
  });

// ── Command: decode ──────────────────────────────────────────────────────────

program
  .command("decode <tx-signature>")
  .description("Decode the error from a failed transaction using the program's IDL")
  .option("-n, --network <network>", "Network: mainnet or devnet", "devnet")
  .action(async (txSignature: string, opts: { network?: string }) => {
    const network = resolveNetwork(opts.network);
    console.log(`\n${bold("SolSense")} · ${cyan("decode")}\n`);
    console.log(`Signature: ${yellow(txSignature)}`);
    console.log(`Network:   ${network}`);
    sep();

    const result = await decodeError(txSignature, HELIUS_API_KEY, network);

    if (result.error) {
      console.error(red(`Error: ${result.error}`));
      process.exit(1);
    }

    // Status
    const statusLine =
      result.status === "failed" ? red(bold("❌ FAILED")) : green(bold("✅ SUCCESS"));
    console.log(`Status:        ${statusLine}`);

    // Program + instruction
    if (result.programId) {
      console.log(`Program:       ${cyan(result.programId)}`);
    }
    if (result.instructionIndex !== undefined) {
      console.log(`Instruction:   index ${result.instructionIndex}`);
    }

    // Error details
    if (result.errorCode !== undefined) {
      console.log(`Error Code:    ${yellow(`Custom(${result.errorCode})`)}`);
    }
    if (result.errorName) {
      console.log(`Error Name:    ${bold(result.errorName)}`);
    }
    if (result.errorMessage) {
      console.log(`Error Message: ${result.errorMessage}`);
    }
    if (!result.idlAvailable) {
      console.log(`IDL:           ${yellow("Program IDL not publicly available")}`);
    }
    if (result.rawError && !result.errorName) {
      console.log(`Raw Error:     ${result.rawError}`);
    }

    // Suggestion
    if (result.suggestion) {
      sep();
      console.log(`Suggestion: ${result.suggestion}`);
    }

    console.log("");
    sep();
    console.log("");
    setImmediate(() => process.exit(0));
  });

// ── Command: watch ─────────────────────────────────────────────────────

program
  .command("watch <program-address>")
  .description("Fetch recent transactions for a Solana program address")
  .option("-n, --network <network>", "Network: mainnet or devnet", "devnet")
  .option("-l, --limit <n>", "Number of signatures to return (1-50)", "10")
  .option("-s, --since <slot>", "Only show signatures newer than this slot number")
  .action(
    async (
      programAddress: string,
      opts: { network?: string; limit?: string; since?: string }
    ) => {
      const network = resolveNetwork(opts.network);
      const limit = Math.min(Math.max(1, parseInt(opts.limit ?? "10", 10)), 50);
      const since = opts.since ? parseInt(opts.since, 10) : undefined;

      console.log(`\n${bold("SolSense")} · ${cyan("watch")}\n`);
      console.log(`Program:  ${yellow(programAddress)}`);
      console.log(`Network:  ${network}`);
      console.log(`Limit:    ${limit}`);
      if (since !== undefined) console.log(`Since:    slot ${since}`);
      sep();

      const result = await watchProgram(programAddress, HELIUS_API_KEY, network, limit, since);

      if (result.error) {
        console.error(red(`Error: ${result.error}`));
        process.exit(1);
      }

      const modeLabel = result.filteredBySince
        ? yellow("Polling mode — new activity only")
        : "Recent activity";
      console.log(`Mode:     ${modeLabel}`);
      console.log(`Found:    ${bold(String(result.activities.length))} transaction(s)`);
      sep();

      if (result.activities.length === 0) {
        console.log(cyan("  No activity found."));
      } else {
        result.activities.forEach((a, i) => {
          const icon = a.status === "success" ? green("✓") : red("✗");
          const time = a.blockTime
            ? new Date(a.blockTime * 1000).toLocaleString()
            : "unknown time";
          console.log(`  ${i + 1}. ${icon}  slot ${bold(String(a.slot))}  (${time})`);
          console.log(`     ${cyan(a.signature)}`);
        });
      }

      if (result.latestSlot) {
        sep();
        console.log(
          `${yellow("Tip:")} To poll for only new activity, run:\n` +
            `  node dist/cli.js watch ${programAddress} --network ${network} --since ${result.latestSlot}`
        );
      }

      console.log("");
      setImmediate(() => process.exit(0));
    }
  );

// ── Run ───────────────────────────────────────────────────────────────────────

program
  .parseAsync(process.argv)
  .catch((err) => {
    console.error(red(`Fatal: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  });
