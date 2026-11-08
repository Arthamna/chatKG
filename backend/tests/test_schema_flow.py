"""Real Neo4j + HTTP/worker lifecycle; LLM and vectors are deterministic test doubles."""

import asyncio
import copy
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from graphiti_core import Graphiti
from graphiti_core.edges import EntityEdge
from graphiti_core.embedder.client import EmbedderClient
from graphiti_core.nodes import EntityNode, EpisodeType, EpisodicNode

from app.ai.cpu_models import NoopReranker
from app.ai.openrouter_llm import IncompleteCompletion
from app.ai.quota import Limits, QuotaBudget
from app.api import create_app
from app.config import get_settings
from app.kg import versions as V
from app.kg.graph import _NoLLM
from app.kg.ingest import existing_episodes
from app.kg.schema import Ontology, active_schema

from .test_api import wait_job
from .test_schema import example_schema

pytestmark = pytest.mark.neo4j
FIXTURE = Path(__file__).parent / 'fixtures' / 'wa_ios_sample.txt'


class TestEmbedder(EmbedderClient):
    __test__ = False

    async def create(self, input_data):
        return [1.0] + [0.0] * 383

    async def create_batch(self, input_data_list):
        return [await self.create(text) for text in input_data_list]


class FakeGeneration:
    model = 'openrouter/free'
    quota_key = 'openrouter:free'

    def __init__(self):
        self.budget = QuotaBudget(Limits())
        self.ontology = example_schema()
        self.ingested = []
        self.instructions = []
        self.discoveries = 0
        self.fail_after = None
        self.incomplete_after = None

    async def generate_response(self, messages, **kwargs):
        self.discoveries += 1
        return copy.deepcopy(self.ontology)


@pytest.fixture
def flow_client(tmp_path, monkeypatch):
    settings = get_settings().model_copy(update={'data_dir': tmp_path, 'llm_provider': 'openrouter'})
    if not settings.neo4j_password:
        pytest.skip('NEO4J_PASSWORD not set')
    fake = FakeGeneration()

    # Only process this test's new jobs, never another local application's queue.
    from app.jobs import JobRunner

    async def start_test_worker(runner):
        runner._task = asyncio.create_task(runner._worker())

    monkeypatch.setattr(JobRunner, 'start', start_test_worker)

    def build(s):
        graph = Graphiti(
            s.neo4j_uri,
            s.neo4j_user,
            s.neo4j_password,
            llm_client=_NoLLM(),
            embedder=TestEmbedder(),
            cross_encoder=NoopReranker(),
        )
        return graph, fake, fake.budget

    async def ingest(graphiti, episodes, *, group_id, instructions, progress, ontology):
        fake.ingested.append(ontology.model_dump())
        fake.instructions.append(instructions)
        known = await existing_episodes(graphiti, group_id)
        for i, ep in enumerate(episodes, 1):
            if ep.name in known:
                continue
            progress('episode_start', {'i': i, 'total': len(episodes), 'name': ep.name})
            now = datetime.now(UTC)
            a = EntityNode(name=f'Ana {i}', group_id=group_id, labels=['Person'], summary='Orang', created_at=now)
            b = EntityNode(name=f'Produk {i}', group_id=group_id, labels=['Product'], summary='Produk', created_at=now)
            for node in (a, b):
                await node.generate_name_embedding(graphiti.embedder)
                await node.save(graphiti.driver)
            episode = EpisodicNode(
                name=ep.name,
                group_id=group_id,
                source=EpisodeType.message,
                source_description=ep.source_description,
                content=ep.body,
                valid_at=ep.reference_time,
                created_at=now,
            )
            edge = EntityEdge(
                source_node_uuid=a.uuid,
                target_node_uuid=b.uuid,
                name='DISCUSSES',
                fact='Ana membahas produk',
                group_id=group_id,
                episodes=[episode.uuid],
                created_at=now,
            )
            await edge.generate_embedding(graphiti.embedder)
            await edge.save(graphiti.driver)
            episode.entity_edges = [edge.uuid]
            await episode.save(graphiti.driver)
            progress(
                'episode_done',
                {
                    'i': i,
                    'total': len(episodes),
                    'name': ep.name,
                    'seconds': 0,
                    'nodes': [a.name, b.name],
                    'edges': [edge.fact],
                },
            )
            if fake.fail_after == i:
                fake.fail_after = None
                raise RuntimeError('Simulated interruption after a completed episode')
            if fake.incomplete_after == i:
                fake.incomplete_after = None
                raise IncompleteCompletion('Simulated truncated structured response')
        return SimpleNamespace(skipped=[])

    app = create_app(build=build, settings=settings, ingest_fn=ingest)
    try:
        with TestClient(app) as client:
            client.fake_generation = fake
            client.created_kgs = []
            yield client

            async def cleanup():
                for kg in client.created_kgs:
                    for n in range(6):
                        await V.delete_group(app.state.graphiti.driver, V.version_group(kg, n))
                    await V.delete_group(app.state.graphiti.driver, V.draft_group(kg))
                    await V._q(
                        app.state.graphiti.driver,
                        'MATCH (n) WHERE (n:KnowledgeGraph AND n.id = $id) OR '
                        '((n:Source OR n:Version OR n:IngestJob) AND n.kg_id = $id) DETACH DELETE n',
                        id=kg,
                    )

            client.portal.call(cleanup)
    except Exception as e:
        if 'Connect' in type(e).__name__ or 'ServiceUnavailable' in type(e).__name__:
            pytest.skip(f'Neo4j unreachable: {e}')
        raise


def new_kg(client):
    kg = f'schema-{uuid.uuid4().hex[:8]}'
    result = client.post('/api/kgs', json={'id': kg, 'name': 'Schema test'})
    assert result.status_code == 201, result.text
    client.created_kgs.append(kg)
    return kg


def upload(client, kg, extra=''):
    unique = f'\n[11/4/26, 12:50:00 PM] Anda: marker {kg}\n'
    result = client.post(
        f'/api/kgs/{kg}/sources',
        data={'owner': 'Pemilik', 'aliases': 'Leon TC 24=Leon'},
        files={'file': ('chat.txt', FIXTURE.read_text(encoding='utf-8') + unique + extra, 'text/plain')},
    )
    assert result.status_code == 201, result.text
    preview = result.json()
    assert 'schema_job' not in preview
    mapping = client.post(
        f'/api/kgs/{kg}/sources/{preview["source_id"]}/schema-jobs', json={'model': 'openrouter/free'}
    )
    assert mapping.status_code == 202, mapping.text
    job = wait_job(client, mapping.json()['id'])
    assert job['status'] == 'done', job
    schema_url = f'/api/kgs/{kg}/sources/{preview["source_id"]}/schema'
    return preview, schema_url, client.get(schema_url).json()


def extract(client, kg, source, schema):
    result = client.post(
        f'/api/kgs/{kg}/ingest-jobs', json={'source_id': source, 'schema_revision': schema['revision']}
    )
    assert result.status_code == 202, result.text
    job = wait_job(client, result.json()['id'])
    assert job['status'] == 'done', job
    return job


def test_upload_review_dynamic_extraction_and_versioned_schema(flow_client):
    c = flow_client
    kg = new_kg(c)
    preview, url, schema = upload(c, kg)
    assert schema['sampled_episodes'] == 4
    assert schema['model'] == 'openrouter/free'
    assert c.get(f'/api/kgs/{kg}').json()['stats']['nodes'] == 0  # discovery must not create a graph
    assert not c.fake_generation.ingested
    edited = copy.deepcopy(schema['ontology'])
    edited['entity_types'][1]['description'] = 'Produk yang dibicarakan'
    result = c.put(
        url,
        json={
            'revision': schema['revision'],
            'ontology': edited,
            'extraction_instructions': 'Abaikan proyek lama.',
        },
    )
    assert result.status_code == 200, result.text
    saved = result.json()
    assert c.put(url, json={'revision': schema['revision'], 'ontology': edited}).status_code == 409
    assert (
        c.post(
            f'/api/kgs/{kg}/ingest-jobs',
            json={
                'source_id': preview['source_id'],
                'schema_revision': schema['revision'],
            },
        ).status_code
        == 409
    )
    job = extract(c, kg, preview['source_id'], saved)
    assert job['model'] == 'openrouter/free'
    assert 'Instruksi tambahan pengguna (berlaku hanya jika tidak bertentangan' in c.fake_generation.instructions[-1]
    assert c.fake_generation.instructions[-1].endswith('Abaikan proyek lama.')
    assert c.fake_generation.ingested[-1] == edited
    graph = c.get(f'/api/kgs/{kg}/graph').json()
    assert {n['type'] for n in graph['nodes']} == {'Person', 'Product'}
    assert {e['label'] for e in graph['edges']} == {'DISCUSSES'}
    # Duplicate approval reuses the completed job; no duplicate graph or LLM calls.
    assert extract(c, kg, preview['source_id'], saved)['id'] == job['id']
    assert c.post(f'/api/kgs/{kg}/versions', json={'message': 'v1'}).status_code == 201

    extended = copy.deepcopy(edited)
    extended['entity_types'].append({'name': 'Store', 'description': 'Toko', 'attributes': []})
    c.fake_generation.ontology = extended
    p2, url2, schema2 = upload(c, kg, '\n[11/5/26, 1:00:00 PM] Anda: Toko baru sudah buka\n')
    assert schema2['baseline'] == edited
    bad = copy.deepcopy(extended)
    bad['entity_types'][1]['attributes'][0]['type'] = 'string'
    assert c.put(url2, json={'revision': schema2['revision'], 'ontology': bad}).status_code == 422
    extract(c, kg, p2['source_id'], schema2)
    assert c.post(f'/api/kgs/{kg}/versions', json={'message': 'v2'}).status_code == 201
    restored = c.post(f'/api/kgs/{kg}/versions/1/restore', json={})
    assert restored.status_code == 201, restored.text
    current = c.portal.call(active_schema, c.app.state.graphiti.driver, kg)
    assert current.model_dump() == edited
    assert c.get(f'/api/kgs/{kg}/graph?version=v2').json()['nodes']  # prior versions survive


def test_source_isolation_invalid_output_and_stale_baseline(flow_client):
    c = flow_client
    kg = new_kg(c)
    preview, url, schema = upload(c, kg)
    other = new_kg(c)
    wrong = f'/api/kgs/{other}/sources/{preview["source_id"]}'
    assert c.get(f'{wrong}/schema').status_code == 404
    assert c.post(f'{wrong}/schema-jobs', json={}).status_code == 404
    assert (
        c.post(
            f'/api/kgs/{other}/ingest-jobs',
            json={
                'source_id': preview['source_id'],
                'schema_revision': schema['revision'],
            },
        ).status_code
        == 404
    )
    invalid = copy.deepcopy(schema['ontology'])
    invalid['edge_type_map'][0]['target'] = 'Missing'
    assert c.put(url, json={'revision': schema['revision'], 'ontology': invalid}).status_code == 422

    async def change_active():
        changed = Ontology.model_validate(example_schema('appointments'))
        await V._q(
            c.app.state.graphiti.driver,
            'MATCH (k:KnowledgeGraph {id: $kg}) SET k.ontology = $schema',
            kg=kg,
            schema=changed.model_dump_json(),
        )

    c.portal.call(change_active)
    assert (
        c.post(
            f'/api/kgs/{kg}/ingest-jobs',
            json={
                'source_id': preview['source_id'],
                'schema_revision': schema['revision'],
            },
        ).status_code
        == 409
    )


def wait_worker_idle(client):
    async def wait_idle():
        async with asyncio.timeout(2):
            while client.app.state.runner._current is not None:
                await asyncio.sleep(0.01)

    client.portal.call(wait_idle)


def test_failed_job_resumes_original_schema_without_duplicate_episodes(flow_client):
    c = flow_client
    kg = new_kg(c)
    preview, _, schema = upload(c, kg)
    c.fake_generation.fail_after = 1
    response = c.post(
        f'/api/kgs/{kg}/ingest-jobs',
        json={
            'source_id': preview['source_id'],
            'schema_revision': schema['revision'],
        },
    )
    job = wait_job(c, response.json()['id'])
    assert job['status'] == 'failed' and job['done'] == 1
    wait_worker_idle(c)
    # Restart/configuration changes must not renumber episodes and skip different messages.
    c.app.state.runner.settings = c.app.state.runner.settings.model_copy(update={'episode_max_messages': 1})
    response = c.post(f'/api/ingest-jobs/{job["id"]}/retry')
    assert response.status_code == 202, response.text
    finished = wait_job(c, job['id'])
    assert finished['status'] == 'done', finished
    assert finished['done'] == 4
    graph = c.get(f'/api/kgs/{kg}/graph').json()
    assert len(graph['nodes']) == 8 and len(graph['edges']) == 4
    assert c.fake_generation.ingested == [schema['ontology'], schema['ontology']]


def test_incomplete_job_automatically_resumes_without_duplicate_episodes(flow_client):
    c = flow_client
    kg = new_kg(c)
    preview, _, schema = upload(c, kg)
    c.app.state.runner.settings = c.app.state.runner.settings.model_copy(
        update={'ingest_retry_base_seconds': 0}
    )
    c.fake_generation.incomplete_after = 1

    response = c.post(
        f'/api/kgs/{kg}/ingest-jobs',
        json={'source_id': preview['source_id'], 'schema_revision': schema['revision']},
    )
    finished = wait_job(c, response.json()['id'])

    assert finished['status'] == 'done'
    assert finished['done'] == finished['total'] == 4
    assert any('melanjutkan dari checkpoint' in line for line in finished['log'])
    graph = c.get(f'/api/kgs/{kg}/graph').json()
    assert len(graph['nodes']) == 8 and len(graph['edges']) == 4


def test_discarded_draft_does_not_reuse_completed_job(flow_client):
    c = flow_client
    kg = new_kg(c)
    preview, _, schema = upload(c, kg)
    original = extract(c, kg, preview['source_id'], schema)
    wait_worker_idle(c)
    assert c.delete(f'/api/kgs/{kg}/draft').status_code == 200
    repeated = extract(c, kg, preview['source_id'], schema)
    assert repeated['id'] != original['id']
    assert c.get(f'/api/kgs/{kg}/graph').json()['nodes']


async def test_worker_cancel_does_not_stop_queue_and_restart_requeues(monkeypatch):
    from app.jobs import JobRunner

    first_started = asyncio.Event()
    second_done = asyncio.Event()
    runner = JobRunner(SimpleNamespace(driver=None), get_settings())
    runner._update = AsyncMock()
    runner.get = AsyncMock(return_value={'status': 'running'})

    async def run(job):
        if job == 'first':
            first_started.set()
            await asyncio.Event().wait()
        else:
            second_done.set()

    monkeypatch.setattr(runner, '_run', run)
    runner._task = asyncio.create_task(runner._worker())
    try:
        await runner.queue.put('first')
        await asyncio.wait_for(first_started.wait(), 1)
        await runner.cancel('first')
        await runner.queue.put('second')
        await asyncio.wait_for(second_done.wait(), 1)
    finally:
        await runner.stop()

    monkeypatch.setattr(V, '_q', AsyncMock(return_value=[{'id': 'paused'}]))
    restarted = JobRunner(SimpleNamespace(driver=None), get_settings())
    restarted._update = AsyncMock()
    restarted._worker = AsyncMock()
    await restarted.start()
    assert await restarted.queue.get() == 'paused'
    restarted._update.assert_awaited_once_with('paused', status='queued')
    await restarted.stop()
