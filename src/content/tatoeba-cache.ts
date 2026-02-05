import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Card } from "../core/types.js";
import { getBaseDir } from "../core/paths.js";

const CACHE_VERSION = 1;

export interface TatoebaCache {
  version: number;
  lastFetchedAt: number;
  cards: Card[];
}

export function loadTatoebaCache(lang: string, transLang: string): TatoebaCache {
  const path = getCachePath(lang, transLang);
  if (!existsSync(path)) return { version: CACHE_VERSION, lastFetchedAt: 0, cards: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (!raw || raw.version !== CACHE_VERSION || !Array.isArray(raw.cards)) {
      return { version: CACHE_VERSION, lastFetchedAt: 0, cards: [] };
    }
    return {
      version: CACHE_VERSION,
      lastFetchedAt: typeof raw.lastFetchedAt === "number" ? raw.lastFetchedAt : 0,
      cards: raw.cards,
    };
  } catch {
    return { version: CACHE_VERSION, lastFetchedAt: 0, cards: [] };
  }
}

export function saveTatoebaCache(cache: TatoebaCache, lang: string, transLang: string): void {
  const path = getCachePath(lang, transLang);
  const dir = join(getBaseDir(), "caches");
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache, null, 2), { encoding: "utf-8" });
  renameSync(tmp, path);
}

function getCachePath(lang: string, transLang: string): string {
  const safeLang = sanitizeSegment(lang);
  const safeTrans = sanitizeSegment(transLang);
  return join(getBaseDir(), "caches", `tatoeba-${safeLang}-${safeTrans}.json`);
}

function sanitizeSegment(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
  return cleaned.length > 0 ? cleaned : "unknown";
}
