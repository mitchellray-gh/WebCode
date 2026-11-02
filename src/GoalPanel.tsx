import { useEffect, useRef, useState } from "react";
import { runGoalLoop } from "./goalLoop";
import type { GoalCall, GoalEdit, GoalFiles, GoalInput, GoalSettings, GoalTools } from "./goalLoop";

export default function GoalPanel(props: {
  settings: GoalSettings;
  change: (settings: GoalSettings) => void;
  blocked: boolean;
  ready: boolean;
  workspace: () => { files: GoalFiles; paths: string[] };
  tools?: GoalTools;
  hint?: () => string;
  ask: (call: GoalCall, signal: AbortSignal) => Promise<string>;
  apply: (edit: GoalEdit) => void;
  running: (running: boolean) => void;
  failure: (message: string) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [steeringDraft, setSteeringDraft] = useState<string | null>(null);
  const [status, setStatus] = useState("Off. No changes are made until you explicitly start.");
  const abort = useRef<AbortController | null>(null);
  const pause = useRef(false);
  const input = useRef<GoalInput>({ ...props.settings, revision: 0 });
  useEffect(() => {
    input.current = { ...props.settings, revision: input.current.revision + 1 };
  }, [props.settings]);
  useEffect(() => () => abort.current?.abort(), []);

  async function start() {
    if (abort.current || props.blocked || !props.ready || !props.settings.goal.trim()) return;
    const controller = new AbortController();
    abort.current = controller;
    pause.current = false;
    setPaused(false); setActive(true); props.running(true);
    try {
      const result = await runGoalLoop({
        input: () => input.current,
        workspace: props.workspace,
        tools: props.tools,
        hint: props.hint,
        ask: (call) => props.ask(call, controller.signal),
        apply: props.apply,
        signal: controller.signal,
        pauseRequested: () => pause.current,
        stage: (cycle, stage, detail) => setStatus(`Cycle ${cycle} · ${stage}: ${detail}`),
      });
      setStatus(result === "paused" ? "Paused after the current cycle. Restart to continue." : "Model reports the goal complete. Review the changes before publishing.");
    } catch (error) {
      const message = controller.signal.aborted
        ? "Stopped. Unreviewed drafts were not applied. Reload the model if generation was interrupted."
        : error instanceof Error ? error.message : "Goal loop failed.";
      setStatus(message);
      if (!controller.signal.aborted) props.failure(message);
    } finally {
      abort.current = null; setActive(false); setPaused(false); props.running(false);
    }
  }

  return (
    <div className="goal-panel">
      <label className="goal-toggle">
        <input type="checkbox" checked={enabled} disabled={active}
          onChange={(event) => setEnabled(event.target.checked)} />
        Agent mode
      </label>
      {enabled && (
        <div className="goal-controls">
          <p>Plans, searches, reads, edits and runs your page in a sandbox to check it, then applies reviewed edits to open/new files locally. It never publishes, and connector tools need your approval. Same-model review is not a guarantee of correctness.</p>
          <label>Goal
            <textarea aria-label="Loop goal" value={props.settings.goal} maxLength={2000}
              disabled={active || props.blocked} placeholder="Build a small calculator with accessible controls..."
              onChange={(event) => props.change({ ...props.settings, goal: event.target.value })} />
          </label>
          <label>Steer the next cycle
            <textarea aria-label="Loop steering" value={steeringDraft ?? props.settings.steering} maxLength={1000}
              placeholder="Change direction, add a constraint, or narrow the next step..."
              onChange={(event) => setSteeringDraft(event.target.value)} />
          </label>
          <button className="button full" disabled={steeringDraft === null || steeringDraft === props.settings.steering}
            onClick={() => {
              const settings = { ...props.settings, steering: steeringDraft ?? props.settings.steering };
              input.current = { ...settings, revision: input.current.revision + 1 };
              props.change(settings);
              setSteeringDraft(null);
              setStatus("Steering queued. Any draft based on older steering will be discarded before applying.");
            }}>Send steering</button>
          <div className="goal-actions">
            {!active ? (
              <button className="button primary" disabled={props.blocked || !props.ready || !props.settings.goal.trim()}
                onClick={() => void start()}>Start / resume</button>
            ) : (
              <>
                <button className="button" disabled={paused} onClick={() => {
                  pause.current = true; setPaused(true);
                  setStatus("Pause requested. Finishing the current cycle and its review.");
                }}>Pause after cycle</button>
                <button className="button" onClick={() => abort.current?.abort()}>Stop now</button>
              </>
            )}
          </div>
          <p role="status">{status}</p>
          {!props.ready && <p>Load a browser model before starting.</p>}
          <p>Runs while this page stays open. Stops on errors, repeated/no-op edits, or a completion claim. Goal and steering are saved; execution never auto-resumes.</p>
        </div>
      )}
    </div>
  );
}
