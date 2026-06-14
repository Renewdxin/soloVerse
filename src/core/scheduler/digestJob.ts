import type { Person } from "../domain/types";
import type { Store } from "../ports";
import type { Job } from "./job";

/**
 * 个人 digest 作业：每 tick 看谁本地过了发送时间、今天还没发过 → 推 digest、记 lastDigestAt。
 * 「发不发由内容定」在 push 里（空的不发）；这里只管「到没到点、今天发没发」。
 * 不查 quiet hours——digest 时间是本人选的（默认 10:30），那个点本身就是体面的时间。
 */
export class DigestJob implements Job {
  readonly name = "digest";

  constructor(
    private readonly deps: {
      store: Store;
      push: (personId: string) => Promise<{ dispatchRef: string } | null>;
      defaultTimezone: string;
      defaultTime: string; // HH:MM
      onError: (error: unknown, context: string) => void;
    },
  ) {}

  async runDue(now: Date): Promise<void> {
    for (const person of await this.deps.store.people.all()) {
      try {
        if (!this.due(person, now)) continue;
        await this.deps.push(person.id);
        // 记下「今天这格处理过了」（发了 / 或空跳过都算），避免一天内反复检查。
        await this.deps.store.people.put({ ...person, lastDigestAt: now });
      } catch (error) {
        this.deps.onError(error, `digest ${person.id}`);
      }
    }
  }

  private due(person: Person, now: Date): boolean {
    const tz = person.digestPref?.timezone ?? this.deps.defaultTimezone;
    const target = parseHm(person.digestPref?.localTime ?? this.deps.defaultTime);
    if (target === null) return false; // 时间格式坏 → 宁可不发
    if (localMinutes(now, tz) < target) return false; // 今天还没到点
    const last = person.lastDigestAt;
    if (last != null && localYmd(last, tz) === localYmd(now, tz)) return false; // 今天发过了
    return true;
  }
}

/** "HH:MM" → 当天分钟数；非法返回 null。 */
function parseHm(raw: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (m === null) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function localMinutes(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function localYmd(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  const day = parts.find((p) => p.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}
