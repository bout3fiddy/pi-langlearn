import {
	SessionManager,
	createAgentSession,
	discoverAuthStorage,
	discoverModels,
} from "@mariozechner/pi-coding-agent";
import type { GradeResult, Question } from "./types.js";

const SYSTEM_PROMPT_SUFFIX = `\nYou are a language tutor. You MUST output strict JSON only. No markdown. No prose outside JSON.`;

export class TutorSession {
	private sessionPromise: Promise<any | null> | null = null;

	async grade(question: Question, userAnswer: string): Promise<GradeResult | null> {
		const session = await this.getSession();
		if (!session) return null;
		const payload = buildPromptPayload(question, userAnswer);
		try {
			await session.prompt(JSON.stringify(payload));
			const message = extractLastAssistantMessage(session);
			const text = extractText(message);
			if (!text) return null;
			const parsed = JSON.parse(text);
			if (!parsed || typeof parsed.correct !== "boolean") return null;
			return {
				correct: Boolean(parsed.correct),
				quality: clampQuality(parsed.quality),
				explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
				expectedAnswer: typeof parsed.expectedAnswer === "string" ? parsed.expectedAnswer : undefined,
				normalizedUserAnswer: typeof parsed.normalizedUserAnswer === "string" ? parsed.normalizedUserAnswer : undefined,
			};
		} catch {
			return null;
		}
	}

	private async getSession(): Promise<any | null> {
		if (!this.sessionPromise) {
			this.sessionPromise = this.createSession();
		}
		return this.sessionPromise;
	}

	private async createSession(): Promise<any | null> {
		try {
			const authStorage = discoverAuthStorage();
			const modelRegistry = discoverModels(authStorage);
			const available = await modelRegistry.getAvailable();
			const model = Array.isArray(available) ? available[0] : null;
			if (!model) return null;
			const { session } = await createAgentSession({
				model,
				thinkingLevel: "off",
				tools: [],
				sessionManager: SessionManager.inMemory(),
				authStorage,
				modelRegistry,
				systemPrompt: (defaultPrompt: string) => `${defaultPrompt}${SYSTEM_PROMPT_SUFFIX}`,
			});
			return session;
		} catch {
			return null;
		}
	}
}

function buildPromptPayload(question: Question, userAnswer: string): Record<string, unknown> {
	const base = {
		action: "grade_answer",
		question,
		userAnswer,
		require: {
			correct: "boolean",
			quality: "0-5",
			explanation: "short string",
			expectedAnswer: "string?",
			normalizedUserAnswer: "string?",
		},
	};
	return base;
}

function extractLastAssistantMessage(session: any): any {
	const messages = session?.agent?.state?.messages ?? session?.state?.messages ?? session?.messages;
	if (!Array.isArray(messages)) return null;
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		const role = message?.role ?? message?.type;
		if (role === "assistant" || role === "model") return message;
	}
	return messages[messages.length - 1] ?? null;
}

function extractText(message: any): string | null {
	if (!message) return null;
	if (typeof message === "string") return message;
	if (typeof message.text === "string") return message.text;
	if (typeof message.content === "string") return message.content;
	const content = message.content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") return part;
				if (typeof part?.text === "string") return part.text;
				return "";
			})
			.join("")
			.trim();
	}
	return null;
}

function clampQuality(value: unknown): number {
	const num = typeof value === "number" ? Math.trunc(value) : 3;
	return Math.min(5, Math.max(0, num));
}
