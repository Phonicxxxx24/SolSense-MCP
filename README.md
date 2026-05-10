# SolSense — On-Chain Intelligence for AI Coding Assistants

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Compatible-blueviolet)
![License](https://img.shields.io/badge/License-MIT-green)
![Hackathon](https://img.shields.io/badge/Colosseum-Frontier%202026-orange)

> Gives AI agents (Claude, Cursor, Antigravity, Windsurf, etc.) **real-time Solana data** and explains what's happening on-chain — automatically, without being asked.

---

## What is SolSense?

SolSense is a **Model Context Protocol (MCP) server** and a standalone **CLI** that give AI coding assistants live Solana context:

- Check wallet balances and recent transactions
- Explain what a transaction did in plain English
- Decode cryptic program error codes back into human-readable messages (using the program's published IDL)
- Airdrop devnet SOL automatically when a wallet is empty
- Watch a program address for new on-chain activity

All tools are wired with **proactive trigger descriptions** — the AI calls them automatically when it sees a wallet address, a transaction signature, or a failed transaction, without you needing to ask.

---

## Installation

### Prerequisites

- **Node.js 18+** (`node --version`)
- **npm** (comes with Node)
- A free **Helius API key** — get one at [helius.dev](https://helius.dev) (free tier: 100k requests/day)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/Phonicxxxx24/SolSense-MCP.git
cd solsense-mcp

# 2. Copy the environment template and fill in your key
cp .env.example .env
# Edit .env — replace "your_helius_api_key_here" with your real key

# 3. Install dependencies
npm install

# 4. Build the project
npm run build
```

---

## Usage: MCP Server (for AI Assistants)

### Claude Desktop

Add this to your `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "solsense": {
      "command": "node",
      "args": ["ABSOLUTE_PATH_TO/solsense-mcp/dist/index.js"],
      "env": {
        "HELIUS_API_KEY": "YOUR_KEY_HERE",
        "SOLANA_NETWORK": "devnet"
      }
    }
  }
}
```

Replace `ABSOLUTE_PATH_TO` with the real path to the cloned repo.

### Cursor

Create or edit `.cursor/mcp.json` in your project root with the same config above.

### Windsurf / Antigravity / Other MCP-Compatible Clients

The server communicates over **stdio** and is compatible with any MCP client. Use the same JSON config structure — point `command` to `node` and `args` to the compiled `dist/index.js`, with `HELIUS_API_KEY` set in `env`.

---

## Usage: CLI

Run commands directly from the terminal after building:

```bash
# Check SOL balance and recent transactions for a wallet
node dist/cli.js balance <wallet-address> --network devnet

# Get a plain-English explanation of any transaction
node dist/cli.js explain <tx-signature> --network devnet

# Airdrop devnet SOL to a wallet (devnet only)
node dist/cli.js airdrop <wallet-address> --amount 1

# Decode the error from a failed transaction using the program's IDL
node dist/cli.js decode <failed-tx-signature> --network devnet

# Watch a program for recent on-chain activity
node dist/cli.js watch <program-address> --network devnet --limit 10

# Poll for NEW activity since a specific slot
node dist/cli.js watch <program-address> --network devnet --since <slot-number>
```

**Example — watch the SPL Token Program on devnet:**
```bash
node dist/cli.js watch TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA --network devnet --limit 5
```

**Optional `--short` flag on `balance`** for compact output:
```bash
node dist/cli.js balance <wallet-address> --short
```

---

## Features

| # | MCP Tool | CLI Command | Description |
|---|----------|-------------|-------------|
| 1 | `get_wallet_state` | `balance` | SOL balance (in SOL + lamports) and 5 most recent transaction statuses |
| 2 | `explain_transaction` | `explain` | Plain-English breakdown of any transaction: fee, account deltas, program logs, failure reason |
| 3 | `airdrop_devnet` | `airdrop` | Request devnet SOL — auto-fallback to public faucet if Helius rate-limits |
| 4 | `decode_error` | `decode` | Fetches the program's IDL (on-chain via Anchor, fallback to DeployDAO) and maps error codes to names and messages |
| 5 | `watch_program` | `watch` | Lists recent transactions for any program address; supports polling mode with `--since <slot>` |

### Proactive AI Behavior

Each MCP tool is described with trigger conditions that cause the AI to call it **automatically**:

- **`get_wallet_state`** → fires when a base58 wallet address appears in conversation or code
- **`explain_transaction`** → fires when an 88-character transaction signature is mentioned or pasted
- **`decode_error`** → fires when a transaction fails with an error code
- **`airdrop_devnet`** → fires when a devnet wallet has 0 or near-zero SOL
- **`watch_program`** → fires when the developer asks about monitoring or tracking a program

---

## Architecture

```
src/
  index.ts              ← MCP server entry point, all 5 tools registered
  cli.ts                ← CLI entry point (commander.js)
  tools/
    getWalletState.ts   ← Tool 1
    explainTransaction.ts ← Tool 2
    airdropSol.ts       ← Tool 3
    decodeError.ts      ← Tool 4 (IDL-aware error decoding)
    watchProgram.ts     ← Tool 5 (program activity monitor)
scripts/
  createFailedTx.ts     ← Dev helper: creates an intentionally failed tx for testing decode_error
sidetrack/
  trending.html         ← Hackathon sidetrack: Solana Trending Programs dashboard
  README.md             ← Sidetrack description
```

**Design principles:**
- All RPC calls use plain HTTP `fetch` — no persistent WebSocket connections
- `console.error()` for all logging (stdout is reserved for MCP protocol JSON)
- Errors returned as `{ content, isError: true }` — never thrown to transport
- All public functions have explicit return types, TypeScript strict mode

---

## Demo

> 📺 **Video demo:** [Coming soon — YouTube link]

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `HELIUS_API_KEY` | ✅ Yes | Your Helius RPC API key ([helius.dev](https://helius.dev)) |
| `SOLANA_NETWORK` | No | `"devnet"` (default) or `"mainnet"` |

---

## Development

```bash
# Type-check without building
npx tsc --noEmit

# Build
npm run build

# Run MCP server directly (for debugging)
npm start

# Run CLI dev mode (no build needed)
npx ts-node --esm src/cli.ts balance <address>
```

---

## Contributing

Pull requests welcome. Please follow the rules in `AGENTS.md`:

- No new npm dependencies without discussion
- No RPC provider changes (Helius only; public endpoints as fallback)
- No refactoring completed tools unless there's a confirmed bug
- TypeScript strict mode — no `any`, explicit return types on all exports

---

## License

MIT © 2026 — Built for the [Colosseum Frontier Hackathon](https://arena.colosseum.org/)
