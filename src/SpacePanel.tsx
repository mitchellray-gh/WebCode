import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { activeSpace, addSpace, parsePaths, removeSpace, saveTask, updateSpace } from "./spaces";
import type { SpacesState } from "./spaces";

type Props = {
  state: SpacesState; change: (state: SpacesState) => void; openPaths: string[]; disabled: boolean;
  goal: string; loadGoal: (goal: string) => void;
};

function Editor({ state, change, openPaths, disabled, goal, loadGoal }: Props) {
  const space = activeSpace(state)!;
  const [paths, setPaths] = useState(space.paths.join("\n"));
  const [taskName, setTaskName] = useState("");
  const [taskError, setTaskError] = useState("");
  return (
    <div className="space-editor">
      <label>Name
        <input value={space.name} maxLength={40} disabled={disabled}
          onChange={(event) => change(updateSpace(state, space.id, { name: event.target.value }))} />
      </label>
      <label>Instructions for this space (always sent, verbatim)
        <textarea value={space.instructions} maxLength={1000} disabled={disabled}
          placeholder="Architecture, style, approved libraries, how to test..."
          onChange={(event) => change(updateSpace(state, space.id, { instructions: event.target.value }))} />
      </label>
      <label>Files to focus on (one path per line; agent mode opens them when needed)
        <textarea value={paths} disabled={disabled}
          onChange={(event) => setPaths(event.target.value)}
          onBlur={() => {
            const parsed = parsePaths(paths);
            setPaths(parsed.join("\n"));
            change(updateSpace(state, space.id, { paths: parsed }));
          }} />
      </label>
      <div className="goal-actions">
        <button className="button" disabled={disabled || !openPaths.length}
          onClick={() => {
            const parsed = parsePaths(openPaths.join("\n"));
            setPaths(parsed.join("\n"));
            change(updateSpace(state, space.id, { paths: parsed }));
          }}>Use open files</button>
        <button className="button" disabled={disabled}
          onClick={() => { if (window.confirm(`Delete the space "${space.name}"?`)) change(removeSpace(state, space.id)); }}>
          <Trash2 size={14} />Delete space
        </button>
      </div>
      <p><strong>Saved tasks</strong> (reusable Agent mode goals; run one on demand, nothing starts by itself)</p>
      <ul className="connector-tools">
        {space.tasks.map((task) => (
          <li key={task.name}>
            <span>{task.name}</span>{" "}
            <button className="button" disabled={disabled} onClick={() => loadGoal(task.goal)}>Use as goal</button>{" "}
            <button className="icon-button" disabled={disabled} aria-label={`Delete task ${task.name}`} title="Delete task"
              onClick={() => change(updateSpace(state, space.id, { tasks: space.tasks.filter((entry) => entry.name !== task.name) }))}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
        {!space.tasks.length && <li>No saved tasks yet.</li>}
      </ul>
      <label>Save the current goal as a task
        <input value={taskName} maxLength={40} disabled={disabled} placeholder="Task name, e.g. Add tests"
          onChange={(event) => setTaskName(event.target.value)} />
      </label>
      <button className="button" disabled={disabled || !goal.trim() || !taskName.trim()}
        onClick={() => {
          try {
            setTaskError("");
            change(saveTask(state, space.id, taskName, goal));
            setTaskName("");
          } catch (failure) {
            setTaskError(failure instanceof Error ? failure.message : "Could not save the task.");
          }
        }}>Save task</button>
      {taskError && <p className="form-error" role="alert">{taskError}</p>}
    </div>
  );
}

export default function SpacePanel({ state, change, openPaths, disabled, goal, loadGoal }: Props) {
  const [error, setError] = useState("");
  const space = activeSpace(state);
  return (
    <div className="space-panel">
      <p>A space keeps instructions and key files for one project. Its instructions are added to every request; its files guide agent mode.</p>
      <div className="preview-bar">
        <select aria-label="Active space" value={state.active} disabled={disabled}
          onChange={(event) => change({ ...state, active: event.target.value })}>
          <option value="">No space</option>
          {state.spaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button className="button" disabled={disabled}
          onClick={() => {
            try {
              setError("");
              change(addSpace(state, `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, openPaths));
            } catch (failure) {
              setError(failure instanceof Error ? failure.message : "Could not add a space.");
            }
          }}>
          <Plus size={14} />New space
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {space && <Editor key={space.id} state={state} change={change} openPaths={openPaths} disabled={disabled} goal={goal} loadGoal={loadGoal} />}
    </div>
  );
}
