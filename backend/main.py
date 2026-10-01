"""Versus backend: race one prompt across many LLMs and stream everything over one SSE channel.

Run:  uvicorn main:app --reload --port 8000
"""
import asyncio
import json
import os
import time
from collections import defaultdict, deque

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, Request  
from fastapi.middleware.cors import CORSMiddleware 
from fastapi.responses import StreamingResponse 
from pydantic import BaseModel, Field  

import backend.rag as rag 
from backend.registry import ( 
    MODEL_INDEX,
    MODELS,
    PROVIDER_LABELS,
    extract_text,
    get_llm,
    provider_ready,
)

MODEL_TIMEOUT = int(os.getenv("MODEL_TIMEOUT_SECONDS", "120"))
RATE_LIMIT = int(os.getenv("RATE_LIMIT_CALLS_PER_HOUR", "300"))
MAX_MODELS = 24

app = FastAPI(title="Versus - Model Arena")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


_calls: dict[str, deque] = defaultdict(deque)


def check_rate_limit(ip: str, cost: int) -> None:
    now = time.time()
    q = _calls[ip]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) + cost > RATE_LIMIT:
        raise HTTPException(429, f"Rate limit reached ({RATE_LIMIT} model calls per hour).")
    q.extend([now] * cost)



@app.get("/api/models")
def list_models():
    return {
        "providers": [
            {"id": p, "label": PROVIDER_LABELS[p], "ready": provider_ready(p)}
            for p in PROVIDER_LABELS
        ],
        "models": [{**m, "ready": provider_ready(m["provider"])} for m in MODELS],
        "max_models": MAX_MODELS,
    }


class DocIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=500_000)


@app.get("/api/docs")
def docs_status():
    return {"chunks": rag.count()}


@app.post("/api/docs")
async def docs_add(doc: DocIn):
    added = await asyncio.to_thread(rag.add_document, doc.name, doc.text)
    return {"added": added, "chunks": rag.count()}


@app.delete("/api/docs")
async def docs_clear():
    await asyncio.to_thread(rag.clear)
    return {"chunks": 0}



class ArenaRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    models: list[str] = Field(min_length=1, max_length=MAX_MODELS)
    use_rag: bool = False


SYSTEM = (
    "You are a helpful, accurate assistant. Answer clearly and concisely. "
    "Use Markdown where it helps readability."
)


def sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


async def run_model(model_id: str, messages: list, queue: asyncio.Queue) -> None:
    """Stream one model into the shared queue. Every event carries modelId
    so the frontend can demultiplex a single connection into N panels."""
    start = time.perf_counter()
    first_ms = None
    chars = 0
    usage_tokens = None
    await queue.put({"type": "start", "modelId": model_id})
    try:
        async with asyncio.timeout(MODEL_TIMEOUT):
            llm = get_llm(model_id)
            async for chunk in llm.astream(messages):
                um = getattr(chunk, "usage_metadata", None)
                if um and um.get("output_tokens"):
                    usage_tokens = um["output_tokens"]
                text = extract_text(chunk)
                if not text:
                    continue
                if first_ms is None:
                    first_ms = round((time.perf_counter() - start) * 1000)
                    await queue.put({"type": "first_token", "modelId": model_id, "ms": first_ms})
                chars += len(text)
                await queue.put({"type": "token", "modelId": model_id, "text": text})
        await queue.put(
            {
                "type": "done",
                "modelId": model_id,
                "totalMs": round((time.perf_counter() - start) * 1000),
                "tokens": usage_tokens or max(1, round(chars / 4)),
                "approx": usage_tokens is None,
            }
        )
    except asyncio.CancelledError:
        raise
    except TimeoutError:
        await queue.put({"type": "error", "modelId": model_id, "message": f"Timed out after {MODEL_TIMEOUT}s"})
    except Exception as e:  # provider errors should never kill the other lanes
        await queue.put({"type": "error", "modelId": model_id, "message": str(e)[:300] or e.__class__.__name__})


@app.post("/api/arena/stream")
async def arena_stream(req: ArenaRequest, request: Request):
    ids = list(dict.fromkeys(req.models))  # de-dupe, keep order
    unknown = [m for m in ids if m not in MODEL_INDEX]
    if unknown:
        raise HTTPException(400, f"Unknown model(s): {', '.join(unknown)}")
    check_rate_limit(request.client.host if request.client else "local", len(ids))

    sources: list[dict] = []
    system = SYSTEM
    if req.use_rag:
        sources = await asyncio.to_thread(rag.query, req.prompt)
        if sources:
            ctx = "\n\n".join(f"[{i + 1}] ({s['source']}) {s['text']}" for i, s in enumerate(sources))
            system += "\n\nUse this context if it is relevant, and cite sources like [1]:\n" + ctx

    messages = [("system", system), ("human", req.prompt)]

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        tasks = [asyncio.create_task(run_model(m, messages, queue)) for m in ids]
        remaining = len(tasks)
        try:
            yield sse({"type": "init", "models": ids})
            if req.use_rag:
                yield sse({"type": "context", "sources": sources})
            while remaining:
                ev = await queue.get()
                yield sse(ev)
                if ev["type"] in ("done", "error"):
                    remaining -= 1
            yield sse({"type": "all_done"})
        finally:

            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/health")
def health():
    return {"ok": True}
