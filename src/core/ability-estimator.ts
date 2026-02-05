import type { Profile, Question } from "./types.js";

const EWMA_ALPHA = 0.2;

export function updateAbility(
  profile: Profile,
  question: Question,
  correct: boolean,
  latencyMs: number,
): void {
  const skill = question.meta?.skill ?? inferSkill(question);
  const subskills = profile.ability.subskills;
  const current = subskills[skill] ?? { score: 0.5, samples: 0 };
  const latencyPenalty = latencyMs > 8000 ? 0.15 : latencyMs > 5000 ? 0.08 : 0;
  const outcome = correct ? 1 - latencyPenalty : 0;
  const updatedScore = ewma(current.score, outcome);
  subskills[skill] = { score: updatedScore, samples: current.samples + 1 };

  const subskillValues = Object.values(subskills);
  const avgScore =
    subskillValues.length > 0
      ? subskillValues.reduce((sum, s) => sum + s.score, 0) / subskillValues.length
      : 0.3;
  const totalSamples = subskillValues.reduce((sum, s) => sum + s.samples, 0);

  profile.ability.score = clamp01(avgScore);
  profile.ability.confidence = clamp01(totalSamples / 60);
  profile.ability.estimate = scoreToCefr(profile.ability.score);
  profile.ability.updatedAt = Date.now();
}

function inferSkill(question: Question): string {
  switch (question.type) {
    case "multiple_choice":
      return "sentence_comprehension";
    case "cloze":
      return "grammar_fill";
    case "type_answer":
      return "sentence_production";
    default:
      return "general";
  }
}

function ewma(prev: number, next: number): number {
  return EWMA_ALPHA * next + (1 - EWMA_ALPHA) * prev;
}

function scoreToCefr(score: number): Profile["ability"]["estimate"] {
  if (score < 0.15) return "A0";
  if (score < 0.35) return "A1";
  if (score < 0.55) return "A2";
  if (score < 0.75) return "B1";
  if (score < 0.85) return "B2";
  if (score < 0.93) return "C1";
  return "C2";
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
