import type { Evidence, VerificationSpec } from "../../core/domain/types";
import type { VerifierAdapter } from "../../core/ports";

/** 认证 verifier：octokit + 只读 token，看私有仓库 / PR merged / CI。只读。M2 实现。 */
export class GithubVerifier implements VerifierAdapter {
  readonly kind = "github" as const;
  async fetchState(
    _commitment: { verification: VerificationSpec },
    _previous: Evidence | null,
  ): Promise<Evidence> {
    throw new Error("GithubVerifier.fetchState 未实现（M2）");
  }
}
