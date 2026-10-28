import { parseSkillPack } from "./skills";

const packs = import.meta.glob("../skills/*.skills.json", {
  eager: true,
  import: "default",
});
export const BUILTIN_SKILLS = Object.entries(packs)
  .flatMap(([path, value]) => parseSkillPack(JSON.stringify(value), path))
  .sort((left, right) => left.name.localeCompare(right.name));

if (
  new Set(BUILTIN_SKILLS.map((skill) => skill.id)).size !==
  BUILTIN_SKILLS.length
)
  throw new Error("Bundled skills contain duplicate IDs.");
