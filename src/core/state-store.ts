import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AttemptLogEvent, LangCode, Profile } from "./types.js";
import { getBaseDir } from "./paths.js";

const PROFILE_VERSION = 1 as const;
const SAVE_DEBOUNCE_MS = 1500;

export class ProfileStore {
	profile: Profile;
	private baseDir: string;
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(lang: LangCode) {
		this.baseDir = getBaseDir();
		this.ensureDirs();
		this.profile = loadProfile(this.baseDir, lang);
		this.ensureAttribution();
	}

	save(): void {
		writeProfile(this.baseDir, this.profile);
	}

	saveSoon(): void {
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			this.save();
		}, SAVE_DEBOUNCE_MS);
	}

	flush(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		this.save();
	}

	appendAttempt(event: AttemptLogEvent): void {
		const logDir = join(this.baseDir, "logs");
		mkdirSync(logDir, { recursive: true });
		const date = new Date(event.ts);
		const yyyy = date.getFullYear();
		const mm = String(date.getMonth() + 1).padStart(2, "0");
		const dd = String(date.getDate()).padStart(2, "0");
		const logPath = join(logDir, `${event.lang}-${yyyy}-${mm}-${dd}.jsonl`);
		appendFileSync(logPath, `${JSON.stringify(event)}\n`, { encoding: "utf-8" });
	}

	dispose(): void {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private ensureDirs(): void {
		mkdirSync(this.baseDir, { recursive: true });
		mkdirSync(join(this.baseDir, "profiles"), { recursive: true });
		mkdirSync(join(this.baseDir, "caches"), { recursive: true });
		mkdirSync(join(this.baseDir, "logs"), { recursive: true });
		mkdirSync(join(this.baseDir, "attribution"), { recursive: true });
	}

	private ensureAttribution(): void {
		const attributionPath = join(this.baseDir, "attribution", "SOURCES.md");
		if (existsSync(attributionPath)) return;
		const content = [
			"# Data Sources",
			"",
			"Built-in deck authored for pi-langlearn. No external datasets used yet.",
			"",
			"When adding external sources (Tatoeba, Wiktionary, wordfreq), update this file with license and attribution.",
		].join("\n");
		writeFileSync(attributionPath, content, { encoding: "utf-8" });
	}
}

function loadProfile(baseDir: string, lang: LangCode): Profile {
	const profilePath = join(baseDir, "profiles", `${lang}.json`);
	if (!existsSync(profilePath)) return defaultProfile(lang);
	try {
		const raw = JSON.parse(readFileSync(profilePath, "utf-8"));
		return sanitizeProfile(raw, lang);
	} catch {
		return defaultProfile(lang);
	}
}

function writeProfile(baseDir: string, profile: Profile): void {
	const profilePath = join(baseDir, "profiles", `${profile.lang}.json`);
	const tmpPath = `${profilePath}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(profile, null, 2), { encoding: "utf-8" });
	renameSync(tmpPath, profilePath);
}

function defaultProfile(lang: LangCode): Profile {
	return {
		version: PROFILE_VERSION,
		lang,
		enabled: false,
		stats: {
			totalAttempts: 0,
			correctAttempts: 0,
			streakDays: 0,
			lastActiveAt: 0,
		},
		ability: {
			estimate: "unknown",
			score: 0.2,
			confidence: 0,
			subskills: {},
			updatedAt: Date.now(),
		},
		deck: {
			knownCardIds: [],
			srs: {},
			suspendedCardIds: [],
		},
		settings: {
			mode: "strict-free",
			dailyNewCardsTarget: 8,
			overlayAutoHideOnIdle: true,
			maxOverlaySecondsAfterIdle: 10,
		},
	};
}

function sanitizeProfile(raw: any, lang: LangCode): Profile {
	const fallback = defaultProfile(lang);
	const profile: Profile = {
		version: PROFILE_VERSION,
		lang,
		enabled: Boolean(raw?.enabled ?? fallback.enabled),
		stats: {
			totalAttempts: toInt(raw?.stats?.totalAttempts, 0),
			correctAttempts: toInt(raw?.stats?.correctAttempts, 0),
			streakDays: toInt(raw?.stats?.streakDays, 0),
			lastActiveAt: toInt(raw?.stats?.lastActiveAt, 0),
			avgLatencyMs7d: typeof raw?.stats?.avgLatencyMs7d === "number" ? raw.stats.avgLatencyMs7d : undefined,
		},
		ability: {
			estimate: isCefr(raw?.ability?.estimate) ? raw.ability.estimate : fallback.ability.estimate,
			score: clamp01(raw?.ability?.score ?? fallback.ability.score),
			confidence: clamp01(raw?.ability?.confidence ?? fallback.ability.confidence),
			subskills: typeof raw?.ability?.subskills === "object" && raw.ability.subskills
				? raw.ability.subskills
				: {},
			updatedAt: toInt(raw?.ability?.updatedAt, Date.now()),
		},
		deck: {
			knownCardIds: Array.isArray(raw?.deck?.knownCardIds) ? raw.deck.knownCardIds : [],
			srs: typeof raw?.deck?.srs === "object" && raw.deck.srs ? raw.deck.srs : {},
			suspendedCardIds: Array.isArray(raw?.deck?.suspendedCardIds) ? raw.deck.suspendedCardIds : [],
		},
		settings: {
			mode: isMode(raw?.settings?.mode) ? raw.settings.mode : fallback.settings.mode,
			dailyNewCardsTarget: clampInt(raw?.settings?.dailyNewCardsTarget, fallback.settings.dailyNewCardsTarget, 1, 50),
			overlayAutoHideOnIdle: raw?.settings?.overlayAutoHideOnIdle !== false,
			maxOverlaySecondsAfterIdle: clampInt(
				raw?.settings?.maxOverlaySecondsAfterIdle,
				fallback.settings.maxOverlaySecondsAfterIdle,
				0,
				60,
			),
		},
	};
	return profile;
}

function isMode(value: unknown): value is Profile["settings"]["mode"] {
	return value === "strict-free" || value === "shared-llm" || value === "local-llm";
}

function isCefr(value: unknown): value is Profile["ability"]["estimate"] {
	return ["A0", "A1", "A2", "B1", "B2", "C1", "C2", "unknown"].includes(String(value));
}

function toInt(value: unknown, fallback: number): number {
	if (typeof value !== "number" || Number.isNaN(value)) return fallback;
	return Math.trunc(value);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || Number.isNaN(value)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}
