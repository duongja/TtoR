import { Connection, PublicKey } from "@solana/web3.js";

import type { DexRugpullDetail, DexTokenCandidateRecord } from "../types.js";

export interface FreeTokenSecurityFinding {
  detail: DexRugpullDetail;
  rawPayload: Record<string, unknown>;
}

export interface FreeTokenSecurityCheckResult {
  findings: FreeTokenSecurityFinding[];
  rawPayload: Record<string, unknown>;
}

export interface FreeTokenSecurityChecker {
  check(candidate: DexTokenCandidateRecord): Promise<FreeTokenSecurityCheckResult>;
}

interface SolanaSecurityConnection {
  getParsedAccountInfo(publicKey: PublicKey): Promise<{ value: unknown }>;
  getTokenLargestAccounts(publicKey: PublicKey): Promise<{ value: Array<{
    address: PublicKey;
    amount: string;
    decimals: number;
    uiAmount: number | null;
    uiAmountString?: string;
  }> }>;
}

function isSolanaChain(chainId: string): boolean {
  return chainId.toLowerCase() === "solana";
}

function parsedAccountInfo(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const account = value as { data?: unknown };
  if (!account.data || typeof account.data !== "object") {
    return null;
  }

  const data = account.data as { parsed?: unknown };
  if (!data.parsed || typeof data.parsed !== "object") {
    return null;
  }

  const parsed = data.parsed as { info?: unknown };
  return parsed.info && typeof parsed.info === "object" ? parsed.info as Record<string, unknown> : null;
}

function tokenSupplyAmount(info: Record<string, unknown>): number | null {
  const supply = info.supply;
  if (typeof supply === "string") {
    const parsed = Number.parseFloat(supply);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export class SolanaFreeTokenSecurityChecker implements FreeTokenSecurityChecker {
  public constructor(
    rpcUrl: string,
    private readonly connection: SolanaSecurityConnection = new Connection(rpcUrl, "confirmed")
  ) {
  }

  public async check(candidate: DexTokenCandidateRecord): Promise<FreeTokenSecurityCheckResult> {
    if (!isSolanaChain(candidate.chainId)) {
      return {
        findings: [],
        rawPayload: {
          skipped: "unsupported_chain"
        }
      };
    }

    const mint = new PublicKey(candidate.baseTokenAddress);
    const [accountInfo, largestAccounts] = await Promise.all([
      this.connection.getParsedAccountInfo(mint),
      this.connection.getTokenLargestAccounts(mint).catch(() => null)
    ]);
    const info = parsedAccountInfo(accountInfo.value);
    const findings: FreeTokenSecurityFinding[] = [];
    const supply = info ? tokenSupplyAmount(info) : null;
    const mintAuthority = info?.mintAuthority;
    const freezeAuthority = info?.freezeAuthority;

    if (mintAuthority) {
      findings.push({
        detail: {
          flag: "mint_authority_enabled",
          severity: "critical",
          points: 30,
          description: "Solana mint authority is still enabled, so more supply may be minted."
        },
        rawPayload: {
          mintAuthority
        }
      });
    }

    if (freezeAuthority) {
      findings.push({
        detail: {
          flag: "freeze_authority_enabled",
          severity: "critical",
          points: 30,
          description: "Solana freeze authority is still enabled, so token accounts may be frozen."
        },
        rawPayload: {
          freezeAuthority
        }
      });
    }

    const holders = largestAccounts?.value ?? [];
    if (supply && holders.length > 0) {
      const topHolderPct = Number(holders[0]?.amount ?? 0) / supply;
      const top10Pct = holders
        .slice(0, 10)
        .reduce((sum, account) => sum + Number(account.amount ?? 0), 0) / supply;

      if (topHolderPct >= 0.35) {
        findings.push({
          detail: {
            flag: "top_holder_concentration",
            severity: topHolderPct >= 0.5 ? "critical" : "high",
            points: topHolderPct >= 0.5 ? 30 : 20,
            description: `Largest holder controls ${(topHolderPct * 100).toFixed(1)}% of supply.`
          },
          rawPayload: {
            topHolderPct
          }
        });
      }

      if (top10Pct >= 0.65) {
        findings.push({
          detail: {
            flag: "top10_holder_concentration",
            severity: top10Pct >= 0.8 ? "critical" : "high",
            points: top10Pct >= 0.8 ? 25 : 15,
            description: `Top 10 holders control ${(top10Pct * 100).toFixed(1)}% of supply.`
          },
          rawPayload: {
            top10Pct
          }
        });
      }
    }

    return {
      findings,
      rawPayload: {
        chain: "solana",
        supply,
        mintAuthority: mintAuthority ?? null,
        freezeAuthority: freezeAuthority ?? null,
        largestAccounts: holders.slice(0, 10).map((account) => ({
          address: account.address.toBase58(),
          amount: account.amount,
          decimals: account.decimals,
          uiAmount: account.uiAmount,
          uiAmountString: account.uiAmountString
        }))
      }
    };
  }
}

export class CompositeFreeTokenSecurityChecker implements FreeTokenSecurityChecker {
  public constructor(private readonly checkers: FreeTokenSecurityChecker[]) {}

  public async check(candidate: DexTokenCandidateRecord): Promise<FreeTokenSecurityCheckResult> {
    const findings: FreeTokenSecurityFinding[] = [];
    const rawPayload: Record<string, unknown> = {};

    for (const checker of this.checkers) {
      try {
        const result = await checker.check(candidate);
        findings.push(...result.findings);
        rawPayload[checker.constructor.name] = result.rawPayload;
      } catch (error) {
        rawPayload[checker.constructor.name] = {
          error: error instanceof Error ? error.message : "Unknown free security check error"
        };
      }
    }

    return {
      findings,
      rawPayload
    };
  }
}
