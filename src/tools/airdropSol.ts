import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from "@solana/web3.js";

export interface AirdropResult {
  address: string;
  network: string;
  amountSOL: number;
  signature?: string;
  error?: string;
}

export async function airdropSol(
  address: string,
  heliusApiKey: string,
  amountSOL = 1
): Promise<AirdropResult> {
  // Airdrop is only available on devnet
  const network = "devnet";

  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(address);
  } catch {
    return {
      address,
      network,
      amountSOL,
      error: `Invalid Solana address: ${address}`,
    };
  }

  // Helius devnet RPC supports airdrop; fall back to public cluster if needed
  const rpcUrl = `https://devnet.helius-rpc.com/?api-key=${heliusApiKey}`;
  let connection = new Connection(rpcUrl, "confirmed");

  try {
    const lamports = amountSOL * LAMPORTS_PER_SOL;
    const signature = await connection.requestAirdrop(pubkey, lamports);

    // Confirm the airdrop transaction
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction(
      { signature, ...latestBlockhash },
      "confirmed"
    );

    return { address, network, amountSOL, signature };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Helius sometimes rate-limits airdrops — transparently fall back to public devnet
    if (message.includes("429") || message.includes("Too Many Requests") || message.includes("airdrop")) {
      try {
        const publicConnection = new Connection(
          clusterApiUrl("devnet"),
          "confirmed"
        );
        const lamports = amountSOL * LAMPORTS_PER_SOL;
        const signature = await publicConnection.requestAirdrop(
          pubkey,
          lamports
        );
        const latestBlockhash =
          await publicConnection.getLatestBlockhash();
        await publicConnection.confirmTransaction(
          { signature, ...latestBlockhash },
          "confirmed"
        );
        return { address, network, amountSOL, signature };
      } catch (fallbackErr) {
        const fbMsg =
          fallbackErr instanceof Error
            ? fallbackErr.message
            : String(fallbackErr);
        return {
          address,
          network,
          amountSOL,
          error: `Airdrop failed on both Helius and public devnet: ${fbMsg}`,
        };
      }
    }

    return { address, network, amountSOL, error: `Airdrop failed: ${message}` };
  }
}
