import os
from functools import lru_cache


PROVIDER_KEYS = {
    "groq": "GROQ_API_KEY",
    "google": "GOOGLE_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "openai": "OPENAI_API_KEY",
}

PROVIDER_LABELS = {
    "groq": "Groq",
    "google": "Google Gemini",
    "openrouter": "OpenRouter",
    "openai": "OpenAI",
}


def _m(provider: str, model: str, label: str | None = None, free: bool = False):
    return {
        "id": f"{provider}:{model}",
        "provider": provider,
        "model": model,
        "label": label or model.split("/")[-1].replace(":free", ""),
        "free": free or model.endswith(":free"),
    }


MODELS = [
    # Groq
    _m("groq", "qwen/qwen3.8-27b"),
    _m("groq", "openai/gpt-oss-120b"),
    _m("groq", "openai/gpt-oss-20b"),
    _m("groq", "openai/gpt-oss-safeguard-20b"),
    # Google
    _m("google", "gemini-3.6-flash"),
    _m("google", "gemini-3.5-flash"),
    _m("google", "gemini-3.5-flash-lite"),
    _m("google", "gemini-3.1-flash-lite"),
    # OpenRouter
    _m("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"),
    _m("openrouter", "nvidia/nemotron-3-super-120b-a12b:free"),
    _m("openrouter", "nvidia/nemotron-3.5-lightning:free"),
    _m("openrouter", "stealth/space-bunny-alpha"),
    _m("openrouter", "inclusionai/ling-3.0-flash-fin:free"),
    _m("openrouter", "dots-studio/dots-3-note-preview:free"),
    _m("openrouter", "cohere/north-mini-code:free"),
    _m("openrouter", "poolside/laguna-xs-2.1:free"),
    # OpenAI
    _m("openai", "gpt-4o-mini"),
    _m("openai", "gpt-4.1-nano"),
    _m("openai", "gpt-5-nano"),
]

MODEL_INDEX = {m["id"]: m for m in MODELS}


def provider_ready(provider: str) -> bool:
    return bool(os.getenv(PROVIDER_KEYS[provider]))


@lru_cache(maxsize=64)
def get_llm(model_id: str):
    """Build (and cache) the LangChain chat model for a registry id."""
    info = MODEL_INDEX[model_id]
    name = info["model"]
    p = info["provider"]
    if p == "groq":
        from langchain_groq import ChatGroq
        return ChatGroq(model=name)
    if p == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=name)
    if p == "openrouter":
        from langchain_openrouter import ChatOpenRouter
        return ChatOpenRouter(model=name)
    if p == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=name, stream_usage=True)
    raise ValueError(f"Unknown provider {p}")


def extract_text(chunk) -> str:
    """Normalise a streamed chunk to plain text (Gemini returns content blocks)."""
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") in (None, "text"):
            parts.append(block.get("text", ""))
    return "".join(parts)
