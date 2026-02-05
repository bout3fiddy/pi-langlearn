import { DUTCH_LANGUAGE } from "./dutch/index.js";
import type { Card } from "../core/types.js";
import type { LanguageDefinition } from "./types.js";
export type { LanguageDefinition } from "./types.js";

const LANGUAGES: LanguageDefinition[] = [DUTCH_LANGUAGE];

export const DEFAULT_LANGUAGE: LanguageDefinition = LANGUAGES[0]!;

export function listLanguages(): LanguageDefinition[] {
  return [...LANGUAGES];
}

export function getLanguage(code: string): LanguageDefinition | null {
  const normalized = normalizeKey(code);
  return LANGUAGES.find((lang) => normalizeKey(lang.code) === normalized) ?? null;
}

export function resolveLanguage(input: string | null | undefined): LanguageDefinition | null {
  if (!input) return null;
  const normalized = normalizeKey(input);
  return (
    LANGUAGES.find((lang) => lang.aliases.some((alias) => normalizeKey(alias) === normalized)) ??
    LANGUAGES.find((lang) => normalizeKey(lang.name) === normalized) ??
    null
  );
}

export function getLanguageLabel(code: string): string {
  const language = getLanguage(code);
  if (language) return language.name;
  return code ? code.toUpperCase() : "Unknown";
}

export function getBuiltinDeck(code: string): Card[] {
  return getLanguage(code)?.builtinDeck ?? [];
}

export function getBuiltinCardById(code: string, id: string): Card | undefined {
  const language = getLanguage(code);
  if (!language) return undefined;
  return language.builtinDeck.find((card) => card.id === id);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}
