import { PROVIDER_COLORS } from "./ModelPicker.jsx";

const fmt = (ms) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Live leaderboard: bar = tokens streamed so far, tick = when the first token landed. */
export default function RaceStrip({ order, runs, byId }) {
  const max = Math.max(1, ...order.map((id) => runs[id]?.tokens || 0));
  return (
    <section className="race" aria-label="Live race">
      <h3>Race</h3>
      <div className="race-rows">
        {order.map((id) => {
          const r = runs[id];
          const m = byId[id];
          if (!r || !m) return null;
          const pct = ((r.tokens || 0) / max) * 100;
          return (
            <div className="race-row" key={id}>
              <span className="race-name">{m.label}</span>
              <div className="race-track">
                <div
                  className={`race-bar ${r.status}`}
                  style={{ width: `${pct}%`, background: PROVIDER_COLORS[m.provider] }}
                />
              </div>
              <span className="race-val">
                {r.status === "error" ? "failed" : r.firstTokenMs != null ? fmt(r.firstTokenMs) : "waiting"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="muted small">Bar length is tokens streamed. Time on the right is first-token latency.</p>
    </section>
  );
}
