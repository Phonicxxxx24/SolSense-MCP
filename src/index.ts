import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getWalletState } from "./tools/getWalletState.js";
import { explainTransaction } from "./tools/explainTransaction.js";
import { airdropSol } from "./tools/airdropSol.js";
import { decodeError } from "./tools/decodeError.js";
import { watchProgram } from "./tools/watchProgram.js";

// ── Config ────────────────────────────────────────────────────────────────────
const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? "";
const SOLANA_NETWORK = (process.env.SOLANA_NETWORK ?? "devnet") as "mainnet" | "devnet";

if (!HELIUS_API_KEY) {
  console.error(
    "Error: HELIUS_API_KEY environment variable is required.\n" +
    "  1. Copy .env.example to .env\n" +
    "  2. Replace 'your-helius-api-key-here' with your real key from https://helius.dev\n" +
    "  3. Restart the server."
  );
  process.exit(1);
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "solsense-mcp",
  version: "0.1.0",
});

// ── Tool 1: get_wallet_state ──────────────────────────────────────────────────
server.tool(
  "get_wallet_state",
  // Trigger automatically when: (1) a Solana wallet address (base58, 32–44 chars) appears in the
  // conversation, (2) the user mentions balance, funds, or wallet info, or (3) we are debugging any
  // Solana program/transaction and need to verify the signer or payer account state.
  // Do NOT wait for the user to explicitly ask — call this tool proactively whenever a wallet address
  // is visible in the context so the user always has up-to-date balance and recent tx data available.
  "PROACTIVE: Call this tool automatically whenever a Solana wallet address (base58 public key) appears in the conversation or code — do not wait to be asked. Also call it when debugging Solana transactions or programs to inspect the signer/payer balance and recent activity. Returns SOL balance (in SOL and lamports) plus the 5 most recent transactions with their status.",
  {
    address: z.string().describe("Solana wallet address (base58 public key)"),
    network: z
      .enum(["mainnet", "devnet"])
      .optional()
      .describe("Network to query — defaults to server config (devnet)"),
  },
  async ({ address, network }) => {
    const result = await getWalletState(
      address,
      HELIUS_API_KEY,
      network ?? SOLANA_NETWORK
    );

    if (result.error) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    const txLines = result.recentTransactions.length
      ? result.recentTransactions
          .map(
            (tx, i) =>
              `  ${i + 1}. ${tx.status === "success" ? "✓" : "✗"} ${tx.signature.slice(0, 20)}...  (slot ${tx.slot})`
          )
          .join("\n")
      : "  No recent transactions found.";

    const output = [
      `Wallet:  ${result.address}`,
      `Network: ${result.network}`,
      `Balance: ${result.balanceSOL.toFixed(6)} SOL (${result.balanceLamports} lamports)`,
      ``,
      `Recent Transactions (last 5):`,
      txLines,
    ].join("\n");

    return { content: [{ type: "text", text: output }] };
  }
);

// ── Tool 2: explain_transaction ─────────────────────────────────────────────
server.tool(
  "explain_transaction",
  // Trigger automatically when: (1) a transaction signature (88-char base58 string) appears anywhere
  // in the conversation, (2) the user says a transaction failed or they're getting an error from a tx,
  // or (3) the user pastes logs that contain a signature. Parse the output to surface the failure
  // reason, account deltas, and program logs without waiting to be asked.
  "PROACTIVE: Call this tool automatically when a Solana transaction signature (88-character base58 string) appears in the conversation, is pasted in a code block, or surfaces in logs. Also call it immediately when a user reports a transaction failure or error — fetch and explain the failed tx right away. Returns a plain-English breakdown of status, fee, account balance changes, program logs, and the precise failure reason (including InstructionError code and program error) if the transaction failed.",
  {
    signature: z.string().describe("Transaction signature (88-character base58 string)"),
    network: z
      .enum(["mainnet", "devnet"])
      .optional()
      .describe("Network to query — defaults to server config (devnet)"),
  },
  async ({ signature, network }) => {
    const result = await explainTransaction(
      signature,
      HELIUS_API_KEY,
      network ?? SOLANA_NETWORK
    );

    if (result.error) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    return { content: [{ type: "text", text: result.explanation }] };
  }
);

// ── Tool 3: airdrop_devnet ────────────────────────────────────────────────────
server.tool(
  "airdrop_devnet",
  // Trigger automatically when: (1) get_wallet_state reveals a devnet wallet balance that is zero or
  // too low to cover transaction fees (~0.000005 SOL per signature), (2) a transaction fails with
  // "insufficient funds", "0x1" (InsufficientFunds), or "account has insufficient lamports" on devnet,
  // or (3) the user is about to deploy or test on devnet and their wallet balance is < 0.01 SOL.
  // Always confirm the network is devnet before calling — mainnet airdrops are impossible.
  "PROACTIVE: Call this tool automatically on devnet when a wallet has insufficient SOL to pay for transactions — specifically when: (a) get_wallet_state shows a balance of 0 or near-zero, (b) a transaction fails with an insufficient-funds error (InsufficientFunds / 0x1 / insufficient lamports) on devnet, or (c) the user is about to run a deploy/test and their devnet balance is below 0.01 SOL. Always targets devnet only — never call for mainnet addresses. Airdrops 1 SOL by default.",
  {
    address: z.string().describe("Solana wallet address to airdrop SOL to (base58 public key)"),
    amount: z
      .number()
      .positive()
      .optional()
      .describe("Amount of SOL to airdrop — defaults to 1 SOL"),
  },
  async ({ address, amount }) => {
    const result = await airdropSol(address, HELIUS_API_KEY, amount ?? 1);

    if (result.error) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    const output = [
      `Airdrop successful!`,
      `Wallet:    ${result.address}`,
      `Network:   ${result.network}`,
      `Amount:    ${result.amountSOL} SOL`,
      `Signature: ${result.signature}`,
      ``,
      `View on explorer: https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
    ].join("\n");

    return { content: [{ type: "text", text: output }] };
  }
);

// ── Tool 4: decode_error ─────────────────────────────────────────────────────
server.tool(
  "decode_error",
  "PROACTIVE: Call this tool automatically whenever a Solana transaction fails with an error code. Given a transaction signature, fetches the program's IDL from chain and returns the human-readable error name and message instead of a raw error code. Trigger when: (a) a transaction fails with InstructionError / Custom code, (b) a user pastes a failed tx signature and asks why it failed, or (c) explain_transaction reveals a custom program error.",
  {
    signature: z.string().describe("Transaction signature (88-character base58 string)"),
    network: z
      .enum(["mainnet", "devnet"])
      .optional()
      .describe("Network to query — defaults to server config (devnet)"),
  },
  async ({ signature, network }) => {
    const result = await decodeError(
      signature,
      HELIUS_API_KEY,
      network ?? SOLANA_NETWORK
    );

    if (result.error) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    const sep = "─".repeat(56);
    const lines: string[] = [
      `Status:        ${result.status === "failed" ? "❌ FAILED" : "✅ SUCCESS"}`,
    ];

    if (result.programId) lines.push(`Program:       ${result.programId}`);
    if (result.instructionIndex !== undefined) {
      lines.push(`Instruction:   index ${result.instructionIndex}`);
    }
    if (result.errorCode !== undefined) {
      lines.push(`Error Code:    Custom(${result.errorCode})`);
    }
    if (result.errorName) lines.push(`Error Name:    ${result.errorName}`);
    if (result.errorMessage) lines.push(`Error Message: ${result.errorMessage}`);
    if (!result.idlAvailable) {
      lines.push(`IDL:           Program IDL not publicly available`);
    }
    if (result.rawError && !result.errorName) {
      lines.push(`Raw Error:     ${result.rawError}`);
    }
    if (result.suggestion) {
      lines.push("");
      lines.push(`Suggestion: ${result.suggestion}`);
    }

    const output = [sep, lines.join("\n"), sep].join("\n");
    return { content: [{ type: "text", text: output }] };
  }
);

// ── Tool 5: watch_program ─────────────────────────────────────────────────────
server.tool(
  "watch_program",
  "PROACTIVE: Call this tool automatically when a developer mentions monitoring, tracking, or watching a Solana program for activity. Also call it when a user shares a program ID and wants to see what's happening on-chain with it. Returns the most recent transaction signatures for the program address with slot, timestamp, and status. Pass the returned latestSlot as the 'since' parameter on subsequent calls to get only new activity since the last check.",
  {
    programId: z.string().describe("Solana program address to monitor (base58 public key)"),
    network: z
      .enum(["mainnet", "devnet"])
      .optional()
      .describe("Network to query — defaults to server config (devnet)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Number of recent signatures to return (1–50, default 10)"),
    since: z
      .number()
      .int()
      .optional()
      .describe("Only return signatures with slot > this value. Use the latestSlot from a previous call to poll for new activity."),
  },
  async ({ programId, network, limit, since }) => {
    const result = await watchProgram(
      programId,
      HELIUS_API_KEY,
      network ?? SOLANA_NETWORK,
      limit ?? 10,
      since
    );

    if (result.error) {
      return {
        content: [{ type: "text", text: `Error: ${result.error}` }],
        isError: true,
      };
    }

    const sep = "─".repeat(56);
    const header = [
      `Program:  ${result.programId}`,
      `Network:  ${result.network}`,
      result.filteredBySince ? `Mode:     Polling (new activity only)` : `Mode:     Recent activity`,
      `Found:    ${result.activities.length} transaction(s)`,
    ].join("\n");

    if (result.activities.length === 0) {
      const output = [sep, header, sep, "No new activity found.", sep].join("\n");
      return { content: [{ type: "text", text: output }] };
    }

    const rows = result.activities
      .map((a, i) => {
        const icon = a.status === "success" ? "✓" : "✗";
        const time = a.blockTime
          ? new Date(a.blockTime * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"
          : "unknown time";
        return `  ${i + 1}. ${icon}  slot ${a.slot}  ${time}\n     ${a.signature}`;
      })
      .join("\n");

    const footer = result.latestSlot
      ? `\nTo poll for new activity, pass since=${result.latestSlot} on next call.`
      : "";

    const output = [sep, header, sep, rows, sep, footer].join("\n");
    return { content: [{ type: "text", text: output }] };
  }
);

// ── Prompts (slash-command shortcuts) ─────────────────────────────────────────
//
// Each prompt mirrors its tool's parameters and returns a user message that
// instructs the LLM to immediately call the corresponding tool.  Clients that
// support MCP Prompts (Claude Desktop, Cursor, etc.) expose these as /wallet,
// /explain, /airdrop, /decode and /watch slash commands.

// /wallet <address> [network]
server.prompt(
  "wallet",
  "Quickly check SOL balance and recent activity for any wallet address",
  async (args: any) => {
    if (!args) {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Please provide the required arguments for this command.",
            },
          },
        ],
      };
    }
    const { walletAddress, network } = args;
    const net = network ?? SOLANA_NETWORK;
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Please call the get_wallet_state tool with address="${walletAddress}" and network="${net}". ` +
              `Show me the SOL balance and recent transactions for this wallet.`,
          },
        },
      ],
    };
  }
);

// /explain <signature> [network]
server.prompt(
  "explain",
  "Explain what happened in any Solana transaction",
  async (args: any) => {
    if (!args) {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Please provide the required arguments for this command.",
            },
          },
        ],
      };
    }
    const { signature, network } = args;
    const net = network ?? SOLANA_NETWORK;
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Please call the explain_transaction tool with signature="${signature}" and network="${net}". ` +
              `Give me a plain-English breakdown of what this transaction did, including fee, account balance changes, and any errors.`,
          },
        },
      ],
    };
  }
);

// /airdrop <address> [amount]
server.prompt(
  "airdrop",
  "Request devnet SOL for a wallet (max 1 SOL per request)",
  async (args: any) => {
    if (!args) {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Please provide the required arguments for this command.",
            },
          },
        ],
      };
    }
    const { walletAddress, amount } = args;
    const sol = amount ?? 1;
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Please call the airdrop_devnet tool with address="${walletAddress}" and amount=${sol}. ` +
              `This is a devnet airdrop — confirm it succeeds and show me the transaction signature.`,
          },
        },
      ],
    };
  }
);

// /decode <signature> [network]
server.prompt(
  "decode",
  "Decode a failed transaction's custom error into plain English using the program's IDL",
  async (args: any) => {
    if (!args) {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Please provide the required arguments for this command.",
            },
          },
        ],
      };
    }
    const { signature, network } = args;
    const net = network ?? SOLANA_NETWORK;
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Please call the decode_error tool with signature="${signature}" and network="${net}". ` +
              `Fetch the program's IDL and translate the raw error code into a human-readable name, message, and suggested fix.`,
          },
        },
      ],
    };
  }
);

// /watch <programId> [network] [limit]
server.prompt(
  "watch",
  "Monitor recent on-chain activity for a Solana program",
  async (args: any) => {
    if (!args) {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Please provide the required arguments for this command.",
            },
          },
        ],
      };
    }
    const { programId, network, limit } = args;
    const net = network ?? SOLANA_NETWORK;
    const n = limit ?? 10;
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Please call the watch_program tool with programId="${programId}", network="${net}", and limit=${n}. ` +
              `Show me the most recent ${n} transaction(s) for this program with their slot, timestamp, and status. ` +
              `Also tell me the latestSlot value so I can poll for new activity later.`,
          },
        },
      ],
    };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("SolSense MCP server running — network:", SOLANA_NETWORK);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
