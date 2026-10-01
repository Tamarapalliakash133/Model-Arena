import os
import uuid

import chromadb

_client = chromadb.PersistentClient(path=os.getenv("CHROMA_PATH", "./chroma_data"))
_col = _client.get_or_create_collection("arena_docs")


def chunk_text(text: str, size: int = 900, overlap: int = 150) -> list[str]:
    text = text.strip()
    chunks, i = [], 0
    while i < len(text):
        chunks.append(text[i : i + size])
        i += size - overlap
    return chunks


def add_document(name: str, text: str) -> int:
    chunks = chunk_text(text)
    if not chunks:
        return 0
    _col.add(
        ids=[uuid.uuid4().hex for _ in chunks],
        documents=chunks,
        metadatas=[{"source": name, "chunk": i} for i in range(len(chunks))],
    )
    return len(chunks)


def query(question: str, k: int = 4) -> list[dict]:
    if _col.count() == 0:
        return []
    res = _col.query(query_texts=[question], n_results=min(k, _col.count()))
    return [
        {"source": m["source"], "text": d}
        for d, m in zip(res["documents"][0], res["metadatas"][0])
    ]


def count() -> int:
    return _col.count()


def clear() -> None:
    global _col
    _client.delete_collection("arena_docs")
    _col = _client.get_or_create_collection("arena_docs")
