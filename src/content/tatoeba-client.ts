import type { Card } from "../core/types.js";

const API_URL = "https://api.tatoeba.org/unstable/sentences";

interface TatoebaTranslation {
  id: number;
  text: string;
  lang: string;
  license?: string | null;
  owner?: string | null;
  is_direct?: boolean;
}

interface TatoebaSentence {
  id: number;
  text: string;
  lang: string;
  license?: string | null;
  owner?: string | null;
  translations?: TatoebaTranslation[];
}

interface TatoebaResponse {
  data: TatoebaSentence[];
}

export interface TatoebaFetchOptions {
  limit: number;
  maxWords: number;
  lang: string;
  transLang: string;
  cardLang?: string;
}

export async function fetchTatoebaCards(options: TatoebaFetchOptions): Promise<Card[]> {
  const url = new URL(API_URL);
  url.searchParams.set("lang", options.lang);
  url.searchParams.set("trans:lang", options.transLang);
  url.searchParams.set("sort", "random");
  url.searchParams.set("limit", String(options.limit));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Tatoeba request failed: ${response.status}`);
  }
  const json = (await response.json()) as TatoebaResponse;
  if (!json?.data) return [];

  const cards: Card[] = [];
  const cardLang = options.cardLang ?? options.lang;
  for (const sentence of json.data) {
    if (!sentence?.text || !sentence?.id) continue;
    if (wordCount(sentence.text) > options.maxWords) continue;
    const translation = pickTranslation(sentence.translations ?? [], options.transLang);
    if (!translation?.text) continue;
    const card: Card = {
      id: `tatoeba:${sentence.id}`,
      lang: cardLang,
      type: "sentence",
      source: "tatoeba",
      prompt: sentence.text,
      answer: translation.text,
      translation: translation.text,
      metadata: {
        tags: ["tatoeba"],
        authorAttribution: buildAttribution(sentence, translation),
      },
    };
    cards.push(card);
  }
  return cards;
}

function pickTranslation(
  translations: TatoebaTranslation[],
  lang: string,
): TatoebaTranslation | null {
  const direct = translations.find((t) => t.lang === lang && t.is_direct);
  if (direct) return direct;
  const fallback = translations.find((t) => t.lang === lang);
  return fallback ?? null;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildAttribution(sentence: TatoebaSentence, translation: TatoebaTranslation): string {
  const promptOwner = sentence.owner ? `prompt:${sentence.owner}` : "prompt:unknown";
  const translationOwner = translation.owner
    ? `translation:${translation.owner}`
    : "translation:unknown";
  return `${promptOwner}; ${translationOwner}`;
}
