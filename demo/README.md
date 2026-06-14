# Demo — the butler, in one terminal run

```bash
npm run demo
```

Zero setup: no API key, no Postgres, no Feishu/Discord. It plays a one-week timeline
of a work group through the **real** core pipeline and prints what the butler does — and,
just as important, when it chooses to stay quiet.

## What you'll see (7 scenes)

| # | Scene | The pillar it shows |
|---|-------|---------------------|
| 1 | Capture, not log | hears a commitment in normal chat, confirms once, ignores chatter & delegation |
| 2 | Earned silence | next-day sweep, on-track → says nothing (and shows *why*) |
| 3 | Verify, not ask | a GitHub PR merges → it closes the item itself, never asks "done yet?" |
| 4 | Speak only near due | 3h before due, no progress → one line, face-saving, offers to prep the material |
| 5 | Guardrails with teeth | same day again → silent (≤1/day); late night → silent (quiet hours) |
| 6 | Group = accountability, DM = the person | overdue personal item goes to a private DM, never named in the group |
| 7 | Taste is a mechanism | the same situation: a good line PASSes the taste floor, a shaming line FAILs |

## What's real vs. simulated

**Real (this is `src/core`, unchanged):** the capture pipeline (`Router` + `Extractor`),
the invisible guardrails (`screenIntervention`), the scheduler job (`CommitmentJob` over
`computeNextCheckAt` / `dueCommitments`), evidence-driven evaluation (`Evaluator`), and the
daily digest (`DigestAssembler`) — all wired as in the app. The **taste floor** (`rubric` /
`judge`) is also real code, but the demo runs it as an offline self-check; the app does not
yet gate outbound messages on it (see `docs/taste-guarantee.md`).

**Simulated (the edges only):**

- **The LLM.** A scripted `FakeLlm` stands in for the three narrow decisions the real pi LLM
  makes (is-it-a-commitment / wording / how-to-speak). It's deterministic, not "smart" — it
  only covers the demo's inputs.
- **The outside world.** Fake `link` / `github` verifiers report progress from an in-memory
  `World` instead of hitting the network. (The real github/manual verifiers are still stubs —
  see CLAUDE.md "Where things stand" — so a hermetic demo has to simulate them.)

## See the real model talk

If you have an LLM key **exported in your shell** (same `LLM_*` env the app reads, e.g.
`ANTHROPIC_API_KEY`; the demo does not auto-load `.env`):

```bash
ANTHROPIC_API_KEY=sk-... DEMO_LLM=real npm run demo
```

The three narrow decisions then run against the real model; the verifiers stay simulated.
(Without a key, `DEMO_LLM=real` fails fast with a one-line hint.)

## Layout

```
demo/run.ts       the scripted story (scenes + narration)
demo/harness.ts   FakeLlm, fake verifiers, DemoClock, and the real-brain wiring
demo/ui.ts        terminal formatting (set NO_COLOR=1 for plain text)
```
