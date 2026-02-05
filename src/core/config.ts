import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface LangLearnConfig {
	overlayWidthPercent: number;
	overlayHeightPercent: number;
	overlayMargin: number;
	overlayAnchor: "top-right" | "top-left" | "center";
	widgetPlacement: "belowEditor" | "aboveEditor";
}

const DEFAULT_CONFIG: LangLearnConfig = {
	overlayWidthPercent: 38,
	overlayHeightPercent: 32,
	overlayMargin: 1,
	overlayAnchor: "top-right",
	widgetPlacement: "belowEditor",
};

export function loadConfig(): LangLearnConfig {
	const configPath = join(homedir(), ".agents", "pi-langlearn", "config.json");
	let raw: Partial<LangLearnConfig> = {};
	if (existsSync(configPath)) {
		try {
			raw = JSON.parse(readFileSync(configPath, "utf-8"));
		} catch (error) {
			console.error(`Warning: Could not parse ${configPath}: ${String(error)}`);
		}
	}

	const merged = { ...DEFAULT_CONFIG, ...raw };
	return {
		overlayWidthPercent: clampInt(merged.overlayWidthPercent, DEFAULT_CONFIG.overlayWidthPercent, 20, 90),
		overlayHeightPercent: clampInt(merged.overlayHeightPercent, DEFAULT_CONFIG.overlayHeightPercent, 20, 80),
		overlayMargin: clampInt(merged.overlayMargin, DEFAULT_CONFIG.overlayMargin, 0, 6),
		overlayAnchor: merged.overlayAnchor === "top-left" || merged.overlayAnchor === "center" ? merged.overlayAnchor : "top-right",
		widgetPlacement: merged.widgetPlacement === "aboveEditor" ? "aboveEditor" : "belowEditor",
	};
}

export function ensureConfigFile(): void {
	const baseDir = join(homedir(), ".agents", "pi-langlearn");
	const configPath = join(baseDir, "config.json");
	if (existsSync(configPath)) return;
	mkdirSync(baseDir, { recursive: true });
	writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), { encoding: "utf-8" });
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
	if (typeof value !== "number" || Number.isNaN(value)) return fallback;
	const rounded = Math.trunc(value);
	return Math.min(max, Math.max(min, rounded));
}
