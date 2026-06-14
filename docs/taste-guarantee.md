# Taste guarantee — making 分寸 a mechanism, not a prompt

> The persona is the crux of this product. A great butler is interchangeable on *tasks* and
> irreplaceable on *judgment*. Judgment can't live in a prompt and a hope — it has to be
> **guaranteed**. This is the machinery that guarantees it.

## The goal

Every word the agent says in a group must be **in character**: terse, grounded, never servile,
never shaming, never faking progress it can't see. Today that's only prose in
`src/adapters/llm/prompts/persona.ts`. Prose is unguarded — a prompt tweak, a model swap, or a
bad sample can regress taste and nothing catches it.

This layer turns the persona's 分寸 into something **checkable** and wires it into a test loop, so
a regression fails a test instead of shipping to a user.

## The four pieces (rubric · golden · judge · eval)

```
src/core/taste/rubric.ts     the persona's 分寸, as checkable dimensions
src/core/taste/golden.ts     curated input→expected cases (the source of truth)
src/core/taste/judge.ts      floor (deterministic) + ceiling (LLM-as-judge) combiner
src/adapters/llm/tasteJudge.ts   the pi-backed LLM judge (lives in adapters; core stays pure)
eval/runEval.ts              run the real pipeline + judge over golden, print a scorecard
test/taste/*.test.ts         the deterministic floor — runs offline in `npm test`
```

### Floor vs ceiling — why two layers

A taste check is partly objective and partly subjective. We split it so the objective half runs
**everywhere, offline, deterministically** and the subjective half runs **on demand against a real
model**:

- **Floor — deterministic (`npm test`, no API key).** Length, sentence count, banned servile /
  shaming phrases, emoji spam, claiming completion with no evidence, piling up questions. These are
  `blocker`/`warn` rules in `rubric.ts`. A `blocker` violation = the message is out of character,
  full stop. This is the part that gates CI.
- **Ceiling — LLM-as-judge (`npm run eval`, needs a key).** Tone, groundedness, whether the wording
  actually fits the situation. Judged by a model with a strict, conservative rubric. Too subjective
  to gate CI on, but the thing you run before shipping a prompt or model change.

`fullTasteCheck()` in `judge.ts` runs the floor always and the ceiling when an `LlmTasteJudge` is
supplied; **any** `blocker` from either layer fails the whole check.

## The golden set

Two datasets, both in `src/core/taste/golden.ts`:

- `EXTRACTION_GOLDEN` — messages labelled commitment / not-commitment. This guards the
  capture boundary, the project's "宁可漏不可误" (better to miss than misfire) rule. Scored as
  precision/recall in the eval.
- `DECISION_GOLDEN` — situations fed to the deterministic guardrail `screenIntervention`, each with
  the expected outcome (`silent` / `celebrate` / `consult_llm`), plus a hand-written **golden
  message** for the cases that reach the LLM. The golden messages are dogfood: the test asserts our
  own model answers pass the rubric.

## How to run

```bash
npm test            # the floor — deterministic, offline, gates CI
npm run eval        # the ceiling — real LLM + LLM-judge over the golden set; needs an API key
```

`npm run eval` reads the same `LLM_*` env as the app (`loadConfig()`); with only
`ANTHROPIC_API_KEY` set it runs without any channel or database. It prints precision/recall for
extraction and a taste pass-rate for wording, and exits non-zero if either falls below the
thresholds at the top of `eval/runEval.ts`.

## How to extend

- Found a new way the agent talks out of character? Add a dimension to `rubric.ts` (deterministic if
  you can express it as a rule, judge-only if it needs taste) **and** a failing exemplar to
  `test/taste/rubric.test.ts` so the checker is proven to discriminate.
- A real misfire in the wild? Add it to the golden set as a case so it can never come back silently.

## Not yet wired into the live path (deliberate)

`scoreMessage()` is the obvious guard to call in `InterventionPolicy` before a message is sent —
reject or regenerate anything that fails the floor. That's a runtime behavior change and is left as
the next step, so this layer can land as a pure, test-covered guarantee first.
