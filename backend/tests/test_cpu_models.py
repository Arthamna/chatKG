"""Downloads and runs the CPU models. Opt in with: uv run pytest -m models"""

import math

import pytest

from app.ai.cpu_models import CrossEncoderReranker, SentenceTransformerEmbedder
from app.config import get_settings

pytestmark = pytest.mark.models


async def test_embedder_dim_and_similarity():
    s = get_settings()
    emb = SentenceTransformerEmbedder(s.embedding_model_name, s.embedding_dim, prefix=s.embedding_prefix)
    a, b, c = await emb.create_batch(
        ['tugas machine learning besok', 'tugas ML dikumpulkan besok', 'stiker kucing lucu']
    )
    assert len(a) == s.embedding_dim
    assert math.isclose(sum(x * x for x in a), 1.0, rel_tol=1e-3)

    def cos(x, y):
        return sum(i * j for i, j in zip(x, y, strict=True))

    assert cos(a, b) > cos(a, c)
    assert await emb.create('halo') == (await emb.create_batch(['halo']))[0]


async def test_reranker_orders_relevant_first():
    s = get_settings()
    rr = CrossEncoderReranker(s.reranker_model_name)
    ranked = await rr.rank('kapan tugas ML dikumpulkan?', ['abid nyebar stiker', 'Tugas ML dikumpulkan besok'])
    assert ranked[0][0] == 'Tugas ML dikumpulkan besok'
    assert all(0.0 <= score <= 1.0 for _, score in ranked)
