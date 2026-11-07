"""ask(): point-in-time context must not leak node summaries; empty LLM output is retried."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from types import SimpleNamespace

import pytest

from app.ai.openrouter_llm import IncompleteCompletion
from app.kg import ask as ask_mod


@dataclass
class FakeLLM:
    replies: list[str | Exception]
    model: str = 'openai/gpt-oss-120b'
    prompts: list[str] = field(default_factory=list)

    async def complete(self, messages, **kwargs):
        self.prompts.append(messages[-1]['content'])
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply, 10


class FakeGraphiti:
    def __init__(self, edges, nodes):
        self.edges, self.nodes = edges, nodes
        self.filters = []

    async def search_(self, question, *, config, group_ids, search_filter):
        self.filters.append(search_filter)
        return SimpleNamespace(edges=self.edges, nodes=self.nodes)


def _edge(fact: str):
    return SimpleNamespace(uuid='e1', fact=fact, valid_at=datetime(2026, 11, 2), invalid_at=None)


NODE = SimpleNamespace(name='Pemilik', summary='Pemilik menanyakan informasi kode PBKK (4 Nov).')


async def test_point_in_time_drops_node_summaries():
    g = FakeGraphiti([_edge('tugas ml bagian dari Machine Learning')], [NODE])
    llm = FakeLLM(['Tidak ada di KG versi ini.'])
    await ask_mod.ask(
        g, llm, 'pbkk?', group_id='kg_x__v1', point_in_time=datetime.fromisoformat('2026-11-03T23:00+07:00')
    )
    assert 'Entitas' not in llm.prompts[0]
    assert 'PBKK' not in llm.prompts[0]
    assert g.filters[0].valid_at and g.filters[0].invalid_at


async def test_without_point_in_time_keeps_node_summaries():
    g = FakeGraphiti([_edge('fakta')], [NODE])
    llm = FakeLLM(['jawab [1]'])
    await ask_mod.ask(g, llm, 'q', group_id='kg_x__v1')
    assert 'Entitas' in llm.prompts[0]


async def test_empty_answer_is_retried_then_falls_back():
    g = FakeGraphiti([_edge('fakta')], [])
    llm = FakeLLM(['', 'Jawaban [1]'])
    res = await ask_mod.ask(g, llm, 'q', group_id='kg_x__v1')
    assert res.answer == 'Jawaban [1]'
    assert len(llm.prompts) == 2

    llm = FakeLLM(['', '  ', ''])
    res = await ask_mod.ask(g, llm, 'q', group_id='kg_x__v1')
    assert res.answer == ask_mod.NO_ANSWER
    assert len(llm.prompts) == 1 + ask_mod.EMPTY_ANSWER_RETRIES


async def test_truncated_answer_becomes_retryable_error():
    g = FakeGraphiti([_edge('fakta')], [])
    llm = FakeLLM([IncompleteCompletion('finish_reason=length')])

    with pytest.raises(ask_mod.AskRetryableError) as caught:
        await ask_mod.ask(g, llm, 'q', group_id='kg_x__v1')

    assert caught.value.code == 'response_truncated'
    assert caught.value.retry_after == 1
    assert str(caught.value) == 'Response Terpotong, mencoba ulang kembali'


async def test_free_quota_error_becomes_retryable_error():
    class QuotaError(RuntimeError):
        status_code = 429

    g = FakeGraphiti([_edge('fakta')], [])
    llm = FakeLLM([QuotaError('rate limit exceeded')])

    with pytest.raises(ask_mod.AskRetryableError) as caught:
        await ask_mod.ask(g, llm, 'q', group_id='kg_x__v1')

    assert caught.value.code == 'free_model_quota'
    assert caught.value.retry_after == 2
    assert str(caught.value) == 'Kuota model gratis belum mencukupi, mencoba ulang kembali'
