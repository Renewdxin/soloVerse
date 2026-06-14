import type { Evidence, VerificationSpec } from "../../core/domain/types";
import type { VerifierAdapter } from "../../core/ports";

/** 兜底 verifier：无可查链接时，把用户自报转成一条 Evidence。M2 实现。 */
export class ManualVerifier implements VerifierAdapter {
  readonly kind = "manual" as const;
  async fetchState(
    _commitment: { verification: VerificationSpec },
    _previous: Evidence | null,
  ): Promise<Evidence> {
    throw new Error("ManualVerifier.fetchState 未实现（M2）");
  }
}
