"""Exercise real Graphiti and OpenAI HTTP serialization against a scripted OpenRouter endpoint."""

import json

import httpx
import pytest
from graphiti_core import Graphiti
from graphiti_core.llm_client.config import LLMConfig
from openai import AsyncOpenAI

from app.ai.cpu_models import NoopReranker
from app.ai.discovery import discover_schema
from app.ai.openrouter_llm import OpenRouterClient
from app.ai.quota import Limits, QuotaBudget
from app.ingest.prepare import prepare_source
from app.kg import draft as D
from app.kg.ingest import ingest_episodes
from app.kg.schema import Ontology

from .test_schema import example_schema
from .test_schema_flow import TestEmbedder
from .test_versions import driver, kg  # noqa: F401

pytestmark = pytest.mark.neo4j


async def test_discovery_to_real_graphiti_preserves_dynamic_types_and_attributes(driver, kg):  # noqa: F811
    calls = []
    replies = {
        'Ontology': example_schema(),
        'ExtractedEntities': {
            'extracted_entities': [
                {'name': 'Ana', 'entity_type_id': 1},
                {'name': 'Produk X', 'entity_type_id': 2},
            ]
        },
        'NodeResolutions': {
            'entity_resolutions': [
                {'id': 0, 'name': 'Ana', 'duplicate_candidate_id': -1},
                {'id': 1, 'name': 'Produk X', 'duplicate_candidate_id': -1},
            ]
        },
        'ExtractedEdges': {
            'edges': [
                {
                    'source_entity_name': 'Ana',
                    'target_entity_name': 'Produk X',
                    'relation_type': 'DISCUSSES',
                    'fact': 'Ana membahas Produk X',
                    'valid_at': '2026-11-05T13:00:00+07:00',
                    'invalid_at': None,
                }
            ]
        },
        'EdgeDuplicate': {'duplicate_facts': [], 'contradicted_facts': []},
        'EdgeTimestamps': {'valid_at': '2026-11-05T13:00:00+07:00', 'invalid_at': None},
        'SummarizedEntities': {
            'summaries': [
                {'name': 'Ana', 'summary': 'Ana membahas Produk X'},
                {'name': 'Produk X', 'summary': 'Produk yang dibahas Ana'},
            ]
        },
        'EntitySummary': {'summary': 'Ana membahas Produk X'},
        'Person': {},
        'Product': {'scheduled_at': '2026-11-06T13:00:00+07:00'},
        'DISCUSSES': {},
    }

    def endpoint(request):
        assert str(request.url) == 'https://openrouter.ai/api/v1/chat/completions'
        body = json.loads(request.content)
        assert body['model'] == 'openrouter/free'
        assert body['provider']['require_parameters'] is True
        schema = body['response_format']['json_schema']['name']
        calls.append(schema)
        assert schema in replies, f'Unexpected Graphiti response schema: {schema}'
        return httpx.Response(
            200,
            json={
                'id': 'test',
                'object': 'chat.completion',
                'created': 0,
                'model': 'test/model:free',
                'choices': [
                    {
                        'index': 0,
                        'finish_reason': 'stop',
                        'message': {
                            'role': 'assistant',
                            'content': json.dumps(replies[schema]),
                        },
                    }
                ],
                'usage': {'prompt_tokens': 10, 'completion_tokens': 10, 'total_tokens': 20},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(endpoint)) as http:
        sdk = AsyncOpenAI(api_key='test', base_url='https://openrouter.ai/api/v1', http_client=http, max_retries=0)
        llm = OpenRouterClient(
            LLMConfig(api_key='test', model='openrouter/free', temperature=0), QuotaBudget(Limits()), client=sdk
        )
        prepared = prepare_source(
            '[11/5/26, 1:00:00 PM] Ana: Aku membahas Produk X untuk besok\n',
            filename='chat.txt',
            owner='Ana',
            date_order='MDY',
        )
        ontology, _ = await discover_schema(llm, prepared, Ontology())
        graph = Graphiti(graph_driver=driver, llm_client=llm, embedder=TestEmbedder(), cross_encoder=NoopReranker())
        await graph.build_indices_and_constraints()
        report = await ingest_episodes(
            graph,
            prepared.episodes,
            group_id=f'kg_{kg}__draft',
            instructions='Hanya fakta dari chat. Gunakan tipe yang diberikan.',
            ontology=ontology,
        )
        assert len(report.done) == 1
        view = await D.graph_view(driver, kg)
        assert {n['type'] for n in view['nodes']} == {'Person', 'Product'}
        product = next(n for n in view['nodes'] if n['type'] == 'Product')
        assert product['props']['scheduled_at'] == '2026-11-06T13:00:00+07:00'
        assert len(view['edges']) == 1 and view['edges'][0]['label'] == 'DISCUSSES'
        assert {'Ontology', 'ExtractedEntities', 'ExtractedEdges', 'Product'} <= set(calls)
