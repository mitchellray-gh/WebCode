export type Command =
  | { type: "help" }
  | { type: "open"; slug: string; branch: string }
  | { type: "files"; filter: string }
  | { type: "read"; path: string }
  | { type: "publish"; branch: string; message: string };

export const HELP = [
  "The assistant model cannot reach GitHub itself; this app does it for you. Commands:",
  "/open owner/repo [branch]  connect to a repository (or paste a github.com link after 'open')",
  "/files [text]  list files in the connected repository",
  "/read path  open a file in the editor, then use Explain or Edit",
  "/publish [branch] [message]  commit all local changes to a NEW branch (asks you to confirm first)",
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
      case "read":
        return argument ? { type: "read", path: argument } : { type: "help" };
      case "publish": {
        const [branch = "", ...rest] = argument.split(/\s+/).filter(Boolean);
        return { type: "publish", branch, message: rest.join(" ") };
      }
      default:
        return null;
    }
  }
  // Must start with the verb so questions like "how do I publish..." still reach the model.
  if (
    /^(please\s+)?(publish|push|commit)\b/i.test(trimmed) &&
    /\b(git\s?hub|changes|edits|branch)\b/i.test(trimmed)
  )
    return { type: "publish", branch: "", message: "" };
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
