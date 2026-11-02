import { Decoration, EditorView, Prec, StateEffect, StateField, ViewPlugin, WidgetType, keymap } from "@uiw/react-codemirror";
import type { DecorationSet, Extension, ViewUpdate } from "@uiw/react-codemirror";

type Ghost = { pos: number; text: string } | null;
const setGhost = StateEffect.define<Ghost>();

function accept(view: EditorView) {
  const ghost = view.state.field(ghostField, false);
  if (!ghost) return false;
  view.dispatch({
    changes: { from: ghost.pos, insert: ghost.text },
    selection: { anchor: ghost.pos + ghost.text.length },
    effects: setGhost.of(null),
    userEvent: "input.complete",
  });
  return true;
}

class GhostWidget extends WidgetType {
  readonly text: string;
  constructor(text: string) { super(); this.text = text; }
  eq(other: GhostWidget) { return other.text === this.text; }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = "cm-ghost";
    span.textContent = this.text;
    span.title = "Tap or press Tab to accept";
    span.setAttribute("aria-hidden", "true");
    // Phones have no Tab key: tapping the suggestion accepts it.
    span.addEventListener("mousedown", (event) => { event.preventDefault(); accept(view); });
    return span;
  }
  ignoreEvent() { return false; }
}

const ghostField = StateField.define<Ghost>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setGhost)) return effect.value;
    return transaction.docChanged || transaction.selection ? null : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value): DecorationSet =>
    value ? Decoration.set([Decoration.widget({ widget: new GhostWidget(value.text), side: 1 }).range(value.pos)]) : Decoration.none),
});

/** Updated by the app (from an effect) so the single shared extension below always sees current settings. */
export const inlineBridge = { allowed: false, request: async (_before: string, _after: string): Promise<string> => "" };

export const inlineExtension = inlineSuggestions({
  enabled: () => inlineBridge.allowed,
  request: (before, after) => inlineBridge.request(before, after),
});

/** Copilot-style ghost text after a typing pause. `request` must never throw; empty text means no suggestion. */
export function inlineSuggestions(options: {
  enabled: () => boolean;
  request: (before: string, after: string) => Promise<string>;
  delay?: number;
}): Extension {
  const plugin = ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | undefined;
    version = 0;
    view: EditorView;
    constructor(view: EditorView) { this.view = view; }
    update(update: ViewUpdate) {
      if (!update.docChanged && !update.selectionSet) return;
      this.version++;
      clearTimeout(this.timer);
      // Only real typing or pasting asks for a suggestion, never programmatic edits (agent, restore, proposals).
      const typed = update.transactions.some((transaction) => transaction.isUserEvent("input") && !transaction.isUserEvent("input.complete"));
      if (!update.docChanged || !typed || !update.state.selection.main.empty || !options.enabled()) return;
      const version = this.version;
      this.timer = setTimeout(() => void this.run(version), options.delay ?? 800);
    }
    async run(version: number) {
      if (version !== this.version || !options.enabled()) return;
      const { state } = this.view;
      const pos = state.selection.main.head;
      const text = await options.request(
        state.doc.sliceString(Math.max(0, pos - 1500), pos),
        state.doc.sliceString(pos, Math.min(state.doc.length, pos + 300)),
      );
      if (!text || version !== this.version || !this.view.dom.isConnected) return;
      this.view.dispatch({ effects: setGhost.of({ pos, text }) });
    }
    destroy() { clearTimeout(this.timer); this.version++; }
  });
  return [
    ghostField,
    plugin,
    Prec.highest(keymap.of([
      { key: "Tab", run: accept },
      { key: "Escape", run: (view) => { if (!view.state.field(ghostField, false)) return false; view.dispatch({ effects: setGhost.of(null) }); return true; } },
    ])),
  ];
}
