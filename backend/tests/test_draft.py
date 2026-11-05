"""Draft review / edit operations against the real Neo4j (skipped when unreachable)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.kg import draft as D
from app.kg import versions as V
from app.kg.groups import draft_group, version_group

from .test_versions import driver, kg, seed  # noqa: F401  (fixtures)

pytestmark = pytest.mark.neo4j


class FakeEmbedder:
    def __init__(self):
        self.calls: list[str] = []

    async def create(self, input_data):
        text = input_data if isinstance(input_data, str) else input_data[0]
        self.calls.append(text)
        return [float(len(text)), 1.0]


@pytest.fixture
def graphiti(driver):  # noqa: F811
    return SimpleNamespace(driver=driver, embedder=FakeEmbedder())


async def one(driver, query, **params):  # noqa: F811
    records, _, _ = await driver.execute_query(query, **params)
    return [dict(r) for r in records]


async def committed_with_draft(driver, kg):  # noqa: F811
    await seed(driver, draft_group(kg))
    await V.commit(driver, kg, 'v1', kind='ingest')
    await V.ensure_draft(driver, kg)
    return draft_group(kg)


async def test_review_lists_changes_and_reject(driver, kg, graphiti):  # noqa: F811
    d = await committed_with_draft(driver, kg)
    # Simulate an ingest: new node + fact, invalidated old fact, renamed node.
    await driver.execute_query(
        'MATCH (a:Entity {group_id: $g, name: "Pemilik"}), (t:Entity {group_id: $g, name: "tugas ml"}) '
        'CREATE (c:Entity:Course {uuid: randomUUID(), group_id: $g, name: "Machine Learning", summary: "", '
        '  labels: ["Entity", "Course"], name_embedding: [1.0, 1.0]}) '
        'CREATE (t)-[:RELATES_TO {uuid: randomUUID(), group_id: $g, name: "PART_OF", fact: "tugas ml bagian dari ML", '
        '  episodes: [], source_node_uuid: t.uuid, target_node_uuid: c.uuid, created_at: datetime()}]->(c) '
        'SET t.name = "Tugas ML" '
        'WITH a MATCH (a)-[r:RELATES_TO {group_id: $g}]->() SET r.invalid_at = datetime()',
        g=d,
    )
    review = await D.review_changes(driver, kg)
    kinds = {(i['kind'], i['target']) for i in review['items']}
    assert {('add', 'node'), ('add', 'edge'), ('modify', 'node'), ('invalidate', 'edge')} <= kinds
    assert review['summary']['add'] == 2

    by_kind = {(i['kind'], i['target']): i for i in review['items']}
    await D.reject_change(graphiti, kg, by_kind[('invalidate', 'edge')]['id'])
    await D.reject_change(graphiti, kg, by_kind[('modify', 'node')]['id'])
    await D.reject_change(graphiti, kg, by_kind[('add', 'node')]['id'])  # also drops its PART_OF fact
    review = await D.review_changes(driver, kg)
    assert review['items'] == [], review['items']


async def test_conflict_detection_and_resolve(driver, kg, graphiti):  # noqa: F811
    d = await committed_with_draft(driver, kg)
    await driver.execute_query(
        'MATCH (a:Entity {group_id: $g, name: "Pemilik"}), (t:Entity {group_id: $g, name: "tugas ml"}) '
        'CREATE (x:Entity:Task {uuid: randomUUID(), group_id: $g, name: "tugas pbkk", summary: "", labels: ["Entity", "Task"]}) '
        'CREATE (a)-[:RELATES_TO {uuid: "keep-" + randomUUID(), group_id: $g, name: "RESPONSIBLE_FOR", fact: "Pemilik pegang ml", '
        '  episodes: [], source_node_uuid: a.uuid, target_node_uuid: t.uuid}]->(t) '
        'CREATE (a)-[:RELATES_TO {uuid: randomUUID(), group_id: $g, name: "RESPONSIBLE_FOR", fact: "Pemilik pegang pbkk", '
        '  episodes: [], source_node_uuid: a.uuid, target_node_uuid: x.uuid}]->(x)',
        g=d,
    )
    review = await D.review_changes(driver, kg)
    conflicts = [i for i in review['items'] if i['kind'] == 'conflict']
    assert len(conflicts) == 2 and review['summary']['conflict'] == 2
    keep = next(i for i in conflicts if i['uuid'].startswith('keep-'))
    assert await D.resolve_conflict(driver, kg, keep['uuid']) == 1
    review = await D.review_changes(driver, kg)
    assert not [i for i in review['items'] if i['kind'] == 'conflict']


async def test_edits_rename_merge_delete(driver, kg, graphiti):  # noqa: F811
    d = await committed_with_draft(driver, kg)
    rows = await one(driver, 'MATCH (n:Entity {group_id: $g}) RETURN n.name AS name, n.uuid AS u', g=d)
    ids = {r['name']: r['u'] for r in rows}

    out = await D.update_entity(graphiti, kg, ids['tugas ml'], name='Tugas ML', attributes={'status': 'selesai'})
    assert out['name'] == 'Tugas ML' and graphiti.embedder.calls == ['Tugas ML']
    node = (await one(driver, 'MATCH (n:Entity {uuid: $u}) RETURN n {.*} AS n', u=ids['tugas ml']))[0]['n']
    assert node['status'] == 'selesai' and node['origin_uuid'] and node['name_embedding'] == [8.0, 1.0]

    # Merge "tugas ml" into a new duplicate: its fact and mentions move over.
    dup = (
        await one(
            driver,
            'CREATE (n:Entity:Task {uuid: randomUUID(), group_id: $g, name: "tugas machine learning", summary: "dup", created_at: datetime(), '
            '  labels: ["Entity", "Task"], name_embedding: [1.0, 1.0]}) RETURN n.uuid AS u',
            g=d,
        )
    )[0]['u']
    res = await D.merge_entities(graphiti, kg, ids['tugas ml'], dup, name='Tugas ML')
    assert res['moved'] == 1
    facts = await one(
        driver,
        'MATCH (a)-[r:RELATES_TO {group_id: $g}]->(b) RETURN b.uuid AS b, r.target_node_uuid AS t',
        g=d,
    )
    assert facts == [{'b': dup, 't': dup}]
    mentions = await one(
        driver, 'MATCH (:Episodic {group_id: $g})-[:MENTIONS]->(n {uuid: $u}) RETURN count(*) AS c', g=d, u=dup
    )
    assert mentions[0]['c'] == 1

    removed = await D.delete_entity(driver, kg, ids['Pemilik'])
    assert removed == 1
    refs = await one(driver, 'MATCH (e:Episodic {group_id: $g}) RETURN e.entity_edges AS x', g=d)
    assert refs == [{'x': []}]


async def test_committed_versions_are_read_only(driver, kg, graphiti):  # noqa: F811
    await seed(driver, draft_group(kg))
    await V.commit(driver, kg, 'v1')
    rows = await one(driver, 'MATCH (n:Entity {group_id: $g}) RETURN n.uuid AS u LIMIT 1', g=version_group(kg, 1))
    with pytest.raises(D.DraftError, match='read-only'):
        await D.update_entity(graphiti, kg, rows[0]['u'], name='x')
    with pytest.raises(D.DraftError, match='read-only'):
        await D.delete_entity(driver, kg, rows[0]['u'])


async def test_graph_view_marks_draft_changes(driver, kg, graphiti):  # noqa: F811
    d = await committed_with_draft(driver, kg)
    await driver.execute_query(
        'CREATE (:Entity:Course {uuid: randomUUID(), group_id: $g, name: "PBKK", summary: "", labels: ["Entity", "Course"]})',
        g=d,
    )
    view = await D.graph_view(driver, kg, 'draft')
    by_name = {n['label']: n for n in view['nodes']}
    assert by_name['PBKK']['mark'] == 'add' and by_name['PBKK']['type'] == 'Course'
    assert by_name['tugas ml']['props'] == {'status': 'belum'}
    assert len(view['edges']) == 1 and view['edges'][0]['source_quote'].startswith('[00:07]')
    v1 = await D.graph_view(driver, kg, 'v1')
    assert all(n['mark'] is None for n in v1['nodes']) and len(v1['nodes']) == 2
