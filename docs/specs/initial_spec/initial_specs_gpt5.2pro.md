Below is a detailed, “build-from-this” plan for a **Pi extension** that enables a **Duolingo‑esque language-learning overlay** via **`/learn-dutch`**, which only becomes active **while the main agent is busy**. It’s **online‑first** (as you corrected) and can optionally use **the same model/provider/auth Pi is already using** (so no extra keys/subscriptions), while still supporting a **zero‑LLM** mode that stays “free” in the strict sense.

---

## What you’re building

### Core behavior (user-visible)

1. User types **`/learn-dutch`**.
2. This **enables “learn while waiting” mode** (and sets target language to Dutch).
3. Whenever the main agent is **busy** (processing a prompt / executing tools / streaming), a **top-right overlay** appears and starts asking:
   - flashcards
   - cloze (fill-the-blank)
   - multiple choice
   - short translation / production prompts

4. User answers in the overlay while waiting.
5. When the main agent becomes **idle**, overlay **auto-pauses or auto-hides** (configurable), saving progress to:
   - `~/.agents/pi-langlearn/...`

### Constraints you gave

- Overlay only active when main agent is busy.
- Uses **Pi’s extension system** and should look/feel like **pi-interactive-shell** (overlay lifecycle, non-blocking UI, focus handling, debounced rendering, widget updates).
- “Free”:
  - No paid language-learning app subscription.
  - Prefer open data and open tooling.
  - **Optional**: use the same LLM provider/auth Pi already uses (no new auth), and/or allow local models.

- Persist user progress and proficiency estimates in:
  - `~/.agents/pi-langlearn/`

- Track and adapt to user ability, guesstimate CEFR-ish level, and guide learning accordingly.

---

## Scientifically grounded learning approach (what the engine should do)

If you want “fast learning” with high ROI during short waiting windows, you want three things:

1. **Retrieval practice** (testing yourself, not rereading) — strong evidence for long-term retention. ([PubMed][1])
2. **Spaced repetition** (schedule reviews by forgetting curve) — strong evidence; also studied directly for second-language learning. ([PubMed][2])
3. **Adaptive difficulty** (“desirable difficulty”): keep success rate ~70–85% by adjusting prompt type, hints, and item selection.

So the overlay should be an **SRS-first** micro-tutor:

- Always prioritize **due reviews**
- Add a few **new items** when review queue is small
- Drill **weak subskills** (e.g., de/het, word order, separable verbs) based on your error patterns
- Keep each question short (5–25 seconds) so it fits in tool-wait gaps

---

## Architecture overview

Think of it as 5 subsystems:

1. **Busy detector**: knows when the main agent is busy vs idle.
2. **Overlay UI**: top-right TUI component, interactive, fast rendering.
3. **Learning engine**: picks next item, generates question, grades answer, updates SRS.
4. **Content pipeline**: supplies learning items from open sources + caching.
5. **Persistence**: stores profile + deck + logs in `~/.agents/pi-langlearn`.

### High-level diagram

```
Pi main session events
   │
   ├── agent_start / turn_start  ──► BusyDetector ──► OverlayController.show()
   │
   └── agent_end / idle          ──► BusyDetector ──► OverlayController.hide/pause()

OverlayController
   ├── OverlayComponent (TUI)
   │      ├── renders question, input, feedback
   │      └── calls LearningEngine.submitAnswer()
   │
   └── LearningEngine
          ├── Scheduler (SRS)
          ├── AbilityEstimator (CEFR-ish)
          ├── QuestionGenerator
          ├── Grader (heuristics + optional LLM)
          └── ContentSources (Tatoeba/Wiktionary/etc + cache)

Persistence layer
   └── ~/.agents/pi-langlearn/{config,profiles,caches,logs}
```

---

## Key Pi APIs you’ll rely on

### Extension lifecycle + busy detection

Pi extensions can subscribe to agent lifecycle events like `agent_start`, `agent_end`, `turn_start`, `turn_end`. ([Upd][3])

You also have helpers like `ctx.isIdle()` / `ctx.hasPendingMessages()` that can be used as a fallback check. ([Upd][3])

### Custom UI + TUI components

You can build interactive TUI components implementing `render(width)` + `handleInput(data)`, and mount them via `ctx.ui.custom(...)`. ([Upd][4])

The pi-interactive-shell extension shows the “right way” to:

- keep overlays non-blocking
- debounce rendering
- manage focus/escape keys
- keep one overlay open at a time

We’ll replicate those patterns.

### Using the same auth / provider Pi uses (no new keys)

You can spin up an **internal AgentSession** with the SDK and let it discover credentials/models from Pi’s standard locations. That gives you “use the same provider Pi uses” without you handling keys directly. ([Upd][5])

`discoverAuthStorage()` + `discoverModels()` and `createAgentSession()` are the key building blocks. ([Upd][5])

---

## Data layout in `~/.agents/pi-langlearn/`

This is intentionally **not** `~/.pi` and not session-scoped.

```
~/.agents/pi-langlearn/
  config.json
  profiles/
    default.json                  # general user prefs
    nl.json                       # Dutch profile (ability, deck, SRS)
  logs/
    nl-2026-02-05.jsonl           # append-only attempts log
  caches/
    tatoeba-nl-en.sqlite          # sentence pairs cache (optional)
    wiktionary.sqlite             # dictionary cache (optional)
  attribution/
    SOURCES.md                    # license/attribution notices
```

### Why an append-only log is worth it

Besides the “current profile state,” keep a **JSONL event log** of each attempt:

- you can recompute ability estimates later
- you can debug scheduling issues
- you can add better SRS (FSRS) later without losing history

Example log event (one line):

```json
{
  "ts": 1760000123456,
  "lang": "nl",
  "cardId": "tatoeba:123456",
  "qType": "cloze",
  "prompt": "Ik ___ naar huis.",
  "userAnswer": "ga",
  "correct": true,
  "latencyMs": 4120,
  "quality": 4,
  "tags": ["verb", "present", "A1"]
}
```

---

## Content sources (free + online-first)

### Primary free sources

1. **Tatoeba sentence pairs (nl↔en)**: excellent for Duolingo-like translation & cloze. Licensed CC BY 2.0 FR (with some CC0). ([tatoeba.org][6])
2. **Wiktionary**: useful for word gender (de/het), definitions, example sentences, morphology—licensed CC BY-SA/GFDL (requires attribution + share-alike). ([Wiktionary][7])
3. **Frequency lists**:
   - You can use something like `wordfreq` datasets (license is Apache for code + CC BY‑SA for included data). ([PyPI][8])
   - Or ship a small curated frequency list with attribution in `attribution/`.

### Online-first caching policy

- Fetch on demand, cache aggressively.
- If network fails, still run from cached items.
- If user wants strict free/no-LLM, they still get good drills from Tatoeba + simple grading.

---

## Learning engine design

### Core entities

**Card** (thing you’re learning)

```ts
type Card = {
  id: string; // stable: source + unique id
  lang: string; // "nl"
  type: "sentence" | "vocab" | "grammar";
  source: "tatoeba" | "wiktionary" | "llm" | "builtin";
  prompt: string; // canonical NL text
  answer: string | string[]; // canonical answer(s)
  translation?: string; // EN reference
  metadata: {
    difficulty?: number; // 0..1 internal
    tags?: string[]; // ["A1", "verb", "dehet"]
    authorAttribution?: string; // for CC BY
  };
};
```

**SRS state per card**

```ts
type SrsState = {
  dueAt: number; // epoch ms
  intervalDays: number;
  ease: number; // SM-2 style ease factor
  reps: number;
  lapses: number;
  lastReviewedAt?: number;
  lastQuality?: number; // 0..5
};
```

**Profile**

```ts
type Profile = {
  version: 1;
  lang: "nl";
  enabled: boolean;

  stats: {
    totalAttempts: number;
    correctAttempts: number;
    streakDays: number;
    lastActiveAt: number;
    avgLatencyMs7d?: number;
  };

  ability: {
    estimate: "A0" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "unknown";
    score: number; // 0..1 internal
    confidence: number; // 0..1
    subskills: Record<string, { score: number; samples: number }>;
    updatedAt: number;
  };

  deck: {
    knownCardIds: string[];
    srs: Record<string, SrsState>;
    suspendedCardIds?: string[];
  };

  settings: {
    mode: "strict-free" | "shared-llm" | "local-llm";
    dailyNewCardsTarget: number;
    overlayAutoHideOnIdle: boolean;
    maxOverlaySecondsAfterIdle: number; // allow “grace period”
  };
};
```

---

## SRS scheduling strategy

### MVP: SM-2-style scheduling

- It’s simple, proven, and adequate for a first iteration.
- Later you can upgrade to FSRS (more accurate, used by Anki ecosystem).

**Quality scoring**: convert user result into 0–5:

- 5: perfect, fast
- 4: correct but slow / minor typo
- 3: correct with hint
- 2: wrong but close
- 1: wrong
- 0: total blackout

**SM-2 update (pseudocode)**

```ts
function updateSm2(state: SrsState, quality: number, now: number): SrsState {
  const MIN_EASE = 1.3;

  let ease = state.ease ?? 2.5;
  let reps = state.reps ?? 0;
  let interval = state.intervalDays ?? 0;

  if (quality < 3) {
    reps = 0;
    interval = 1;
    ease = Math.max(MIN_EASE, ease - 0.2);
    return {
      ...state,
      reps,
      intervalDays: interval,
      ease,
      lapses: (state.lapses ?? 0) + 1,
      lastReviewedAt: now,
      dueAt: now + days(interval),
    };
  }

  // quality >= 3
  reps += 1;
  if (reps === 1) interval = 1;
  else if (reps === 2) interval = 6;
  else interval = Math.round(interval * ease);

  // SM-2 ease update
  ease = Math.max(MIN_EASE, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

  return {
    ...state,
    reps,
    intervalDays: interval,
    ease,
    lastReviewedAt: now,
    lastQuality: quality,
    dueAt: now + days(interval),
  };
}
```

### Selection strategy (what to ask next)

When overlay is active:

1. **Due cards** (sorted by overdue-ness)
2. If due queue small: mix in **new cards** (up to daily target)
3. Sprinkle **weak subskill drills** (e.g. if “articles” subskill is low)
4. Avoid repeating the same card too soon (short-term “cooldown”)

---

## Ability estimation (CEFR-ish)

You want something that:

- updates continuously
- doesn’t pretend to be an official CEFR test
- gives a useful “A1/A2/B1-ish” signal

### Practical approach

Maintain an internal score per subskill:

- vocab recognition
- vocab production
- sentence comprehension
- sentence production
- grammar: articles (de/het)
- grammar: verb forms
- word order

Update each subskill with an EWMA (exponentially weighted moving average) of correctness, optionally penalized for long latency.

Then map overall score to CEFR-ish bands with conservative confidence:

- `score < 0.15`: A0/A1
- `0.15–0.35`: A1/A2
- `0.35–0.55`: A2/B1
- `0.55–0.75`: B1/B2
- `0.75+`: B2/C1+

You can improve this by anchoring with frequency bands:

- track “mastery” of words/structures drawn from top frequency bins.
- if you’ve mastered many top-bin cards with production prompts, you’re probably past A1.

---

## Question types (Duolingo-esque in TUI)

Each `Card` can generate multiple `Question` formats depending on difficulty and mastery stage.

### Question object

```ts
type Question =
  | {
      type: "multiple_choice";
      prompt: string;
      options: string[];
      correctIndex: number;
    }
  | {
      type: "type_answer";
      prompt: string;
      answer: string | string[];
      hint?: string;
    }
  | { type: "cloze"; prompt: string; answer: string | string[] }
  | { type: "de_het"; noun: string; correct: "de" | "het" }
  | { type: "reorder"; tokens: string[]; correctSentence: string };
```

### Examples

**Multiple choice (early stage)**

- Prompt: `Wat betekent: "ik ben moe"?`
- Options: `["I am tired", "I am hungry", "I am late", "I am angry"]`

**Cloze**

- Prompt: `Morgen ___ ik naar Amsterdam.`
- Answer: `ga`

**Article drill**

- Prompt: `__ boek`
- Answer: `het`

**Typed translation**

- Prompt: `Translate to Dutch: "I don't understand."`
- Answer: `Ik begrijp het niet.`

---

## Grading answers (free vs LLM-augmented)

### Strict-free grading (no LLM calls)

Use layered heuristics:

1. Normalize (lowercase, trim, normalize punctuation)
2. Allow minor typos (Levenshtein distance threshold)
3. Allow known alternative forms (small synonyms list)
4. For sentence translation, accept “close enough” if key tokens match

This is imperfect, but works for many prompts.

### LLM grading (uses Pi’s configured auth/provider)

When enabled, ask the tutor session to return a JSON judgment:

- correct/incorrect
- normalized correction
- minimal explanation
- suggest next drill

This is where “same auth Pi uses” is huge: no new key flow, and it works across providers. ([Upd][5])

---

## Using Pi’s auth/provider for the tutor (recommended design)

### Why not inject into the main agent session?

You _could_ `pi.sendMessage()` into the main session, but that pollutes the coding conversation and competes with the coding task. Better: run a **separate in-memory AgentSession** as your “tutor brain”.

### Tutor session creation (pseudocode)

```ts
import {
  createAgentSession,
  SessionManager,
  discoverAuthStorage,
  discoverModels,
} from "@mariozechner/pi-coding-agent";

async function createTutorSession(modelHint?: any) {
  const authStorage = discoverAuthStorage();
  const modelRegistry = discoverModels(authStorage);

  // Prefer current Pi model if available; otherwise pick first available.
  const model = modelHint ?? (await modelRegistry.getAvailable())[0];

  const { session } = await createAgentSession({
    model,
    thinkingLevel: "off", // keep it cheap
    tools: [], // tutor shouldn't call bash/read/etc
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    systemPrompt: (defaultPrompt) => `
${defaultPrompt}

You are a language tutor. You MUST output strict JSON only.
No markdown. No prose outside JSON.
`,
  });

  return session;
}
```

The SDK docs describe `createAgentSession()`, `SessionManager.inMemory()`, prompt methods, and how it discovers auth/models from Pi’s standard directories (including `auth.json`). ([Upd][5])

### Tutor JSON contract

Example “generate next question” prompt:

```json
{
  "action": "generate_question",
  "target_lang": "nl",
  "user_level": "A2",
  "focus": ["articles", "present_tense"],
  "format": "cloze",
  "constraints": {
    "max_words": 10,
    "no_proper_nouns": true
  }
}
```

Tutor returns:

```json
{
  "question": {
    "type": "cloze",
    "prompt": "Ik ___ een appel.",
    "answer": ["eet", "koop"]
  },
  "explanation": "Use present tense with 'ik': eet/koop.",
  "tags": ["A1", "verb", "present"]
}
```

---

## Busy detection + overlay lifecycle

### Detecting “agent is busy”

Use events:

- `agent_start` → busy = true
- `agent_end` → busy = false
  These are part of the extension event system. ([Upd][3])

Optionally, reinforce with a timer check using `ctx.isIdle()` (in case of edge cases). ([Upd][3])

### Overlay behavior

- If learning mode enabled and busy becomes true:
  - show overlay
  - start question loop

- If busy becomes false:
  - auto-hide overlay (default)
  - or show “Paused (agent ready)” for a short grace period and auto-close

**Important detail** (pi-interactive-shell pattern):

- Only **one** overlay open at a time.
- Keep a global `overlayHandle` and `overlayOpen` flag.
- Use debounced render calls to avoid flicker.

---

## TUI overlay UX

### Layout (top-right box)

Suggested rendering:

```
┌───────────────────────────────┐
│ Dutch Drill   A2-ish   due:12 │
│ (agent busy — practicing)     │
├───────────────────────────────┤
│ Cloze:                        │
│ Ik ___ naar huis.             │
│                               │
│ Answer: [ga______________]    │
│                               │
│ Enter=submit  Tab=hint  Esc=× │
└───────────────────────────────┘
```

### Keybindings

- **Enter**: submit answer
- **Tab**: hint (reveal first letter / show word bank)
- **Ctrl+H**: show full answer (counts as low quality)
- **Esc**: close overlay (but leave learning enabled)
- **Ctrl+Shift+L** (optional): toggle learning enabled/disabled

Pi TUI docs emphasize `render(width)` width correctness and using key helpers / `matchesKey`. ([Upd][4])

### Widget above editor (like interactive-shell)

Even when overlay is hidden, show a tiny widget:

- `LangLearn: Dutch (A2-ish) • due 12 • streak 3d • /learn-dutch to toggle`

This mirrors how pi-interactive-shell keeps background state visible.

---

## Detailed module plan (file-by-file)

### `index.ts` (extension entrypoint)

Responsibilities:

- load config + profile from `~/.agents/pi-langlearn`
- register `/learn-dutch`
- register events for busy detection
- manage overlay controller
- register widget updates

Pseudocode skeleton:

```ts
export default function (pi: ExtensionAPI) {
  const controller = new LearningController();

  pi.on("session_start", async (_evt, ctx) => {
    if (!ctx.hasUI) return;
    await controller.loadAll();
    controller.renderWidget(ctx);
  });

  pi.on("session_shutdown", async (_evt, ctx) => {
    await controller.flush(); // atomic write
  });

  pi.on("agent_start", async (_evt, ctx) => {
    controller.setBusy(true);
    if (controller.isEnabled()) controller.ensureOverlayOpen(ctx);
  });

  pi.on("agent_end", async (_evt, ctx) => {
    controller.setBusy(false);
    controller.pauseOrCloseOverlay(ctx);
    controller.renderWidget(ctx);
    await controller.flushSoon(); // debounce disk writes
  });

  pi.registerCommand("learn-dutch", {
    description: "Toggle Dutch learning overlay while agent is busy",
    handler: async (_args, ctx) => {
      controller.toggle("nl");
      controller.renderWidget(ctx);
      if (controller.isEnabled() && controller.isBusy()) {
        controller.ensureOverlayOpen(ctx);
      } else {
        controller.pauseOrCloseOverlay(ctx);
      }
      ctx.ui.notify(
        controller.isEnabled() ? "Dutch learning enabled" : "Dutch learning disabled",
        "info",
      );
    },
  });

  pi.registerShortcut("ctrl+shift+l", {
    description: "Toggle language learning overlay",
    handler: async (ctx) => {
      controller.toggle("nl");
      controller.renderWidget(ctx);
    },
  });
}
```

### `LearningController`

Responsibilities:

- own the in-memory profile
- coordinate persistence
- coordinate overlay open/close
- own the “tutor session” instance (optional)
- expose `engine` to overlay

Key design borrowed from pi-interactive-shell:

- `onChange()` listeners (like ShellSessionManager) to update widget & overlay
- `overlayOpen` guard
- `debouncedRender()` helper
- clean up timers in `session_shutdown`

### `OverlayComponent`

Responsibilities:

- UI state machine: `ASKING → FEEDBACK → NEXT`
- input buffer and cursor
- render cached lines per width (performance)
- call `engine.nextQuestion()` and `engine.submitAnswer()`

Pseudo state machine:

```ts
class LangLearnOverlay implements Component {
  mode: "asking" | "feedback" | "loading" | "paused" = "loading";
  question?: Question;
  input = "";
  feedback?: { correct: boolean; message: string };

  constructor(
    private engine: LearningEngine,
    private handle: OverlayHandle,
  ) {}

  async start() {
    await this.loadNext();
  }

  async loadNext() {
    this.mode = "loading";
    this.handle.requestRender();
    this.question = await this.engine.nextQuestion();
    this.input = "";
    this.feedback = undefined;
    this.mode = "asking";
    this.handle.requestRender();
  }

  handleInput(data: string) {
    if (matchesKey(data, "escape")) {
      this.engine.onUserClosed();
      this.handle.close();
      return;
    }
    if (this.mode !== "asking") {
      if (matchesKey(data, "return")) this.loadNext();
      return;
    }

    if (matchesKey(data, "tab")) {
      this.engine.useHint(this.question);
      this.handle.requestRender();
      return;
    }
    if (matchesKey(data, "return")) {
      this.submit();
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.input = this.input.slice(0, -1);
      this.handle.requestRender();
      return;
    }

    // normal char input (filter control sequences)
    this.input += data;
    this.handle.requestRender();
  }

  async submit() {
    this.mode = "loading";
    this.handle.requestRender();
    const result = await this.engine.submitAnswer(this.question!, this.input);
    this.feedback = { correct: result.correct, message: result.explanation };
    this.mode = "feedback";
    this.handle.requestRender();
  }

  render(width: number): string[] {
    // return boxed lines, truncated to width
  }
}
```

### `LearningEngine`

Responsibilities:

- select due card / new card
- generate question
- grade answer
- update SRS
- update ability estimate
- append log event
- return feedback text

Pseudo:

```ts
class LearningEngine {
  constructor(
    private store: ProfileStore,
    private sources: ContentSources,
    private scheduler: Scheduler,
    private grader: Grader,
    private estimator: AbilityEstimator,
  ) {}

  async nextQuestion(): Promise<Question> {
    const card = await this.pickCard();
    return QuestionGenerator.fromCard(card, this.store.profile.ability);
  }

  async submitAnswer(q: Question, userAnswer: string): Promise<{correct:boolean; quality:number; explanation:string}> {
    const start = Date.now();
    const grade = await this.grader.grade(q, userAnswer);
    const latency = Date.now() - start;

    this.scheduler.update(q.cardId, grade.quality);
    this.estimator.updateFromAttempt({ ... });

    this.store.appendAttemptLog({ ... });

    return grade;
  }
}
```

---

## Making it “free” without sacrificing quality

You’ll support three modes in config:

### 1) `strict-free`

- No LLM calls.
- Uses Tatoeba + cached deck.
- Grading via heuristics.
- Always free (just internet + open data).
  Tatoeba licensing is clear and compatible with this approach. ([tatoeba.org][6])

### 2) `shared-llm` (your “same auth as Pi” mode)

- Use Pi’s configured provider/auth via SDK discovery.
- Tutor session generates and grades.
- Still “free” in the sense: **no new keys/subscriptions**, but it will consume tokens on whatever provider Pi is using. ([Upd][5])

### 3) `local-llm`

- If Pi is configured to use a local provider, great.
- Otherwise you can still keep it as future option.

---

## License + attribution hygiene (important)

If you cache or ship any dataset-derived content:

- Keep an `~/.agents/pi-langlearn/attribution/SOURCES.md`.
- Record source + license + attribution requirements.
- For Tatoeba, include attribution guidance (CC BY). ([tatoeba.org][6])
- For Wiktionary-derived data, honor CC BY‑SA/GFDL requirements. ([Wiktionary][7])
- If you incorporate wordfreq-derived lists, honor its license constraints. ([PyPI][8])

---

## Concrete development roadmap (MVP → v1)

### Phase 0 — Scaffold (1–2 sessions)

- Copy the structure style of pi-interactive-shell:
  - `index.ts`
  - `overlay-component.ts`
  - `config.ts`
  - `state-store.ts`
  - `debounced-render.ts`

- Implement directory creation and atomic JSON save in `~/.agents/pi-langlearn/`.
- Register `/learn-dutch` and a widget.

### Phase 1 — Busy-triggered overlay (MVP UI)

- Listen to `agent_start/agent_end`.
- When busy:
  - open overlay top-right (non-blocking)
  - show “Loading next card…”

- When idle:
  - close overlay or pause

- Add robust cleanup in `session_shutdown`. ([Upd][3])

### Phase 2 — Strict-free learning loop

- Add a tiny built-in starter deck (50–200 items) so it works instantly.
- Implement SM-2 SRS.
- Add question types: multiple choice + typed answer.
- Implement heuristic grading (typos, normalization).

### Phase 3 — Online-first content: Tatoeba integration

- Add Tatoeba fetcher:
  - pull sentence pairs at chosen difficulty
  - cache locally

- Generate cloze questions from sentences:
  - remove a frequent word or target tag

- Expand deck automatically.

### Phase 4 — Ability estimation + adaptivity

- Track subskills and update CEFR-ish estimate.
- Use that to:
  - choose question types (recognition → production)
  - choose sentence length
  - prioritize weak tags

### Phase 5 — Shared-auth tutor session (LLM augmentation)

- Build tutor session with `createAgentSession()` + in-memory session.
- Use it for:
  - tolerant grading
  - concise explanations
  - generating new minimal pairs / examples
    SDK and model/auth discovery behavior is documented. ([Upd][5])

### Phase 6 — Polishing like pi-interactive-shell

- debounced rendering
- cached render lines
- better focus behavior
- overlay options + resizing
- one-overlay guard + re-entrancy
- robust error states (“network down”, “no model configured”, etc.)

---

## Edge cases you should explicitly handle

1. **No UI context** (`ctx.hasUI === false`): do nothing. ([Upd][3])
2. **User closes overlay while busy**: don’t auto-reopen until next busy cycle (or until user re-enables).
3. **Agent becomes idle mid-question**:
   - default: auto-hide overlay + save attempt state
   - optional: show “Paused” for 10 seconds so user can finish

4. **Model not available in shared-llm mode**:
   - fallback to strict-free mode (and notify)

5. **Licensing**: store attribution info with cached items.

---

## Why this plan matches your “pi-interactive-shell style”

You’ll mirror these concrete patterns from that extension:

- **Non-blocking overlay**: open overlay UI without blocking main execution.
- **Global overlayOpen guard**: prevents multiple overlays and weird focus loops.
- **Debounced render requests**: avoids flicker and excessive redraw.
- **Manager + onChange** pattern: central controller emits changes → widget/overlay update.
- **Clean session_shutdown cleanup** (timers, open handles, flush state).

---

## Final notes on “free”

If you want **strict $0** even when Pi is configured with a paid provider:

- default mode can be `strict-free`
- user can opt-in to `shared-llm`
  If you want **best UX**, shared-llm grading/explanations will feel way more “Duolingo-like”, and it still uses “the same auth Pi uses” (no extra keys). ([Upd][5])

[1]: https://pubmed.ncbi.nlm.nih.gov/20951630/?utm_source=chatgpt.com "The critical role of retrieval practice in long-term retention"
[2]: https://pubmed.ncbi.nlm.nih.gov/16719566/?utm_source=chatgpt.com "Distributed practice in verbal recall tasks: A review and ..."
[3]: https://upd.dev/badlogic/pi-mono/src/commit/e3dd4f21d1593982e3786bf0d798b942656df8fe/packages/coding-agent/docs/extensions.md "https://upd.dev/badlogic/pi-mono/src/commit/e3dd4f21d1593982e3786bf0d798b942656df8fe/packages/coding-agent/docs/extensions.md"
[4]: https://upd.dev/badlogic/pi-mono/src/commit/84b663276d4e87178127ecdf9968434e9e7e18eb/packages/coding-agent/docs/tui.md "pi-mono/packages/coding-agent/docs/tui.md at 84b663276d4e87178127ecdf9968434e9e7e18eb - badlogic/pi-mono - upd.dev"
[5]: https://upd.dev/badlogic/pi-mono/src/commit/cb3ac0ba9e82ba06ca309f7da4fef7e68bf9ef00/packages/coding-agent/docs/sdk.md "pi-mono/packages/coding-agent/docs/sdk.md at cb3ac0ba9e82ba06ca309f7da4fef7e68bf9ef00 - badlogic/pi-mono - upd.dev"
[6]: https://tatoeba.org/en/downloads?utm_source=chatgpt.com "Download sentences"
[7]: https://en.wiktionary.org/wiki/Wiktionary%3ACopyrights?utm_source=chatgpt.com "Wiktionary:Copyrights"
[8]: https://pypi.org/project/wordfreq/?utm_source=chatgpt.com "wordfreq"
