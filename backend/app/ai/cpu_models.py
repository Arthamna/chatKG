"""Embedding and reranking on CPU with sentence-transformers.

Defaults are sized for a host with 4–8 GB free RAM:
- embedder ``intfloat/multilingual-e5-small``: 118M params, 384 dims, ~0.5 GB
- reranker ``cross-encoder/mmarco-mMiniLMv2-L12-H384-v1``: 118M params, multilingual

Graphiti's built-in ``BGERerankerClient`` hard-codes ``bge-reranker-v2-m3``
(568M params, ~2.3 GB), which is why the reranker is a separate class here.
Models load lazily on first use so the API can start without them.
"""

from __future__ import annotations

import asyncio
import math
import threading
from collections.abc import Iterable

from graphiti_core.cross_encoder.client import CrossEncoderClient
from graphiti_core.embedder.client import EmbedderClient

_load_lock = threading.Lock()


def _set_threads(n: int) -> None:
    if n > 0:
        import torch

        torch.set_num_threads(n)


class SentenceTransformerEmbedder(EmbedderClient):
    def __init__(self, model_name: str, dim: int, prefix: str = '', torch_threads: int = 0) -> None:
        self.model_name = model_name
        self.dim = dim
        self.prefix = prefix
        self.torch_threads = torch_threads
        self._model = None

    def _get_model(self):
        if self._model is None:
            with _load_lock:
                if self._model is None:
                    from sentence_transformers import SentenceTransformer

                    _set_threads(self.torch_threads)
                    model = SentenceTransformer(self.model_name, device='cpu')
                    get_dim = getattr(model, 'get_embedding_dimension', None) or model.get_sentence_embedding_dimension
                    got = get_dim()
                    if got != self.dim:
                        raise ValueError(f'{self.model_name} produces {got}-dim vectors but EMBEDDING_DIM={self.dim}')
                    self._model = model
        return self._model

    def _encode(self, texts: list[str]) -> list[list[float]]:
        vectors = self._get_model().encode(
            [self.prefix + t for t in texts],
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return [v.tolist() for v in vectors]

    async def create(self, input_data: str | list[str] | Iterable[int] | Iterable[Iterable[int]]) -> list[float]:
        if isinstance(input_data, str):
            text = input_data
        elif isinstance(input_data, list) and input_data and isinstance(input_data[0], str):
            text = input_data[0]
        else:
            raise TypeError('SentenceTransformerEmbedder only accepts text input')
        return (await asyncio.to_thread(self._encode, [text]))[0]

    async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        if not input_data_list:
            return []
        return await asyncio.to_thread(self._encode, input_data_list)


class CrossEncoderReranker(CrossEncoderClient):
    def __init__(self, model_name: str, torch_threads: int = 0) -> None:
        self.model_name = model_name
        self.torch_threads = torch_threads
        self._model = None

    def _get_model(self):
        if self._model is None:
            with _load_lock:
                if self._model is None:
                    from sentence_transformers import CrossEncoder

                    _set_threads(self.torch_threads)
                    self._model = CrossEncoder(self.model_name, device='cpu')
        return self._model

    def _predict(self, pairs: list[list[str]]) -> list[float]:
        # Recent sentence-transformers return raw logits (Identity activation) for
        # mmarco models. Squash to 0..1 so Graphiti's reranker_min_score=0 does not
        # silently drop every passage with a negative logit.
        logits = self._get_model().predict(pairs, show_progress_bar=False)
        return [1.0 / (1.0 + math.exp(-float(x))) for x in logits]

    async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
        if not passages:
            return []
        scores = await asyncio.to_thread(self._predict, [[query, p] for p in passages])
        return sorted(zip(passages, scores, strict=True), key=lambda x: x[1], reverse=True)


class NoopReranker(CrossEncoderClient):
    """Keeps the incoming order; for hosts that cannot spare RAM for a reranker."""

    async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
        n = len(passages)
        return [(p, 1.0 - i / max(n, 1)) for i, p in enumerate(passages)]
