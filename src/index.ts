import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { LearningController } from "./app/learning-controller.js";
import { listLanguages, resolveLanguage } from "./languages/index.js";

export default function (pi: ExtensionAPI): void {
  const controller = new LearningController();
  controller.loadAll();

  pi.on("session_start", (_event: unknown, ctx: any) => {
    if (!ctx.hasUI) return;
    controller.attachWidget(ctx);
    controller.refreshContent();
  });

  pi.on("session_shutdown", async (_event: unknown, _ctx: unknown) => {
    controller.flush();
  });

  pi.on("agent_start", (_event: unknown, ctx: any) => {
    if (!ctx.hasUI) return;
    controller.setBusy(true, ctx);
  });

  pi.on("agent_end", (_event: unknown, ctx: any) => {
    if (!ctx.hasUI) return;
    controller.setBusy(false, ctx);
  });

  pi.registerCommand("langlearn", {
    description:
      "Enable language learning or turn it off. Usage: /langlearn <language-name> | /langlearn off",
    handler: async (args: unknown, ctx: any) => {
      const parsedArgs = parseArgs(args);
      const langArg = parsedArgs[0]?.trim().toLowerCase();
      if (!langArg) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /langlearn <language-name> or /langlearn off", "info");
        }
        return;
      }
      if (langArg === "off") {
        const enabled = controller.setEnabled(false);
        controller.pauseOrCloseOverlay(true);
        if (ctx.hasUI) {
          ctx.ui.notify(
            enabled ? "Language learning enabled" : "Language learning disabled",
            "info",
          );
        }
        return;
      }
      const language = resolveLanguage(langArg);
      if (!language) {
        const available = listLanguages()
          .map((entry) => entry.name.toLowerCase())
          .join(", ");
        if (ctx.hasUI) {
          ctx.ui.notify(`Unknown language "${langArg}". Available: ${available}`, "error");
        }
        return;
      }
      const result = controller.enableLanguage(language);
      if (controller.isBusy()) {
        controller.ensureOverlayOpen(ctx);
      }
      if (ctx.hasUI) {
        const name = result.language.name;
        const message = result.switched
          ? `Language learning enabled for ${name}`
          : `${name} learning enabled`;
        ctx.ui.notify(message, "info");
      }
    },
  });
}

function parseArgs(args: unknown): string[] {
  if (Array.isArray(args)) return args.map((value) => String(value));
  if (typeof args === "string") return args.split(/\s+/).filter(Boolean);
  if (args && typeof args === "object") {
    const maybeArgs = (args as { args?: unknown }).args;
    if (Array.isArray(maybeArgs)) return maybeArgs.map((value) => String(value));
    if (typeof maybeArgs === "string") return maybeArgs.split(/\s+/).filter(Boolean);
  }
  return [];
}
