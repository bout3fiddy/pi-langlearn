import type { Card, EngineStatus, GradeResult, Question } from "./types.js";
import type { ProfileStore } from "./state-store.js";
import { generateQuestion } from "./question-generator.js";
import { gradeAnswer, normalizeText } from "./grader.js";
import { initSrsState, isDue, updateSm2 } from "./scheduler.js";
import { updateAbility } from "./ability-estimator.js";
import { TutorSession } from "./tutor-session.js";

const RECENT_LIMIT = 5;

export class LearningEngine {
	private recentCardIds: string[] = [];
	private newCardsDayKey: string | null = null;
	private newCardsToday = 0;
	private deck: Card[];
	private deckById: Map<string, Card>;
	private tutor: TutorSession | null = null;

	constructor(
		private store: ProfileStore,
		deck: Card[] = [],
		private onChange?: () => void,
	) {
		this.deck = deck;
		this.deckById = buildDeckIndex(deck);
	}

	setDeck(deck: Card[]): void {
		this.deck = deck;
		this.deckById = buildDeckIndex(deck);
		this.emitChange();
	}

	getStatus(): EngineStatus {
		const now = Date.now();
		const profile = this.store.profile;
		const dueCount = Object.entries(profile.deck.srs)
			.filter(([id, state]) => !profile.deck.suspendedCardIds?.includes(id) && isDue(state, now))
			.length;
		const newCount = this.deck.filter((card) => !profile.deck.knownCardIds.includes(card.id)).length;
		return {
			lang: profile.lang,
			ability: profile.ability,
			dueCount,
			newCount,
			streakDays: profile.stats.streakDays,
			enabled: profile.enabled,
		};
	}

	nextQuestion(): Question {
		const card = this.pickCard();
		return generateQuestion(card, this.store.profile, this.deck);
	}

	async submitAnswer(question: Question, userAnswer: string, latencyMs: number, hintUsed: boolean): Promise<GradeResult> {
		const now = Date.now();
		const tutorGrade = await this.maybeGradeWithTutor(question, userAnswer);
		const grade = tutorGrade ?? gradeAnswer(question, userAnswer, latencyMs);
		const adjustedGrade = { ...grade };
		if (hintUsed && adjustedGrade.quality > 3) {
			adjustedGrade.quality = 3;
			adjustedGrade.explanation = `${adjustedGrade.explanation} (Hint used)`;
		}

		const learningNote = buildLearningNote(question);
		if (!adjustedGrade.correct && learningNote) {
			adjustedGrade.explanation = `${adjustedGrade.explanation} ${learningNote}`;
		}

		this.updateSrs(question.cardId, adjustedGrade.quality, now);
		updateAbility(this.store.profile, question, adjustedGrade.correct, latencyMs);
		this.updateStats(adjustedGrade.correct, latencyMs, now);
		this.logAttempt(question, userAnswer, adjustedGrade, latencyMs, now);
		this.store.saveSoon();
		this.emitChange();
		return adjustedGrade;
	}

	getHint(question: Question): string {
		switch (question.type) {
			case "multiple_choice":
				return buildMultipleChoiceHint(question);
			case "de_het":
				return buildArticleHint(question);
			case "reorder":
				return buildReorderHint(question);
			case "cloze":
			case "type_answer":
				return buildTextAnswerHint(question);
			default:
				return "";
		}
	}

	private pickCard(): Card {
		const profile = this.store.profile;
		const now = Date.now();
		const dueIds = Object.entries(profile.deck.srs)
			.filter(([id, state]) => !profile.deck.suspendedCardIds?.includes(id) && isDue(state, now))
			.sort((a, b) => a[1].dueAt - b[1].dueAt)
			.map(([id]) => id);

		const dueCandidate = dueIds.find((id) => !this.recentCardIds.includes(id)) ?? dueIds[0];
		const dueCard = dueCandidate ? this.getCardById(dueCandidate) : null;
		if (dueCard) {
			this.trackRecent(dueCard.id);
			return dueCard;
		}

		if (this.shouldAddNewCard()) {
			const newCard = this.pickNewCard();
			if (newCard) {
				this.addNewCard(newCard.id, now);
				this.trackRecent(newCard.id);
				return newCard;
			}
		}

		const fallback = this.pickKnownCard();
		if (fallback) {
			this.trackRecent(fallback.id);
			return fallback;
		}

		const first = this.deck[0];
		if (!first) {
			throw new Error("No cards available for language learning.");
		}
		if (!profile.deck.knownCardIds.includes(first.id)) {
			this.addNewCard(first.id, now);
		}
		this.trackRecent(first.id);
		return first;
	}

	private shouldAddNewCard(): boolean {
		const profile = this.store.profile;
		return this.deck.some((card) => !profile.deck.knownCardIds.includes(card.id));
	}

	private pickNewCard(): Card | null {
		const profile = this.store.profile;
		const unseen = this.deck.filter((card) => !profile.deck.knownCardIds.includes(card.id));
		if (unseen.length === 0) return null;
		return unseen[Math.floor(Math.random() * unseen.length)] ?? null;
	}

	private pickKnownCard(): Card | null {
		const profile = this.store.profile;
		const candidates = profile.deck.knownCardIds
			.filter((id) => !profile.deck.suspendedCardIds?.includes(id))
			.map((id) => this.getCardById(id))
			.filter((card): card is Card => Boolean(card));
		if (candidates.length === 0) return null;
		const filtered = candidates.filter((card) => !this.recentCardIds.includes(card.id));
		const pool = filtered.length > 0 ? filtered : candidates;
		return pool[Math.floor(Math.random() * pool.length)] ?? null;
	}

	private addNewCard(cardId: string, now: number): void {
		const profile = this.store.profile;
		if (!profile.deck.knownCardIds.includes(cardId)) {
			profile.deck.knownCardIds.push(cardId);
		}
		if (!profile.deck.srs[cardId]) {
			profile.deck.srs[cardId] = initSrsState(now);
		}
		this.newCardsToday += 1;
		this.store.saveSoon();
		this.emitChange();
	}

	private updateSrs(cardId: string, quality: number, now: number): void {
		const profile = this.store.profile;
		const state = profile.deck.srs[cardId] ?? initSrsState(now);
		profile.deck.srs[cardId] = updateSm2(state, quality, now);
	}

	private updateStats(correct: boolean, latencyMs: number, now: number): void {
		const stats = this.store.profile.stats;
		const prevLastActiveAt = stats.lastActiveAt;
		stats.totalAttempts += 1;
		if (correct) stats.correctAttempts += 1;
		stats.lastActiveAt = now;
		stats.avgLatencyMs7d = updateLatency(stats.avgLatencyMs7d, latencyMs);
		stats.streakDays = updateStreak(stats.streakDays, prevLastActiveAt, now);
	}

	private logAttempt(question: Question, userAnswer: string, grade: GradeResult, latencyMs: number, now: number): void {
		const tags = question.meta?.tags ?? [];
		this.store.appendAttempt({
			ts: now,
			lang: this.store.profile.lang,
			cardId: question.cardId,
			qType: question.type,
			prompt: question.prompt,
			userAnswer,
			correct: grade.correct,
			latencyMs,
			quality: grade.quality,
			tags,
		});
	}

	private trackRecent(cardId: string): void {
		this.recentCardIds = [cardId, ...this.recentCardIds.filter((id) => id !== cardId)].slice(0, RECENT_LIMIT);
	}

	private getCardById(id: string): Card | null {
		return this.deckById.get(id) ?? null;
	}

	private getTodayKey(): string {
		const date = new Date();
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	}

	private emitChange(): void {
		this.onChange?.();
	}

	private async maybeGradeWithTutor(
		question: Question,
		userAnswer: string,
	): Promise<GradeResult | null> {
		if (!this.tutor) this.tutor = new TutorSession();
		const result = await this.tutor.grade(question, userAnswer);
		if (!result) return null;
		if (typeof result.quality !== "number") return null;
		return result;
	}
}

function buildDeckIndex(deck: Card[]): Map<string, Card> {
	const index = new Map<string, Card>();
	for (const card of deck) {
		index.set(card.id, card);
	}
	return index;
}

function updateLatency(prev: number | undefined, next: number): number {
	if (!prev) return next;
	return prev * 0.8 + next * 0.2;
}

function updateStreak(current: number, lastActiveAt: number, now: number): number {
	if (!lastActiveAt) return 1;
	const lastDate = new Date(lastActiveAt);
	const nowDate = new Date(now);
	const lastKey = `${lastDate.getFullYear()}-${lastDate.getMonth()}-${lastDate.getDate()}`;
	const nowKey = `${nowDate.getFullYear()}-${nowDate.getMonth()}-${nowDate.getDate()}`;
	if (lastKey === nowKey) return Math.max(1, current);
	const diffDays = Math.floor((nowDate.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
	if (diffDays === 1) return current + 1;
	return 1;
}

type TextAnswerQuestion = Extract<Question, { type: "type_answer" | "cloze" }>;
type MultipleChoiceQuestion = Extract<Question, { type: "multiple_choice" }>;
type ReorderQuestion = Extract<Question, { type: "reorder" }>;
type ArticleQuestion = Extract<Question, { type: "de_het" }>;

type WordInfo = {
	word: string;
	core: string;
	startsWith: string;
	length: number;
	capitalized: boolean;
};

function buildMultipleChoiceHint(question: MultipleChoiceQuestion): string {
	const answer = question.options[question.correctIndex] ?? "";
	if (!answer) return "Pick A-D or 1-4.";
	const hint = formatAnswerHint(answer, { includePattern: true });
	return hint || "Pick A-D or 1-4.";
}

function buildArticleHint(question: ArticleQuestion): string {
	const noun = question.noun.trim();
	const clean = noun.toLowerCase().replace(/[^a-z]/g, "");
	const diminutive = /(tje|pje|kje|etje|je)$/.test(clean);
	const parts: string[] = [];
	if (diminutive) {
		parts.push("Diminutive (-je/-tje) usually takes 'het'.");
	} else {
		parts.push("Most nouns take 'de'—use 'de' if unsure.");
	}
	const translation = question.meta?.sourceTranslation;
	if (translation) parts.push(`Meaning: ${translation}.`);
	return parts.join(" ");
}

function buildReorderHint(question: ReorderQuestion): string {
	const words = question.correctSentence.split(" ").filter(Boolean);
	const parts: string[] = [];
	if (words.length > 0) parts.push(`${words.length} words`);
	const first = words[0] ?? "";
	const last = words[words.length - 1] ?? "";
	if (first) parts.push(`Starts with "${first}"`);
	if (last && last !== first) parts.push(`Ends with "${last}"`);
	const translation = question.meta?.sourceTranslation;
	if (translation) parts.push(`Meaning: ${translation}`);
	return parts.join(". ");
}

function buildTextAnswerHint(question: TextAnswerQuestion): string {
	const answer = getPrimaryAnswer(question);
	if (!answer) return "";
	const parts: string[] = [];
	const words = answer.split(" ").filter(Boolean);
	if (words.length <= 1) {
		const info = describeWord(answer);
		if (info.startsWith) parts.push(`Starts with "${info.startsWith}"`);
		if (info.length > 0) parts.push(`${info.length} letters`);
		if (info.capitalized) parts.push("Capitalized");
		const masked = maskToken(answer);
		if (masked && masked !== answer) parts.push(`Pattern: ${masked}`);
	} else {
		parts.push(`${words.length} words`);
		const first = words[0] ?? "";
		const last = words[words.length - 1] ?? "";
		if (first) parts.push(`Starts with "${first}"`);
		if (last && last !== first) parts.push(`Ends with "${last}"`);
		const pattern = maskSentence(answer);
		if (pattern && pattern !== answer) parts.push(`Pattern: ${pattern}`);
	}

	const translation = shouldIncludeTranslationHint(question);
	if (translation) parts.push(`Meaning: ${translation}`);
	return parts.join(". ");
}

function buildLearningNote(question: Question): string | null {
	const parts: string[] = [];
	const sourcePrompt = question.meta?.sourcePrompt;
	const sourceTranslation = question.meta?.sourceTranslation;

	switch (question.type) {
		case "de_het":
			parts.push(formatLearningPart("Article", `${question.correct} ${question.noun}`));
			if (sourceTranslation) parts.push(formatLearningPart("Meaning", sourceTranslation));
			break;
		case "reorder":
			parts.push(formatLearningPart("Sentence", question.correctSentence));
			if (sourceTranslation) parts.push(formatLearningPart("Meaning", sourceTranslation));
			break;
		case "multiple_choice":
			if (sourcePrompt) parts.push(formatLearningPart("Sentence", sourcePrompt));
			if (sourceTranslation) parts.push(formatLearningPart("Meaning", sourceTranslation));
			break;
		case "cloze":
		case "type_answer": {
			if (sourcePrompt) {
				parts.push(formatLearningPart("Sentence", sourcePrompt));
			} else {
				const answer = getPrimaryAnswer(question);
				if (answer) parts.push(formatLearningPart("Answer", answer));
			}
			if (sourceTranslation) parts.push(formatLearningPart("Meaning", sourceTranslation));
			break;
		}
		default:
			break;
	}

	const filtered = parts.filter(Boolean);
	if (filtered.length === 0) return null;
	return `Learn: ${filtered.join(" ")}`;
}

function shouldIncludeTranslationHint(question: Question): string | null {
	const translation = question.meta?.sourceTranslation;
	if (!translation) return null;
	if (question.type === "multiple_choice") return null;
	if ("prompt" in question && typeof question.prompt === "string" && question.prompt.includes(translation)) return null;
	if (question.type === "type_answer" || question.type === "cloze") {
		const answers = Array.isArray(question.answer) ? question.answer : [question.answer];
		if (answers.some((answer) => normalizeText(answer) === normalizeText(translation))) return null;
	}
	return translation;
}

function getPrimaryAnswer(question: TextAnswerQuestion): string {
	const answers = Array.isArray(question.answer) ? question.answer : [question.answer];
	return answers[0] ?? "";
}

function describeWord(word: string): WordInfo {
	const match = word.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/);
	const core = match ? match[0] : word;
	const startsWith = core.slice(0, Math.min(2, core.length));
	const length = core.length;
	const capitalized = Boolean(core[0] && core[0] === core[0]?.toUpperCase());
	return { word, core, startsWith, length, capitalized };
}

function maskSentence(text: string): string {
	return text
		.split(" ")
		.map((token) => maskToken(token))
		.join(" ");
}

function maskToken(token: string): string {
	const match = token.match(/^(["'\(\[]?)([A-Za-zÀ-ÖØ-öø-ÿ]+)([^A-Za-zÀ-ÖØ-öø-ÿ]*)$/);
	if (!match) return token;
	const prefix = match[1] ?? "";
	const word = match[2] ?? "";
	const suffix = match[3] ?? "";
	if (word.length <= 1) return token;
	return `${prefix}${word[0]}${"_".repeat(Math.max(0, word.length - 1))}${suffix}`;
}

function formatAnswerHint(answer: string, options: { includePattern?: boolean } = {}): string {
	const words = answer.split(" ").filter(Boolean);
	const parts: string[] = [];
	if (words.length <= 1) {
		const info = describeWord(answer);
		if (info.startsWith) parts.push(`Starts with "${info.startsWith}"`);
		if (info.length > 0) parts.push(`${info.length} letters`);
		if (info.capitalized) parts.push("Capitalized");
		if (options.includePattern) {
			const masked = maskToken(answer);
			if (masked && masked !== answer) parts.push(`Pattern: ${masked}`);
		}
	} else {
		parts.push(`${words.length} words`);
		const first = words[0] ?? "";
		const last = words[words.length - 1] ?? "";
		if (first) parts.push(`Starts with "${first}"`);
		if (last && last !== first) parts.push(`Ends with "${last}"`);
		if (options.includePattern) {
			const pattern = maskSentence(answer);
			if (pattern && pattern !== answer) parts.push(`Pattern: ${pattern}`);
		}
	}
	return parts.join(". ");
}

function formatLearningPart(label: string, value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "";
	const ending = /[.!?]$/.test(trimmed) ? "" : ".";
	return `${label}: ${trimmed}${ending}`;
}
