import type { Card } from "../core/types.js";

export interface LanguageDefinition {
	code: string;
	name: string;
	aliases: string[];
	tatoebaLang: string;
	builtinDeck: Card[];
}
