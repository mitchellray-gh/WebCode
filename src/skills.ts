import { parseDocument } from "yaml";

export type Skill = {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  instructions: string;
};

export const MAX_ATTACHED_SKILLS = 3;
export const SKILL_BYTE_BUDGET = 1200;
export const MAX_IMPORTED_SKILLS = 200;
const byteLength = (text: string) => new TextEncoder().encode(text).length;

function field(value: unknown, name: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || byteLength(value) > limit)
    throw new Error(
      `Skill ${name} must be nonempty text, at most ${limit} bytes.`,
    );
  return value.trim();
}

export function validateSkill(value: unknown): Skill {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Each skill must be an object.");
  const record = value as Record<string, unknown>;
  const id = field(record.id, "id", 64);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id))
    throw new Error("Skill IDs use lowercase letters, digits and hyphens.");
  const tags = record.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 8)
    throw new Error("Skills can have at most 8 tags.");
  return {
    id,
    name: field(record.name, "name", 100),
    description: field(record.description, "description", 300),
    category: field(record.category ?? "Imported", "category", 50),
    tags: tags.map((tag) => field(tag, "tag", 40)),
    version: field(record.version ?? "1.0.0", "version", 24),
    instructions: field(record.instructions, "instructions", 8000),
  };
}

export function parseSkillPack(
  text: string,
  filename = "skills.json",
): Skill[] {
  if (byteLength(text) > 131072)
    throw new Error("Skill files must be at most 128 KB.");
  let value: unknown;
  if (/\.md$/i.test(filename)) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    let metadata: Record<string, unknown> = {};
    if (frontmatter) {
      const document = parseDocument(frontmatter[1]);
      if (document.errors.length)
        throw new Error("Invalid Markdown skill frontmatter.");
      const parsed = document.toJS({ maxAliasCount: 10 });
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Skill frontmatter must contain named fields.");
      metadata = parsed;
    }
    const instructions = frontmatter ? frontmatter[2] : text;
    const name =
      metadata.name ??
      /^#\s+(.+)$/m.exec(instructions)?.[1] ??
      filename.replace(/\.md$/i, "");
    if (typeof name !== "string") throw new Error("Skill name must be text.");
    value = {
      ...metadata,
      name,
      id:
        metadata.id ??
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 64),
      description: metadata.description ?? `Imported from ${filename}`,
      instructions,
    };
  } else {
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(
        "Invalid skill JSON. Import a skill object or an array of skills.",
      );
    }
  }
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length > 100)
    throw new Error("Import at most 100 skills per file.");
  const skills = entries.map(validateSkill);
  if (new Set(skills.map((skill) => skill.id)).size !== skills.length)
    throw new Error("A skill pack contains duplicate IDs.");
  return skills;
}

export function attachSkillContext(skills: Skill[]): string {
  if (skills.length > MAX_ATTACHED_SKILLS)
    throw new Error(`Attach at most ${MAX_ATTACHED_SKILLS} skills at once.`);
  if (!skills.length) return "";
  const context = skills
    .map(
      (skill) =>
        `[Skill: ${skill.name} / ${skill.id} / v${skill.version}]\n${skill.instructions}`,
    )
    .join("\n\n");
  if (byteLength(context) > SKILL_BYTE_BUDGET)
    throw new Error(
      `Selected skill instructions exceed ${SKILL_BYTE_BUDGET} bytes. Attach fewer or shorter skills.`,
    );
  return context;
}

export function mergeImportedSkills(
  existing: Skill[],
  incoming: Skill[],
  reservedIds: string[],
) {
  if (existing.length + incoming.length > MAX_IMPORTED_SKILLS)
    throw new Error(`Store at most ${MAX_IMPORTED_SKILLS} imported skills.`);
  const known = new Set([...reservedIds, ...existing.map((skill) => skill.id)]);
  for (const skill of incoming) {
    if (known.has(skill.id))
      throw new Error(
        `Skill ID ${skill.id} already exists. Remove the imported copy or use a unique ID.`,
      );
    known.add(skill.id);
  }
  return [...existing, ...incoming];
}

export type SkillLibrary = {
  imported: Skill[];
  attachedIds: string[];
  warning: string;
};

export function readSkillLibrary(
  raw: string | null,
  bundled: Skill[],
): SkillLibrary {
  if (!raw) return { imported: [], attachedIds: [], warning: "" };
  try {
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.imported) || !Array.isArray(saved.attachedIds))
      throw new Error("Invalid saved skill library.");
    if (saved.imported.length > MAX_IMPORTED_SKILLS)
      throw new Error("Too many saved skills.");
    const imported = mergeImportedSkills(
      [],
      saved.imported.map(validateSkill),
      bundled.map((skill) => skill.id),
    );
    const known = [...bundled, ...imported];
    const attachedIds: string[] = [
      ...new Set<string>(
        saved.attachedIds.filter(
          (id: unknown) =>
            typeof id === "string" && known.some((skill) => skill.id === id),
        ),
      ),
    ];
    attachSkillContext(known.filter((skill) => attachedIds.includes(skill.id)));
    return { imported, attachedIds, warning: "" };
  } catch {
    return {
      imported: [],
      attachedIds: [],
      warning:
        "Saved skills could not be restored. Your browser storage was not overwritten; re-import your skill files to recover them.",
    };
  }
}
