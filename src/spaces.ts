export type SpaceTask = { name: string; goal: string };
export type Space = { id: string; name: string; instructions: string; paths: string[]; tasks: SpaceTask[] };
export type SpacesState = { spaces: Space[]; active: string };

export const MAX_SPACES = 12;
export const MAX_TASKS = 10;
export const EMPTY_SPACES: SpacesState = { spaces: [], active: "" };
const MAX_PATHS = 20;

// Tab and newline are fine in instructions; any other control character is not.
const hasControl = (text: string) =>
  [...text].some((char) => {
    const code = char.charCodeAt(0);
    return (code < 32 && code !== 9 && code !== 10) || code === 127;
  });
const withoutControl = (text: string) => [...text].filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("");

const plain = (value: unknown, limit: number, what: string): string => {
  if (typeof value !== "string" || value.length > limit || hasControl(value))
    throw new Error(`Invalid saved space ${what}.`);
  return value;
};

/** One repository path per line, trimmed, de-duplicated, capped. */
export function parsePaths(text: string): string[] {
  const paths = [...new Set(text.split(/\r?\n/).map((line) => withoutControl(line).trim().replace(/^\/+/, "")).filter(Boolean))];
  return paths.slice(0, MAX_PATHS).map((path) => path.slice(0, 200));
}

export function readSpaces(value: unknown): SpacesState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved spaces.");
  const data = value as { spaces?: unknown; active?: unknown };
  if (!Array.isArray(data.spaces) || data.spaces.length > MAX_SPACES) throw new Error("Invalid saved space list.");
  const ids = new Set<string>();
  const spaces = data.spaces.map((entry: unknown): Space => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid saved space.");
    const item = entry as Record<string, unknown>;
    const id = plain(item.id, 40, "id");
    if (!id || ids.has(id)) throw new Error("Invalid saved space id.");
    ids.add(id);
    if (!Array.isArray(item.paths) || item.paths.length > MAX_PATHS) throw new Error("Invalid saved space files.");
    // Spaces saved before reusable tasks existed have no task list.
    const rawTasks = item.tasks === undefined ? [] : item.tasks;
    if (!Array.isArray(rawTasks) || rawTasks.length > MAX_TASKS) throw new Error("Invalid saved space tasks.");
    return {
      id,
      name: plain(item.name, 40, "name"),
      instructions: plain(item.instructions, 1000, "instructions"),
      paths: item.paths.map((path: unknown) => plain(path, 200, "file")),
      tasks: rawTasks.map((task: unknown): SpaceTask => {
        if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("Invalid saved space task.");
        const entry = task as Record<string, unknown>;
        return { name: plain(entry.name, 40, "task name"), goal: plain(entry.goal, 1900, "task goal") };
      }),
    };
  });
  const active = plain(data.active ?? "", 40, "selection");
  return { spaces, active: ids.has(active) ? active : "" };
}

export const activeSpace = (state: SpacesState) => state.spaces.find((space) => space.id === state.active);

export function addSpace(state: SpacesState, id: string, paths: string[] = []): SpacesState {
  if (state.spaces.length >= MAX_SPACES) throw new Error(`You can keep up to ${MAX_SPACES} spaces. Delete one first.`);
  const space: Space = { id, name: `Space ${state.spaces.length + 1}`, instructions: "", paths: paths.slice(0, MAX_PATHS), tasks: [] };
  return { spaces: [...state.spaces, space], active: id };
}

export function updateSpace(state: SpacesState, id: string, patch: Partial<Omit<Space, "id">>): SpacesState {
  return {
    ...state,
    spaces: state.spaces.map((space) => space.id !== id ? space : {
      ...space,
      ...(patch.name === undefined ? {} : { name: patch.name.slice(0, 40) }),
      ...(patch.instructions === undefined ? {} : { instructions: patch.instructions.slice(0, 1000) }),
      ...(patch.paths === undefined ? {} : { paths: patch.paths.slice(0, MAX_PATHS) }),
      ...(patch.tasks === undefined ? {} : { tasks: patch.tasks.slice(0, MAX_TASKS) }),
    }),
  };
}

/** Saves (or replaces by name) a reusable agent goal inside a space. */
export function saveTask(state: SpacesState, id: string, name: string, goal: string): SpacesState {
  const space = state.spaces.find((candidate) => candidate.id === id);
  const label = name.replace(/\s+/g, " ").trim().slice(0, 40);
  const text = goal.trim().slice(0, 1900);
  if (!space) throw new Error("Choose a space first.");
  if (!label) throw new Error("Name the task before saving it.");
  if (!text) throw new Error("Write a goal before saving it as a task.");
  const others = space.tasks.filter((task) => task.name.toLowerCase() !== label.toLowerCase());
  if (others.length >= MAX_TASKS) throw new Error(`A space keeps up to ${MAX_TASKS} tasks. Delete one first.`);
  return updateSpace(state, id, { tasks: [...others, { name: label, goal: text }] });
}

export const removeSpace = (state: SpacesState, id: string): SpacesState => ({
  spaces: state.spaces.filter((space) => space.id !== id),
  active: state.active === id ? "" : state.active,
});

/** Extra protected requirements for prompts, and a short planner hint naming the space's files. */
export function spaceContext(state: SpacesState) {
  const space = activeSpace(state);
  if (!space) return { requirements: "", hint: "" };
  return {
    requirements: space.instructions.trim() ? `Space "${space.name}" instructions:\n${space.instructions.trim()}` : "",
    hint: space.paths.length ? `Space "${space.name}" files to focus on (open or read them when needed):\n${space.paths.join("\n")}` : "",
  };
}
