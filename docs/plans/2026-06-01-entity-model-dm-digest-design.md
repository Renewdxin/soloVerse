# Entity model + DM digest · design decision

> Date: 2026-06-01 · Related: [../architecture.md](../architecture.md) (§7 transparency, §15.4 persona) · [../flows.md](../flows.md) (§6) · [../plan.md](../plan.md) (M4 ledger)
>
> This decision **changes a documented iron rule** ("always in the group, never DM"). It is the authoritative record; CLAUDE.md is updated to match, and `architecture.md` §7 / `flows.md` §6 are superseded on this point (sweep pending).

## Why this changed

The original design was group-only for transparency. In practice that forces an awkward choice: the butler knows something relevant to one person but either stays mute or speaks a watered-down version in the group — which builds information silos and makes the agent look dim. The fix is not isolation; it's **altitude + the right channel per audience.**

## Decisions

### 1. Person and group are the same kind of thing: goal-bearing entities

A group has goals; those goals get delegated to people; a person carries their own goals plus the slices delegated to them. So there is **one commitment spine** — the existing `Commitment { assignee (who), groupRef (which group context) }`. "Person view" and "group view" are just two **filtered projections** of the same rows. No new types required to start.

### 2. Push = one digest engine, two filters

- **Person digest → Feishu DM (email-like):** filter `assignee = person` across the groups they're in → their today's todo + review progress, pushed privately.
- **Group digest → group post:** filter `groupRef = group` → the group's rollup. If the group is read-only, skip the post; the person still gets their DM.

### 3. Altitude, not isolation

Same data, different granularity per audience:

- **Individual (DM):** full detail — what you owe today, which review notes are on your PR, where you're stuck. It's your own business, so give all of it.
- **Group (public):** ledger-level only — who's moving, overall progress. No per-person detail.

Information is never hidden (that's what looks dim / builds walls); it's routed at the right altitude.

### 4. Channels: Feishu only

Discord is dropped (its bot DM is best-effort: only works if the user shares a guild and hasn't disabled DMs → error 50007). Feishu carries the model cleanly:

- Same endpoint `POST /open-apis/im/v1/messages`; `receive_id_type = open_id` (we already capture `open_id` as `authorRef`) for DM, `chat_id` for group.
- Scope `im:message` covers both single-chat and group send/receive.
- **One gotcha:** the recipient must be within the bot's availability scope (可用范围) or the API returns `230013`. Configure in the developer console (dogfood: set to all members).
- DM digests can use `msg_type: post` / `interactive` (rich text / cards), not just plain text.

### 5. Group posting modes

`off` (don't read, don't store) / `read` (store context, never post in the group, but may DM the relevant people) / `readwrite` (full loop, may post in the group). Default for unlisted groups: `off`.

### 6. Person → groups mapping comes from our own store, not platform APIs

We already log `groupRef + authorRef` on every inbound (`router.ts` `recordInbound`). So "which groups is a person in" = `distinct groupRef where authorRef = person`. Platform-independent, needs no privileged member-list scopes, and means "the groups we've actually seen them in."

### 7. Code review surfacing

Consistent with the existing "review → GitHub thread, not in group" rule:

- Review **detail** → opened as a GitHub thread on the PR (canonical) + included in the responsible person's **DM digest** ("your PR #12 has 2 review notes").
- The **group** never carries review detail (that would be public nitpicking — violates "don't embarrass anyone"). At most a status line: "backend PR#12: reviewed, in progress."

### 8. The one red line

Everything else flows freely (no hard cross-group composition rules). The single hard constraint: **never repost one group's raw content publicly into another group.** DMs to the individual and aggregate rollups are fine; verbatim cross-group reposting is not.

## Iron-rule change

Old: *"Always in the group, never DM."*
New: **"Group = accountability (transparent, no private pressure); DM = the individual's own todo / review digest (full detail, no public embarrassment)."**

This actually resolves the old tension of "how to nudge without public pressure" — the answer is: nudge in DM.

## Port / code impact

- `ChannelAdapter` gains `sendDirect(userRef, message)` and a capability flag `canDirectMessage` (Feishu: true).
- `OutboundMessage` gains a target distinction (group vs person), or a parallel direct-message type.
- `Person.handles[].userRef` already holds the per-channel id / Feishu `open_id` — addressing is free.
- A `GroupPolicy` (injected param, not env-read in core) resolves `mode(groupRef)`.
- A digest assembler (deterministic) composes person/group digests from the commitment + evidence + interaction store.

## Deferred

Explicit **group-goal → person-commitment delegation hierarchy** (a group goal with child commitments). Start lightweight: `assignee + groupRef` + aggregation; add the parent/child layer only when there are group goals not yet assigned to anyone.

## Docs to reconcile

- [x] `CLAUDE.md` iron rule (updated with this decision)
- [x] `docs/architecture.md` §7 (principle rewritten: group = accountability, DM = personal digest)
- [x] `docs/flows.md` legend (no-DM line updated)
- [x] `docs/plan.md` (communication principle + "对谁说" updated)

## Code slices done

1. `GroupPolicy` (off/read/readwrite) + `ChannelAdapter.sendDirect` / `canDirectMessage` (Feishu p2p; Discord throws). Inbound gated on `canRead`, group posting on `canPost`, read-only groups ingest context but never post. Config: `GROUPS_READ_WRITE` / `GROUPS_READ_ONLY` (`ALLOWED_GROUP_REFS` = read-write alias).
2. `DigestAssembler` (`forPerson` / `forGroup`, deterministic, bucketed overdue/today/upcoming with evidence summary) + `renderDigestText` fallback + Feishu interactive-card rendering (card first, text on failure) + `container.pushPersonDigest` (skips empty).

**Next:** the digest scheduler (below).

## Digest scheduling (decided 2026-06-02)

**Principle — the schedule is a ceiling on noise, not a floor of messages.** A traditional bot's cron is a floor: it *will* ping daily. Ours is a ceiling: at most one digest/day per person; content + evidence + judgment decide whether anything actually goes out (empty digest → skip, already implemented in `pushPersonDigest`).

**Two clocks, one voice:**
- Event-driven `nextCheckAt` per commitment (built) = just-in-time verification / intervention.
- Daily digest = the calm rhythm / passive panel.
- **Unify them:** batch into the daily digest by default; interrupt out-of-band **only when waiting for the next digest would be too late** (working threshold: due before the next digest window AND `at_risk` / no progress). So a person's day ≈ one digest + rare urgent interrupts, otherwise silence. (This refines `decideIntervention` to lean silent when the digest can carry it — later.)

**Decisions:**
- Digest default time: **10:30 person-local**. Per-person configurable — the bot may ask the person their preferred time and remember it.
- Respect `quiet hours`; compute in the person's timezone.
- Persist `lastDigestAt` per person (restart-safe, same discipline as `nextCheckAt`); once/day guard.
- **Stage B (later):** learn each person's real engagement time and shift the default. North star, not now.

**Data-model impact:** `Person` gains a digest preference (local time, default `10:30`; timezone) and `lastDigestAt`. The "ask the person their time" is a small DM flow (later); the default works without it.

**Implemented (slice 3):** the `Scheduler` was rewritten into a **generic job runner** — `Job { name; runDue(now) }`, the loop ticks and isolates failure per job; adding a future periodic behavior (weekly report, cleanup) = add a `Job`, don't touch the scheduler. `CommitmentJob` (the old `dueCommitments`+`evaluate` loop, lifted out) and `DigestJob` are the two jobs. `DigestJob` fires when a person's local time has passed their digest time (`Person.digestPref.localTime` ?? `DIGEST_TIME` env, default `10:30`) and they haven't been served today (`lastDigestAt`), then records `lastDigestAt` — restart-safe, once/day. **Refinement:** the digest does NOT check quiet hours (the chosen time is itself the considerate slot; quiet hours governs reactive interrupts, not the digest). PG `people` gained `digest_pref` / `last_digest_at` columns (needs migration when PgStore goes live). **Still open:** the "interrupt only when it can't wait" refinement to `decideIntervention` (so most accountability rides the daily digest); the per-person "ask your preferred time" DM flow.
