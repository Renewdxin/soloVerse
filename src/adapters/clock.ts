import type { Clock } from "../core/ports";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
