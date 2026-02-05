# pi-langlearn

Language-learning overlay for Pi that appears while the main agent is busy. It supports multiple languages via `/langlearn <language-name>` and stores progress locally under `~/.agents/pi-langlearn/`.

**Highlights**

- Busy-gated overlay: shows only while the agent is working; Esc hides until the next busy cycle.
- Language switching: `/langlearn <language-name>` selects and enables a language.
- Always-on LLM grading: attempts shared model grading first, then falls back to strict-free grading automatically.
- Online-first content: pulls from Tatoeba and caches locally with attribution.

**Quick Test**

1. `pi -e ./src/index.ts`
2. In Pi: `/langlearn dutch`
3. Trigger a busy cycle (example: “Run sleep 3 with bash.”)
4. Use the overlay: press Enter to submit answers, Tab for hints, Esc to close.

**Install (Pi Packages)**
Add this to Pi `settings.json` (preferred for users). Common locations:

- Global: `~/.pi/agent/settings.json`
- Project-local: `.pi/settings.json` (in your project root)

```json
{
  "packages": ["npm:pi-langlearn@latest"]
}
```

Start Pi (or run `/reload`) and then enable with `/langlearn dutch`.

**Persistent Load (Local Dev)**

1. Recommended for local dev (auto-discovery + `/reload`): place this repo in one of:

- `~/.pi/agent/extensions/pi-langlearn/`
- `.pi/extensions/pi-langlearn/` (project-local)

2. Alternative (explicit path): add the extension path in Pi settings:

```json
{
  "extensions": ["/absolute/path/to/pi-langlearn"]
}
```

3. Start Pi and use `/reload` after changes (only auto-discovered locations hot-reload).
4. Enable with `/langlearn dutch`.

**Commands**

- `/langlearn <language-name>`: switch to a language and enable learning.
- `/langlearn off`: disable learning.

**Language Components**

- Each language lives under `src/languages/<code>/` with:
  - `builtin-deck.ts`: built-in cards for first-run learning.
  - `index.ts`: exports a `LanguageDefinition` for the language.
- The registry in `src/languages/index.ts` lists available languages.
- Shared types live in `src/languages/types.ts`.

To add a language, create a new folder and follow this template:

1. `src/languages/<code>/builtin-deck.ts` exporting `BUILTIN_CARDS: Card[]`.
2. `src/languages/<code>/index.ts` exporting a `LanguageDefinition`:
   - `code`: short language code (e.g., `es`)
   - `name`: display name
   - `aliases`: command-friendly names (e.g., `spanish`, `español`)
   - `tatoebaLang`: Tatoeba language code
   - `builtinDeck`: `BUILTIN_CARDS`
3. Add the new export to the `LANGUAGES` list in `src/languages/index.ts`.

**Data Layout**

- Profiles: `~/.agents/pi-langlearn/profiles/<lang>.json`
- Caches: `~/.agents/pi-langlearn/caches/tatoeba-<lang>-<trans>.json`
- Logs: `~/.agents/pi-langlearn/logs/<lang>-YYYY-MM-DD.jsonl`
- Attribution: `~/.agents/pi-langlearn/attribution/SOURCES.md`

**Notes**

- The overlay is busy-gated by default. It auto-opens when the agent becomes busy and pauses on idle.
- LLM grading is always attempted. If no shared model is available, grading falls back to strict-free heuristics.

**Repo Map**

- `src/index.ts`: Pi entrypoint and command registration.
- `src/app/learning-controller.ts`: lifecycle, overlay control, language switching.
- `src/languages/`: language registry + built-in decks.
- `src/content/`: Tatoeba fetch + cache integration.
