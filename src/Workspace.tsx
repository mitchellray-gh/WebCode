import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { unifiedMergeView } from "@codemirror/merge";
import {
  ArrowDownToLine,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  Circle,
  Code2,
  Download,
  FileCode2,
  FilePlus,
  Files,
  GitBranch,
  GitFork as Github,
  Layers,
  LoaderCircle,
  MessageSquare,
  Pin,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Square,
  Unplug,
  X,
} from "lucide-react";
import {
  appendExchange,
  assemblePrompt,
  bytes,
  compactMemory,
  codingInstruction,
  extractiveSummarize,
  emptyMemory,
  INPUT_BYTE_BUDGET,
  preparePrompt,
  promptBytes,
  emptyCompactionStats,
  measureSummarizer,
  memoryBytes as historyBytes,
} from "./context";
import type { Memory } from "./context";
import { BrowserModel } from "./model";
import {
  DEFAULT_MODEL_ID,
  MOBILE_MODEL_ID,
  MODEL_CHOICES,
  modelChoice,
} from "./models";
import SkillStore from "./SkillStore";
import { BUILTIN_SKILLS } from "./skillCatalog";
import {
  attachSkillContext,
  mergeImportedSkills,
  readSkillLibrary,
} from "./skills";
import type { Skill } from "./skills";
import "./skills.css";
import {
  GitHub,
  EmptyRepositoryError,
  TOKEN_URL,
  validateNewPath,
} from "./github";
import type { Repository } from "./github";
import {
  HELP,
  extractCodeBlock,
  freshPath,
  parseCommand,
  resolvePath,
} from "./commands";
import type { Command } from "./commands";
import { importWorkspaceArchive, workspaceArchive } from "./archive";
import CloudSave from "./CloudSave";
import { recoverySession } from "./recovery";
import type { Proposal, Session, TranscriptTurn } from "./session";
import { MAX_SESSION_BYTES } from "./session";
import GoalPanel from "./GoalPanel";
import Preview from "./Preview";
import { defaultEntry, htmlFromReply, looksLikeHtml, previewPages, SNIPPET_PAGE } from "./sandbox";
import { applyGoalEdit } from "./goalLoop";
import type { GoalCall, GoalEdit, GoalFiles, GoalSettings, GoalTools } from "./goalLoop";
import { searchWorkspace } from "./agentTools";
import { checkPage } from "./pageCheck";

type OpenFile = { original: string; content: string; isNew?: boolean };
const isChanged = (file: OpenFile) =>
  Boolean(file.isNew) || file.original !== file.content;
type Phase = "idle" | "loading" | "thinking" | "compacting";

const sample = `type Task = { title: string; done: boolean }

export function completionRate(tasks: Task[]): number {
  if (tasks.length === 0) return 0
  const completed = tasks.filter(task => task.done).length
  return Math.round((completed / tasks.length) * 100)
}
`;
const initialFiles: Record<string, OpenFile> = {
  "src/tasks.ts": { original: sample, content: sample },
  "README.md": {
    original: "# Scratch workspace\n\nA small task utility.\n",
    content: "# Scratch workspace\n\nA small task utility.\n",
  },
};

function extensions(path: string) {
  if (/\.[cm]?[jt]sx?$/.test(path))
    return [
      javascript({ typescript: /\.tsx?$/.test(path), jsx: /x$/.test(path) }),
    ];
  if (path.endsWith(".py")) return [python()];
  if (path.endsWith(".json")) return [json()];
  if (/\.mdx?$/.test(path)) return [markdown()];
  if (/\.html?$/.test(path)) return [html()];
  if (/\.css$/.test(path)) return [css()];
  return [];
}

const MOBILE_QUERY = "(max-width: 760px)";

function useMobile() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia(MOBILE_QUERY).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

function download(name: string, content: string | Blob, type = "text/plain") {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function failureMessage(failure: unknown, fallback: string) {
  return failure instanceof Error
    ? failure.message
    : typeof failure === "string"
      ? failure
      : fallback;
}

const newBranchName = () => `work/assistant-${Date.now().toString(36)}`;

const SKILL_STORAGE_KEY = "technicalskills.skill-library.v1";
function restoreSkillLibrary() {
  try {
    return readSkillLibrary(
      localStorage.getItem(SKILL_STORAGE_KEY),
      BUILTIN_SKILLS,
    );
  } catch {
    return {
      imported: [],
      attachedIds: [],
      warning:
        "Browser storage is unavailable. Skill imports cannot be saved on this browser.",
    };
  }
}

function TokenHelp() {
  return (
    <p className="token-help">
      No token is needed for public repositories. For private repos or
      publishing,{" "}
      <a href={TOKEN_URL} target="_blank" rel="noreferrer noopener">
        create a token on GitHub
      </a>{" "}
      (pre-filled with Contents write, 30 days). Under Repository access, choose
      Only select repositories and pick the repo.
    </p>
  );
}

function Dialog({
  title,
  children,
  close,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${wide ? "dialog wide" : "dialog"} ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="dialog-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          title="Close dialog"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function App() {
  const [files, setFiles] = useState(initialFiles);
  const [active, setActive] = useState("src/tasks.ts");
  const [repo, setRepo] = useState<Repository | null>(null);
  const [token, setToken] = useState("");
  const [filter, setFilter] = useState("");
  const mobile = useMobile();
  const [panel, setPanel] = useState<"changes" | "memory">("memory");
  const [panelOpen, setPanelOpen] = useState(!mobile);
  const [mobilePane, setMobilePane] = useState<
    "files" | "editor" | "assistant"
  >("editor");
  const [phase, setPhase] = useState<Phase>("idle");
  const [ready, setReady] = useState(false);
  const [selectedModelId, setSelectedModelId] =
    useState<string>(() =>
      window.matchMedia(MOBILE_QUERY).matches
        ? MOBILE_MODEL_ID
        : DEFAULT_MODEL_ID,
    );
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [skillLibrary, setSkillLibrary] = useState(restoreSkillLibrary);
  const [progress, setProgress] = useState({ value: 0, text: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [networkBusy, setNetworkBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newPathError, setNewPathError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishDestination, setPublishDestination] = useState<
    "new-branch" | "main"
  >("new-branch");
  const [repoInput, setRepoInput] = useState("");
  const [branchInput, setBranchInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [publishBranch, setPublishBranch] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [request, setRequest] = useState("");
  const [pinned, setPinned] = useState("");
  const [notes, setNotes] = useState("");
  const [goalSettings, setGoalSettings] = useState<GoalSettings>({ goal: "", steering: "" });
  const [goalRunning, setGoalRunning] = useState(false);
  const goalWorkspace = useRef<{ files: GoalFiles; paths: string[] }>({ files: initialFiles, paths: Object.keys(initialFiles) });
  const [stats, setStats] = useState(emptyCompactionStats);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [saveStatus, setSaveStatus] = useState("Loading local recovery...");
  const zipInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"explain" | "edit">("explain");
  // Text filled in by a create-file request; it must reach the model, not the command parser.
  const [prefilled, setPrefilled] = useState("");
  const autoRun = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [memory, setMemory] = useState<Memory>(emptyMemory);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [liveBytes, setLiveBytes] = useState(0);
  const [selectedRange, setSelectedRange] = useState({ from: 0, to: 0 });
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [review, setReview] = useState<Proposal | null>(null);
  const [previewEntry, setPreviewEntry] = useState("");
  const [previewSnippet, setPreviewSnippet] = useState("");
  const model = useRef<BrowserModel | null>(null);
  const controller = useRef<AbortController | null>(null);
  const memoryRef = useRef<Memory>(emptyMemory());
  const nextId = useRef(1);
  const endOfChat = useRef<HTMLDivElement>(null);
  const busy = phase !== "idle" || networkBusy || !recoveryReady || goalRunning;
  const session = useMemo<Session>(() => ({
    version: 1,
    files: Object.fromEntries(Object.entries(files).map(([path, file]) => [path, { content: file.content }])),
    active, transcript, memory, pinned, notes, request, mode, goalLoop: goalSettings,
    model: selectedModelId, proposal,
  }), [files, active, transcript, memory, pinned, notes, request, mode, selectedModelId, proposal, goalSettings]);
  const latestSession = useRef(session);
  const lastSavedSession = useRef<Session | null>(null);
  useEffect(() => { latestSession.current = session; }, [session]);
  useEffect(() => {
    if (!recoveryReady || !recoveryEnabled) return;
    let saving = false;
    const save = async () => {
      const current = latestSession.current;
      if (saving || current === lastSavedSession.current) return;
      saving = true;
      try {
        await recoverySession(current);
        lastSavedSession.current = current;
        setSaveStatus(`Local recovery saved at ${new Date().toLocaleTimeString()}.`);
      } catch (failure) {
        setSaveStatus(`Local recovery failed: ${failureMessage(failure, "Download a ZIP to protect edits.")}`);
      } finally { saving = false; }
    };
    const timer = setInterval(() => void save(), 1000);
    const hide = () => { if (document.visibilityState === "hidden") void save(); };
    document.addEventListener("visibilitychange", hide);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", hide); };
  }, [recoveryReady, recoveryEnabled]);
  const selectedModel = modelChoice(selectedModelId);
  const availableSkills = [...BUILTIN_SKILLS, ...skillLibrary.imported];
  const attachedSkills = availableSkills.filter((skill) =>
    skillLibrary.attachedIds.includes(skill.id),
  );
  const skillText = attachSkillContext(attachedSkills);
  const activeFile = files[active];
  const selectionSize = selectedRange.to - selectedRange.from;
  const changes = Object.entries(files).filter(([, file]) => isChanged(file));
  const newPaths = Object.entries(files)
    .filter(([, file]) => file.isNew)
    .map(([path]) => path);
  const allPaths = repo
    ? [...repo.files.map((file) => file.path), ...newPaths].sort()
    : Object.keys(files).sort();
  useEffect(() => { goalWorkspace.current = { files, paths: allPaths }; }, [files, allPaths]);
  const visiblePaths = allPaths.filter((path) =>
    path.toLowerCase().includes(filter.toLowerCase()),
  );
  const archivedBytes = transcript.reduce(
    (total, turn) => total + bytes(turn.request) + bytes(turn.response),
    0,
  );
  const memoryBytes = memory.nodes.reduce(
    (total, node) => total + bytes(node.text),
    0,
  );

  useEffect(
    () => () => {
      controller.current?.abort();
      model.current?.dispose();
    },
    [],
  );
  useEffect(() => {
    endOfChat.current?.scrollIntoView({ block: "nearest" });
  }, [transcript, phase]);
  // Runs after the new file and Edit mode have rendered, so the request targets the right file.
  useEffect(() => {
    if (!autoRun.current || busy || !prefilled || request !== prefilled) return;
    autoRun.current = false;
    formRef.current?.requestSubmit();
  }, [busy, prefilled, request]);
  useEffect(() => {
    const preventLoss = (event: BeforeUnloadEvent) => {
      if (changes.length || transcript.length) event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [changes.length, transcript.length]);

  function remember(value: Memory) {
    memoryRef.current = value;
    setMemory(value);
  }

  function restoreSession(saved: Session) {
    model.current?.dispose();
    model.current = null;
    setReady(false);
    setFiles(Object.fromEntries(Object.entries(saved.files).map(([path, file]) =>
      [path, { original: "", content: file.content, isNew: true }])));
    setActive(saved.active);
    setTranscript(saved.transcript.map((turn) => ({
      ...turn,
      status: ["Preparing context", "Generating"].includes(turn.status) ? "Interrupted" : turn.status,
    })));
    remember(saved.memory);
    setPinned(saved.pinned);
    setNotes(saved.notes);
    setGoalSettings(saved.goalLoop ?? { goal: "", steering: "" });
    setRequest(saved.request);
    setMode(saved.mode);
    setSelectedModelId(saved.model);
    setProposal(saved.proposal);
    setReview(null);
    setRepo(null); setToken(""); setTokenInput(""); setPublishedUrl("");
    setFilter(""); setPrefilled(""); autoRun.current = false;
    setSelectedRange({ from: 0, to: 0 });
    nextId.current = Math.max(0, ...saved.transcript.map((turn) => turn.id),
      ...saved.memory.nodes.map((node) => node.last), ...saved.memory.recent.map((turn) => turn.id)) + 1;
    setStats(emptyCompactionStats());
    setLiveBytes(0);
  }

  useEffect(() => {
    let alive = true;
    void recoverySession().then((saved) => {
      if (!alive) return;
      if (saved) {
        restoreSession(saved);
        setNotice("Recovered your workspace locally. Reconnect GitHub separately; credentials were not saved.");
      }
      setRecoveryEnabled(true);
      setSaveStatus(saved ? "Local workspace recovered." : "Local recovery ready.");
    }).catch((failure) => {
      if (alive) setSaveStatus(`Local recovery unavailable: ${failureMessage(failure, "Unknown storage error.")}`);
    }).finally(() => { if (alive) setRecoveryReady(true); });
    return () => { alive = false; };
  }, []);

  function saveSkillLibrary(imported: Skill[], attachedIds: string[]) {
    attachSkillContext(
      [...BUILTIN_SKILLS, ...imported].filter((skill) =>
        attachedIds.includes(skill.id),
      ),
    );
    try {
      localStorage.setItem(
        SKILL_STORAGE_KEY,
        JSON.stringify({ imported, attachedIds }),
      );
    } catch {
      throw new Error(
        "Unable to save skills in browser storage. Nothing was changed; export your imports before clearing browser data.",
      );
    }
    setSkillLibrary({ imported, attachedIds, warning: "" });
  }

  function toggleSkill(id: string) {
    const attachedIds = skillLibrary.attachedIds.includes(id)
      ? skillLibrary.attachedIds.filter((attached) => attached !== id)
      : [...skillLibrary.attachedIds, id];
    saveSkillLibrary(skillLibrary.imported, attachedIds);
  }
  function pickPanel(next: "changes" | "memory") {
    setPanelOpen(panelOpen && panel === next ? false : true);
    setPanel(next);
  }
  function clearConversation() {
    if (busy) return;
    if (
      transcript.length &&
      !window.confirm(
        "Clear this conversation and its summaries? Export it first to keep a copy.",
      )
    )
      return;
    remember(emptyMemory());
    setTranscript([]);
    setProposal(null);
    setLiveBytes(0);
    setError("");
    setNotice("");
  }

  async function loadModel() {
    const abort = new AbortController();
    controller.current = abort;
    setPhase("loading");
    setError("");
    setProgress({ value: 0, text: "Checking WebGPU adapter..." });
    model.current?.dispose();
    const instance = new BrowserModel();
    model.current = instance;
    try {
      await instance.load(
        abort.signal,
        (value, text) => setProgress({ value, text }),
        selectedModelId,
        (message) => { setReady(false); setError(message); },
      );
      setReady(true);
      setNotice("Model loaded. Inference stays in this browser.");
    } catch (failure) {
      setReady(false);
      if (!abort.signal.aborted)
        setError(
          `Model loading failed. Check artifact downloads and browser storage. ${failureMessage(failure, "Unknown model error.")}`,
        );
    } finally {
      setPhase("idle");
      controller.current = null;
    }
  }

  async function openFile(path: string) {
    if (busy) return;
    setSelectedRange({ from: 0, to: 0 });
    if (files[path]) {
      setActive(path);
      setMobilePane("editor");
      return;
    }
    const entry = repo?.files.find((file) => file.path === path);
    if (!repo || !entry) return;
    setNetworkBusy(true);
    setError("");
    try {
      const content = await new GitHub(token).read(repo, entry);
      setFiles((previous) => ({
        ...previous,
        [path]: { original: content, content },
      }));
      setActive(path);
      setMobilePane("editor");
    } catch (failure) {
      setError(failureMessage(failure, "Could not open file."));
    } finally {
      setNetworkBusy(false);
    }
  }

  async function openRepository(
    slug: string,
    branch: string,
    tokenValue: string,
  ): Promise<Repository | null> {
    if (
      changes.length &&
      !window.confirm("Discard local edits and open another repository?")
    )
      return null;
    if (
      transcript.length &&
      !window.confirm("Opening a repository clears the conversation. Continue?")
    )
      return null;
    setNetworkBusy(true);
    setError("");
    try {
      const client = new GitHub(tokenValue);
      let created = false;
      let repository: Repository;
      try {
        repository = await client.open(slug, branch);
      } catch (failure) {
        if (!(failure instanceof EmptyRepositoryError)) throw failure;
        if (!tokenValue.trim())
          throw new Error(
            `${failure.message} Or enter a token with Contents write permission and the app can create the README for you.`,
          );
        if (
          !window.confirm(
            `${slug} is empty. Create a README.md as its first commit so you can start working?`,
          )
        )
          throw failure;
        await client.initialize(slug);
        created = true;
        repository = await client.open(slug, branch);
      }
      setRepo(repository);
      setToken(tokenValue.trim());
      setFiles({});
      setActive("");
      setFilter("");
      setPublishedUrl("");
      setProposal(null);
      remember(emptyMemory());
      setTranscript([]);
      setLiveBytes(0);
      setPinned("");
      setNotes("");
      setGoalSettings({ goal: "", steering: "" });
      setRequest("");
      setNotice(
        `${created ? "Created README.md and opened" : "Opened"} ${repository.owner}/${repository.name} at ${repository.head.slice(0, 7)}.`,
      );
      return repository;
    } catch (failure) {
      setError(failureMessage(failure, "Connection failed."));
      return null;
    } finally {
      setNetworkBusy(false);
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (await openRepository(repoInput, branchInput, tokenInput)) {
      setTokenInput("");
      setConnecting(false);
      setMobilePane("files");
    }
  }

  function openNewFile() {
    const folder = active.includes("/")
      ? active.slice(0, active.lastIndexOf("/") + 1)
      : "";
    setNewPath(folder);
    setNewPathError("");
    setCreating(true);
  }

  function downloadWorkspace() {
    setError("");
    try {
      download(`${repo?.name || "scratch-workspace"}.zip`, workspaceArchive(files));
      setNotice(
        "ZIP download started with all open and newly created files. Unapplied AI proposals are not included.",
      );
    } catch (failure) {
      setError(failureMessage(failure, "Could not create workspace ZIP."));
    }
  }

  async function importZip(file: File) {
    if (busy) return;
    setNetworkBusy(true);
    setError("");
    try {
      const imported = await importWorkspaceArchive(file);
      if (!window.confirm("Replace the current workspace with this ZIP? Download existing work first.")) return;
      restoreSession({
        version: 1, files: imported, active: Object.keys(imported)[0],
        transcript: [], memory: emptyMemory(), pinned: "", notes: "", request: "",
        mode: "edit", model: selectedModelId, proposal: null,
      });
      setMobilePane("files");
      setNotice(`Imported ${Object.keys(imported).length} files locally. No repository connection needed.`);
    } catch (failure) {
      setError(failureMessage(failure, "ZIP import failed. Nothing was changed."));
    } finally { setNetworkBusy(false); }
  }

  // Returns an error message, or "" after the file was created.
  function createFile(rawPath: string) {
    const path = rawPath.trim();
    const problem = validateNewPath(path, allPaths);
    if (problem) return problem;
    setFiles((previous) => ({
      ...previous,
      [path]: { original: "", content: "", isNew: true },
    }));
    setActive(path);
    setSelectedRange({ from: 0, to: 0 });
    setMobilePane("editor");
    setNotice(
      `Created ${path}. Type in the editor, or choose Edit and describe what it should contain.`,
    );
    return "";
  }

  // Real HTML pages win; otherwise preview HTML found in the active file or the latest finished assistant reply.
  function previewTarget() {
    const entry = defaultEntry(Object.keys(files), active);
    if (entry) return { entry, snippet: "" };
    const html =
      (activeFile && looksLikeHtml(activeFile.content) ? activeFile.content : null) ??
      [...transcript].reverse().map((turn) => turn.status === "Complete" ? htmlFromReply(turn.response) : null).find(Boolean) ??
      null;
    return html ? { entry: SNIPPET_PAGE, snippet: html } : null;
  }

  function startPreview(entry: string, snippet = "") {
    setPreviewSnippet(snippet);
    setPreviewEntry(entry);
  }

  function launchPreview() {
    const target = previewTarget();
    if (target) return startPreview(target.entry, target.snippet);
    setNotice(
      "Nothing to preview yet: Play runs a web page (HTML, CSS, JavaScript). Ask the assistant for a complete HTML page, then press Play or Run under its reply, or create a file with /new index.html.",
    );
  }

  function saveSnippet(html: string) {
    if (busy) return;
    const path = freshPath(allPaths, "index.html");
    const problem = createFile(path);
    if (problem) return setError(problem);
    setFiles((previous) => ({ ...previous, [path]: { ...previous[path], content: html } }));
    setNotice(`Saved the reply as ${path}. Press Play to run it, or edit it first.`);
  }

  // Commands run in the app, not the model, so GitHub access is real rather than described.
  async function runCommand(command: Command, text: string) {
    if (busy) return;
    const reply = (response: string) =>
      setTranscript((previous) => [
        ...previous,
        {
          id: nextId.current++,
          request: text,
          response,
          file: active,
          status: "Done",
        },
      ]);
    setRequest("");
    setError("");
    setNotice("");
    const scope = repo
      ? `${repo.owner}/${repo.name}`
      : "the scratch workspace (no repository connected)";
    if (command.type === "help") return reply(HELP);
    if (command.type === "run") {
      const pages = previewPages(Object.keys(files));
      if (command.path) {
        const matches = resolvePath(pages, command.path);
        if (matches.length !== 1)
          return reply(
            matches.length
              ? `Several pages match; be more specific:\n${matches.join("\n")}`
              : `No HTML page matches "${command.path}". Pages: ${pages.join(", ") || "none"}`,
          );
        startPreview(matches[0]);
        return reply(`Launched ${matches[0]} in an isolated in-browser preview. Edit, then choose Reload to see changes. Only open files are served.`);
      }
      const target = previewTarget();
      if (!target)
        return reply(
          "There is no HTML page to run. Ask the assistant for a complete HTML page, or create one with /new index.html. The preview serves static HTML, CSS and JavaScript; it cannot run Node servers, npm, TypeScript or JSX.",
        );
      startPreview(target.entry, target.snippet);
      return reply(
        target.snippet
          ? "Launched the HTML found in your active file or latest reply (not saved as a file; use Save as file under the reply to keep it)."
          : `Launched ${target.entry} in an isolated in-browser preview. Edit, then choose Reload to see changes. Only open files are served.`,
      );
    }
    if (command.type === "new") {
      if (!command.path) {
        openNewFile();
        return reply("Enter the new file's path in the dialog.");
      }
      let target = command.path;
      let opened = false;
      if (allPaths.includes(target) && command.onExists === "open") {
        await openFile(target);
        opened = true;
      } else {
        if (command.onExists === "fresh") target = freshPath(allPaths, target);
        const problem = createFile(target);
        if (problem) return reply(problem);
      }
      if (!command.description)
        return reply(
          `Created ${target} (not saved to GitHub until you publish). Select Edit and describe what it should contain.`,
        );
      setMode("edit");
      setRequest(command.description);
      setPrefilled(command.description);
      autoRun.current = ready;
      setMobilePane("assistant");
      return reply(
        `${opened ? "Opened" : "Created"} ${target} and switched to Edit. ${
          ready
            ? "Sending your request to the assistant; review the proposal when it appears."
            : "Load the model, then press Send to have the assistant write it."
        }`,
      );
    }
    if (command.type === "open") {
      const opened = await openRepository(command.slug, command.branch, token);
      if (opened)
        reply(
          `Connected to ${opened.owner}/${opened.name} on ${opened.branch} at ${opened.head.slice(0, 7)}. ${opened.files.length} text files available. Try /files or /read <path>.`,
        );
      return;
    }
    if (command.type === "files") {
      const matches = allPaths.filter((path) =>
        path.toLowerCase().includes(command.filter.toLowerCase()),
      );
      const shown = matches.slice(0, 40);
      return reply(
        matches.length
          ? `${matches.length} file(s) in ${scope}:\n${shown.join("\n")}${matches.length > shown.length ? `\n...and ${matches.length - shown.length} more; narrow with /files <text>` : ""}`
          : `No files match in ${scope}.`,
      );
    }
    if (command.type === "publish") {
      if (!repo)
        return reply(
          "No repository is connected, so there is nothing to publish to. Use /open owner/repo first.",
        );
      if (!changes.length)
        return reply(
          "No local changes to publish. Edit a file or apply an AI proposal first.",
        );
      const branch = command.branch || newBranchName();
      const message = command.message || "Apply reviewed changes";
      if (!token) {
        setPublishDestination("new-branch");
        setPublishBranch(branch);
        setCommitMessage(message);
        setPublishing(true);
        return reply(
          "Publishing needs a GitHub token. The publish dialog is open: enter a token there and confirm.",
        );
      }
      const names = changes.map(([path]) => path);
      if (
        !window.confirm(
          `Publish ${names.length} changed file(s) to the NEW branch "${branch}" in ${repo.owner}/${repo.name}?\n\n${names.join("\n")}\n\nCommit message: ${message}`,
        )
      )
        return reply("Publish cancelled. Nothing was sent to GitHub.");
      const result = await publishChanges(branch, message);
      return reply(
        result.url
          ? `Published ${names.length} file(s) to ${branch}. Open a pull request: ${result.url}`
          : `Publish failed: ${result.error} Nothing was changed on GitHub.`,
      );
    }
    const matches = resolvePath(allPaths, command.path);
    if (matches.length !== 1)
      return reply(
        matches.length
          ? `Several files match; be more specific:\n${matches.slice(0, 10).join("\n")}`
          : `No file named "${command.path}" in ${scope}. Try /files.`,
      );
    await openFile(matches[0]);
    reply(
      `Opened ${matches[0]} in the editor. Use Explain or Edit to work on it.`,
    );
  }

  const instruction = codingInstruction(mode) +
    ` ${repo ? `Connected repository: ${repo.owner}/${repo.name} (${repo.branch}).` : "Local scratch workspace; no repository connection is required to write code."}`;

  function currentContext() {
    const range = selectedRange;
    if (!activeFile) return "";
    const selected = range.to > range.from;
    return `File: ${active}${selected ? ` (selected characters ${range.from}-${range.to})` : " (entire file)"}\n${selected ? activeFile.content.slice(range.from, range.to) : activeFile.content}`;
  }

  async function askGoal(call: GoalCall, signal: AbortSignal) {
    const instance = model.current;
    if (!instance) throw new Error("Load the model before starting goal mode.");
    signal.throwIfAborted();
    if (latestSession.current.transcript.length >= 19_990 ||
        bytes(JSON.stringify(latestSession.current)) > MAX_SESSION_BYTES - 64_000)
      throw new Error("Goal mode paused near the 3 MB save limit. Export your conversation and ZIP, then clear old conversation history before restarting.");
    const id = nextId.current++;
    const task = `[Goal ${call.stage}]\n${call.request}`;
    setTranscript((previous) => [...previous, {
      id, request: task, response: "", file: "", status: "Preparing context", model: selectedModel.name,
    }]);
    const update = (values: Partial<TranscriptTurn>) =>
      setTranscript((previous) => previous.map((turn) => turn.id === id ? { ...turn, ...values } : turn));
    const measurement = emptyCompactionStats();
    const prompt = {
      instruction: call.instruction, request: task, fileContext: call.fileContext,
      pinned, notes, skills: skillText,
    };
    const reviewing = call.stage === "Review" || call.stage === "Completion review";
    const contextMemory = reviewing ? emptyMemory() : memoryRef.current;
    measurement.beforeBytes = promptBytes(assemblePrompt(prompt, contextMemory));
    measurement.afterBytes = measurement.beforeBytes;
    setPhase("compacting");
    try {
      const prepared = await preparePrompt(prompt, contextMemory,
        measureSummarizer(extractiveSummarize, measurement));
      signal.throwIfAborted();
      if (!reviewing) remember(prepared.memory);
      measurement.afterBytes = prepared.inputBytes;
      setLiveBytes(prepared.inputBytes);
      setPhase("thinking");
      update({ status: "Generating" });
      let lastUpdate = 0;
      const answer = await instance.completeTask(prepared.messages, signal, (text) => {
        const now = Date.now();
        if (now - lastUpdate >= 100) { lastUpdate = now; update({ response: text }); }
      }, call.stage === "Draft" || call.stage === "Revise" ? "code" : "json",
      assemblePrompt(prompt, emptyMemory()), call.schema);
      signal.throwIfAborted();
      update({ response: answer.text, status: answer.finished ? "Complete" : "Output limit reached" });
      if (!answer.finished || !answer.text.trim())
        throw new Error("Goal mode needs a complete, nonempty answer. No draft was applied; narrow the goal or file size and retry.");
      remember(appendExchange(memoryRef.current, { id, request: task, response: answer.text }));
      return answer.text;
    } catch (failure) {
      update({ status: signal.aborted ? "Cancelled" : "Failed" });
      throw failure;
    } finally {
      setStats({ ...measurement });
      setPhase("idle");
    }
  }

  function logAgent(label: string, response: string, file = "") {
    const id = nextId.current++;
    setTranscript((previous) => [...previous, { id, request: `[Agent ${label}]`, response, file, status: "Done" }]);
  }

  const agentTools: GoalTools = {
    async search(query) {
      const { files: current, paths } = goalWorkspace.current;
      let report = searchWorkspace(current, paths, query);
      if (repo && token) {
        try {
          const found = (await new GitHub(token).searchCode(repo, query)).filter((path) => !Object.hasOwn(current, path));
          if (found.length)
            report = `${report}\nGitHub code search (not open; use read):\n${found.join("\n")}`;
        } catch (failure) {
          report = `${report}\n(GitHub code search unavailable: ${failureMessage(failure, "failed")})`;
        }
      }
      logAgent("Search", `"${query}"\n${report}`);
      return report;
    },
    read: repo ? async (path) => {
      const entry = repo.files.find((file) => file.path === path);
      if (!entry) throw new Error(`${path} is not in the repository.`);
      const content = await new GitHub(token).read(repo, entry);
      const workspace = goalWorkspace.current;
      const next = { ...workspace.files, [path]: { original: content, content } };
      goalWorkspace.current = { ...workspace, files: next };
      setFiles(next);
      logAgent("Read", `Opened ${path} from ${repo.owner}/${repo.name}.`, path);
    } : undefined,
    async check(focus) {
      const contents = Object.fromEntries(Object.entries(goalWorkspace.current.files).map(([path, file]) => [path, file.content]));
      const report = await checkPage(contents, focus);
      logAgent("Check", report, focus);
      return report;
    },
  };

  function applyGoal(edit: GoalEdit) {
    const workspace = goalWorkspace.current;
    const next = applyGoalEdit(workspace.files, workspace.paths, edit);
    goalWorkspace.current = {
      files: next,
      paths: workspace.paths.includes(edit.path) ? workspace.paths : [...workspace.paths, edit.path],
    };
    setFiles(next);
    setActive(edit.path);
    setSelectedRange({ from: 0, to: 0 });
    const id = nextId.current++;
    const response = `Applied ${edit.path} locally after model review. Nothing published.`;
    setTranscript((previous) => [...previous, {
      id, request: "[Goal Apply]", response, file: edit.path, status: "Done",
    }]);
    remember(appendExchange(memoryRef.current, { id, request: "[Goal Apply]", response }));
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    const command = request === prefilled ? null : parseCommand(request);
    if (command) return runCommand(command, request.trim());
    const instance = model.current;
    if (!instance || !ready || busy || !request.trim()) return;
    if (mode === "edit" && !activeFile) {
      setError("Open a text file before requesting an edit.");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const id = nextId.current++;
    const task = request;
    const path = active;
    const base = activeFile?.content || "";
    const range = { ...selectedRange };
    const selected = range.to > range.from;
    setError("");
    setNotice(
      /\bgit\s?hub\b/i.test(task)
        ? "The model can't reach GitHub. Type /open owner/repo, /files, /read path or /publish to use it through the app."
        : "",
    );
    setProposal(null);
    setPhase("compacting");
    setTranscript((previous) => [
      ...previous,
      {
        id,
        request: task,
        response: "",
        file: path,
        status: "Preparing context",
        model: selectedModel.name,
      },
    ]);
    const updateTurn = (update: Partial<TranscriptTurn>) =>
      setTranscript((previous) =>
        previous.map((turn) =>
          turn.id === id ? { ...turn, ...update } : turn,
        ),
      );
    const measurement = emptyCompactionStats();
    const promptInput = {
      instruction, pinned, notes, request: task,
      fileContext: currentContext(), skills: skillText,
    };
    measurement.beforeBytes = promptBytes(assemblePrompt(promptInput, memoryRef.current));
    measurement.afterBytes = measurement.beforeBytes;
    try {
      const prepared = await preparePrompt(
        promptInput,
        memoryRef.current,
        measureSummarizer(extractiveSummarize, measurement),
      );
      measurement.afterBytes = prepared.inputBytes;
      abort.signal.throwIfAborted();
      remember(prepared.memory);
      setLiveBytes(prepared.inputBytes);
      setPhase("thinking");
      updateTurn({ status: "Generating" });
      let lastStreamUpdate = 0;
      const answer = await instance.completeTask(
        prepared.messages,
        abort.signal,
        (text) => {
          const now = Date.now();
          if (now - lastStreamUpdate >= 100) {
            lastStreamUpdate = now;
            updateTurn({ response: text });
          }
        },
        mode === "edit" ? "code" : "text",
        assemblePrompt(promptInput, emptyMemory()),
      );
      if (!answer.text.trim())
        throw new Error(
          "Model returned an empty answer. Try a shorter, more specific request.",
        );
      updateTurn({
        status: answer.finished ? "Complete" : "Output limit reached",
        response: answer.text,
      });
      setRequest("");
      const pending = appendExchange(memoryRef.current, {
        id,
        request: `${path ? `File ${path}${selected ? " (selection)" : ""}: ` : ""}${task}`,
        response:
          answer.text + (answer.finished ? "" : "\n[Output was truncated.]"),
      });
      remember(pending);
      if (mode === "edit" && answer.finished) {
        const code = extractCodeBlock(answer.text);
        if (code !== null) {
          const originalSnippet = selected
            ? base.slice(range.from, range.to)
            : base;
          const replacement =
            code +
            (originalSnippet.endsWith("\n") && !code.endsWith("\n")
              ? "\n"
              : "");
          setProposal({
            path,
            base,
            next: selected
              ? base.slice(0, range.from) + replacement + base.slice(range.to)
              : replacement,
            source: "ai",
          });
        } else
          setNotice(
            "No complete replacement code block returned. No edit was staged.",
          );
      } else if (mode === "edit")
        setNotice(
          "Output limit reached. No edit was staged; select a smaller section and retry.",
        );
    } catch (failure) {
      updateTurn({ status: abort.signal.aborted ? "Cancelled" : "Failed" });
      if (!abort.signal.aborted)
        setError(failureMessage(failure, "Request failed."));
    } finally {
      setStats({ ...measurement });
      setPhase("idle");
      controller.current = null;
    }
  }

  async function compactNow() {
    if (busy) return;
    setError("");
    const measurement = emptyCompactionStats();
    measurement.beforeBytes = historyBytes(memoryRef.current);
    measurement.afterBytes = measurement.beforeBytes;
    try {
      const compacted = await compactMemory(
        memoryRef.current,
        measureSummarizer(extractiveSummarize, measurement),
        0,
      );
      remember(compacted);
      measurement.afterBytes = historyBytes(compacted);
    } catch (failure) {
      setError(failureMessage(failure, "Compaction failed."));
    } finally {
      setStats({ ...measurement });
    }
  }

  function applyProposal() {
    if (!review || review.source !== "ai") return;
    if (files[review.path]?.content !== review.base) {
      setError(
        "File changed since this proposal. Request a fresh edit to avoid overwriting your work.",
      );
      setReview(null);
      return;
    }
    setFiles((previous) => ({
      ...previous,
      [review.path]: { ...previous[review.path], content: review.next },
    }));
    setActive(review.path);
    setSelectedRange({ from: 0, to: 0 });
    setProposal(null);
    setReview(null);
    setPanel("changes");
    setPanelOpen(true);
    setMobilePane("editor");
    setNotice("Applied locally. Nothing has been sent to GitHub.");
  }

  async function publishChanges(
    branch: string,
    message: string,
    destination: "new-branch" | "main" = "new-branch",
  ): Promise<{ url?: string; error?: string }> {
    if (!repo) return { error: "No repository is connected." };
    setNetworkBusy(true);
    setError("");
    const submitted = [...changes];
    try {
      const client = new GitHub(token);
      const url = await client.publish(
        repo,
        branch,
        message,
        submitted.map(([path, file]) => ({ path, content: file.content })),
        destination,
      );
      setPublishedUrl(url);
      setPublishing(false);
      if (destination === "main") {
        try {
          const refreshed = await client.open(
            `${repo.owner}/${repo.name}`,
            "main",
          );
          if (refreshed.head !== new URL(url).pathname.split("/").at(-1))
            throw new Error("Main advanced again after your commit.");
          setRepo(refreshed);
          setFiles((previous) => {
            const next = { ...previous };
            for (const [path, file] of submitted)
              next[path] = {
                ...next[path],
                original: file.content,
                isNew: false,
              };
            return next;
          });
          setNotice("Published to main. Workspace is up to date.");
        } catch {
          setNotice(
            "Published to main, but the workspace could not be refreshed. Download any remaining edits and reopen main before continuing.",
          );
        }
      } else {
        setNotice(
          `Published ${branch}. Local edits retained; reopen the new branch to continue.`,
        );
      }
      return { url };
    } catch (failure) {
      const error = failureMessage(failure, "Publish failed.");
      setError(error);
      return { error };
    } finally {
      setNetworkBusy(false);
    }
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    await publishChanges(
      publishDestination === "main" ? "main" : publishBranch,
      commitMessage,
      publishDestination,
    );
  }

  const isCommand = request !== prefilled && parseCommand(request) !== null;
  const prospectiveBytes = promptBytes(
    assemblePrompt(
      {
        instruction,
        pinned,
        notes,
        fileContext: currentContext(),
        request,
        skills: skillText,
      },
      emptyMemory(),
    ),
  );
  const exportConversation = () =>
    download(
      "technicalskills-session.json",
      JSON.stringify(
        {
          model: selectedModelId,
          transcript,
          memory,
          pinned,
          notes,
          goalLoop: goalSettings,
          skills: attachedSkills,
        },
        null,
        2,
      ),
      "application/json",
    );

  return (
    <div className={`app mobile-${mobilePane}`}>
      <header className="titlebar">
        <div className="brand">
          <Code2 size={21} />
          <span>technicalskills</span>
          <span className="preview-label">LOCAL</span>
        </div>
        <div className="workspace-name">
          <GitBranch size={13} />
          <span>
            {repo ? `${repo.owner} / ${repo.name}` : "Scratch workspace"}
          </span>
        </div>
        <button
          className="button skills-button"
          onClick={() => setSkillsOpen(true)}
          title="Browse skills library"
        >
          <BookOpen size={16} />
          Skills
          {attachedSkills.length > 0 && (
            <span className="count">{attachedSkills.length}</span>
          )}
        </button>
        <button
          className="button connect-button"
          onClick={() => {
            setTokenInput(token);
            setConnecting(true);
            setError("");
          }}
          disabled={busy}
        >
          <Github size={15} />
          {repo ? "Repository" : "Open GitHub"}
        </button>
      </header>

      <nav className="activity" aria-label="Workspace panels">
        <button
          title="Explorer"
          aria-label="Explorer"
          className={mobilePane === "files" ? "active" : ""}
          onClick={() => setMobilePane("files")}
        >
          <Files size={23} />
          <span className="tab-label">Files</span>
        </button>
        <button
          title="Editor"
          aria-label="Editor"
          className={mobilePane === "editor" ? "active" : ""}
          onClick={() => setMobilePane("editor")}
        >
          <Code2 size={23} />
          <span className="tab-label">Editor</span>
          {changes.length > 0 && (
            <span
              className="tab-badge"
              aria-label={`${changes.length} modified`}
            >
              {changes.length}
            </span>
          )}
        </button>
        <button
          title="Local assistant"
          aria-label="Local assistant"
          className={mobilePane === "assistant" ? "active" : ""}
          onClick={() => setMobilePane("assistant")}
        >
          <MessageSquare size={23} />
          <span className="tab-label">Assistant</span>
        </button>
        <div className="activity-spacer" />
        <ShieldCheck
          size={21}
          className="privacy-icon"
          aria-label="Local inference"
        />
      </nav>

      <aside className="explorer">
        <div className="section-heading">
          <h2>EXPLORER</h2>
          <div className="heading-actions">
            <button
              className="icon-button"
              title="New file"
              aria-label="New file"
              disabled={busy}
              onClick={openNewFile}
            >
              <FilePlus size={16} />
            </button>
            <span className="count">{allPaths.length}</span>
          </div>
        </div>
        <div className="search-box">
          <Search size={14} />
          <input
            aria-label="Find files"
            placeholder="Find a file..."
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <div className="repo-caption">
          <ChevronRight size={14} />
          <span>{repo?.name || "scratch"}</span>
        </div>
        <div className="workspace-download">
          <button
            className="button full"
            disabled={busy || !Object.keys(files).length}
            onClick={downloadWorkspace}
            title="Download all open and newly created files, preserving folders"
          >
            <Download size={14} />
            Download workspace ZIP
          </button>
          <button className="button full" disabled={busy} onClick={() => zipInput.current?.click()}>
            Import workspace ZIP
          </button>
          <input ref={zipInput} type="file" accept=".zip,application/zip" hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importZip(file);
            }} />
          <p className="save-status" role="status">{saveStatus}</p>
          <details className="save-panel">
            <summary>Saving and recovery</summary>
            {recoveryReady && !recoveryEnabled && (
              <button className="button full" onClick={() => {
                if (window.confirm("Enable local autosave? This will replace any unreadable saved workspace with the current one."))
                  setRecoveryEnabled(true);
              }}>Enable local recovery</button>
            )}
            <p>Local saves run every second. Cloud and recovered files reopen as a local workspace; reconnect GitHub separately.</p>
            <CloudSave session={session} busy={busy} autosaveBusy={networkBusy || !recoveryReady || (busy && !goalRunning)}
              restore={restoreSession} connecting={setNetworkBusy} />
          </details>
        </div>
        <div className="file-list">
          {visiblePaths.map((path) => (
            <button
              key={path}
              disabled={busy}
              className={`file-row ${path === active ? "selected" : ""}`}
              title={path}
              onClick={() => openFile(path)}
            >
              <FileCode2 size={15} />
              <span>{path}</span>
              {files[path] && isChanged(files[path]) && (
                <b>{files[path].isNew ? "A" : "M"}</b>
              )}
            </button>
          ))}
          {!visiblePaths.length && (
            <p className="empty-label">No matching files</p>
          )}
        </div>
        <div className="explorer-bottom">
          {!repo && (
            <p className="muted">
              No repository needed. Create files, edit or apply AI proposals,
              then download your workspace.
            </p>
          )}
          <span className="eyebrow">SOURCE</span>
          <div>
            <GitBranch size={14} />
            <span>{repo?.branch || "local only"}</span>
          </div>
          {repo && (
            <button
              className="text-button"
              title="Forget GitHub credentials"
              disabled={busy || !token}
              onClick={() => {
                setToken("");
                setNotice(
                  "GitHub token forgotten. Public reads remain available.",
                );
              }}
            >
              <Unplug size={13} />
              Forget token
            </button>
          )}
        </div>
      </aside>

      <main className="editor-area">
        <div className="editor-tabs" role="tablist" aria-label="Open files">
          {Object.keys(files).map((path) => (
            <button
              key={path}
              role="tab"
              aria-selected={path === active}
              disabled={busy}
              className={path === active ? "selected" : ""}
              onClick={() => openFile(path)}
            >
              <FileCode2 size={14} />
              <span>{path.split("/").at(-1)}</span>
              {isChanged(files[path]) && (
                <Circle size={7} fill="currentColor" />
              )}
            </button>
          ))}
          <div className="tab-spacer" />
          <div className="tab-actions">
            <button
              className="icon-button"
              title="Preview app (HTML, CSS, JavaScript)"
              aria-label="Preview app"
              onClick={launchPreview}
            >
              <Play size={16} />
            </button>
            <button
              className="icon-button"
              title="Download current file"
              aria-label="Download current file"
              disabled={!activeFile}
              onClick={() =>
                download(active.split("/").at(-1)!, activeFile.content)
              }
            >
              <ArrowDownToLine size={16} />
            </button>
          </div>
        </div>
        <div className="breadcrumb">
          <span>{repo?.name || "scratch"}</span>
          <ChevronRight size={12} />
          <span>{active || "No file selected"}</span>
          {selectionSize > 0 && (
            <span className="selection-badge">
              {selectionSize} characters selected
            </span>
          )}
        </div>
        <div className="code-surface">
          {activeFile ? (
            <CodeMirror
              key={active}
              value={activeFile.content}
              readOnly={!recoveryReady || networkBusy || goalRunning}
              height="100%"
              extensions={[
                ...extensions(active),
                ...(mobile ? [EditorView.lineWrapping] : []),
              ]}
              basicSetup={{ foldGutter: !mobile, autocompletion: true }}
              onChange={(content) =>
                setFiles((previous) => ({
                  ...previous,
                  [active]: { ...previous[active], content },
                }))
              }
              onUpdate={(update) => {
                if (update.selectionSet || update.docChanged) {
                  const range = update.state.selection.main;
                  setSelectedRange((previous) =>
                    previous.from === range.from && previous.to === range.to
                      ? previous
                      : { from: range.from, to: range.to },
                  );
                }
              }}
            />
          ) : (
            <div className="empty-editor">
              <Files size={35} strokeWidth={1} />
              <h2>No file selected</h2>
              <span>{repo?.name || "Workspace"}</span>
            </div>
          )}
        </div>
        <section className={`bottom-panel ${panelOpen ? "" : "collapsed"}`}>
          <div className="bottom-tabs">
            <button
              className={panelOpen && panel === "changes" ? "selected" : ""}
              aria-expanded={panelOpen && panel === "changes"}
              onClick={() => pickPanel("changes")}
            >
              Changes <span className="count">{changes.length}</span>
            </button>
            <button
              className={panelOpen && panel === "memory" ? "selected" : ""}
              aria-expanded={panelOpen && panel === "memory"}
              onClick={() => pickPanel("memory")}
            >
              Memory <span className="count">{memory.nodes.length}</span>
            </button>
            <div className="tab-spacer" />
            {panel === "memory" ? (
              <button
                className="icon-button"
                title="Compact all completed turns now"
                aria-label="Compact all completed turns now"
                disabled={busy || !memory.recent.length}
                onClick={compactNow}
              >
                <Layers size={15} />
              </button>
            ) : (
              <button
                className="text-button"
                disabled={!repo || !changes.length || busy}
                onClick={() => {
                  setPublishDestination("new-branch");
                  setPublishBranch(
                    `work/local-edit-${Date.now().toString(36)}`,
                  );
                  setCommitMessage("Apply reviewed changes");
                  setPublishing(true);
                  setError("");
                }}
              >
                <GitBranch size={14} />
                Publish
              </button>
            )}
          </div>
          {panel === "memory" ? (
            <div className="memory-panel">
              <p className="compaction-stats" aria-label="Last compaction statistics">
                Last preparation: {stats.calls} local compaction steps (no model calls) · {stats.milliseconds.toFixed(0)} ms · {stats.beforeBytes.toLocaleString()} → {stats.afterBytes.toLocaleString()} B.
                {" "}Manual compaction measures history bytes; request preparation measures the assembled prompt.
              </p>
              <div className="memory-stats">
                <div>
                  <strong>
                    {
                      transcript.filter((turn) =>
                        ["Complete", "Output limit reached"].includes(
                          turn.status,
                        ),
                      ).length
                    }
                  </strong>
                  <span>turns archived</span>
                </div>
                <div>
                  <strong>{memory.nodes.length}</strong>
                  <span>summary blocks</span>
                </div>
                <div>
                  <strong>
                    {memoryBytes.toLocaleString()} <small>B</small>
                  </strong>
                  <span>summary memory</span>
                </div>
                <div>
                  <strong>
                    {liveBytes.toLocaleString()} <small>B</small>
                  </strong>
                  <span>last packed prompt</span>
                </div>
              </div>
              <div className="memory-nodes">
                {memory.nodes.length ? (
                  memory.nodes.map((node) => (
                    <details key={`${node.first}-${node.last}`}>
                      <summary>
                        <Layers size={13} />
                        <span>
                          Turns {node.first}-{node.last}
                        </span>
                        <span className="node-level">L{node.level}</span>
                        <span>{bytes(node.text)} B</span>
                      </summary>
                      <p>{node.text}</p>
                    </details>
                  ))
                ) : (
                  <div className="memory-empty">
                    <Layers size={17} />
                    <span>No compacted turns</span>
                    <span className="muted">
                      {archivedBytes.toLocaleString()} B in transcript
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="changes-list">
              {changes.length ? (
                changes.map(([path, file]) => (
                  <button
                    key={path}
                    onClick={() =>
                      setReview({
                        path,
                        base: file.original,
                        next: file.content,
                        source: "manual",
                      })
                    }
                  >
                    <span className="modified-label">
                      {file.isNew ? "A" : "M"}
                    </span>
                    <span>{path}</span>
                    <span className="muted">Review diff</span>
                    <ChevronRight size={14} />
                  </button>
                ))
              ) : (
                <div className="memory-empty">
                  <Check size={17} />
                  <span>No local changes</span>
                </div>
              )}
              {publishedUrl && (
                <a
                  className="compare-link"
                  href={publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {publishedUrl.includes("/commit/")
                    ? "View commit on GitHub"
                    : "Open pull request on GitHub"}{" "}
                  <ChevronRight size={14} />
                </a>
              )}
            </div>
          )}
        </section>
      </main>

      <aside className="assistant">
        <div className="section-heading">
          <h2>LOCAL ASSISTANT</h2>
          <div className="heading-actions">
            <button
              className="icon-button"
              title="Export conversation and memory"
              aria-label="Export conversation and memory"
              disabled={!transcript.length}
              onClick={exportConversation}
            >
              <Download size={15} />
            </button>
            <button
              className="icon-button"
              title="New conversation"
              aria-label="New conversation"
              disabled={busy}
              onClick={clearConversation}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
        <div className="model-bar">
          <div className="model-avatar">
            <Code2 size={17} />
          </div>
          <div>
            <strong>{selectedModel.name}</strong>
            <span className="model-status">
              <span className={`status-dot ${ready ? "online" : ""}`} />
              {phase === "loading"
                ? "Downloading model"
                : ready
                  ? "Running in browser"
                  : "Not loaded"}
            </span>
          </div>
          {ready && <ShieldCheck size={17} className="model-shield" />}
        </div>
        <div className="model-picker">
          <label htmlFor="browser-model">Browser model</label>
          <select
            id="browser-model"
            value={selectedModelId}
            disabled={busy}
            onChange={(event) => {
              model.current?.dispose();
              model.current = null;
              setReady(false);
              setSelectedModelId(event.target.value);
              setError("");
              setProgress({ value: 0, text: "" });
            }}
          >
            {MODEL_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
          <div className="model-specs">
            <span>{selectedModel.purpose}</span>
            <span>
              Est. GPU {(selectedModel.memoryMB / 1024).toFixed(1)} GB
              {selectedModel.half ? " / FP16" : " / FP32"}
            </span>
          </div>
        </div>
        {!ready && (
          <div className="load-controls">
            {phase === "loading" ? (
              <>
                <progress value={progress.value} max="1" />
                <p>{progress.text}</p>
                <button
                  className="text-button"
                  onClick={() => controller.current?.abort()}
                >
                  <Square size={12} />
                  Cancel download
                </button>
              </>
            ) : (
              <button
                className="button primary full"
                disabled={busy}
                onClick={loadModel}
              >
                <Download size={14} />
                Load model <span className="button-note">ModelScope</span>
              </button>
            )}
          </div>
        )}
        <div className="chat-log" aria-live="polite">
          {!transcript.length && (
            <div className="chat-empty">
              <div className="empty-mark">
                <MessageSquare size={25} strokeWidth={1.5} />
              </div>
              <h2>New conversation</h2>
              <div className="local-label">
                <ShieldCheck size={13} />
                Local inference
              </div>
            </div>
          )}
          {mobile && transcript.length > 6 && (
            <p className="muted">
              Showing the latest 6 exchanges. Export to keep the full
              conversation.
            </p>
          )}
          {(mobile ? transcript.slice(-6) : transcript).map((turn) => (
            <article className="exchange" key={turn.id}>
              <div className="chat-person">
                YOU <span>{turn.file.split("/").at(-1)}</span>
              </div>
              <p className="user-message">{turn.request}</p>
              <div className="chat-person assistant-person">
                <Code2 size={13} />
                {turn.status === "Done" ? "APP" : (turn.model ?? "MODEL")}{" "}
                <span>{turn.status}</span>
              </div>
              <pre className="answer">
                {turn.response ||
                  (turn.status === "Preparing context"
                    ? "Preparing context..."
                    : turn.status === "Failed"
                      ? "Request failed."
                      : "...")}
              </pre>
              {turn.status === "Complete" && turn.response.includes("<") && (() => {
                const html = htmlFromReply(turn.response);
                return html && (
                  <div className="answer-actions">
                    <button className="button" disabled={busy} onClick={() => startPreview(SNIPPET_PAGE, html)}>
                      <Play size={14} />Run
                    </button>
                    <button className="button" disabled={busy} onClick={() => saveSnippet(html)}>
                      <FilePlus size={14} />Save as file
                    </button>
                  </div>
                );
              })()}
            </article>
          ))}
          <div ref={endOfChat} />
        </div>
        {proposal && (
          <div className="proposal-banner">
            <div>
              <FileCode2 size={15} />
              <span>{proposal.path.split("/").at(-1)}</span>
              <button
                className="icon-button"
                title="Discard AI proposal"
                aria-label="Discard AI proposal"
                onClick={() => setProposal(null)}
              >
                <X size={14} />
              </button>
            </div>
            <button
              className="button primary full"
              onClick={() => setReview(proposal)}
            >
              Review proposed edit <ChevronRight size={14} />
            </button>
          </div>
        )}
        <div className="composer-area">
          <GoalPanel settings={goalSettings} change={setGoalSettings}
            ready={ready} blocked={busy || Boolean(proposal || review) || creating || connecting || publishing || skillsOpen}
            workspace={() => goalWorkspace.current} tools={agentTools}
            ask={askGoal} apply={applyGoal} running={(running) => {
              setGoalRunning(running);
              if (running) setError("");
              setNotice(running
                ? "Goal mode is applying reviewed edits locally. Use its steering, Pause, or Stop controls."
                : "Goal mode stopped. Review local changes and test externally before publishing.");
            }} failure={setError} />
          <details className="pinned">
            <summary>Project notes (saved, editable)</summary>
            <textarea aria-label="Project notes" value={notes} maxLength={4000} disabled={busy}
              placeholder="Goals, decisions, unresolved tasks..."
              onChange={(event) => setNotes(event.target.value)} />
          </details>
          <details className="pinned">
            <summary>
              <Pin size={13} />
              Pinned requirements
              {pinned && <span className="status-dot online" />}
            </summary>
            <textarea
              aria-label="Pinned requirements"
              value={pinned}
              maxLength={4000}
              disabled={busy}
              onChange={(event) => setPinned(event.target.value)}
              placeholder="Keep public APIs unchanged..."
            />
          </details>
          {attachedSkills.length > 0 && (
            <div className="attached-skills" aria-label="Attached skills">
              {attachedSkills.map((skill) => (
                <span className="attached-skill" key={skill.id}>
                  <button
                    title={`View ${skill.name}`}
                    onClick={() => setSkillsOpen(true)}
                  >
                    <BookOpen size={12} />
                    <span>{skill.name}</span>
                  </button>
                  <button
                    className="icon-button"
                    title={`Detach ${skill.name}`}
                    aria-label={`Detach ${skill.name}`}
                    disabled={busy}
                    onClick={() => {
                      try {
                        toggleSkill(skill.id);
                      } catch (failure) {
                        setError(String(failure));
                      }
                    }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form ref={formRef} onSubmit={send}>
            <div
              className="mode-switch"
              role="group"
              aria-label="Assistant mode"
            >
              <button
                type="button"
                className={mode === "explain" ? "selected" : ""}
                disabled={busy}
                onClick={() => setMode("explain")}
              >
                <MessageSquare size={13} />
                Explain
              </button>
              <button
                type="button"
                className={mode === "edit" ? "selected" : ""}
                disabled={busy}
                onClick={() => setMode("edit")}
              >
                <Code2 size={13} />
                Edit
              </button>
            </div>
            <div className="prompt-input">
              <textarea
                aria-label="Coding request"
                placeholder={
                  mode === "edit"
                    ? "Describe a focused change..."
                    : "Ask about the code, or /open owner/repo"
                }
                value={request}
                maxLength={12000}
                title="Enter to send; Shift+Enter for a new line"
                disabled={busy}
                onChange={(event) => setRequest(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    event.currentTarget.form
                      ?.querySelector<HTMLButtonElement>('button[type="submit"]')
                      ?.click();
                  }
                }}
              />
              <div className="prompt-bottom">
                <span title={active}>
                  {activeFile
                    ? `${active.split("/").at(-1)}${selectionSize ? " / selection" : ""}`
                    : "No code context"}
                </span>
                {!goalRunning && (phase === "thinking" || phase === "compacting") ? (
                  <button
                    type="button"
                    className="send-button stop"
                    title="Stop generation or compaction"
                    aria-label="Stop generation or compaction"
                    onClick={() => controller.current?.abort()}
                  >
                    <Square size={13} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    title="Send request"
                    aria-label="Send request"
                    disabled={
                      (!ready && !isCommand) ||
                      busy ||
                      !request.trim() ||
                      (!isCommand && prospectiveBytes > INPUT_BYTE_BUDGET)
                    }
                  >
                    <ArrowUp size={18} />
                  </button>
                )}
              </div>
            </div>
            <div
              className={`budget-label ${prospectiveBytes > INPUT_BYTE_BUDGET ? "over-budget" : ""}`}
            >
              <span>
                {phase === "thinking" || phase === "compacting" ? (
                  <>
                    <LoaderCircle size={11} className="spin" />
                    {phase === "compacting"
                      ? "Compacting memory"
                      : "Generating"}
                  </>
                ) : (
                  "Protected prompt"
                )}
              </span>
              <span>
                {prospectiveBytes.toLocaleString()} /{" "}
                {INPUT_BYTE_BUDGET.toLocaleString()} B
              </span>
            </div>
            {prospectiveBytes > INPUT_BYTE_BUDGET && (
              <div className="budget-warning">
                Select less code or shorten the request.
              </div>
            )}
          </form>
        </div>
      </aside>

      {(error || notice) && (
        <div
          className={`notification ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          <button
            className="icon-button"
            title="Dismiss notification"
            aria-label="Dismiss notification"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <footer className="statusbar">
        <span>
          <GitBranch size={12} />
          {repo?.branch || "scratch"}
        </span>
        <span>
          <Circle size={8} />
          {changes.length} modified
        </span>
        <div className="tab-spacer" />
        <span className="status-local">
          <ShieldCheck size={12} />
          {ready ? "Local model ready" : "Model offline"}
        </span>
        <span>UTF-8</span>
        <span className="window-status">4K context</span>
      </footer>

      {skillsOpen && (
        <Dialog
          title="Skills Store"
          wide
          className="skills-dialog"
          close={() => setSkillsOpen(false)}
        >
          <SkillStore
            skills={availableSkills}
            importedIds={skillLibrary.imported.map((skill) => skill.id)}
            attachedIds={skillLibrary.attachedIds}
            disabled={busy}
            warning={skillLibrary.warning}
            onToggle={toggleSkill}
            onImport={(incoming) =>
              saveSkillLibrary(
                mergeImportedSkills(
                  skillLibrary.imported,
                  incoming,
                  BUILTIN_SKILLS.map((skill) => skill.id),
                ),
                skillLibrary.attachedIds,
              )
            }
            onRemove={(id) =>
              saveSkillLibrary(
                skillLibrary.imported.filter((skill) => skill.id !== id),
                skillLibrary.attachedIds.filter((attached) => attached !== id),
              )
            }
          />
        </Dialog>
      )}
      {creating && (
        <Dialog title="New File" close={() => setCreating(false)}>
          <form
            className="dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              const problem = createFile(newPath);
              setNewPathError(problem);
              if (!problem) setCreating(false);
            }}
          >
            <label>
              File path{" "}
              <span className="muted">folders are created automatically</span>
              <input
                required
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                placeholder="src/components/Button.tsx"
              />
            </label>
            {newPathError && (
              <p className="form-error" role="alert">
                {newPathError}
              </p>
            )}
            <footer>
              <button
                type="button"
                className="button"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
              <button className="button primary">
                <FilePlus size={14} />
                Create file
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {connecting && (
        <Dialog
          title="Open GitHub Repository"
          close={() => {
            if (!networkBusy) {
              setConnecting(false);
              setTokenInput("");
            }
          }}
        >
          <form onSubmit={connect} className="dialog-form">
            <label>
              Repository
              <input
                required
                autoFocus
                value={repoInput}
                onChange={(event) => setRepoInput(event.target.value)}
                placeholder="owner/repository"
                disabled={networkBusy}
              />
            </label>
            <label>
              Branch <span className="muted">optional</span>
              <input
                value={branchInput}
                onChange={(event) => setBranchInput(event.target.value)}
                placeholder="Default branch"
                disabled={networkBusy}
              />
            </label>
            <label>
              GitHub token{" "}
              <span className="muted">private repos / publishing</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                disabled={networkBusy}
                placeholder="Fine-grained personal access token"
              />
            </label>
            <TokenHelp />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                className="button"
                disabled={networkBusy}
                onClick={() => {
                  setConnecting(false);
                  setTokenInput("");
                }}
              >
                Cancel
              </button>
              <button className="button primary" disabled={networkBusy}>
                {networkBusy ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Github size={14} />
                )}
                Open repository
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {publishing && (
        <Dialog
          title="Publish Changes"
          close={() => {
            if (!networkBusy) setPublishing(false);
          }}
        >
          <form className="dialog-form" onSubmit={publish}>
            <div
              className="mode-switch"
              role="group"
              aria-label="Publish destination"
            >
              <button
                type="button"
                aria-pressed={publishDestination === "new-branch"}
                className={
                  publishDestination === "new-branch" ? "selected" : ""
                }
                disabled={networkBusy}
                onClick={() => setPublishDestination("new-branch")}
              >
                <GitBranch size={14} />
                New branch
              </button>
              <button
                type="button"
                aria-pressed={publishDestination === "main"}
                className={publishDestination === "main" ? "selected" : ""}
                disabled={networkBusy || repo?.branch !== "main"}
                title={
                  repo?.branch === "main"
                    ? "Commit directly to main"
                    : "Open the main branch first"
                }
                onClick={() => setPublishDestination("main")}
              >
                <Github size={14} />
                Publish to main
              </button>
            </div>
            <div className="publish-summary">
              <GitBranch size={16} />
              <span>{repo?.branch}</span>
              <ChevronRight size={14} />
              <span>{changes.length} changed files</span>
            </div>
            {publishDestination === "new-branch" ? (
              <label>
                New branch
                <input
                  required
                  value={publishBranch}
                  onChange={(event) => setPublishBranch(event.target.value)}
                  disabled={networkBusy}
                />
              </label>
            ) : (
              <p className="token-help">
                Commits all listed files directly to main. Branch protection
                rules still apply.
              </p>
            )}
            <label>
              Commit message
              <input
                required
                maxLength={200}
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                disabled={networkBusy}
              />
            </label>
            <label>
              GitHub token
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
                disabled={networkBusy}
              />
            </label>
            <TokenHelp />
            <div className="publish-files">
              {changes.map(([path]) => (
                <div key={path}>
                  <FileCode2 size={13} />
                  {path}
                </div>
              ))}
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                className="button"
                type="button"
                disabled={networkBusy}
                onClick={() => setPublishing(false)}
              >
                Cancel
              </button>
              <button className="button primary" disabled={networkBusy}>
                {networkBusy ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <GitBranch size={14} />
                )}
                {publishDestination === "main"
                  ? "Publish to main"
                  : "Commit to new branch"}
              </button>
            </footer>
          </form>
        </Dialog>
      )}
      {previewEntry && (
        <Dialog wide title="Preview app" close={() => { setPreviewEntry(""); setPreviewSnippet(""); }}>
          <Preview
            entry={previewEntry}
            files={() => {
              const live = Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.content]));
              return previewSnippet ? { ...live, [SNIPPET_PAGE]: previewSnippet } : live;
            }}
            save={(name, html) => download(name, html, "text/html")}
          />
        </Dialog>
      )}
      {review && (
        <Dialog
          wide
          title={`Review / ${review.path}`}
          close={() => setReview(null)}
        >
          <div className="diff-legend">
            <span>
              <span className="diff-minus" />
              Removed
            </span>
            <span>
              <span className="diff-plus" />
              Added
            </span>
            <span className="muted">
              {review.source === "ai" ? "AI proposal" : "Local edits"}
            </span>
          </div>
          <div className="diff-content">
            <CodeMirror
              value={review.next}
              editable={false}
              readOnly
              extensions={[
                ...extensions(review.path),
                unifiedMergeView({
                  original: review.base,
                  mergeControls: false,
                }),
              ]}
            />
          </div>
          <footer className="review-footer">
            <button className="button" onClick={() => setReview(null)}>
              Close
            </button>
            {review.source === "ai" && (
              <button className="button primary" onClick={applyProposal}>
                <Check size={15} />
                Apply locally
              </button>
            )}
          </footer>
        </Dialog>
      )}
    </div>
  );
}

export default App;
