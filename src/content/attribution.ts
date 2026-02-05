import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getBaseDir } from "../core/paths.js";

const TATOEBA_SECTION = [
	"## Tatoeba",
	"",
	"Source: https://tatoeba.org/",
	"License: CC BY 2.0 FR (see https://tatoeba.org/en/downloads)",
	"Attribution: include sentence owner usernames when available.",
	"",
].join("\n");

export function ensureTatoebaAttribution(): void {
	const sourcesPath = join(getBaseDir(), "attribution", "SOURCES.md");
	if (!existsSync(sourcesPath)) return;
	const current = readFileSync(sourcesPath, "utf-8");
	if (current.includes("## Tatoeba")) return;
	const updated = `${current.trim()}\n\n${TATOEBA_SECTION}`;
	writeFileSync(sourcesPath, updated, { encoding: "utf-8" });
}
