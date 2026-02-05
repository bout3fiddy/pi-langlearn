import type { Card, Profile, Question, QuestionMeta } from "./types.js";
import { getLanguageLabel } from "../languages/index.js";

export function generateQuestion(card: Card, profile: Profile, deck: Card[]): Question {
	const targetLanguage = getLanguageLabel(profile.lang);
	const nativeLanguage = "English";
	const abilityScore = profile.ability.score ?? 0.2;
	const preferProduction = abilityScore >= 0.45;
	const allowCloze = card.type === "sentence" && card.prompt.split(" ").length >= 3;
	const allowReorder = card.type === "sentence" && card.prompt.split(" ").length <= 8;
	const article = card.type === "vocab" ? getArticle(card) : null;

	if (article && Math.random() < 0.45) {
		return {
			type: "de_het",
			cardId: card.id,
			noun: card.prompt,
			correct: article,
			meta: buildMeta(card, "articles"),
		};
	}

	if (allowReorder && Math.random() < (preferProduction ? 0.35 : 0.15)) {
		const reorder = makeReorder(card);
		if (reorder) return reorder;
	}

	if (allowCloze && Math.random() < (preferProduction ? 0.5 : 0.2)) {
		const cloze = makeCloze(card);
		if (cloze) return cloze;
	}

	if (preferProduction && card.translation) {
		return {
			type: "type_answer",
			cardId: card.id,
			prompt: `Translate to ${targetLanguage}: "${card.translation}"`,
			answer: card.prompt,
			meta: buildMeta(card, "sentence_production"),
		};
	}

	if (card.translation) {
		const multi = makeMultipleChoice(card, deck);
		if (multi) return multi;
	}

	return {
		type: "type_answer",
		cardId: card.id,
		prompt: `Translate to ${nativeLanguage}: "${card.prompt}"`,
		answer: card.translation ?? card.answer,
		meta: buildMeta(card, "sentence_comprehension"),
	};
}

function buildMeta(card: Card, skill: string): QuestionMeta {
	return {
		tags: card.metadata.tags,
		skill,
		sourcePrompt: card.prompt,
		sourceTranslation: card.translation,
	};
}

function makeMultipleChoice(card: Card, deck: Card[]): Question | null {
	if (!card.translation) return null;
	const options = new Set<string>();
	options.add(card.translation);
	const shuffled = shuffle(deck.filter((c) => c.id !== card.id && c.translation));
	for (const candidate of shuffled) {
		if (options.size >= 4) break;
		if (candidate.translation) options.add(candidate.translation);
	}
	if (options.size < 2) return null;
	const optionList = shuffle(Array.from(options));
	const correctIndex = optionList.indexOf(card.translation);
	return {
		type: "multiple_choice",
		cardId: card.id,
		prompt: `Translate: "${card.prompt}"`,
		options: optionList,
		correctIndex,
		meta: buildMeta(card, "sentence_comprehension"),
	};
}

function makeCloze(card: Card): Question | null {
	const tokens = card.prompt.split(" ");
	const candidates = tokens
		.map((token, index) => ({ token, index }))
		.map(({ token, index }) => {
			const match = token.match(/^(["'\(\[]?)([A-Za-z]+)([^A-Za-z]*)$/);
			if (!match) return null;
			const word = match[2] ?? "";
			if (word.length < 3) return null;
			if (word !== word.toLowerCase()) return null;
			return { token, index, match };
		})
		.filter((entry): entry is { token: string; index: number; match: RegExpMatchArray } => entry !== null);
	if (candidates.length === 0) return null;
	const choice = candidates[Math.floor(Math.random() * candidates.length)];
	const token = choice.token;
	const match = choice.match;
	const prefix = match[1] ?? "";
	const word = match[2] ?? token;
	const suffix = match[3] ?? "";
	const clozeToken = `${prefix}___${suffix}`;
	const clozeTokens = tokens.slice();
	clozeTokens[choice.index] = clozeToken;
	return {
		type: "cloze",
		cardId: card.id,
		prompt: `Fill in: ${clozeTokens.join(" ")}`,
		answer: word,
		meta: buildMeta(card, "grammar_fill"),
	};
}

function makeReorder(card: Card): Question | null {
	const cleaned = card.prompt.replace(/[.!?]/g, "");
	const tokens = cleaned.split(" ").filter(Boolean);
	if (tokens.length < 3) return null;
	let shuffled = shuffle(tokens);
	if (shuffled.join(" ") === tokens.join(" ")) {
		shuffled = shuffle(tokens);
	}
	return {
		type: "reorder",
		cardId: card.id,
		tokens: shuffled,
		correctSentence: cleaned,
		meta: buildMeta(card, "word_order"),
	};
}

function getArticle(card: Card): "de" | "het" | null {
	const tags = card.metadata.tags ?? [];
	if (tags.includes("de")) return "de";
	if (tags.includes("het")) return "het";
	return null;
}

function shuffle<T>(items: T[]): T[] {
	const copy = items.slice();
	for (let i = copy.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j]!, copy[i]!];
	}
	return copy;
}
