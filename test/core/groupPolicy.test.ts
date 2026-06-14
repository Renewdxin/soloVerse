import { describe, expect, it } from "vitest";
import { GroupPolicy } from "../../src/core/groupPolicy";

describe("GroupPolicy", () => {
  const policy = new GroupPolicy({ readWrite: ["rw"], readOnly: ["ro"] });

  it("readwrite 群：可读、可发言", () => {
    expect(policy.mode("rw")).toBe("readwrite");
    expect(policy.canRead("rw")).toBe(true);
    expect(policy.canPost("rw")).toBe(true);
  });

  it("read 群：可读、不可发言", () => {
    expect(policy.mode("ro")).toBe("read");
    expect(policy.canRead("ro")).toBe(true);
    expect(policy.canPost("ro")).toBe(false);
  });

  it("未列出的群默认 off：不读不发", () => {
    expect(policy.mode("x")).toBe("off");
    expect(policy.canRead("x")).toBe(false);
    expect(policy.canPost("x")).toBe(false);
  });

  it("同时在两个名单里时 readWrite 优先", () => {
    const both = new GroupPolicy({ readWrite: ["g"], readOnly: ["g"] });
    expect(both.mode("g")).toBe("readwrite");
  });

  it("setMode 运行时改权限（加群只读 → 提权可发言）", () => {
    const p = new GroupPolicy();
    expect(p.mode("oc_new")).toBe("off");
    p.setMode("oc_new", "read");
    expect(p.canRead("oc_new")).toBe(true);
    expect(p.canPost("oc_new")).toBe(false);
    p.setMode("oc_new", "readwrite");
    expect(p.canPost("oc_new")).toBe(true);
  });

  it("load 从 DB 载入并覆盖 env 种子（DB 是运行时真相）", () => {
    const p = new GroupPolicy({ readWrite: ["g"], readOnly: [] });
    expect(p.mode("g")).toBe("readwrite");
    p.load([{ id: "g", mode: "off" }]); // operator 之前把它忽略了
    expect(p.mode("g")).toBe("off");
  });
});
