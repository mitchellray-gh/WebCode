import { useEffect, useRef, useState } from "react";
import { readSession } from "./session";
import type { Session } from "./session";

async function cloud(key: string, session?: Session, revision = 0) {
  const response = await fetch("/api/workspace", {
    method: session ? "PUT" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(session ? { "Content-Type": "application/json" } : {}),
    },
    ...(session ? { body: JSON.stringify({ session: readSession(session), revision }) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const type = response.headers.get("content-type") || "";
  if (!type.includes("application/json"))
    throw new Error("Cloud API unavailable. Use the Vercel deployment (plain Vite does not run API functions).");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object")
    throw new Error("Invalid cloud response.");
  if (!response.ok)
    throw new Error("error" in result && typeof result.error === "string"
      ? result.error : `Cloud request failed (${response.status}).`);
  if (!("revision" in result) || typeof result.revision !== "number" ||
      !Number.isSafeInteger(result.revision) || result.revision < 0)
    throw new Error("Invalid cloud revision.");
  if (!session && !("session" in result)) throw new Error("Cloud workspace response is missing its session.");
  return {
    revision: result.revision,
    session: "session" in result && result.session !== null ? readSession(result.session) : null,
  };
}

export default function CloudSave({
  session, busy, restore, connecting,
}: {
  session: Session; busy: boolean; restore: (session: Session) => void;
  connecting: (value: boolean) => void;
}) {
  const [key, setKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState("Cloud disconnected. Access key stays in memory.");
  const current = useRef({ session, busy });
  const saved = useRef<Session | null>(null);
  const revision = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => { current.current = { session, busy }; }, [session, busy]);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(async () => {
      const latest = current.current;
      if (latest.busy || inFlight.current || latest.session === saved.current) return;
      inFlight.current = true;
      setWorking(true);
      try {
        const result = await cloud(key, latest.session, revision.current);
        revision.current = result.revision;
        saved.current = latest.session;
        setStatus(`Cloud saved at ${new Date().toLocaleTimeString()}.`);
      } catch (error) {
        setConnected(false);
        setStatus(error instanceof Error ? error.message : "Cloud save failed.");
      } finally { inFlight.current = false; setWorking(false); }
    }, 3000);
    return () => clearInterval(timer);
  }, [connected, key]);

  async function connect() {
    connecting(true);
    setWorking(true);
    inFlight.current = true;
    try {
      const result = await cloud(key);
      if (result.session) {
        if (!window.confirm("Replace this workspace with the Neon save? Download a ZIP of local edits first.")) {
          setStatus("Connection cancelled. Local workspace unchanged.");
          return;
        }
        restore(result.session);
        saved.current = result.session;
      } else {
        const latest = current.current.session;
        const created = await cloud(key, latest, 0);
        saved.current = latest;
        result.revision = created.revision;
      }
      revision.current = result.revision;
      setConnected(true);
      setStatus("Connected. Cloud autosave runs every 3 seconds while idle.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Cloud connection failed.");
    } finally { inFlight.current = false; setWorking(false); connecting(false); }
  }

  return (
    <details className="save-panel">
      <summary>Neon cloud saves</summary>
      <p>One private workspace. Reconnect on each device to load its latest save.</p>
      <label>
        Private workspace access key
        <input type="password" autoComplete="off" value={key} disabled={connected || working}
          onChange={(event) => setKey(event.target.value)} />
      </label>
      <button className="button full" disabled={busy || working || (!connected && key.length < 32)}
        onClick={() => {
          if (connected) {
            setConnected(false); setKey(""); setStatus("Disconnected. Access key forgotten.");
          } else void connect();
        }}>
        {working ? "Saving / connecting..." : connected ? "Disconnect cloud" : "Connect / load cloud"}
      </button>
      <p role="status">{status}</p>
    </details>
  );
}
