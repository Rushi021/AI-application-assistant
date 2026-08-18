"""Import adapters so their `@register_*` decorators run."""

from app.modules.ai.providers.embeddings import fake as _emb_fake  # noqa: F401
from app.modules.ai.providers.embeddings import gemini as _emb_gemini  # noqa: F401
from app.modules.ai.providers.embeddings import openai as _emb_openai  # noqa: F401
from app.modules.ai.providers.embeddings import sentence_transformers as _emb_sbert  # noqa: F401
from app.modules.ai.providers.llm import fake as _llm_fake  # noqa: F401
from app.modules.ai.providers.llm import gemini as _llm_gemini  # noqa: F401
from app.modules.ai.providers.llm import nvidia as _llm_nvidia  # noqa: F401
from app.modules.ai.providers.llm import ollama as _llm_ollama  # noqa: F401
from app.modules.ai.providers.llm import openai as _llm_openai  # noqa: F401
