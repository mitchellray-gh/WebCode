import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Braces,
  Check,
  ChevronRight,
  Code2,
  Database,
  Download,
  FileText,
  GitBranch,
  Layers,
  Package,
  Plus,
  Search,
  ShieldCheck,
  TestTube2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  MAX_ATTACHED_SKILLS,
  SKILL_BYTE_BUDGET,
  parseSkillPack,
} from "./skills";
import type { Skill } from "./skills";

type Props = {
  skills: Skill[];
  importedIds: string[];
  attachedIds: string[];
  disabled: boolean;
  warning: string;
  onToggle: (id: string) => void;
  onImport: (skills: Skill[]) => void;
  onRemove: (id: string) => void;
};

const icons = {
  Frontend: Code2,
  Languages: Braces,
  Backend: Layers,
  Testing: TestTube2,
  Security: ShieldCheck,
  "Git & Delivery": GitBranch,
  Data: Database,
  Documentation: FileText,
};

function SkillIcon({ category }: { category: string }) {
  const Icon = icons[category as keyof typeof icons] ?? Package;
  return (
    <span
      className={`skill-icon skill-color-${Object.keys(icons).indexOf(category) + 1}`}
    >
      <Icon size={24} strokeWidth={1.6} />
    </span>
  );
}

function exportSkill(skill: Skill) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(skill, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${skill.id}.skill.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SkillStore({
  skills,
  importedIds,
  attachedIds,
  disabled,
  warning,
  onToggle,
  onImport,
  onRemove,
}: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All collections");
  const [view, setView] = useState<"browse" | "imported" | "attached">(
    "browse",
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const categories = [...new Set(skills.map((skill) => skill.category))].sort();
  const preview = skills.find((skill) => skill.id === previewId);
  const search = query.trim().toLowerCase();
  const visible = skills.filter(
    (skill) =>
      (category === "All collections" || skill.category === category) &&
      (view === "browse" ||
        (view === "imported"
          ? importedIds.includes(skill.id)
          : attachedIds.includes(skill.id))) &&
      (!search ||
        `${skill.name} ${skill.description} ${skill.tags.join(" ")}`
          .toLowerCase()
          .includes(search)),
  );

  function toggle(id: string) {
    try {
      onToggle(id);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to attach this skill.",
      );
    }
  }

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setImporting(true);
    setError("");
    try {
      if (files.length > 20)
        throw new Error("Import at most 20 files at once.");
      const incoming: Skill[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 131072)
          throw new Error(`${file.name}: skill files must be at most 128 KB.`);
        incoming.push(...parseSkillPack(await file.text(), file.name));
      }
      if (!incoming.length) throw new Error("No skills found in these files.");
      onImport(incoming);
      setView("imported");
      setCategory("All collections");
      setQuery("");
      setPreviewId(null);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Skill import failed.",
      );
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="skill-store">
      <header className="store-toolbar">
        <div className="store-search">
          <Search size={17} />
          <input
            aria-label="Search skills"
            placeholder="Search skills, languages, workflows..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPreviewId(null);
            }}
          />
          {query && (
            <button
              className="icon-button"
              title="Clear search"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <X size={15} />
            </button>
          )}
        </div>
        <button
          className="button"
          disabled={disabled || importing}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={15} />
          {importing ? "Importing..." : "Import skills"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".json,.md,application/json,text/markdown"
          hidden
          aria-label="Import skill files"
          onChange={(event) => importFiles(event.target.files)}
        />
      </header>
      {(error || warning) && (
        <div className="store-error" role="alert">
          {error || warning}
          {error && (
            <button
              className="icon-button"
              aria-label="Dismiss skill error"
              title="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
      <div className="store-body">
        <nav className="store-categories" aria-label="Skill collections">
          <div className="store-nav-title">COLLECTIONS</div>
          {["All collections", ...categories].map((name) => (
            <button
              key={name}
              className={category === name ? "selected" : ""}
              onClick={() => {
                setCategory(name);
                setPreviewId(null);
              }}
            >
              <span>{name}</span>
              <span>
                {name === "All collections"
                  ? skills.length
                  : skills.filter((skill) => skill.category === name).length}
              </span>
            </button>
          ))}
          <div className="store-nav-footer">
            <BookOpen size={16} />
            <span>
              {attachedIds.length} / {MAX_ATTACHED_SKILLS} attached
            </span>
            <small>{SKILL_BYTE_BUDGET.toLocaleString()} B skill budget</small>
          </div>
        </nav>
        <div className="store-content">
          <div
            className="store-view-tabs"
            role="group"
            aria-label="Skill library view"
          >
            <button
              aria-pressed={view === "browse"}
              className={view === "browse" ? "selected" : ""}
              onClick={() => {
                setView("browse");
                setPreviewId(null);
              }}
            >
              Discover
            </button>
            <button
              aria-pressed={view === "imported"}
              className={view === "imported" ? "selected" : ""}
              onClick={() => {
                setView("imported");
                setPreviewId(null);
              }}
            >
              Imported <span>{importedIds.length}</span>
            </button>
            <button
              aria-pressed={view === "attached"}
              className={view === "attached" ? "selected" : ""}
              onClick={() => {
                setView("attached");
                setPreviewId(null);
              }}
            >
              Attached <span>{attachedIds.length}</span>
            </button>
          </div>
          {preview ? (
            <article className="skill-preview">
              <button
                className="text-button"
                onClick={() => setPreviewId(null)}
              >
                <ArrowLeft size={15} />
                Back to skills
              </button>
              <div className="skill-preview-heading">
                <SkillIcon category={preview.category} />
                <div>
                  <span className="skill-category-label">
                    {preview.category}
                  </span>
                  <h2>{preview.name}</h2>
                  <p>{preview.description}</p>
                </div>
              </div>
              <div className="skill-preview-actions">
                <button
                  className={`button ${attachedIds.includes(preview.id) ? "" : "primary"}`}
                  disabled={disabled}
                  onClick={() => toggle(preview.id)}
                >
                  {attachedIds.includes(preview.id) ? (
                    <Check size={15} />
                  ) : (
                    <Plus size={15} />
                  )}
                  {attachedIds.includes(preview.id)
                    ? "Detach skill"
                    : "Attach skill"}
                </button>
                <button className="button" onClick={() => exportSkill(preview)}>
                  <Download size={15} />
                  Export JSON
                </button>
                {importedIds.includes(preview.id) && (
                  <button
                    className="icon-button"
                    title="Remove imported skill"
                    aria-label="Remove imported skill"
                    disabled={disabled}
                    onClick={() => {
                      try {
                        onRemove(preview.id);
                        setPreviewId(null);
                      } catch (failure) {
                        setError(String(failure));
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div className="skill-preview-meta">
                <span>v{preview.version}</span>
                <span>
                  {new TextEncoder().encode(preview.instructions).length} B
                  instructions
                </span>
                <span>
                  {importedIds.includes(preview.id)
                    ? "Imported / browser storage"
                    : "technicalskills / bundled"}
                </span>
              </div>
              <h3>Instructions</h3>
              <pre>{preview.instructions}</pre>
              <div className="skill-tags">
                {preview.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </article>
          ) : (
            <>
              <div className="store-section-heading">
                <div>
                  <span className="store-eyebrow">
                    TECHNICALSKILLS COLLECTION
                  </span>
                  <h2>
                    {view === "imported"
                      ? "Your imports"
                      : view === "attached"
                        ? "Attached to the assistant"
                        : category === "All collections"
                          ? "Skills for your next change"
                          : category}
                  </h2>
                </div>
                <span>{visible.length} skills</span>
              </div>
              <div className="skill-grid">
                {visible.map((skill) => (
                  <article
                    key={skill.id}
                    className={`skill-card ${attachedIds.includes(skill.id) ? "attached" : ""}`}
                  >
                    <div className="skill-card-top">
                      <SkillIcon category={skill.category} />
                      <span className="skill-category-label">
                        {skill.category}
                      </span>
                      <button
                        className="icon-button skill-attach"
                        title={
                          attachedIds.includes(skill.id)
                            ? `Detach ${skill.name}`
                            : `Attach ${skill.name}`
                        }
                        aria-label={
                          attachedIds.includes(skill.id)
                            ? `Detach ${skill.name}`
                            : `Attach ${skill.name}`
                        }
                        aria-pressed={attachedIds.includes(skill.id)}
                        disabled={disabled}
                        onClick={() => toggle(skill.id)}
                      >
                        {attachedIds.includes(skill.id) ? (
                          <Check size={18} />
                        ) : (
                          <Plus size={18} />
                        )}
                      </button>
                    </div>
                    <button
                      className="skill-card-open"
                      onClick={() => setPreviewId(skill.id)}
                    >
                      <h3>{skill.name}</h3>
                      <p>{skill.description}</p>
                      <span className="skill-card-meta">
                        {importedIds.includes(skill.id)
                          ? "Imported"
                          : "technicalskills"}
                        <span>
                          v{skill.version}
                          <ArrowUpRight size={13} />
                        </span>
                      </span>
                    </button>
                  </article>
                ))}
              </div>
              {!visible.length && (
                <div className="store-empty">
                  <Package size={32} strokeWidth={1.4} />
                  <h3>
                    {view === "imported"
                      ? "No imported skills"
                      : view === "attached"
                        ? "No attached skills"
                        : "No matching skills"}
                  </h3>
                  <button
                    className="text-button"
                    onClick={() => {
                      setQuery("");
                      setCategory("All collections");
                      setView("browse");
                    }}
                  >
                    Browse all collections
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
