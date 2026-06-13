# CLAUDE.md — Commitment Agent

A signpost for anyone (and Claude) working in this repo. Full design lives in `docs/`.

> Keep this file a **signpost**: stable pointers only. No volatile status (per-component progress, test counts, stub lists) — that rots and makes the file lie. How to keep docs in sync → `.claude/skills/keeping-docs-current`.

## What this is

A **butler** that lives in the team's **work chat** (Feishu + Discord). Done well, it's the team's hub — everything passes through its hands, nothing slips. Its edge is the mix only AI can give:

- **Broad**: knows a bit of everything (80% is enough; hands deep-expert questions to real experts);
- **Tasteful**: not just knowing, but **judgment** — what's appropriate, what's done with care;
- **Anticipatory**: has the relevant material / a first draft ready before you ask;
- **Discreet**: low-key, loyal — never embarrasses anyone in the group; what should stay private stays private.

What it does: capture commitments → bind evidence (link/GitHub) to track progress → a gentle nudge at the right time + **the thing you'll need, prepared in advance** → help out (search, answer, **tasteful code review**: real bugs first (the floor), then judge whether it's done with care — read-only, raised as a GitHub thread). The daily todo / weekly progress is the ledger it keeps.

## Iron rules (read before changing)

- **Invisible by default**: silent when on-track; nudge at most once a day; **play dead, never call people out**. Better to miss than to misfire.
- **Group = accountability, DM = the individual**: shared/accountability items stay transparent in the group (no private pressure); a person's own todo / review digest goes to them via Feishu DM (full detail, no public embarrassment). Never repost one group's raw content into another. (See `docs/plans/2026-06-01-entity-model-dm-digest-design.md`.)
- **Never writes code**: may read code, write comments / open issues (threads); **never writes code, never opens code PRs**.
- **Narrow decisions, controlled actions**: is-it-a-commitment / is-it-done / how-to-speak = three schema-constrained single LLM calls; open-ended actions (search / fetch / review) go through pi's tool loop, with a `block` hook keeping it read-only.
- **DB is memory**: commitment/evidence/profile land in our own Postgres+pgvector (Drizzle); pi's compaction only covers a single run.

## Architecture in one line

`pi` is the engine (`pi-ai` = LLM/cache/typebox; `pi-agent-core` = tool loop / guardrails / compaction; pi's read-only tools = review engine); **we are the brain** (commitments / evidence / accountability / long-term memory / channels / scheduling). Hexagonal ports in `src/core/ports`; pi hides behind `LlmPort` / `ToolRunner`.

## Layout

```
src/core/domain    domain types (the contracts)
src/core/ports     port interfaces (all core depends on)
src/core/pipeline  Router · Extractor · Evaluator (capture/eval pipeline)
src/core/scheduler proactive loop (polls due commitments)
src/adapters       implementations: channels (feishu/discord) · verifiers (link/github/manual) · llm (pi) · store (pg + memory)
src/app            config · main · wiring
docs/              architecture · plan · flows
.claude/skills/    project skills (how to extend this project; incl. how to write/review a skill)
```

## Dev

```bash
npm install
cp .env.example .env   # fill in keys
npm run typecheck      # tsc
npm run check          # Biome lint + format
npm run dev            # tsx watch (development)
npm start              # run directly
npm test               # vitest
```

> Needs Node ≥22. Lint/format via Biome (see `biome.json`); no eslint/prettier.

## How to extend

Adding a channel / verifier / tool? **Read the matching skill first** (`.claude/skills/`), follow its checklist, self-check against `reviewing-skills`. Found a reusable pattern worth keeping? **Write a skill too** — see `writing-skills`.

## Onboarding (fill `.env` and go)

- **Discord**: Developer Portal → create bot → enable **MESSAGE CONTENT INTENT** → invite to the group → put the token in `DISCORD_BOT_TOKEN`.
- **Feishu**: Open Platform → create a custom app → enable the "bot" capability + subscribe to `im.message.receive_v1` (**long connection**, no public callback needed) → `FEISHU_APP_ID` / `FEISHU_APP_SECRET`.
- Fill `.env` (see `.env.example`), then `npm run dev`. It starts fine with a channel unconfigured — it just won't listen there.

## Where things stand

Coarse: **M0/M1 done · M2 link path in place (github/manual verifier pending) · M3 proactive loop coded**.

Detail isn't tracked here (it rots). Single source of truth:

- milestone checkboxes → `docs/plan.md`
- unfinished work → grep `未实现` in the code
- type / test / lint → `npm run typecheck` · `npm test` · `npm run check`
- what changed → `git log`
