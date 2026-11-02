const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Cuts to a UTF-8 byte budget without leaving a broken character. */
export function clip(text: string, limit: number) {
  const data = encoder.encode(text);
  if (data.length <= limit) return text;
  return `${decoder.decode(data.slice(0, Math.max(0, limit - 3))).replace(/\uFFFD+$/, "")}…`;
}

/** Bounded keyword search over open files (path and content) and unopened repository paths. */
export function searchWorkspace(
  files: Record<string, { content: string }>,
  repoPaths: string[],
  query: string,
  limit = 8,
): string {
  const words = [...new Set(query.toLowerCase().split(/[^a-z0-9_$./-]+/).filter((word) => word.length > 1))].slice(0, 5);
  if (!words.length) return "Search needs at least one word of 2+ characters.";
  const score = (text: string) => {
    const lower = text.toLowerCase();
    return words.filter((word) => lower.includes(word)).length;
  };
  const hits: { score: number; text: string }[] = [];
  for (const [path, file] of Object.entries(files)) {
    const byPath = score(path);
    if (byPath) hits.push({ score: byPath * 3, text: `${path} (open file, path match)` });
    file.content.split("\n").forEach((line, index) => {
      const byLine = score(line);
      if (byLine) hits.push({ score: byLine, text: `${path}:${index + 1}: ${line.trim().slice(0, 100)}` });
    });
  }
  for (const path of repoPaths) {
    if (Object.hasOwn(files, path)) continue;
    const byPath = score(path);
    if (byPath) hits.push({ score: byPath * 3, text: `${path} (not open; use read)` });
  }
  if (!hits.length) return `No matches for "${query}" in open files or repository paths.`;
  hits.sort((a, b) => b.score - a.score);
  const shown = hits.slice(0, limit).map((hit) => hit.text).join("\n");
  return clip(`${hits.length > limit ? `Top ${limit} of ${hits.length} matches:\n` : ""}${shown}`, 900);
}
