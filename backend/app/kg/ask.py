"""Ask: search a KG version and answer with citations (design §7)."""

from __future__ import annotations

import copy
import time
from dataclasses import dataclass
from datetime import datetime

from graphiti_core import Graphiti
from graphiti_core.search.search_config_recipes import COMBINED_HYBRID_SEARCH_CROSS_ENCODER
from graphiti_core.search.search_filters import ComparisonOperator, DateFilter, SearchFilters

from app.ai.groq_llm import BudgetedGroqClient

SYSTEM_PROMPT = """\
Kamu menjawab pertanyaan berdasarkan knowledge graph yang diekstrak dari chat.
- Jawab HANYA dari konteks bernomor yang diberikan, dalam Bahasa Indonesia.
- Sertakan sitasi [n] setelah setiap klaim.
- Jika sebuah fakta sudah usang (ada tanggal berakhir), sebutkan.
- Jika konteks tidak cukup, jawab: "Tidak ada di KG versi ini."
- Jangan menebak tanggal yang ditandai tidak pasti."""

NO_ANSWER = 'Tidak ada di KG versi ini.'
# gpt-oss on Groq occasionally returns an empty `content` (output spent in reasoning).
EMPTY_ANSWER_RETRIES = 2


@dataclass
class Reference:
    n: int
    edge_uuid: str
    fact: str
    valid_at: str | None
    invalid_at: str | None


@dataclass
class Answer:
    answer: str
    references: list[Reference]
    ms: int
    group_id: str


def _iso(d: datetime | None) -> str | None:
    return d.isoformat() if d else None


async def ask(
    graphiti: Graphiti,
    llm: BudgetedGroqClient,
    question: str,
    *,
    group_id: str,
    top_k: int = 10,
    point_in_time: datetime | None = None,
    include_invalid: bool = True,
    model: str | None = None,
    temperature: float = 0.2,
) -> Answer:
    t0 = time.monotonic()
    config = copy.deepcopy(COMBINED_HYBRID_SEARCH_CROSS_ENCODER)
    config.limit = top_k

    search_filter = SearchFilters()
    if point_in_time is not None:
        search_filter.valid_at = [
            [DateFilter(date=point_in_time, comparison_operator=ComparisonOperator.less_than_equal)]
        ]
        search_filter.invalid_at = [
            [DateFilter(comparison_operator=ComparisonOperator.is_null)],
            [DateFilter(date=point_in_time, comparison_operator=ComparisonOperator.greater_than)],
        ]
    elif not include_invalid:
        search_filter.invalid_at = [[DateFilter(comparison_operator=ComparisonOperator.is_null)]]

    results = await graphiti.search_(question, config=config, group_ids=[group_id], search_filter=search_filter)

    refs = [Reference(i, e.uuid, e.fact, _iso(e.valid_at), _iso(e.invalid_at)) for i, e in enumerate(results.edges, 1)]
    lines = [f'[{r.n}] {r.fact} (valid {r.valid_at or "?"} – {r.invalid_at or "sekarang"})' for r in refs]
    # Node summaries are rewritten as later episodes arrive and carry no validity
    # window, so they would leak facts from after `point_in_time`. Only the
    # time-filtered facts are used for point-in-time questions.
    nodes = [] if point_in_time else [f'- {n.name}: {n.summary}' for n in results.nodes[:5] if n.summary]
    if not lines and not nodes:
        return Answer(NO_ANSWER, [], int((time.monotonic() - t0) * 1000), group_id)

    context = 'Fakta:\n' + ('\n'.join(lines) or '(tidak ada)')
    if nodes:
        context += '\n\nEntitas:\n' + '\n'.join(nodes)
    content = ''
    for _ in range(1 + EMPTY_ANSWER_RETRIES):
        content, _ = await llm.complete(
            [
                {'role': 'system', 'content': SYSTEM_PROMPT},
                {'role': 'user', 'content': f'{context}\n\nPertanyaan: {question}'},
            ],
            model=model or llm.model or '',
            max_tokens=1024,
            temperature=temperature,
            json_mode=False,
        )
        if content.strip():
            break
    return Answer(content.strip() or NO_ANSWER, refs, int((time.monotonic() - t0) * 1000), group_id)
