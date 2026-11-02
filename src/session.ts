import { validateNewPath } from "./github.ts";
import { modelChoice } from "./models.ts";
import type { Memory } from "./context.ts";
import type { GoalSettings } from "./goalLoop.ts";
import { readSpaces } from "./spaces.ts";
import type { SpacesState } from "./spaces.ts";

export type TranscriptTurn = {
  id: number;
  request: string;
  response: string;
  file: string;
  status: string;
  model?: string;
};
export type Proposal = {
  path: string;
  base: string;
  next: string;
  source: "ai" | "manual";
};
export type Session = {
  version: 1;
  files: Record<string, { content: string }>;
  active: string;
  transcript: TranscriptTurn[];
  memory: Memory;
  pinned: string;
  notes: string;
  request: string;
  mode: "explain" | "edit";
  model: string;
  proposal: Proposal | null;
  goalLoop?: GoalSettings;
  spaces?: SpacesState;
};
export const MAX_SESSION_BYTES = 3_000_000;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved workspace object.");
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = MAX_SESSION_BYTES): string {
  if (typeof value !== "string" || value.length > limit)
    throw new Error("Invalid or oversized saved workspace text.");
  return value;
}
function integer(value: unknown, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    throw new Error("Invalid saved workspace turn number.");
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 20000)
    throw new Error("Invalid saved workspace list.");
  return value;
}

// Explicit reconstruction prevents credentials or unknown fields entering saves.
export function readSession(value: unknown): Session {
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_SESSION_BYTES)
    throw new Error("Workspace exceeds the 3 MB recovery/cloud-save limit. Download a ZIP.");
  const data = object(value);
  if (data.version !== 1) throw new Error("Unsupported saved workspace version.");
  const files: Session["files"] = Object.create(null);
  const paths: string[] = [];
  for (const [path, file] of Object.entries(object(data.files))) {
    const problem = validateNewPath(path, paths);
    if (problem || paths.length >= 1000)
      throw new Error(`Invalid saved file path: ${path}. ${problem}`);
    files[path] = { content: text(object(file).content, 500_000) };
    paths.push(path);
  }
  const active = text(data.active, 200);
  if (active && !Object.hasOwn(files, active)) throw new Error("Saved active file is missing.");
  const transcript = array(data.transcript).map((value): TranscriptTurn => {
    const turn = object(value);
    return {
      id: integer(turn.id, 1),
      request: text(turn.request),
      response: text(turn.response),
      file: text(turn.file, 200),
      status: text(turn.status, 100),
      ...(turn.model === undefined ? {} : { model: text(turn.model, 200) }),
    };
  });
  const memory = object(data.memory);
  let last = 0;
  const nodes = array(memory.nodes).map((value) => {
    const node = object(value);
    const first = integer(node.first, 1);
    const end = integer(node.last, first);
    if (first <= last) throw new Error("Saved memory is out of order.");
    last = end;
    return { first, last: end, level: integer(node.level), text: text(node.text) };
  });
  const recent = array(memory.recent).map((value) => {
    const turn = object(value);
    const id = integer(turn.id, 1);
    if (id <= last) throw new Error("Saved recent turns are out of order.");
    last = id;
    return { id, request: text(turn.request), response: text(turn.response) };
  });
  const model = text(data.model, 200);
  modelChoice(model);
  if (data.mode !== "explain" && data.mode !== "edit") throw new Error("Invalid saved mode.");
  let proposal: Proposal | null = null;
  if (data.proposal !== null) {
    const entry = object(data.proposal);
    const path = text(entry.path, 200);
    if (!Object.hasOwn(files, path) || !["ai", "manual"].includes(text(entry.source)))
      throw new Error("Invalid saved proposal.");
    proposal = {
      path, base: text(entry.base), next: text(entry.next),
      source: entry.source === "ai" ? "ai" : "manual",
    };
  }
  return {
    version: 1, files, active, transcript, memory: { nodes, recent },
    pinned: text(data.pinned, 4000), notes: text(data.notes, 4000),
    request: text(data.request, 12000), mode: data.mode, model, proposal,
    ...(data.goalLoop === undefined ? {} : {
      goalLoop: {
        goal: text(object(data.goalLoop).goal, 2000),
        steering: text(object(data.goalLoop).steering, 1000),
      },
    }),
    ...(data.spaces === undefined ? {} : { spaces: readSpaces(data.spaces) }),
  };
}
