import ReactMarkdown from "react-markdown";
import { useEffect, useRef } from "react";
import { PROVIDER_COLORS } from "./ModelPicker.jsx";

const fmt = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);

export default function ResultCard({ model, run, elapsed, badges, picked, canPick, onPick }) {
  const body = useRef(null);
  useEffect(() => {
    const el = body.current;
    if (el && run.status === "streaming") el.scrollTop = el.scrollHeight;
  }, [run.text, run.status]);

  const streamMs = run.totalMs != null && run.firstTokenMs != null ? run.totalMs - run.firstTokenMs : null;
  const tps = streamMs > 0 ? (run.tokens / (streamMs / 1000)).toFixed(0) : null;

  return (
    <article className={`card ${run.status} ${picked ? "picked" : ""}`}>
      <header className="card-head">
        <span className="dot" style={{ background: PROVIDER_COLORS[model.provider] }} />
        <div className="card-title">
          <strong title={model.model}>{model.label}</strong>
          <span className="muted small">{model.provider}</span>
        </div>
        <div className="badges">
          {badges.map((b) => (
            <span key={b} className="badge">{b}</span>
          ))}
          <StatusPill status={run.status} />
        </div>
      </header>

      <div className="card-body" ref={body}>
        {run.status === "error" ? (
          <p className="error-text">{run.error}</p>
        ) : run.text ? (
          <div className="md">
            <ReactMarkdown>{run.text}</ReactMarkdown>
            {run.status === "streaming" && <span className="caret" />}
          </div>
        ) : (
          <div className="skeleton"><i /><i /><i /></div>
        )}
      </div>

      <footer className="card-foot">
        <dl className="metrics">
          <div><dt>First token</dt><dd>{fmt(run.firstTokenMs)}</dd></div>
          <div><dt>{run.status === "done" ? "Total" : "Elapsed"}</dt><dd>{fmt(run.status === "done" ? run.totalMs : elapsed)}</dd></div>
          <div><dt>Tokens{run.approx ? " ~" : ""}</dt><dd>{run.tokens || "—"}</dd></div>
          <div><dt>Speed</dt><dd>{tps ? `${tps} t/s` : "—"}</dd></div>
        </dl>
        {canPick && run.status === "done" && (
          <button className={`pick ${picked ? "on" : ""}`} onClick={onPick}>
            {picked ? "Your pick" : "Pick best"}
          </button>
        )}
      </footer>
    </article>
  );
}

function StatusPill({ status }) {
  const label = { queued: "Queued", streaming: "Streaming", done: "Done", error: "Error", stopped: "Stopped" }[status];
  return <span className={`pill ${status}`}>{label}</span>;
}
