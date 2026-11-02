import { buildPreview, defaultEntry, formatCheck, PREVIEW_CHANNEL } from "./sandbox";
import type { PreviewFiles } from "./sandbox";

/** Runs a page in a hidden, isolated iframe for a moment and reports console errors. Never runs without the caller asking. */
export async function checkPage(files: PreviewFiles, focus: string, settleMs = 1500): Promise<string> {
  const entry = defaultEntry(Object.keys(files), focus);
  if (!entry) return "No HTML page to run yet.";
  const build = buildPreview(files, entry);
  const lines: { level: string; text: string }[] = [];
  const frame = document.createElement("iframe");
  // No allow-same-origin or allow-modals: isolated from the app, and alert() cannot stall the check.
  frame.setAttribute("sandbox", "allow-scripts allow-forms");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // Kept inside the viewport so the browser does not throttle its timers like an off-screen frame.
  frame.style.cssText = "position:fixed;left:0;top:0;width:390px;height:700px;border:0;opacity:0;pointer-events:none;z-index:-1";
  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (event.source !== frame.contentWindow || !data || typeof data !== "object") return;
    const message = data as { channel?: unknown; type?: unknown; level?: unknown; text?: unknown };
    if (message.channel === PREVIEW_CHANNEL && message.type === "log" && typeof message.text === "string")
      lines.push({ level: String(message.level), text: message.text.slice(0, 200) });
  };
  window.addEventListener("message", onMessage);
  frame.srcdoc = build.frame;
  document.body.append(frame);
  try {
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  } finally {
    window.removeEventListener("message", onMessage);
    frame.remove();
  }
  return formatCheck(entry, lines, build);
}
