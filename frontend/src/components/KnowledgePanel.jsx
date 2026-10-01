import { useEffect, useRef, useState } from "react";
import { addDoc, clearDocs, getDocs } from "../api.js";

export default function KnowledgePanel({ useRag, setUseRag, sources, disabled }) {
  const [chunks, setChunks] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef(null);

  useEffect(() => {
    getDocs().then((d) => setChunks(d.chunks)).catch(() => {});
  }, []);

  const ingest = async (name, body) => {
    setBusy(true);
    setErr("");
    try {
      const r = await addDoc(name, body);
      setChunks(r.chunks);
      setText("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await ingest(f.name, await f.text());
    e.target.value = "";
  };

  return (
    <details className="knowledge">
      <summary>
        <span>Shared context</span>
        <span className="muted small">
          {useRag ? `On · ${chunks} chunks indexed` : "Off"}
        </span>
      </summary>
      <div className="knowledge-body">
        <label className="check">
          <input type="checkbox" checked={useRag} disabled={disabled} onChange={(e) => setUseRag(e.target.checked)} />
          <span>Give every model the same retrieved passages, so differences come from the model, not the context.</span>
        </label>
        <textarea
          rows={4}
          placeholder="Paste notes or documentation to index"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="row">
          <button className="btn" disabled={busy || !text.trim()} onClick={() => ingest("pasted-text", text)}>
            Add text
          </button>
          <button className="btn" disabled={busy} onClick={() => file.current?.click()}>
            Upload .txt / .md
          </button>
          <input ref={file} type="file" accept=".txt,.md,.markdown" hidden onChange={onFile} />
          <button
            className="btn ghost"
            disabled={busy || !chunks}
            onClick={async () => setChunks((await clearDocs()).chunks)}
          >
            Clear index
          </button>
        </div>
        {err && <p className="error-text small">{err}</p>}
        {sources?.length > 0 && (
          <div className="sources">
            <strong className="small">Passages used in this round</strong>
            {sources.map((s, i) => (
              <p key={i} className="small muted">
                [{i + 1}] {s.source}: {s.text.slice(0, 140)}…
              </p>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}
