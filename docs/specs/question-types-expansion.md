# Question Types Expansion (Articles + Reorder)

## Title / Scope
Add new question types for article drills (de/het) and simple word-order reorder prompts, and wire them into question selection.

## Goals and Non-goals
Goals
- Add `de/het` drills based on vocab cards tagged with article metadata.
- Add `reorder` questions for short sentence cards.
- Keep question selection adaptive to ability score and avoid repeating recent cards.

Non-goals
- Full grammar analysis or tokenization beyond simple heuristics.
- Rich UI widgets beyond inline text prompts.

## Assumptions and Constraints
- Vocab cards already include `de`/`het` tags in `metadata.tags`.
- TUI input is text-only; reorder can be answered by typing the sentence or indices.

## Research Summary
- No external research needed for this step.

## Architecture and Approach
- Extend `Question` type to include:
  - `de_het`: prompt with noun and expect "de" or "het".
  - `reorder`: prompt with shuffled tokens and expect the correct sentence.
- Add generators in `question-generator.ts`:
  - `makeDeHet(card)` for vocab cards tagged with article.
  - `makeReorder(card)` for short sentence prompts (<= 8 tokens).
- Update grader to evaluate:
  - `de_het` by normalized exact match.
  - `reorder` by normalized sentence equality (ignoring punctuation).
- Update overlay rendering to display new types.

## Implementation Plan
1. [x] Extend `types.ts` Question union with `de_het` and `reorder`.
2. [x] Update `question-generator.ts` to produce these types.
3. [x] Update `grader.ts` to grade them.
4. [x] Update `overlay-component.ts` rendering/input hints for new types.

## Experiments / Trials
- None (logic changes only).

## Validation
- Not run (no TS tooling configured in repo yet).
- Manual sanity pending: verify de/het prompts and reorder prompts display and grade correctly.

## Open Questions / Risks
- Reorder input UX (typing full sentence vs. indices).
- Whether to penalize minor punctuation differences.

## Next Steps
- Implement new question types and wire into generator/grader/overlay.
