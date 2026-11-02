export type Command =
  | { type: "help" }
  | { type: "run"; path: string }
  | { type: "open"; slug: string; branch: string }
  | { type: "files"; filter: string }
  | { type: "read"; path: string }
  | {
      type: "new";
      path: string;
      description: string;
      // error: explicit /new; open: a named file; fresh: "a new readme" never touches existing files.
      onExists: "error" | "open" | "fresh";
    }
  | { type: "publish"; branch: string; message: string }
  | { type: "issues" }
  | { type: "issue"; number: number }
  | { type: "pr"; title: string }
  | { type: "review"; number: number }
  | { type: "assist"; kind: "explain" | "fix" | "doc" | "tests"; extra: string };

/** What each Copilot-style shortcut asks for: a chat request in a mode, or an Agent mode goal. */
export function assistPlan(kind: "explain" | "fix" | "doc" | "tests", extra: string, path: string):
  { mode: "explain" | "edit"; request: string } | { goal: string } {
  const tail = extra.trim() ? ` ${extra.trim()}` : "";
  if (kind === "explain") return { mode: "explain", request: `Explain the selected code (or this file) clearly and briefly.${tail}` };
  if (kind === "fix") return { mode: "edit", request: `Find and fix bugs in the selected code (or this file). Make the smallest change that fixes them.${tail}` };
  if (kind === "doc") return { mode: "edit", request: `Add concise documentation comments to the selected code (or this file) without changing its behavior.${tail}` };
  return { goal: `Write unit tests for ${path} in a new test file next to it, following the project's existing test style if there is one.${tail}`.slice(0, 1900) };
}

/** "@workspace where is auth handled?" asks a question about the whole project instead of only the open file. */
export function splitWorkspaceMention(text: string): { mentioned: boolean; question: string } {
  const match = /^\s*@workspace\b[:,]?\s*/i.exec(text);
  return match ? { mentioned: true, question: text.slice(match[0].length).trim() } : { mentioned: false, question: text.trim() };
}

export const HELP = [
  "The assistant model cannot reach GitHub itself; this app does it for you. Commands:",
  "/open owner/repo [branch]  connect to a repository (or paste a github.com link after 'open')",
  "/files [text]  list files in the connected repository",
  "/read path  open a file in the editor, then use Explain or Edit",
  "/new [path]  create a new file (e.g. /new src/util.ts), then use Edit to have the assistant write it",
  "/publish [branch] [message]  commit all local changes to a NEW branch (asks you to confirm first)",
  "/issues  list open issues in the connected repository (needs a token for private repositories)",
  "/issue N  load issue N as the Agent mode goal; turn on Agent mode and press Start",
  "/pr [title]  open a pull request from the branch you just published (needs a token with Pull requests write)",
  "/review N  review pull request N locally in chunks; you confirm before anything is posted to GitHub",
  "/explain, /fix, /doc  act on the selected code (or the open file): explain it, fix bugs, or add documentation comments (the last two stage a diff to review)",
  "/tests  load \"write unit tests for this file\" as the Agent mode goal",
  "@workspace <question>  ask about the whole project: searches open files and repository paths (and GitHub code search with a token) for context",
  "/run [page.html]  preview and serve a web app (HTML/CSS/JavaScript) from your workspace in an isolated in-browser sandbox",
].join("\n");

const GITHUB_URL =
  /https?:\/\/github\.com\/([\w-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^\s?#]+))?(?:[/?#]\S*)?(?=\s|$)/i;

export function parseCommand(text: string): Command | null {
  const trimmed = text.trim();
  const slash = /^\/(\w+)\s*([\s\S]*)$/.exec(trimmed);
  if (slash) {
    const argument = slash[2].trim();
    switch (slash[1].toLowerCase()) {
      case "help":
        return { type: "help" };
      case "open":
      case "connect": {
        const [slug = "", branch = ""] = argument.split(/\s+/);
        return slug ? { type: "open", slug, branch } : { type: "help" };
      }
      case "files":
        return { type: "files", filter: argument };
      case "issues":
        return { type: "issues" };
      case "issue": {
        const number = /^#?(\d{1,7})$/.exec(argument);
        return number ? { type: "issue", number: Number(number[1]) } : { type: "help" };
      }
      case "explain":
      case "fix":
      case "doc":
      case "tests":
        return { type: "assist", kind: slash[1].toLowerCase() as "explain" | "fix" | "doc" | "tests", extra: argument };
      case "pr":
        return { type: "pr", title: argument };
      case "review": {
        const number = /^(?:pr\s*)?#?(\d{1,7})$/i.exec(argument);
        return number ? { type: "review", number: Number(number[1]) } : { type: "help" };
      }
      case "run":
      case "preview":
      case "launch":
      case "serve":
        return { type: "run", path: argument };
      case "read":
        return argument ? { type: "read", path: argument } : { type: "help" };
      case "new": {
        const [path = "", ...rest] = argument.split(/\s+/).filter(Boolean);
        return {
          type: "new",
          path,
          description: rest.join(" "),
          onExists: "error",
        };
      }
      case "publish": {
        const [branch = "", ...rest] = argument.split(/\s+/).filter(Boolean);
        return { type: "publish", branch, message: rest.join(" ") };
      }
      default:
        return null;
    }
  }
  // Must start with the verb and name the thing to run, so "how do I run the app" or "run the tests" reach the model.
  if (/^(?:please\s+)?(?:run|launch|preview|serve|start)\s+(?:the\s+|my\s+|this\s+)?(?:web\s*)?(?:app(?:lication)?|site|page|website|preview)\b/i.test(trimmed))
    return { type: "run", path: "" };
  // Must start with the verb so questions like "how do I publish..." still reach the model.
  const reviewing = /^(?:please\s+)?review\s+(?:pr|pull\s*request)\s*#?(\d{1,7})\b/i.exec(trimmed);
  if (reviewing) return { type: "review", number: Number(reviewing[1]) };
  if (/^(?:please\s+)?(?:open|create|make)\s+(?:a\s+|the\s+)?pull\s*request\b/i.test(trimmed))
    return { type: "pr", title: "" };
  if (
    /^(please\s+)?(publish|push|commit)\b/i.test(trimmed) &&
    /\b(git\s?hub|changes|edits|branch)\b/i.test(trimmed)
  )
    return { type: "publish", branch: "", message: "" };
  // Must start with a creation verb, so questions like "how do I write a readme" still reach the model.
  const make =
    /^(?:please\s+)?(?:create|write|make|add|generate)\s+(?:me\s+)?(?:an?\s+)?(?:new\s+)?/i.exec(
      trimmed,
    );
  if (make) {
    const after = trimmed.slice(make[0].length);
    const named = /^(?:\w+\s+)?file\s+(?:named|called)\s+(\S+)/i.exec(after);
    const path = /^readme(?:\.md)?\b/i.test(after)
      ? "README.md"
      : named?.[1].replace(/[.,;:!?'"`]+$/, "");
    if (path)
      if (path)
        return {
          type: "new",
          path,
          description: trimmed,
          onExists: named ? "open" : "fresh",
        };
  }
  if (/^(please\s+)?(connect|open|access|link|load)\b/i.test(trimmed)) {
    const match = GITHUB_URL.exec(trimmed);
    if (match) {
      return {
        type: "open",
        slug: `${match[1]}/${match[2]}`,
        branch: match[3] ?? "",
      };
    }
  }
  return null;
}

export function resolvePath(paths: string[], wanted: string): string[] {
  const query = wanted.trim().replace(/^\/+/, "");
  const lower = query.toLowerCase();
  const exact = paths.filter((path) => path.toLowerCase() === lower);
  if (exact.length) return exact;
  const suffix = paths.filter((path) =>
    path.toLowerCase().endsWith(`/${lower}`),
  );
  if (suffix.length) return suffix;
  return paths.filter((path) => path.toLowerCase().includes(lower));
}

// Accepts exactly one fenced block, so surrounding prose is dropped but ambiguous replies stage nothing.
export function extractCodeBlock(text: string): string | null {
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)\n```/g)];
  return blocks.length === 1 ? blocks[0][1] : null;
}

// README.md -> README-2.md, README-3.md ... so "a new readme" never overwrites an existing one.
export function freshPath(paths: string[], wanted: string): string {
  if (!paths.includes(wanted)) return wanted;
  const dot = wanted.lastIndexOf(".");
  const [stem, ext] =
    dot > wanted.lastIndexOf("/") + 1
      ? [wanted.slice(0, dot), wanted.slice(dot)]
      : [wanted, ""];
  for (let n = 2; ; n++)
    if (!paths.includes(`${stem}-${n}${ext}`)) return `${stem}-${n}${ext}`;
}
