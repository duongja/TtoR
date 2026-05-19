import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

import type { SolanaWalletClient } from "../types.js";

export function keypairFromSecret(value: string): Keypair {
  const trimmed = value.trim();
  const bytes = trimmed.startsWith("[")
    ? Uint8Array.from(JSON.parse(trimmed) as number[])
    : bs58.decode(trimmed);

  return Keypair.fromSecretKey(bytes);
}

export class SolanaHotWalletClient implements SolanaWalletClient {
  private readonly keypair: Keypair;
  private readonly connection: Connection;

  public constructor(secretKey: string, rpcUrl: string) {
    this.keypair = keypairFromSecret(secretKey);
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  public publicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  public async signBase64Transaction(transaction: string): Promise<string> {
    const buffer = Buffer.from(transaction, "base64");
    const versionedTransaction = VersionedTransaction.deserialize(buffer);
    versionedTransaction.sign([this.keypair]);
    return Buffer.from(versionedTransaction.serialize()).toString("base64");
  }

  public async getSolBalance(): Promise<number> {
    const lamports = await this.connection.getBalance(this.keypair.publicKey, "confirmed");
    return lamports / LAMPORTS_PER_SOL;
  }

  public async getSplTokenBalance(mint: string): Promise<number> {
    const accounts = await this.connection.getParsedTokenAccountsByOwner(this.keypair.publicKey, {
      mint: new PublicKey(mint)
    });

    return accounts.value.reduce((sum, account) => {
      const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
      return sum + (typeof amount === "number" ? amount : 0);
    }, 0);
  }
}
