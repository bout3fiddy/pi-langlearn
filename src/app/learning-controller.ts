import type { Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, type TUI } from "@mariozechner/pi-tui";
import { ensureConfigFile, loadConfig } from "../core/config.js";
import { LearningEngine } from "../core/learning-engine.js";
import { LangLearnOverlay, type OverlayResult } from "../ui/overlay-component.js";
import { ProfileStore } from "../core/state-store.js";
import { ContentStore } from "../content/content-store.js";
import { DEFAULT_LANGUAGE, getLanguageLabel, type LanguageDefinition } from "../languages/index.js";

export class LearningController {
  private store: ProfileStore | null = null;
  private engine: LearningEngine | null = null;
  private contentStore: ContentStore | null = null;
  private overlayOpen = false;
  private overlaySuppressed = false;
  private overlayRef: LangLearnOverlay | null = null;
  private busy = false;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private widgetTui: { requestRender: () => void } | null = null;
  private config = loadConfig();
  private language: LanguageDefinition = DEFAULT_LANGUAGE;

  loadAll(): void {
    ensureConfigFile();
    this.config = loadConfig();
    this.setLanguage(DEFAULT_LANGUAGE);
  }

  getEngine(): LearningEngine {
    if (!this.engine) throw new Error("Learning engine not initialized.");
    return this.engine;
  }

  getProfileEnabled(): boolean {
    return Boolean(this.store?.profile.enabled);
  }

  isBusy(): boolean {
    return this.busy;
  }

  setBusy(isBusy: boolean, ctx: any): void {
    this.busy = isBusy;
    if (isBusy) {
      this.clearIdleTimer();
      if (this.getProfileEnabled() && !this.overlayOpen && !this.overlaySuppressed) {
        this.ensureOverlayOpen(ctx);
      }
      if (this.overlayRef) {
        this.overlayRef.setBusy(true);
        this.overlayRef.resume();
      }
    } else {
      this.overlaySuppressed = false;
      if (this.overlayRef) this.overlayRef.setBusy(false);
      this.pauseOrCloseOverlay();
    }
    this.requestWidgetRender();
  }

  enableLanguage(language: LanguageDefinition): {
    enabled: boolean;
    switched: boolean;
    language: LanguageDefinition;
  } {
    if (!this.store) this.loadAll();
    if (!this.store) throw new Error("Profile store not initialized.");
    let switched = false;
    if (language.code !== this.language.code) {
      this.overlaySuppressed = false;
      this.pauseOrCloseOverlay(true);
      this.setLanguage(language);
      switched = true;
    }
    this.store.profile.enabled = true;
    this.store.saveSoon();
    this.requestWidgetRender();
    if (switched) this.refreshContent();
    return { enabled: this.store.profile.enabled, switched, language: this.language };
  }

  setEnabled(enabled: boolean): boolean {
    if (!this.store) this.loadAll();
    if (!this.store) throw new Error("Profile store not initialized.");
    this.store.profile.enabled = enabled;
    this.store.saveSoon();
    this.requestWidgetRender();
    return this.store.profile.enabled;
  }

  toggleEnabled(): boolean {
    if (!this.store) this.loadAll();
    if (!this.store) throw new Error("Profile store not initialized.");
    this.store.profile.enabled = !this.store.profile.enabled;
    this.store.saveSoon();
    this.requestWidgetRender();
    return this.store.profile.enabled;
  }

  ensureOverlayOpen(ctx: any): void {
    if (!ctx.hasUI || this.overlayOpen) return;
    if (!this.getProfileEnabled()) return;
    const engine = this.getEngine();
    const config = this.config;

    this.overlayOpen = true;
    const overlayPromise: Promise<OverlayResult> = ctx.ui.custom(
      (tui: TUI, theme: Theme, _kb: unknown, done: (result: OverlayResult) => void) => {
        const overlay = new LangLearnOverlay(tui, theme, engine, (result) => done(result), {
          maxHeightPercent: config.overlayHeightPercent,
          margin: config.overlayMargin,
        });
        overlay.setBusy(this.busy);
        overlay.start();
        this.overlayRef = overlay;
        return overlay;
      },
      {
        overlay: true,
        overlayOptions: {
          width: `${config.overlayWidthPercent}%`,
          maxHeight: `${config.overlayHeightPercent}%`,
          anchor: config.overlayAnchor,
          margin: config.overlayMargin,
        },
      },
    );

    overlayPromise
      .then((result) => {
        if (result?.closedByUser) {
          this.overlaySuppressed = true;
        }
      })
      .finally(() => {
        this.clearIdleTimer();
        this.overlayOpen = false;
        this.overlayRef = null;
        this.requestWidgetRender();
      });
  }

  pauseOrCloseOverlay(forceClose = false): void {
    const overlay = this.overlayRef;
    const profile = this.store?.profile;
    if (!overlay || !profile) return;
    if (forceClose) {
      overlay.close(false);
      return;
    }
    if (!profile.settings.overlayAutoHideOnIdle) {
      overlay.pause("Agent ready");
      return;
    }
    const seconds = profile.settings.maxOverlaySecondsAfterIdle;
    overlay.pause("Agent ready");
    if (seconds <= 0) {
      overlay.close(false);
      return;
    }
    this.clearIdleTimer();
    this.idleCloseTimer = setTimeout(() => {
      this.idleCloseTimer = null;
      overlay.close(false);
    }, seconds * 1000);
  }

  resumeOverlay(): void {
    this.clearIdleTimer();
    this.overlayRef?.resume();
  }

  attachWidget(ctx: any): void {
    if (!ctx.hasUI) return;
    const config = this.config;
    ctx.ui.setWidget(
      "langlearn-status",
      (tui: any, theme: Theme) => {
        this.widgetTui = tui;
        return {
          render: (width: number) => this.renderWidget(width, theme),
          invalidate: () => {},
        };
      },
      { placement: config.widgetPlacement },
    );
  }

  refreshContent(): void {
    if (!this.contentStore || !this.engine) return;
    void this.contentStore
      .refreshTatoeba()
      .then((result) => {
        if (result.added > 0) {
          this.engine?.setDeck(this.contentStore!.getDeck());
        }
        this.requestWidgetRender();
      })
      .catch(() => {
        // Ignore network errors; keep strict-free deck.
      });
  }

  renderWidget(width: number, theme: Theme): string[] {
    const engine = this.engine;
    if (!engine) return [];
    const status = engine.getStatus();
    const level =
      status.ability.estimate === "unknown" ? "A0-ish" : `${status.ability.estimate}-ish`;
    const streak = `streak ${status.streakDays}d`;
    const languageLabel = getLanguageLabel(status.lang);
    const commandLang = this.language.aliases[0] ?? this.language.name.toLowerCase();
    const command = status.enabled ? "/langlearn off" : `/langlearn ${commandLang}`;
    const busy = this.busy ? "busy" : "idle";

    const stateLabel = status.enabled ? "LangLearn Enabled" : "LangLearn Disabled";
    const languageBlock = `Language (${languageLabel})`;
    const text = `${stateLabel}: ${languageBlock} ${level} | ${streak} | ${busy} | ${command}`;
    const line = truncateToWidth(text, width, "...");
    return [theme.fg("dim", line)];
  }

  flush(): void {
    this.clearIdleTimer();
    this.store?.flush();
    this.store?.dispose();
  }

  private requestWidgetRender(): void {
    this.widgetTui?.requestRender();
  }

  private setLanguage(language: LanguageDefinition): void {
    if (this.language.code === language.code && this.store && this.engine && this.contentStore) {
      return;
    }
    this.store?.flush();
    this.store?.dispose();
    this.language = language;
    this.store = new ProfileStore(language.code);
    this.contentStore = new ContentStore(language);
    this.engine = new LearningEngine(this.store, this.contentStore.getDeck(), () =>
      this.requestWidgetRender(),
    );
  }

  private clearIdleTimer(): void {
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
  }
}
