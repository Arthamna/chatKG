"""API end to end against the real Neo4j + CPU embedder, with Groq replaced.

The fake ingest writes entities/facts through Graphiti's own models (real 384-dim
embeddings), so search, graph view, review and versioning run on realistic data.
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from graphiti_core.edges import EntityEdge
from graphiti_core.nodes import EntityNode, EpisodeType, EpisodicNode

from app.api import create_app
from app.config import get_settings
from app.kg import versions as V
from app.kg.groups import draft_group, version_group

pytestmark = pytest.mark.neo4j

FIXTURE = Path(__file__).parent / 'fixtures' / 'wa_ios_sample.txt'


class FakeBudget:
    on_wait = None
    limits = SimpleNamespace(rpm=1, tpm=1, rpd=1, tpd=1)

    def usage(self, model):
        return {'requests_day': 0}


class FakeGroq:
    model = 'fake'
    budget = FakeBudget()

    def __init__(self):
        self.prompts: list[str] = []

    async def complete(self, messages, **kw):
        self.prompts.append(messages[-1]['content'])
        return 'Leon mengingatkan Pemilik [1].', 10


async def fake_ingest(graphiti, episodes, *, group_id, instructions, progress=None):
    """Stand-in for Graphiti extraction: one episode -> 2 entities + 1 fact."""
    emb = graphiti.embedder
    now = datetime.now(UTC)
    ep0 = episodes[0]
    episode = EpisodicNode(
        name=ep0.name,
        group_id=group_id,
        source=EpisodeType.message,
        source_description=ep0.source_description,
        content=ep0.body,
        valid_at=ep0.reference_time,
        created_at=now,
    )
    a = EntityNode(name='Leon', group_id=group_id, labels=['Person'], summary='teman', created_at=now)
    b = EntityNode(name='Pemilik', group_id=group_id, labels=['Person'], summary='pemilik akun', created_at=now)
    for n in (a, b):
        await n.generate_name_embedding(emb)
        await n.save(graphiti.driver)
    e = EntityEdge(
        source_node_uuid=a.uuid,
        target_node_uuid=b.uuid,
        name='REMINDS',
        fact='Leon mengingatkan Pemilik tentang tugas ml',
        group_id=group_id,
        episodes=[episode.uuid],
        created_at=now,
        valid_at=ep0.reference_time,
    )
    await e.generate_embedding(emb)
    episode.entity_edges = [e.uuid]
    await episode.save(graphiti.driver)
    await e.save(graphiti.driver)
    for i, ep in enumerate(episodes, 1):
        if progress:
            progress('episode_start', {'i': i, 'total': len(episodes), 'name': ep.name})
            progress(
                'episode_done',
                {'i': i, 'total': len(episodes), 'name': ep.name, 'seconds': 0.0, 'nodes': [], 'edges': []},
            )
    return SimpleNamespace(skipped=[])


@pytest.fixture
def client(tmp_path):
    s = get_settings()
    if not s.neo4j_password:
        pytest.skip('NEO4J_PASSWORD not set')
    settings = s.model_copy(update={'data_dir': tmp_path})
    fake = FakeGroq()

    def build(st):
        from app.kg.graph import build_graphiti

        graphiti, _ = build_graphiti(st, with_llm=False)
        return graphiti, fake, fake.budget

    app = create_app(build=build, settings=settings, ingest_fn=fake_ingest)
    try:
        with TestClient(app) as c:
            c.fake_groq = fake
            yield c
    except Exception as e:
        if 'Connect' in type(e).__name__ or 'ServiceUnavailable' in type(e).__name__:
            pytest.skip(f'Neo4j unreachable: {e}')
        raise


@pytest.fixture
def kg(client):
    kg_id = f'api-{uuid.uuid4().hex[:8]}'
    r = client.post('/api/kgs', json={'name': 'API test', 'id': kg_id})
    assert r.status_code == 201, r.text
    yield kg_id

    async def cleanup(driver):
        for n in range(6):
            await V.delete_group(driver, version_group(kg_id, n))
        await V.delete_group(driver, draft_group(kg_id))
        await driver.execute_query(
            'MATCH (n) WHERE (n:KnowledgeGraph AND n.id = $id) OR ((n:Version OR n:Source OR n:IngestJob) AND n.kg_id = $id) '
            'DETACH DELETE n',
            id=kg_id,
        )

    client.portal.call(cleanup, client.app.state.graphiti.driver)


def wait_job(client, job_id, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        job = client.get(f'/api/ingest-jobs/{job_id}').json()
        if job['status'] in ('done', 'failed', 'cancelled'):
            return job
        time.sleep(0.2)
    raise AssertionError(f'job {job_id} did not finish: {job}')


def test_full_flow(client, kg):
    assert client.get('/api/health').json()['neo4j'] is True
    assert {t['name'] for t in client.get('/api/schema').json()['entity_types']} >= {'Person', 'Task'}
    assert client.post('/api/kgs', json={'name': 'x', 'id': kg}).status_code == 409

    # A3: upload + preview
    with FIXTURE.open('rb') as f:
        r = client.post(
            f'/api/kgs/{kg}/sources',
            files={'file': ('chat_wa.txt', f, 'text/plain')},
            data={'owner': 'Pemilik', 'aliases': 'Leon TC 24=Leon'},
        )
    assert r.status_code == 201, r.text
    preview = r.json()
    assert preview['date_order'] == 'MDY' and len(preview['episodes']) == 4
    assert preview['participants'] == ['Pemilik', 'Leon']
    assert preview['counts'] == {'total': 17, 'text': 10, 'media': 6, 'system': 1}

    bad = client.post(
        f'/api/kgs/{kg}/sources', files={'file': ('x.txt', b'bukan chat', 'text/plain')}, data={'owner': 'P'}
    )
    assert bad.status_code == 422

    # A5: ingest job
    job = client.post(f'/api/kgs/{kg}/ingest-jobs', json={'source_id': preview['source_id']}).json()
    job = wait_job(client, job['id'])
    assert job['status'] == 'done', job
    assert (job['total'], job['done'], job['nodes'], job['edges']) == (4, 4, 2, 1)
    assert any('selesai' in line for line in job['log'])

    # A6: review the draft (all additions against an empty KG)
    changes = client.get(f'/api/kgs/{kg}/draft/changes').json()
    assert changes['summary']['add'] == 3  # 2 nodes + 1 fact
    fact = next(i for i in changes['items'] if i['target'] == 'edge')
    assert fact['quote'].startswith('[00:07]') or 'Leon' in fact['quote'] or fact['quote']

    # A7: commit -> v1
    v1 = client.post(f'/api/kgs/{kg}/versions', json={'message': 'Ingest chat_wa.txt', 'kind': 'ingest'}).json()
    assert v1['n'] == 1 and (v1['nodes'], v1['edges']) == (2, 1)
    info = client.get(f'/api/kgs/{kg}').json()
    assert info['latest'] == 1 and not info['has_draft']

    # B1: graph of v1 is read-only
    g1 = client.get(f'/api/kgs/{kg}/graph', params={'version': 'v1'}).json()
    leon_v1 = next(n for n in g1['nodes'] if n['label'] == 'Leon')
    r = client.patch(f'/api/kgs/{kg}/draft/entities/{leon_v1["id"]}', json={'name': 'x'})
    assert r.status_code == 409

    # B2: edit in a draft
    client.post(f'/api/kgs/{kg}/draft')
    gd = client.get(f'/api/kgs/{kg}/graph', params={'version': 'draft'}).json()
    leon = next(n for n in gd['nodes'] if n['label'] == 'Leon')
    r = client.patch(f'/api/kgs/{kg}/draft/entities/{leon["id"]}', json={'attributes': {'role': 'teman sekelas'}})
    assert r.status_code == 200, r.text
    edge = gd['edges'][0]
    r = client.patch(f'/api/kgs/{kg}/draft/edges/{edge["id"]}', json={'fact': 'Leon mengingatkan tugas ML pada 3 Nov'})
    assert r.status_code == 200
    d = client.get(f'/api/kgs/{kg}/versions/diff', params={'base': 'v1', 'compare': 'draft'}).json()
    assert d['summary']['nodes_changed'] == 1 and d['summary']['edges_changed'] == 1
    marks = {n['label']: n['mark'] for n in client.get(f'/api/kgs/{kg}/graph').json()['nodes']}
    assert marks['Leon'] == 'mod'

    # B5 + C: commit v2, restore v1 as v3
    assert client.post(f'/api/kgs/{kg}/versions', json={'message': 'Manual edit'}).json()['n'] == 2
    v3 = client.post(f'/api/kgs/{kg}/versions/1/restore', json={}).json()
    assert (v3['n'], v3['kind'], v3['parent']) == (3, 'restore', 1)
    same = client.get(f'/api/kgs/{kg}/versions/diff', params={'base': 'v1', 'compare': 'v3'}).json()
    assert not any(same['summary'].values())
    assert [v['n'] for v in client.get(f'/api/kgs/{kg}/versions').json()['versions']] == [3, 2, 1]

    # D: ask against v2 (search on real embeddings, answer from the fake Groq)
    a = client.post(f'/api/kgs/{kg}/ask', json={'question': 'Siapa mengingatkan tugas ml?', 'version': 'v2'}).json()
    assert a['group_id'] == version_group(kg, 2)
    assert a['references'] and a['references'][0]['fact'].startswith('Leon mengingatkan')
    assert a['subgraph']['edges'][0]['label'].startswith('[1] REMINDS')
    assert 'Leon mengingatkan tugas ML pada 3 Nov' in client.fake_groq.prompts[-1]

    # discard draft
    client.post(f'/api/kgs/{kg}/draft')
    assert client.delete(f'/api/kgs/{kg}/draft').json()['deleted'] > 0
    assert client.get(f'/api/kgs/{kg}').json()['has_draft'] is False
