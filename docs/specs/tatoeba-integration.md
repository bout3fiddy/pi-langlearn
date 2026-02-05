# Tatoeba Integration (Online-First Cache)

## Title / Scope

Add an online-first Tatoeba sentence pair source (nl <-> en) with local caching and attribution, and integrate it into the learning engine deck.

## Goals and Non-goals

Goals

- Fetch a small batch of Dutch sentences with English translations from the Tatoeba API.
- Cache fetched cards locally under `~/.agents/pi-langlearn/caches/`.
- Merge cached cards into the active deck without duplication.
- Update attribution file with Tatoeba license and attribution requirements.
- Keep overlay UX snappy and avoid blocking the main agent.

Non-goals

- Full dataset download or large batch ingestion.
- Advanced filtering or proficiency tagging beyond simple heuristics.
- Any paid services or auth flows.

## Assumptions and Constraints

- Tatoeba API is reachable and supports the unstable `sentences` endpoint.
- Language codes use ISO 639-3 (Dutch: `nld`, English: `eng`).
- The API requires `sort` and supports `trans:lang` filtering.
- Cache size should remain modest (default max 200 cards).

## Research Summary

- Tatoeba provides an unstable API with an OpenAPI description and a `sentences` endpoint.
- `sort` is required; `sort=random` works for sampling.
- `trans:lang` filters translations by language (English for this use case).
- Responses include `owner` and `license` for attribution.

Sources

- https://api.tatoeba.org/ (API landing)
- https://api.tatoeba.org/unstable/sentences (endpoint; requires `sort`)
- https://tatoeba.org/en/downloads (license/attribution context)

## Architecture and Approach

- Add a content store that merges built-in cards with cached Tatoeba cards.
- Add a Tatoeba client that fetches sentences via `https://api.tatoeba.org/unstable/sentences` with params:
  - `lang=nld`
  - `trans:lang=eng`
  - `sort=random`
  - `limit=<batch>`
- Filter sentences to keep short prompts (e.g., <= 12 words) and ignore missing translations.
- Build `Card` objects with:
  - `id = tatoeba:<sentenceId>`
  - `prompt = dutch text`
  - `translation = english text`
  - `metadata.authorAttribution = "prompt:<owner>; translation:<owner>"`
- Cache structure:
  - `~/.agents/pi-langlearn/caches/tatoeba-nl-en.json`
  - `{ version, lastFetchedAt, cards: Card[] }`
- Refresh policy:
  - On session start, try refresh if last fetch > 24h and cache < max size.
  - Non-blocking refresh; update deck when new cards arrive.
- Attribution:
  - Append a Tatoeba section to `~/.agents/pi-langlearn/attribution/SOURCES.md` if missing.

## Implementation Plan

1. [x] Add a `paths.ts` helper for base directory reuse.
2. [x] Create `content/tatoeba-client.ts` to fetch and normalize API responses.
3. [x] Create `content/tatoeba-cache.ts` for load/save + refresh policy.
4. [x] Create `content/content-store.ts` to merge built-in + cached cards and refresh asynchronously.
5. [x] Add `LearningEngine.setDeck()` and map-based lookup for dynamic decks.
6. [x] Wire `LearningController` to use `ContentStore` and update engine on refresh.
7. [x] Update `package.json` file list to include new modules.

## Experiments / Trials

- Verified `sort=random` requirement by calling the unstable sentences endpoint and inspecting sample JSON (includes `owner`, `translations`, and `license`).

## Validation

- Not run (no TS tooling configured in repo yet).
- Manual sanity via live API request to confirm response shape.

## Open Questions / Risks

- API rate limits and stability (unstable endpoint).
- Proper author attribution display (currently stored but not rendered in UI).
- Whether to expose Tatoeba cache sizing and refresh interval via config.

## Next Steps

- Implement cache + fetcher, then verify behavior with a live request.
