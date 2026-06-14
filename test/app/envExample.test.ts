import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// UPPER_SNAKE string literals in config.ts are almost all env var names.
// These are used as log/error prefixes, not env vars — exclude them.
const NOT_ENV = new Set(["TOOL_RUNNER"]);

/** Env var names read by config.ts (UPPER_SNAKE literals containing an underscore). */
function envNamesReadByConfig(): string[] {
  const src = readFileSync(resolve(root, "src/app/config.ts"), "utf8");
  const names = new Set<string>();
  for (const match of src.matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)) {
    const name = match[1];
    if (name !== undefined && !NOT_ENV.has(name)) names.add(name);
  }
  return [...names].sort();
}

// Mechanical guard against doc drift: if a new env knob is added to config.ts
// but not documented in .env.example, this test goes red.
// See .claude/skills/keeping-docs-current.
describe(".env.example stays in sync with config.ts", () => {
  it("documents every env var that config.ts reads", () => {
    const example = readFileSync(resolve(root, ".env.example"), "utf8");
    const missing = envNamesReadByConfig().filter((name) => !example.includes(name));
    expect(
      missing,
      `read by config.ts but missing from .env.example: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
