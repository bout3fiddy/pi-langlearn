import type { GradeResult, Question } from "./types.js";

const FAST_MS = 5000;

export function gradeAnswer(
  question: Question,
  userAnswerRaw: string,
  latencyMs: number,
): GradeResult {
  const userAnswer = userAnswerRaw.trim();
  if (question.type === "de_het") {
    const normalized = normalizeText(userAnswer);
    const correct = normalized === question.correct;
    return {
      correct,
      quality: scoreQuality(correct, latencyMs, correct ? "exact" : "wrong"),
      explanation: correct ? "Correct." : `Correct answer: ${question.correct}`,
      expectedAnswer: question.correct,
      normalizedUserAnswer: normalized,
    };
  }

  if (question.type === "reorder") {
    const normalizedUser = normalizeText(userAnswer);
    const expected = normalizeText(question.correctSentence);
    if (normalizedUser === expected) {
      return {
        correct: true,
        quality: scoreQuality(true, latencyMs, "exact"),
        explanation: "Correct.",
        expectedAnswer: question.correctSentence,
        normalizedUserAnswer: normalizedUser,
      };
    }
    const distance = levenshteinDistance(normalizedUser, expected);
    if (distance <= 2 && normalizedUser.length >= 3) {
      return {
        correct: true,
        quality: scoreQuality(true, latencyMs, "minor"),
        explanation: `Minor typo accepted. Correct: ${question.correctSentence}`,
        expectedAnswer: question.correctSentence,
        normalizedUserAnswer: normalizedUser,
      };
    }
    return {
      correct: false,
      quality: 1,
      explanation: `Incorrect. Correct: ${question.correctSentence}`,
      expectedAnswer: question.correctSentence,
      normalizedUserAnswer: normalizedUser,
    };
  }

  if (question.type === "multiple_choice") {
    const expected = question.options[question.correctIndex] ?? "";
    const selectedIndex = parseChoiceIndex(userAnswer, question.options.length);
    if (selectedIndex === null) {
      return {
        correct: false,
        quality: 1,
        explanation: "Enter A-D or 1-4, then press Enter.",
        expectedAnswer: expected,
        normalizedUserAnswer: normalizeText(userAnswer),
      };
    }
    const correct = selectedIndex === question.correctIndex;
    return {
      correct,
      quality: scoreQuality(correct, latencyMs, correct ? "exact" : "wrong"),
      explanation: correct ? "Correct." : `Correct answer: ${expected}`,
      expectedAnswer: expected,
      normalizedUserAnswer: normalizeText(userAnswer),
    };
  }

  const expectedAnswers = Array.isArray(question.answer) ? question.answer : [question.answer];
  const normalizedUser = normalizeText(userAnswer);
  let bestDistance = Number.POSITIVE_INFINITY;
  let matchedAnswer: string | null = null;

  for (const ans of expectedAnswers) {
    const normalized = normalizeText(ans);
    if (normalizedUser === normalized) {
      matchedAnswer = ans;
      bestDistance = 0;
      break;
    }
    const distance = levenshteinDistance(normalizedUser, normalized);
    if (distance < bestDistance) {
      bestDistance = distance;
      matchedAnswer = ans;
    }
  }

  const expected = matchedAnswer ?? expectedAnswers[0] ?? "";
  const closeEnough = bestDistance <= 2 && normalizedUser.length >= 3;
  const minorTypo = bestDistance <= 1 && normalizedUser.length >= 3;

  if (bestDistance === 0) {
    return {
      correct: true,
      quality: scoreQuality(true, latencyMs, "exact"),
      explanation: "Correct.",
      expectedAnswer: expected,
      normalizedUserAnswer: normalizedUser,
    };
  }
  if (minorTypo) {
    return {
      correct: true,
      quality: scoreQuality(true, latencyMs, "minor"),
      explanation: `Minor typo accepted. Correct: ${expected}`,
      expectedAnswer: expected,
      normalizedUserAnswer: normalizedUser,
    };
  }
  if (closeEnough) {
    return {
      correct: false,
      quality: 2,
      explanation: `Close. Correct: ${expected}`,
      expectedAnswer: expected,
      normalizedUserAnswer: normalizedUser,
    };
  }

  return {
    correct: false,
    quality: 1,
    explanation: `Incorrect. Correct: ${expected}`,
    expectedAnswer: expected,
    normalizedUserAnswer: normalizedUser,
  };
}

function scoreQuality(
  correct: boolean,
  latencyMs: number,
  accuracy: "exact" | "minor" | "wrong",
): number {
  if (!correct) return 1;
  const fast = latencyMs <= FAST_MS;
  if (accuracy === "exact" && fast) return 5;
  return 4;
}

function parseChoiceIndex(input: string, optionCount: number): number | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  const letter = trimmed.match(/^[a-z]$/) ? trimmed : null;
  if (letter) {
    const index = letter.charCodeAt(0) - "a".charCodeAt(0);
    return index >= 0 && index < optionCount ? index : null;
  }
  const number = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(number)) {
    const index = number - 1;
    return index >= 0 && index < optionCount ? index : null;
  }
  return null;
}

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const prev = Array.from({ length: bLen + 1 }, (_, j) => j);
  const curr = Array.from({ length: bLen + 1 }, () => 0);

  for (let i = 1; i <= aLen; i += 1) {
    curr[0] = i;
    const aChar = a.charCodeAt(i - 1);
    for (let j = 1; j <= bLen; j += 1) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= bLen; j += 1) prev[j] = curr[j] ?? 0;
  }

  return prev[bLen] ?? aLen;
}
