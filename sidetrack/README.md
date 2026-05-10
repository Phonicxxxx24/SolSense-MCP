# Solana Trending Programs — SolSense Sidetrack

A lightweight, single-file web dashboard that shows which Solana programs are generating the most activity on **mainnet**, in real-time using the Helius API.

## What it does

1. Samples the most recent N confirmed transactions (configurable, default 30)
2. Fetches and parses each transaction's program instructions
3. Counts how many transactions each program appeared in
4. Displays the **top 10 trending programs** in a ranked table with:
   - Activity count and visual bar
   - Known program label (SPL Token, Jupiter, Orca, Metaplex, etc.)
   - Example transaction link to Solana Explorer

## How to use

1. Open `trending.html` directly in any modern browser (no server needed)
2. Paste your **Helius mainnet API key** ([helius.dev](https://helius.dev) — free tier works)
3. Optionally adjust the sample size (10–100 transactions)
4. Click **⚡ Analyze**

## Why this is a sidetrack submission

This dashboard was built as a **bonus Helius track** entry alongside the main SolSense MCP project for the [Colosseum Frontier Hackathon 2026](https://arena.colosseum.org/). It demonstrates:

- Direct use of the Helius mainnet RPC endpoint
- No backend, no build step — pure browser-side JavaScript
- Practical developer tooling for understanding Solana ecosystem activity

## Main project

See the root [`README.md`](../README.md) for the full SolSense MCP server and CLI.

---

MIT License · SolSense · Colosseum Frontier 2026
