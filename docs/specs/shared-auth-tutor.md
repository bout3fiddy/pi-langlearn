# Shared-Auth Tutor Session (LLM Grading)

## Title / Scope

Add an optional tutor session that uses Pi's existing auth/model discovery to grade answers and provide concise feedback, without introducing new keys or external configuration.

## Goals and Non-goals

Goals

- Support `shared-llm` (and optionally `local-llm`) mode using Pi's model discovery.
- Use a tool-less in-memory `AgentSession` to grade answers with strict JSON output.
- Fall back to strict-free grading if no model is available or JSON parsing fails.

Non-goals

- Full LLM-driven question generation or new content sources.
- Token streaming UI or long explanations.

## Assumptions and Constraints

- `createAgentSession`, `discoverAuthStorage`, `discoverModels`, and `SessionManager.inMemory()` are available from `@mariozechner/pi-coding-agent`.
- `session.prompt()` can be called to get a response, and the response can be retrieved from session state.
- The tutor session must not have tool access.

## Research Summary

- `createAgentSession()` can be called with in-memory session management and custom system prompts; discovery is default unless overridden.
- `discoverAuthStorage()` and `discoverModels()` resolve models and credentials from Pi's standard locations.
- `SessionManager.inMemory()` avoids persistent session files.

Sources

- https://upd.dev/badlogic/pi-mono/src/commit/cb3ac0ba9e82ba06ca309f7da4fef7e68bf9ef00/packages/coding-agent/docs/sdk.md

## Architecture and Approach

- Add a `TutorSession` helper that lazily creates an `AgentSession` with:
  - `sessionManager: SessionManager.inMemory()`
  - `tools: []`
  - `thinkingLevel: "off"`
  - `systemPrompt`: force strict JSON output
- Extend the learning engine to always attempt tutor grading (mode gating removed). When unavailable or failing, fall back to strict-free grading.
- Parse JSON response and map to `GradeResult`.
- On any failure (no models, request error, invalid JSON), fall back to strict-free grading.

## Implementation Plan

1. [x] Create `tutor-session.ts` to manage the LLM session and grading prompt.
2. [x] Make `LearningEngine.submitAnswer()` async and call tutor when enabled.
3. [x] Update overlay submission path to await async grading.
4. [x] Update package exports to include the tutor module.

## Experiments / Trials

- No direct runtime validation (SDK behaviors verified only via docs review).

## Validation

- Not run (no TS tooling configured in repo yet).
- Manual sanity pending: trigger `shared-llm` mode and verify fallback when models are unavailable.

## Open Questions / Risks

- Exact return type/shape of `session.prompt()` responses.
- API stability for the SDK across versions.
- Latency impact on short overlay interactions.

## Next Steps

- Implement tutor session + async grading with fallbacks.
