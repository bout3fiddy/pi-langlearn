export type LangCode = string;

export type LearningMode = "strict-free" | "shared-llm" | "local-llm";

export type CardType = "sentence" | "vocab" | "grammar";

export type CardSource = "builtin" | "tatoeba" | "wiktionary" | "llm";

export type CefrEstimate = "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "unknown";

export interface Card {
	id: string;
	lang: LangCode;
	type: CardType;
	source: CardSource;
	prompt: string;
	answer: string | string[];
	translation?: string;
	metadata: {
		difficulty?: number;
		tags?: string[];
		authorAttribution?: string;
	};
}

export interface SrsState {
	dueAt: number;
	intervalDays: number;
	ease: number;
	reps: number;
	lapses: number;
	lastReviewedAt?: number;
	lastQuality?: number;
}

export interface Profile {
	version: 1;
	lang: LangCode;
	enabled: boolean;
	stats: {
		totalAttempts: number;
		correctAttempts: number;
		streakDays: number;
		lastActiveAt: number;
		avgLatencyMs7d?: number;
	};
	ability: {
		estimate: CefrEstimate;
		score: number;
		confidence: number;
		subskills: Record<string, { score: number; samples: number }>;
		updatedAt: number;
	};
	deck: {
		knownCardIds: string[];
		srs: Record<string, SrsState>;
		suspendedCardIds?: string[];
	};
	settings: {
		mode: LearningMode;
		dailyNewCardsTarget: number;
		overlayAutoHideOnIdle: boolean;
		maxOverlaySecondsAfterIdle: number;
	};
}

export type Question =
	| {
		type: "multiple_choice";
		cardId: string;
		prompt: string;
		options: string[];
		correctIndex: number;
		meta?: QuestionMeta;
	}
	| {
		type: "type_answer";
		cardId: string;
		prompt: string;
		answer: string | string[];
		hint?: string;
		meta?: QuestionMeta;
	}
	| {
		type: "cloze";
		cardId: string;
		prompt: string;
		answer: string | string[];
		meta?: QuestionMeta;
	}
	| {
		type: "de_het";
		cardId: string;
		noun: string;
		correct: "de" | "het";
		meta?: QuestionMeta;
	}
	| {
		type: "reorder";
		cardId: string;
		tokens: string[];
		correctSentence: string;
		meta?: QuestionMeta;
	};

export interface QuestionMeta {
	tags?: string[];
	skill?: string;
	sourcePrompt?: string;
	sourceTranslation?: string;
}

export interface GradeResult {
	correct: boolean;
	quality: number;
	explanation: string;
	expectedAnswer?: string;
	normalizedUserAnswer?: string;
}

export interface AttemptLogEvent {
	ts: number;
	lang: LangCode;
	cardId: string;
	qType: Question["type"];
	prompt: string;
	userAnswer: string;
	correct: boolean;
	latencyMs: number;
	quality: number;
	tags: string[];
}

export interface EngineStatus {
	lang: LangCode;
	ability: Profile["ability"];
	dueCount: number;
	newCount: number;
	streakDays: number;
	enabled: boolean;
}
