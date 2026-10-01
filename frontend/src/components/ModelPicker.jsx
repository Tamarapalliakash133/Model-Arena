import { useMemo, useState } from "react";

export const PROVIDER_COLORS = {
  groq: "#E8622C",
  google: "#2A9D8F",
  openrouter: "#7C5CE0",
  openai: "#1F2937",
};

export default function ModelPicker({ data, selected, setSelected, disabled }) {
  const [q, setQ] = useState("");
  const [onlyFree, setOnlyFree] = useState(false);

  const groups = useMemo(() => {
    if (!data) return [];
    return data.providers
      .map((p) => ({
        ...p,
        models: data.models.filter(
          (m) =>
            m.provider === p.id &&
            m.label.toLowerCase().includes(q.toLowerCase()) &&
            (!onlyFree || m.free)
        ),
      }))
      .filter((g) => g.models.length);
  }, [data, q, onlyFree]);

  if (!data) return <aside className="picker"><p className="muted pad">Loading models…</p></aside>;

  const max = data.max_models;
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.size < max && next.add(id);
    setSelected(next);
  };
  const toggleGroup = (g) => {
    const ready = g.models.filter((m) => m.ready).map((m) => m.id);
    const all = ready.every((id) => selected.has(id));
    const next = new Set(selected);
    ready.forEach((id) => (all ? next.delete(id) : next.size < max && next.add(id)));
    setSelected(next);
  };

  return (
    <aside className="picker">
      <div className="picker-head">
        <h2>Models</h2>
        <span className="count">{selected.size}/{max}</span>
      </div>
      <input
        className="search"
        placeholder="Search models"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <label className="check free-toggle">
        <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
        <span>Free models only</span>
      </label>

      <div className="groups">
        {groups.map((g) => (
          <section key={g.id} className="group">
            <div className="group-head">
              <span className="dot" style={{ background: PROVIDER_COLORS[g.id] }} />
              <strong>{g.label}</strong>
              {!g.ready && <span className="tag warn">No API key</span>}
              {g.ready && (
                <button className="link" disabled={disabled} onClick={() => toggleGroup(g)}>
                  Toggle all
                </button>
              )}
            </div>
            {g.models.map((m) => (
              <label key={m.id} className={`model-row ${!m.ready ? "off" : ""}`}>
                <input
                  type="checkbox"
                  disabled={!m.ready || disabled}
                  checked={selected.has(m.id)}
                  onChange={() => toggle(m.id)}
                />
                <span className="model-name" title={m.model}>{m.label}</span>
                {m.free && <span className="tag">free</span>}
              </label>
            ))}
          </section>
        ))}
        {!groups.length && <p className="muted pad">No models match.</p>}
      </div>
    </aside>
  );
}
