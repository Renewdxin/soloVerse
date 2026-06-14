import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/app/config";
import { buildContainer } from "../../src/app/container";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("buildContainer", () => {
  it("无凭据时用内存 store、不装频道、装好三个 verifier + 调度 + 群策略", () => {
    process.env = { ANTHROPIC_API_KEY: "test-key" };
    const c = buildContainer(loadConfig());

    expect(c.channels).toHaveLength(0);
    expect(c.verifiers.map((v) => v.kind).sort()).toEqual(["github", "link", "manual"]);
    expect(c.scheduler).toBeDefined();
    expect(c.groupPolicy.mode("anything")).toBe("off");
  });

  it("群策略按 GROUPS_READ_WRITE / GROUPS_READ_ONLY 圈定", () => {
    process.env = {
      ANTHROPIC_API_KEY: "test-key",
      GROUPS_READ_WRITE: "rw",
      GROUPS_READ_ONLY: "ro",
    };
    const c = buildContainer(loadConfig());

    expect(c.groupPolicy.canPost("rw")).toBe(true);
    expect(c.groupPolicy.canPost("ro")).toBe(false);
    expect(c.groupPolicy.canRead("ro")).toBe(true);
    expect(c.groupPolicy.canRead("other")).toBe(false);
  });
});
