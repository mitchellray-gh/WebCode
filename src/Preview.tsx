import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, ArrowDownToLine } from "lucide-react";
import { buildPreview, previewPages, resolveRef, PREVIEW_CHANNEL } from "./sandbox";
import type { PreviewBuild, PreviewFiles } from "./sandbox";

type Line = { level: "log" | "info" | "warn" | "error"; text: string };
const LEVELS = ["log", "info", "warn", "error"];

export default function Preview({ files: read, entry: first, save }: {
  files: () => PreviewFiles;
  entry: string;
  save: (name: string, html: string) => void;
}) {
  const [files, setFiles] = useState(read);
  const [entry, setEntry] = useState(first);
  const [reloads, setReloads] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const pages = useMemo(() => previewPages(Object.keys(files)), [files]);
  const build = useMemo((): PreviewBuild | string => {
    try { return buildPreview(files, entry); }
    catch (error) { return error instanceof Error ? error.message : "Could not build the preview."; }
  }, [files, entry]);

  function show(next: string) {
    setEntry(next);
    setLines([]);
  }

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (event.source !== frame.current?.contentWindow || !data || typeof data !== "object") return;
      const message = data as { channel?: unknown; type?: unknown; level?: unknown; text?: unknown; href?: unknown };
      if (message.channel !== PREVIEW_CHANNEL) return;
      if (message.type === "navigate" && typeof message.href === "string") {
        const target = resolveRef(entry, message.href);
        if (target !== null && pages.includes(target)) show(target);
        else setLines((previous) => [...previous.slice(-199), { level: "warn", text: `Link to ${message.href} has no HTML page in the workspace.` }]);
      } else if (message.type === "log" && typeof message.text === "string") {
        const level = LEVELS.includes(message.level as string) ? (message.level as Line["level"]) : "log";
        const text = (message.text as string).slice(0, 500);
        setLines((previous) => [...previous.slice(-199), { level, text }]);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [entry, pages]);

  return (
    <div className="preview">
      <div className="preview-bar">
        <select aria-label="Page to preview" value={entry} onChange={(event) => show(event.target.value)}>
          {pages.map((path) => <option key={path}>{path}</option>)}
        </select>
        <button className="button" onClick={() => { setFiles(read()); setLines([]); setReloads((count) => count + 1); }}>
          <RefreshCw size={14} />Reload
        </button>
        <button className="button" disabled={typeof build === "string"}
          onClick={() => typeof build !== "string" && save(entry.split("/").at(-1)!, build.standalone)}>
          <ArrowDownToLine size={14} />Download HTML
        </button>
      </div>
      <p className="preview-note">
        Served from memory in an isolated sandbox: it cannot read your workspace, saved data or GitHub token, and its storage is temporary. Network requests the app makes are not blocked. Static HTML, CSS and JavaScript only. Reload picks up your latest edits.
      </p>
      {typeof build === "string" ? <p className="form-error" role="alert">{build}</p> : (
        <>
          {build.missing.length > 0 && (
            <p className="form-error" role="status">Not found (open or create these files): {build.missing.join(", ")}</p>
          )}
          {build.warnings.map((warning) => <p key={warning} className="form-error" role="status">{warning}</p>)}
          <iframe
            key={`${entry}:${reloads}`}
            ref={frame}
            className="preview-frame"
            title="App preview"
            sandbox="allow-scripts allow-forms allow-modals"
            referrerPolicy="no-referrer"
            srcDoc={build.frame}
          />
        </>
      )}
      <details className="preview-console-box" open>
        <summary>Console ({lines.length})</summary>
        <ol className="preview-console" aria-label="Preview console">
          {lines.length ? lines.map((line, index) => <li key={index} className={line.level}>{line.text}</li>) : <li>No output yet.</li>}
        </ol>
      </details>
    </div>
  );
}
