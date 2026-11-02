import { useState } from "react";
import { Plug, Unplug } from "lucide-react";

export type ConnectorView = { server: string; host: string; tools: { name: string; description: string }[] };

export default function ConnectorPanel({ connected, connect, disconnect, disabled }: {
  connected: ConnectorView | null;
  connect: (url: string, token: string) => Promise<string>;
  disconnect: () => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  return (
    <div className="space-panel">
      <p>Connect an MCP server over HTTPS so agent mode can use its tools. The server must allow browser requests (CORS). The URL and token stay in memory only and are never saved. You approve each tool before its first use in a run.</p>
      {connected ? (
        <>
          <p role="status">Connected to <strong>{connected.server}</strong> ({connected.host}). {connected.tools.length ? "Tools:" : "No usable tools."}</p>
          <ul className="connector-tools">
            {connected.tools.map((tool) => <li key={tool.name}><code>{tool.name}</code>{tool.description ? ` - ${tool.description}` : ""}</li>)}
          </ul>
          <button className="button" disabled={disabled} onClick={() => { disconnect(); setMessage(""); }}>
            <Unplug size={14} />Disconnect
          </button>
        </>
      ) : (
        <form onSubmit={async (event) => {
          event.preventDefault();
          setMessage("Connecting...");
          const failure = await connect(url, token);
          setMessage(failure);
          if (!failure) setToken("");
        }}>
          <label>Server URL
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://mcp.example.com/mcp"
              inputMode="url" autoComplete="off" spellCheck={false} disabled={disabled} />
          </label>
          <label>Access token (optional)
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)}
              autoComplete="off" disabled={disabled} />
          </label>
          <button className="button" disabled={disabled || !url.trim()}><Plug size={14} />Connect</button>
        </form>
      )}
      {message && !connected && <p className="form-error" role="status">{message}</p>}
    </div>
  );
}
