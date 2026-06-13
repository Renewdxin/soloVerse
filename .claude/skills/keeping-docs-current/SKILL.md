---
name: keeping-docs-current
description: Use after changing code (new adapter/verifier/tool, new config/env var, finished milestone) or when docs look stale, to keep docs in sync without letting them rot. Defines where the single source of truth lives and which files drift.
---

# Keeping docs current

Docs rot because **volatile facts get copied into places that don't auto-update**. The fix is not diligence — it's structure: keep the signpost stable, let mechanical drift be caught by a test, and write each status fact in exactly one place.

## Principles

1. **`CLAUDE.md` is a signpost, not a junk drawer.** Only stable things belong: what it is, iron rules, architecture-in-one-line, layout, how to extend, onboarding. **No volatile detail** — no per-component status, no test counts, no per-stub lists. Those go stale and make the file lie.
2. **One source of truth per fact.** Never restate the same status in two files; point to where it lives.

## Where the truth lives (don't duplicate it)

- **Milestone progress** → `docs/plan.md` checkboxes (roadmap intent; may lead/lag code — it says so itself).
- **Unfinished work** → grep `未实现` in the code. The markers are the to-do list.
- **Test / type / lint health** → run `npm test` · `npm run typecheck` · `npm run check`. **Never hardcode a test count in prose.**
- **What changed** → `git log`.
- **Design** → `docs/architecture.md` / `docs/flows.md` (timeless; no status claims).

## Files that drift — check these when you finish something

- [ ] `CLAUDE.md` "Where things stand": still coarse and true? Did you sneak in detail that belongs in `plan.md` or the code?
- [ ] `docs/plan.md`: did this change tick a milestone box, or move the "next high-value piece"?
- [ ] `.env.example`: new env knob in `src/app/config.ts`? **Guarded by `test/app/envExample.test.ts`** — add an env var without documenting it and that test goes red. Trust the test; don't re-check by hand.
- [ ] New reusable pattern → write a skill under `.claude/skills/` (see `writing-skills`).

## How this actually gets triggered

A skill **cannot wake itself** when you edit code — it only fires when you invoke it, or when the harness auto-matches its `description` to your task. So the reliable triggers are:

- **Mechanical drift → a test.** The `envExample` test is the model: turn "remember to update X" into "CI fails if X is stale." Prefer this whenever drift is mechanical.
- **Judgment drift → the review pass.** `reviewing-skills` points here, so any change review is a checkpoint for this checklist.
- **You, on purpose.** Run `/keeping-docs-current` after finishing a feature.

If you find yourself writing a fact into a doc that the next code change will falsify, stop: either point at the source instead, or add a test that guards it.
