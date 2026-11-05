"""Graphiti wiring: Groq for generation, GLiNER2 + sentence-transformers on CPU, Neo4j."""

from __future__ import annotations

import logging

import graphiti_core.llm_client.client as _llm_client_module
from graphiti_core import Graphiti
from graphiti_core.cross_encoder.client import CrossEncoderClient
from graphiti_core.llm_client.client import LLMClient
from graphiti_core.llm_client.config import LLMConfig

from app.ai.cpu_models import CrossEncoderReranker, NoopReranker, SentenceTransformerEmbedder
from app.ai.groq_llm import BudgetedGroqClient
from app.ai.quota import Limits, QuotaBudget, WaitCallback
from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

# Graphiti's default tells the LLM to output English unless the user wrote full
# sentences, so short Indonesian chat turned into English facts. Graphiti documents
# overriding this function; generate_response looks it up on the module at call time.
INDONESIAN_OUTPUT = (
    '\n\nTulis semua fakta, ringkasan, dan nama entitas dalam Bahasa Indonesia, '
    'mengikuti bahasa chat. Pertahankan nama orang dan singkatan apa adanya.'
)


def _indonesian_instruction(group_id: str | None = None) -> str:
    return INDONESIAN_OUTPUT


_llm_client_module.get_extraction_language_instruction = _indonesian_instruction


def build_budget(s: Settings, on_wait: WaitCallback | None = None) -> QuotaBudget:
    limits = Limits(s.groq_rpm, s.groq_tpm, s.groq_rpd, s.groq_tpd).scaled(s.groq_budget_ratio)
    return QuotaBudget(limits, s.quota_state_path, on_wait=on_wait)


def build_groq(s: Settings, budget: QuotaBudget) -> BudgetedGroqClient:
    if not s.groq_api_key:
        raise RuntimeError('GROQ_API_KEY is empty: set it in .env (console.groq.com/keys)')
    config = LLMConfig(
        api_key=s.groq_api_key,
        model=s.groq_model,
        small_model=s.groq_small_model,
        temperature=0,
        max_tokens=s.groq_max_tokens,
    )
    return BudgetedGroqClient(config, budget, reasoning_effort=s.groq_reasoning_effort)


def build_llm(s: Settings, groq_client: BudgetedGroqClient) -> LLMClient:
    if s.entity_extractor == 'gliner2':
        # Loads weights synchronously; call before heavy async work starts.
        from graphiti_core.llm_client.gliner2_client import GLiNER2Client

        return GLiNER2Client(
            config=LLMConfig(model=s.gliner2_model),
            llm_client=groq_client,
            threshold=s.gliner2_threshold,
        )
    return groq_client


def build_embedder(s: Settings) -> SentenceTransformerEmbedder:
    return SentenceTransformerEmbedder(
        s.embedding_model_name, s.embedding_dim, prefix=s.embedding_prefix, torch_threads=s.torch_threads
    )


def build_reranker(s: Settings) -> CrossEncoderClient:
    if s.reranker == 'none':
        return NoopReranker()
    return CrossEncoderReranker(s.reranker_model_name, torch_threads=s.torch_threads)


def build_graphiti(
    s: Settings | None = None,
    *,
    on_quota_wait: WaitCallback | None = None,
    with_llm: bool = True,
) -> tuple[Graphiti, BudgetedGroqClient | None]:
    """Create a Graphiti instance. ``with_llm=False`` is enough for search-only use
    without a Groq key (search does not call the LLM)."""
    s = s or get_settings()
    if not s.neo4j_password:
        raise RuntimeError('NEO4J_PASSWORD is empty: copy .env.example to .env and set it')
    groq_client: BudgetedGroqClient | None = None
    llm: LLMClient | None = None
    if with_llm:
        groq_client = build_groq(s, build_budget(s, on_quota_wait))
        llm = build_llm(s, groq_client)
    graphiti = Graphiti(
        s.neo4j_uri,
        s.neo4j_user,
        s.neo4j_password,
        llm_client=llm or _NoLLM(),
        embedder=build_embedder(s),
        cross_encoder=build_reranker(s),
    )
    return graphiti, groq_client


class _NoLLM(LLMClient):
    """Placeholder so Graphiti does not build its default OpenAI client."""

    def __init__(self) -> None:
        super().__init__(LLMConfig(model='none'), cache=False)

    async def _generate_response(self, *args, **kwargs):  # pragma: no cover
        raise RuntimeError('This Graphiti instance was built without an LLM (with_llm=False)')
