import type { SrsState } from "./types.js";

const MIN_EASE = 1.3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function initSrsState(now: number): SrsState {
  return {
    dueAt: now,
    intervalDays: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
  };
}

export function updateSm2(state: SrsState, quality: number, now: number): SrsState {
  let ease = state.ease ?? 2.5;
  let reps = state.reps ?? 0;
  let interval = state.intervalDays ?? 0;

  if (quality < 3) {
    reps = 0;
    interval = 1;
    ease = Math.max(MIN_EASE, ease - 0.2);
    return {
      ...state,
      reps,
      intervalDays: interval,
      ease,
      lapses: (state.lapses ?? 0) + 1,
      lastReviewedAt: now,
      lastQuality: quality,
      dueAt: now + interval * DAY_MS,
    };
  }

  reps += 1;
  if (reps === 1) interval = 1;
  else if (reps === 2) interval = 6;
  else interval = Math.round(interval * ease);

  ease = Math.max(MIN_EASE, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

  return {
    ...state,
    reps,
    intervalDays: interval,
    ease,
    lastReviewedAt: now,
    lastQuality: quality,
    dueAt: now + interval * DAY_MS,
  };
}

export function isDue(state: SrsState, now: number): boolean {
  return state.dueAt <= now;
}
