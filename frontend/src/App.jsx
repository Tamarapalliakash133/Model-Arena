import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getModels, streamArena } from "./api.js";
import ModelPicker from "./components/ModelPicker.jsx";
import ResultCard from "./components/ResultCard.jsx";
import RaceStrip from "./components/RaceStrip.jsx";
import KnowledgePanel from "./components/KnowledgePanel.jsx";

const EXAMPLES = [
  "Explain the difference between a mutex and a semaphore with a short example.",
  "Write a Python function that merges overlapping intervals, and explain its complexity.",
  "Summarise the trade-offs between SSE and WebSockets for streaming LLM output.",
];

const blank = () => ({ status: "queued", text: "", firstTokenMs: null, totalMs: null, tokens: 0, approx: true, error: "" });

export default function App() {
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [prompt, setPrompt] = useState("");
  const [useRag, setUseRag] = useState(false);
  const [running, setRunning] = useState(false);
  const [order, setOrder] = useState([]);
  const [runs, setRuns] = useState({});
  const [sources, setSources] = useState([]);
  const [error, setError] = useState("");
  const [pick, setPick] = useState(null);
  const [now, setNow] = useState(0);

  const abortRef = useRef(null);
  const startRef = useRef(0);
  const buffers = useRef({});
  const raf = useRef(0);

  useEffect(() => {
    getModels()
      .then((d) => {
        setData(d);
        // preselect a small, fast starter set
        const ready = d.models.filter((m) => m.ready).slice(0, 4).map((m) => m.id);
        setSelected(new Set(ready));
      })
      .catch((e) => setLoadErr(e.message));
  }, []);

  const byId = useMemo(() => Object.fromEntries((data?.models || []).map((m) => [m.id, m])), [data]);

  // live elapsed clock while racing
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(performance.now() - startRef.current), 100);
    return () => clearInterval(t);
  }, [running]);

  // tokens arrive far faster than React should render: batch per animation frame
  const flush = useCallback(() => {
    raf.current = 0;
    const pending = buffers.current;
    buffers.current = {};
    const ids = Object.keys(pending);
    if (!ids.length) return;
    setRuns((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        const r = next[id] || blank();
        const text = r.text + pending[id];
        next[id] = { ...r, text, tokens: r.status === "streaming" ? Math.ceil(text.length / 4) : r.tokens };
      }
      return next;
    });
  }, []);

  const scheduleFlush = () => {
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  };
  const flushNow = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    flush();
  };

  const patch = (id, p) => setRuns((prev) => ({ ...prev, [id]: { ...(prev[id] || blank()), ...p } }));

  const onEvent = (ev) => {
    switch (ev.type) {
      case "init":
        setOrder(ev.models);
        break;
      case "context":
        setSources(ev.sources);
        break;
      case "start":
        patch(ev.modelId, { status: "streaming" });
        break;
      case "first_token":
        patch(ev.modelId, { firstTokenMs: ev.ms });
        break;
      case "token":
        buffers.current[ev.modelId] = (buffers.current[ev.modelId] || "") + ev.text;
        scheduleFlush();
        break;
      case "done":
        flushNow();
        patch(ev.modelId, { status: "done", totalMs: ev.totalMs, tokens: ev.tokens, approx: ev.approx });
        break;
      case "error":
        flushNow();
        patch(ev.modelId, { status: "error", error: ev.message });
        break;
      default:
    }
  };

  const start = async () => {
    const models = [...selected];
    if (!prompt.trim() || !models.length || running) return;
    setError("");
    setPick(null);
    setSources([]);
    setRuns(Object.fromEntries(models.map((id) => [id, blank()])));
    setOrder(models);
    buffers.current = {};
    startRef.current = performance.now();
    setNow(0);
    setRunning(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await streamArena({ prompt: prompt.trim(), models, useRag, signal: ctrl.signal, onEvent });
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
    } finally {
      flushNow();
      setRuns((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next))
          if (next[id].status === "streaming" || next[id].status === "queued") next[id] = { ...next[id], status: "stopped" };
        return next;
      });
      setRunning(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  // fastest start / fastest finish badges
  const badges = useMemo(() => {
    const b = {};
    const done = order.filter((id) => runs[id]?.status === "done");
    const withFirst = order.filter((id) => runs[id]?.firstTokenMs != null);
    if (withFirst.length > 1) {
      const id = withFirst.reduce((a, c) => (runs[c].firstTokenMs < runs[a].firstTokenMs ? c : a));
      (b[id] ||= []).push("Fastest start");
    }
    if (done.length > 1 && !running) {
      const f = done.reduce((a, c) => (runs[c].totalMs < runs[a].totalMs ? c : a));
      (b[f] ||= []).push("Fastest finish");
    }
    return b;
  }, [runs, order, running]);

  const hasRun = order.length > 0;
  const doneCount = order.filter((id) => ["done", "error", "stopped"].includes(runs[id]?.status)).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark">V</span>
          <div>
            <h1>Versus</h1>
            <p>Race one prompt across many models</p>
          </div>
        </div>
        {hasRun && (
          <div className="progress">
            {doneCount}/{order.length} finished
          </div>
        )}
      </header>

      <div className="layout">
        <ModelPicker data={data} selected={selected} setSelected={setSelected} disabled={running} />

        <main className="main">
          {loadErr && <div className="banner error">{loadErr}</div>}

          <section className="composer">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
              }}
              placeholder="Ask something all selected models should answer…"
              rows={3}
              maxLength={8000}
            />
            <div className="composer-bar">
              <div className="examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="chip" disabled={running} onClick={() => setPrompt(ex)}>
                    {ex.length > 44 ? ex.slice(0, 44) + "…" : ex}
                  </button>
                ))}
              </div>
              <div className="actions">
                <span className="muted small hide-sm">Ctrl/⌘ + Enter</span>
                {running ? (
                  <button className="btn stop" onClick={stop}>Stop all</button>
                ) : (
                  <button className="btn primary" disabled={!prompt.trim() || !selected.size} onClick={start}>
                    Race {selected.size} model{selected.size === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            </div>
            <KnowledgePanel useRag={useRag} setUseRag={setUseRag} sources={sources} disabled={running} />
          </section>

          {error && <div className="banner error">{error}</div>}

          {!hasRun && !loadErr && (
            <div className="empty">
              <h2>Pick your models, ask once, compare side by side.</h2>
              <p>
                Every model gets the same prompt at the same moment. You'll see who starts answering first,
                who finishes first, and which answer you actually prefer.
              </p>
            </div>
          )}

          {hasRun && <RaceStrip order={order} runs={runs} byId={byId} />}

          <div className="grid">
            {order.map((id) =>
              runs[id] && byId[id] ? (
                <ResultCard
                  key={id}
                  model={byId[id]}
                  run={runs[id]}
                  elapsed={now}
                  badges={badges[id] || []}
                  canPick={!running}
                  picked={pick === id}
                  onPick={() => setPick(pick === id ? null : id)}
                />
              ) : null
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
