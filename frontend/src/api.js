export async function getModels() {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error("Backend is not reachable. Start it with: uvicorn main:app --reload");
  return res.json();
}

export async function getDocs() {
  const res = await fetch("/api/docs");
  return res.json();
}

export async function addDoc(name, text) {
  const res = await fetch("/api/docs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text }),
  });
  if (!res.ok) throw new Error("Could not add document");
  return res.json();
}

export async function clearDocs() {
  const res = await fetch("/api/docs", { method: "DELETE" });
  return res.json();
}

/** POST + read the SSE stream. Aborting `signal` cancels every model on the server. */
export async function streamArena({ prompt, models, useRag, signal, onEvent }) {
  const res = await fetch("/api/arena/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, models, use_rag: useRag }),
    signal,
  });
  if (!res.ok) {
    let msg;
    try {
      msg = (await res.json()).detail;
    } catch {}
    throw new Error(typeof msg === "string" ? msg : `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {}
    }
  }
}
