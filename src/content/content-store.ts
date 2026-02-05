import type { Card } from "../core/types.js";
import type { LanguageDefinition } from "../languages/index.js";
import { getBuiltinDeck } from "../languages/index.js";
import { fetchTatoebaCards } from "./tatoeba-client.js";
import { loadTatoebaCache, saveTatoebaCache, type TatoebaCache } from "./tatoeba-cache.js";
import { ensureTatoebaAttribution } from "./attribution.js";

const DEFAULT_MAX_CACHE = 200;
const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_REFRESH_HOURS = 24;
const DEFAULT_MAX_WORDS = 12;
const DEFAULT_TRANSLATION_LANG = "eng";

export class ContentStore {
	private cache: TatoebaCache;
	private deck: Card[];
	private language: LanguageDefinition;
	private transLang: string;
	private cacheTransLang: string;

	constructor(language: LanguageDefinition, transLang: string = DEFAULT_TRANSLATION_LANG) {
		this.language = language;
		this.transLang = transLang;
		this.cacheTransLang = normalizeCacheLang(transLang);
		this.cache = loadTatoebaCache(language.code, this.cacheTransLang);
		this.deck = mergeDecks(getBuiltinDeck(language.code), this.cache.cards);
	}

	getDeck(): Card[] {
		return this.deck;
	}

	async refreshTatoeba(): Promise<{ added: number; total: number }> {
		const now = Date.now();
		if (this.cache.cards.length >= DEFAULT_MAX_CACHE && !shouldRefresh(this.cache.lastFetchedAt, now)) {
			return { added: 0, total: this.cache.cards.length };
		}
		if (!shouldRefresh(this.cache.lastFetchedAt, now)) {
			return { added: 0, total: this.cache.cards.length };
		}

		const fetched = await fetchTatoebaCards({
			limit: DEFAULT_BATCH_SIZE,
			maxWords: DEFAULT_MAX_WORDS,
			lang: this.language.tatoebaLang,
			transLang: this.transLang,
			cardLang: this.language.code,
		});

		const existing = new Set(this.cache.cards.map((card) => card.id));
		const fresh = fetched.filter((card) => !existing.has(card.id));
		if (fresh.length === 0) {
			this.cache.lastFetchedAt = now;
			saveTatoebaCache(this.cache, this.language.code, this.cacheTransLang);
			return { added: 0, total: this.cache.cards.length };
		}

		this.cache.cards = [...this.cache.cards, ...fresh];
		if (this.cache.cards.length > DEFAULT_MAX_CACHE) {
			this.cache.cards = this.cache.cards.slice(-DEFAULT_MAX_CACHE);
		}
		this.cache.lastFetchedAt = now;
		saveTatoebaCache(this.cache, this.language.code, this.cacheTransLang);
		ensureTatoebaAttribution();

		this.deck = mergeDecks(getBuiltinDeck(this.language.code), this.cache.cards);
		return { added: fresh.length, total: this.cache.cards.length };
	}
}

function mergeDecks(builtin: Card[], cached: Card[]): Card[] {
	const byId = new Map<string, Card>();
	for (const card of builtin) byId.set(card.id, card);
	for (const card of cached) byId.set(card.id, card);
	return Array.from(byId.values());
}

function shouldRefresh(lastFetchedAt: number, now: number): boolean {
	if (!lastFetchedAt) return true;
	const hours = (now - lastFetchedAt) / (1000 * 60 * 60);
	return hours >= DEFAULT_REFRESH_HOURS;
}

function normalizeCacheLang(lang: string): string {
	if (lang === "eng") return "en";
	return lang;
}
