import type { LanguageDefinition } from "../types.js";
import { BUILTIN_CARDS } from "./builtin-deck.js";

export const DUTCH_LANGUAGE: LanguageDefinition = {
	code: "nl",
	name: "Dutch",
	aliases: ["dutch", "nederlands"],
	tatoebaLang: "nld",
	builtinDeck: BUILTIN_CARDS,
};
