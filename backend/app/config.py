"""Settings loaded from the repo-root .env (shared with docker-compose).

Import this module before anything from ``graphiti_core``: Graphiti reads
``EMBEDDING_DIM`` from the environment at import time (embedder/client.py and
search/search.py), so it must match the CPU embedding model.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / '.env', REPO_ROOT / 'backend' / '.env'),
        env_file_encoding='utf-8',
        extra='ignore',
    )

    # ---- Neo4j ----
    neo4j_uri: str = 'bolt://localhost:7687'
    neo4j_user: str = 'neo4j'
    neo4j_password: str = ''

    # ---- Generation ----
    llm_provider: Literal['openrouter', 'groq'] = 'openrouter'
    openrouter_api_key: str = ''
    openrouter_model: str = 'openrouter/free'
    openrouter_models: str = ''
    openrouter_max_tokens: int = 4096
    openrouter_incomplete_retries: int = 3
    openrouter_rpm: int = 100
    openrouter_rpd: int = 100

    # ---- Legacy provider: Groq ----
    groq_api_key: str = ''
    groq_model: str = 'openai/gpt-oss-120b'
    groq_small_model: str = 'openai/gpt-oss-20b'
    groq_models: str = ''
    groq_reasoning_effort: str = 'low'  # gpt-oss only: low | medium | high | '' to omit
    groq_max_tokens: int = 4096
    # Free-tier quota per model (check console.groq.com/settings/limits; 0 = unlimited).
    groq_rpm: int = 30
    groq_tpm: int = 8000
    groq_rpd: int = 1000
    groq_tpd: int = 200000
    # Safety margin: only use this fraction of each limit.
    groq_budget_ratio: float = 0.9
    groq_answer_temperature: float = 0.2

    # ---- CPU models ----
    entity_extractor: str = 'llm'  # gliner2 | llm (OpenRouter always uses llm)
    gliner2_model: str = 'fastino/gliner2-base-v1'
    gliner2_threshold: float = 0.5
    embedding_model_name: str = 'intfloat/multilingual-e5-small'
    embedding_dim: int = 384
    embedding_prefix: str = 'query: '  # e5 models expect a prefix; '' for others
    reranker_model_name: str = 'cross-encoder/mmarco-mMiniLMv2-L12-H384-v1'
    reranker: str = 'cross-encoder'  # cross-encoder | none
    torch_threads: int = 0  # 0 = torch default

    # ---- Pipeline ----
    data_dir: Path = REPO_ROOT / 'data'
    default_tz: str = 'Asia/Jakarta'
    episode_gap_hours: float = 6
    # Keep each durable Graphiti checkpoint small. A single episode produces
    # several structured LLM responses, so 50 messages can still overflow a
    # free model's output budget even when the whole chat is not sent at once.
    episode_max_messages: int = 20
    # Number of whole-ingest retries after OpenRouter has exhausted its
    # per-request retries. Completed episodes are read from Neo4j and skipped.
    ingest_incomplete_retries: int = 5
    ingest_retry_base_seconds: float = 2
    semaphore_limit: int = 2

    @property
    def quota_state_path(self) -> Path:
        return self.data_dir / f'{self.llm_provider}_quota.json'

    @property
    def llm_api_key(self) -> str:
        return self.openrouter_api_key if self.llm_provider == 'openrouter' else self.groq_api_key

    @property
    def llm_model(self) -> str:
        return self.openrouter_model if self.llm_provider == 'openrouter' else self.groq_model

    @property
    def llm_models(self) -> list[str]:
        raw = self.openrouter_models if self.llm_provider == 'openrouter' else self.groq_models
        fallback = (
            [self.openrouter_model] if self.llm_provider == 'openrouter' else [self.groq_model, self.groq_small_model]
        )
        configured = [model.strip() for model in raw.split(',') if model.strip()] if raw else fallback
        return list(dict.fromkeys([self.llm_model, *configured]))


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    os.environ.setdefault('EMBEDDING_DIM', str(s.embedding_dim))
    # Graphiti's own concurrency cap; keep it low on the free tier.
    os.environ.setdefault('SEMAPHORE_LIMIT', str(s.semaphore_limit))
    # Graphiti sends anonymous usage analytics to PostHog unless disabled.
    os.environ.setdefault('GRAPHITI_TELEMETRY_ENABLED', 'false')
    return s


get_settings()
