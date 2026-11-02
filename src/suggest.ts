export const SUGGEST_INSTRUCTION =
  "You are a code completion engine inside an editor. Continue the code at <CURSOR>. Output only the text to insert at the cursor: no explanations, no code fences, and never repeat text that already appears before or after the cursor. Keep it short: finish the current statement or write the next few lines. If nothing useful can be added, output nothing.";

const BEFORE_CHARS = 1200;
const AFTER_CHARS = 300;
const MAX_LINES = 8;
const MAX_CHARS = 400;

/** The user message for one completion request, with bounded context on each side of the cursor. */
export function suggestionPrompt(path: string, before: string, after: string): string {
  const head = before.length > BEFORE_CHARS ? before.slice(before.indexOf("\n", before.length - BEFORE_CHARS) + 1 || before.length - BEFORE_CHARS) : before;
  return `File: ${path}\n${head}<CURSOR>${after.slice(0, AFTER_CHARS)}`;
}

/** Turns raw model output into text that is safe to show as ghost text; empty means "no suggestion". */
export function cleanSuggestion(raw: string, before: string, after: string): string {
  let text = raw.replace(/\r\n/g, "\n").replaceAll("<CURSOR>", "");
  // Drop an opening fence and everything from the closing fence on (explanations often follow it).
  if (/^\s*```/.test(text)) text = text.replace(/^\s*```[^\n]*\n?/, "").replace(/\n?```[\s\S]*$/, "");
  text = text.replace(/^\n+/, "").trimEnd();
  if (!text.trim()) return "";
  // A model often restates the line it is continuing; drop the part already in the file.
  for (let size = Math.min(text.length, before.length, 120); size >= 3; size--) {
    if (before.endsWith(text.slice(0, size))) { text = text.slice(size); break; }
  }
  // ...or runs on into text that already follows the cursor.
  const following = after.split("\n").map((line) => line.trim()).filter(Boolean);
  const next = after.split("\n")[0].trim();
  if (next.length > 2) {
    const at = text.indexOf(next);
    if (at >= 0) text = text.slice(0, at);
  }
  let lines = text.split("\n");
  for (const line of following) {
    if (lines.length > 1 && lines.at(-1)!.trim() === line) lines = lines.slice(0, -1);
    else break;
  }
  text = lines.join("\n");
  if (lines.length > MAX_LINES) text = lines.slice(0, MAX_LINES).join("\n");
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);
  return text.trim() ? text.trimEnd() : "";
}
