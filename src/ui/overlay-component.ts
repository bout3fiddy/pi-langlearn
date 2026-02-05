import type { Component, Focusable, TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { GradeResult, Question } from "../core/types.js";
import type { LearningEngine } from "../core/learning-engine.js";
import { createDebouncedRender } from "./debounced-render.js";
import { getLanguageLabel } from "../languages/index.js";

export interface OverlayResult {
  closedByUser: boolean;
}

type Mode = "loading" | "asking" | "checking" | "feedback" | "paused";

export class LangLearnOverlay implements Component, Focusable {
  focused = false;

  private tui: TUI;
  private theme: Theme;
  private engine: LearningEngine;
  private done: (result: OverlayResult) => void;
  private mode: Mode = "loading";
  private question: Question | null = null;
  private input = "";
  private feedback: GradeResult | null = null;
  private hintUsed = false;
  private hintText: string | null = null;
  private pausedReason = "";
  private busy = false;
  private questionStartedAt = 0;
  private pausedAt: number | null = null;
  private debounced: ReturnType<typeof createDebouncedRender>;
  private closed = false;
  private checkingFrame = 0;
  private checkingTimer: ReturnType<typeof setInterval> | null = null;
  private maxHeightPercent: number | null;
  private overlayMargin: number;

  constructor(
    tui: TUI,
    theme: Theme,
    engine: LearningEngine,
    done: (result: OverlayResult) => void,
    layout?: { maxHeightPercent?: number; margin?: number },
  ) {
    this.tui = tui;
    this.theme = theme;
    this.engine = engine;
    this.done = done;
    this.maxHeightPercent = layout?.maxHeightPercent ?? null;
    this.overlayMargin = layout?.margin ?? 0;
    this.debounced = createDebouncedRender(() => this.tui.requestRender(), 60);
  }

  start(): void {
    this.loadNext();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.requestRender();
  }

  pause(reason: string): void {
    this.stopCheckingAnimation();
    this.mode = "paused";
    this.pausedReason = reason;
    this.pausedAt = Date.now();
    this.requestRender();
  }

  resume(): void {
    if (this.mode === "paused") {
      if (this.pausedAt) {
        this.questionStartedAt += Date.now() - this.pausedAt;
        this.pausedAt = null;
      }
      this.mode = "asking";
      this.requestRender();
    }
  }

  close(closedByUser: boolean): void {
    if (this.closed) return;
    this.closed = true;
    this.stopCheckingAnimation();
    this.debounced.dispose();
    this.done({ closedByUser });
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.close(true);
      return;
    }

    if (this.mode === "paused") {
      if (matchesKey(data, "return") || matchesKey(data, "enter")) {
        this.resume();
      }
      return;
    }

    if (this.mode === "feedback") {
      if (matchesKey(data, "return") || matchesKey(data, "enter")) {
        this.loadNext();
      }
      return;
    }

    if (this.mode === "checking") {
      return;
    }

    if (this.mode !== "asking" || !this.question) return;

    if (matchesKey(data, "tab")) {
      this.hintUsed = true;
      this.hintText = this.engine.getHint(this.question);
      this.requestRender();
      return;
    }

    if (matchesKey(data, "ctrl+h")) {
      this.hintUsed = true;
      const reveal = getRevealAnswer(this.question);
      if (reveal && this.question.type !== "multiple_choice") {
        this.input = reveal;
      }
      this.requestRender();
      return;
    }

    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      void this.submit();
      return;
    }

    if (matchesKey(data, "backspace")) {
      this.input = this.input.slice(0, -1);
      this.requestRender();
      return;
    }

    if (isPrintableInput(data)) {
      this.input += data;
      this.requestRender();
    }
  }

  render(width: number): string[] {
    const border = (s: string) => this.theme.fg("border", s);
    const accent = (s: string) => this.theme.fg("accent", s);
    const dim = (s: string) => this.theme.fg("dim", s);
    // Keep accessors for theming consistent with Pi TUI themes.

    const innerWidth = Math.max(10, width - 4);
    const pad = (s: string, w: number) => {
      const vis = visibleWidth(s);
      return s + " ".repeat(Math.max(0, w - vis));
    };
    const row = (content: string) => border("│ ") + pad(content, innerWidth) + border(" │");

    const lines: string[] = [];
    lines.push(border("╭" + "─".repeat(width - 2) + "╮"));

    const status = this.engine.getStatus();
    const level =
      status.ability.estimate === "unknown" ? "A0-ish" : `${status.ability.estimate}-ish`;
    const elo = Math.round(400 + 600 * status.ability.score);
    const languageLabel = getLanguageLabel(status.lang);
    const headerLeft = `${languageLabel} Drill ${level} ELO ${elo}`;
    const header = headerLeft;
    lines.push(row(accent(truncateToWidth(header, innerWidth, "..."))));

    const busyLabel = this.busy ? "agent busy" : "agent idle";
    const modeLabel =
      this.mode === "paused"
        ? "paused"
        : this.mode === "checking"
          ? "checking"
          : this.mode === "feedback"
            ? "review"
            : "practicing";
    lines.push(row(dim(truncateToWidth(`${busyLabel} - ${modeLabel}`, innerWidth, "..."))));
    lines.push(border("├" + "─".repeat(width - 2) + "┤"));

    const footerLines = this.renderFooter(innerWidth);
    const maxBodyLines = this.getMaxBodyLines(footerLines.length);
    const bodyLines = this.renderBody(innerWidth, maxBodyLines);
    for (const line of bodyLines) lines.push(row(line));

    lines.push(border("├" + "─".repeat(width - 2) + "┤"));
    for (const line of footerLines) lines.push(row(line));
    lines.push(border("╰" + "─".repeat(width - 2) + "╯"));
    return lines;
  }

  invalidate(): void {
    // No cached layout yet.
  }

  dispose(): void {
    this.stopCheckingAnimation();
    this.debounced.dispose();
  }

  private renderBody(innerWidth: number, maxBodyLines: number | null): string[] {
    if (this.mode === "loading") {
      return wrapText("Loading next card...", innerWidth);
    }
    if (this.mode === "paused") {
      const reason = this.pausedReason || "Paused";
      return wrapText(`${reason}. Press Enter to resume.`, innerWidth);
    }
    if (!this.question) return wrapText("No question available.", innerWidth);

    const lines: string[] = [];
    lines.push(...this.renderPrompt(this.question, innerWidth));
    if (this.question.type === "multiple_choice") {
      const labels = ["A", "B", "C", "D"];
      for (let i = 0; i < this.question.options.length; i += 1) {
        const option = this.question.options[i] ?? "";
        const label = labels[i] ?? String(i + 1);
        lines.push(...wrapText(`${label}) ${option}`, innerWidth));
      }
    }

    lines.push("");
    const inputLine = this.renderInputLine(innerWidth);
    const inputIndex = lines.length;
    lines.push(inputLine);

    if (this.hintText) {
      lines.push(...wrapText(`Hint: ${this.hintText}`, innerWidth));
    }

    let anchorIndex = inputIndex;

    if (this.mode === "checking") {
      lines.push("");
      const dots = ".".repeat((this.checkingFrame % 3) + 1);
      const checkingLines = wrapText(`Checking${dots}`, innerWidth);
      anchorIndex = lines.length + checkingLines.length - 1;
      lines.push(...checkingLines);
    }

    if (this.mode === "feedback" && this.feedback) {
      const message = this.feedback.correct
        ? `Correct. ${this.feedback.explanation}`
        : this.feedback.explanation;
      lines.push("");
      const feedbackLines = wrapText(message, innerWidth);
      anchorIndex = lines.length + feedbackLines.length - 1;
      lines.push(...feedbackLines);
    }

    if (maxBodyLines) {
      return fitBodyLines(lines, maxBodyLines, anchorIndex);
    }

    return lines;
  }

  private renderInputLine(innerWidth: number): string {
    const label = "Answer: ";
    const available = Math.max(0, innerWidth - visibleWidth(label) - 2);
    const input = this.input.length > available ? this.input.slice(-available) : this.input;
    const padded = input + " ".repeat(Math.max(0, available - visibleWidth(input)));
    return `${label}[${padded}]`;
  }

  private renderFooter(innerWidth: number): string[] {
    const parts: string[] = [];
    if (this.mode === "paused") {
      parts.push("Enter=resume");
    } else if (this.mode === "feedback") {
      parts.push("Enter=next");
    } else if (this.mode === "checking") {
      parts.push("Checking...");
    } else {
      parts.push("Enter=submit");
    }
    parts.push("Tab=hint");
    parts.push("Ctrl+H=show answer");
    parts.push("Esc=close");
    const line = parts.join("  ");
    return wrapText(line, innerWidth);
  }

  private renderPrompt(question: Question, innerWidth: number): string[] {
    switch (question.type) {
      case "de_het":
        return wrapText(`Article: __ ${question.noun}`, innerWidth);
      case "reorder": {
        const tokens = question.tokens.join(" | ");
        return [...wrapText("Reorder the tokens:", innerWidth), ...wrapText(tokens, innerWidth)];
      }
      case "cloze": {
        const lines = wrapText(question.prompt, innerWidth);
        const translation = question.meta?.sourceTranslation;
        if (translation) {
          lines.push(...wrapText(`Context: ${translation}`, innerWidth));
        }
        return lines;
      }
      default:
        return wrapText(question.prompt, innerWidth);
    }
  }

  private loadNext(): void {
    this.mode = "loading";
    this.stopCheckingAnimation();
    this.requestRender();
    this.question = this.engine.nextQuestion();
    this.input = "";
    this.feedback = null;
    this.hintUsed = false;
    this.hintText = null;
    this.questionStartedAt = Date.now();
    this.mode = "asking";
    this.requestRender();
  }

  private async submit(): Promise<void> {
    if (!this.question) return;
    this.mode = "checking";
    this.startCheckingAnimation();
    this.requestRender();
    const latencyMs = Math.max(0, Date.now() - this.questionStartedAt);
    try {
      this.feedback = await this.engine.submitAnswer(
        this.question,
        this.input,
        latencyMs,
        this.hintUsed,
      );
    } finally {
      this.stopCheckingAnimation();
    }
    this.mode = "feedback";
    this.requestRender();
  }

  private getMaxBodyLines(footerLineCount: number): number | null {
    if (!this.maxHeightPercent) return null;
    const rows = this.tui.terminal?.rows ?? 0;
    if (!rows) return null;
    const maxHeight = Math.floor((rows * this.maxHeightPercent) / 100);
    const marginRows = this.overlayMargin > 0 ? this.overlayMargin * 2 : 0;
    const reserved = footerLineCount + 6;
    const available = maxHeight - marginRows - reserved;
    return available > 0 ? available : 1;
  }

  private startCheckingAnimation(): void {
    if (this.checkingTimer) return;
    this.checkingFrame = 0;
    this.checkingTimer = setInterval(() => {
      this.checkingFrame = (this.checkingFrame + 1) % 3;
      this.requestRender();
    }, 250);
  }

  private stopCheckingAnimation(): void {
    if (!this.checkingTimer) return;
    clearInterval(this.checkingTimer);
    this.checkingTimer = null;
  }

  private requestRender(): void {
    this.debounced.request();
  }
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (visibleWidth(next) <= width) {
      current = next;
    } else {
      if (current) lines.push(truncateToWidth(current, width, "..."));
      current = word;
    }
  }
  if (current) lines.push(truncateToWidth(current, width, "..."));
  if (lines.length === 0) lines.push("");
  return lines;
}

function fitBodyLines(lines: string[], maxLines: number, anchorIndex: number): string[] {
  if (maxLines <= 0) return [];
  if (lines.length <= maxLines) return lines;
  const safeAnchor = Math.min(Math.max(anchorIndex, 0), lines.length - 1);
  let start = Math.max(0, safeAnchor - Math.floor(maxLines / 2));
  let end = start + maxLines;
  if (end > lines.length) {
    end = lines.length;
    start = Math.max(0, end - maxLines);
  }
  return lines.slice(start, end);
}

function isPrintableInput(data: string): boolean {
  if (!data) return false;
  if (data.length === 1) {
    const code = data.charCodeAt(0);
    return code >= 32 && code !== 127;
  }
  return false;
}

function getRevealAnswer(question: Question): string | null {
  switch (question.type) {
    case "multiple_choice":
      return null;
    case "de_het":
      return question.correct;
    case "reorder":
      return question.correctSentence;
    case "type_answer":
    case "cloze": {
      const answer = Array.isArray(question.answer) ? question.answer[0] : question.answer;
      return answer ? String(answer) : null;
    }
    default:
      return null;
  }
}
