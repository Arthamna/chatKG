"""Versioning against the real Neo4j from docker-compose (skipped when unreachable)."""

from __future__ import annotations

import uuid

import pytest
from graphiti_core.driver.neo4j_driver import Neo4jDriver
from graphiti_core.edges import EntityEdge
from graphiti_core.nodes import EntityNode

from app.config import get_settings
from app.kg import versions as V
from app.kg.groups import draft_group, version_group

pytestmark = pytest.mark.neo4j


@pytest.fixture
async def driver():
    s = get_settings()
    if not s.neo4j_password:
        pytest.skip('NEO4J_PASSWORD not set')
    d = Neo4jDriver(s.neo4j_uri, s.neo4j_user, s.neo4j_password)
    try:
        await d.execute_query('RETURN 1')
    except Exception as e:  # noqa: BLE001
        await d.close()
        pytest.skip(f'Neo4j unreachable: {e}')
    await V.ensure_schema(d)
    yield d
    await d.close()


@pytest.fixture
async def kg(driver):
    kg_id = f'vtest-{uuid.uuid4().hex[:8]}'
    await V.create_kg(driver, kg_id, 'Versi test')
    yield kg_id
    for n in range(6):
        await V.delete_group(driver, version_group(kg_id, n))
    await V.delete_group(driver, draft_group(kg_id))
    await driver.execute_query(
        'MATCH (k:KnowledgeGraph {id: $id}) OPTIONAL MATCH (v:Version {kg_id: $id}) DETACH DELETE k, v', id=kg_id
    )


async def seed(driver, group_id: str) -> dict[str, str]:
    """A tiny graph shaped like Graphiti's: 2 entities, 1 fact, 1 episode."""
    ids = {k: str(uuid.uuid4()) for k in ('a', 'b', 'e', 'r', 'ep')}
    await driver.execute_query(
        'CREATE (a:Entity:Person {uuid: $a, group_id: $g, name: "Pemilik", summary: "pemilik akun", '
        '  name_embedding: [0.1, 0.2], created_at: datetime(), labels: ["Entity", "Person"]}) '
        'CREATE (b:Entity:Task {uuid: $b, group_id: $g, name: "tugas ml", summary: "", status: "belum", '
        '  name_embedding: [0.3, 0.4], created_at: datetime(), labels: ["Entity", "Task"]}) '
        'CREATE (ep:Episodic {uuid: $ep, group_id: $g, name: "wa:x:1", content: "[00:07] Pemilik: ingatin", '
        '  entity_edges: [$r], created_at: datetime(), valid_at: datetime(), source: "message", source_description: "t"}) '
        'CREATE (a)-[:RELATES_TO {uuid: $r, group_id: $g, name: "ASKS_REMINDER", fact: "Pemilik minta diingatkan", '
        '  episodes: [$ep], source_node_uuid: $a, target_node_uuid: $b, valid_at: datetime(), created_at: datetime(), '
        '  fact_embedding: [0.5, 0.6]}]->(b) '
        'CREATE (ep)-[:MENTIONS {uuid: $e, group_id: $g, created_at: datetime()}]->(a) '
        'CREATE (ep)-[:MENTIONS {uuid: randomUUID(), group_id: $g, created_at: datetime()}]->(b)',
        g=group_id,
        **ids,
    )
    return ids


async def assert_references_consistent(driver, group_id: str) -> None:
    records, _, _ = await driver.execute_query(
        'MATCH (a:Entity {group_id: $g})-[r:RELATES_TO]->(b:Entity) '
        'RETURN r.source_node_uuid = a.uuid AND r.target_node_uuid = b.uuid AS endpoints_ok, '
        '  all(x IN r.episodes WHERE EXISTS { MATCH (e:Episodic {group_id: $g, uuid: x}) }) AS episodes_ok, '
        '  size(r.episodes) AS n_eps',
        g=group_id,
    )
    assert records, 'no facts copied'
    for r in records:
        assert r['endpoints_ok'] and r['episodes_ok'] and r['n_eps'] > 0
    records, _, _ = await driver.execute_query(
        'MATCH (e:Episodic {group_id: $g}) UNWIND e.entity_edges AS x '
        'RETURN x, EXISTS { MATCH ()-[r:RELATES_TO {group_id: $g, uuid: x}]->() } AS ok',
        g=group_id,
    )
    assert all(r['ok'] for r in records)
    records, _, _ = await driver.execute_query(
        'MATCH (n {group_id: $g}) WHERE n._copy_of IS NOT NULL RETURN count(n) AS c', g=group_id
    )
    assert records[0]['c'] == 0


async def test_commit_draft_diff_restore(driver, kg):
    await seed(driver, draft_group(kg))
    info = await V.require_kg(driver, kg)
    assert info.has_draft and info.latest == 0

    v1 = await V.commit(driver, kg, 'Ingest awal', kind='ingest')
    assert (v1.n, v1.nodes, v1.edges) == (1, 2, 1)
    info = await V.require_kg(driver, kg)
    assert not info.has_draft and info.latest == 1
    assert await V.group_stats(driver, draft_group(kg)) == {'nodes': 0, 'edges': 0, 'episodes': 0}
    await assert_references_consistent(driver, version_group(kg, 1))

    # Edit in a fresh draft copied from v1.
    await V.ensure_draft(driver, kg)
    d = draft_group(kg)
    await assert_references_consistent(driver, d)
    await driver.execute_query(
        'MATCH (n:Entity {group_id: $g, name: "tugas ml"}) SET n.name = "Tugas Machine Learning", n.status = "selesai" '
        'WITH 1 AS _ MATCH ()-[r:RELATES_TO {group_id: $g}]->() SET r.invalid_at = datetime() '
        'WITH 1 AS _ MATCH (a:Entity {group_id: $g, name: "Pemilik"}) '
        'CREATE (:Entity:Course {uuid: randomUUID(), group_id: $g, name: "PBKK", summary: "", labels: ["Entity", "Course"]})',
        g=d,
    )
    changes = await V.diff(driver, version_group(kg, 1), d)
    s = changes['summary']
    assert (s['nodes_added'], s['nodes_removed'], s['nodes_changed']) == (1, 0, 1)
    assert s['edges_invalidated'] == 1
    changed = changes['nodes']['changed'][0]['changes']
    assert changed['name'] == ['tugas ml', 'Tugas Machine Learning']
    assert changed['status'] == ['belum', 'selesai']

    v2 = await V.commit(driver, kg, 'Manual edit')
    assert (v2.n, v2.nodes, v2.parent) == (2, 3, 1)

    v3 = await V.restore(driver, kg, 1)
    assert (v3.n, v3.kind, v3.parent) == (3, 'restore', 1)
    same = await V.diff(driver, version_group(kg, 1), version_group(kg, 3))
    assert not any(same['summary'].values()), same['summary']
    assert [v.n for v in await V.list_versions(driver, kg)] == [3, 2, 1]


async def test_uuids_are_unique_across_versions(driver, kg):
    await seed(driver, draft_group(kg))
    await V.commit(driver, kg, 'v1')
    await V.restore(driver, kg, 1)
    records, _, _ = await driver.execute_query(
        'MATCH (n:Entity) WHERE n.group_id STARTS WITH $p WITH n.uuid AS u, count(*) AS c WHERE c > 1 RETURN count(u) AS dupes',
        p=f'kg_{kg}__',
    )
    assert records[0]['dupes'] == 0
    # Graphiti lookups by uuid (no group filter) must find exactly one node / edge.
    records, _, _ = await driver.execute_query(
        'MATCH (n:Entity {group_id: $g}) RETURN n.uuid AS u LIMIT 1', g=version_group(kg, 2)
    )
    node = await EntityNode.get_by_uuid(driver, records[0]['u'])
    assert node.group_id == version_group(kg, 2)
    records, _, _ = await driver.execute_query(
        'MATCH ()-[r:RELATES_TO {group_id: $g}]->() RETURN r.uuid AS u LIMIT 1', g=version_group(kg, 2)
    )
    edge = await EntityEdge.get_by_uuid(driver, records[0]['u'])
    assert edge.group_id == version_group(kg, 2) and edge.episodes


async def test_copy_of_real_graphiti_group(driver, kg):
    """Copy a group produced by an actual Graphiti ingest (chatkg ingest --kg demo-verify)."""
    src = draft_group('demo-verify')
    if (await V.group_stats(driver, src))['nodes'] == 0:
        pytest.skip(f'{src} not present; run chatkg ingest first')
    dst = version_group(kg, 5)
    stats = await V.copy_group(driver, src, dst)
    assert stats == await V.group_stats(driver, src)
    await assert_references_consistent(driver, dst)
    same = await V.diff(driver, src, dst)
    assert not any(same['summary'].values()), same['summary']


async def test_graphiti_save_keeps_origin_uuid(driver, kg):
    """Graphiti's save() does `SET n = $data`; origin_uuid must survive via attributes."""
    await seed(driver, draft_group(kg))
    await V.commit(driver, kg, 'v1')
    await V.ensure_draft(driver, kg)
    d = draft_group(kg)
    records, _, _ = await driver.execute_query(
        'MATCH (n:Entity {group_id: $g, name: "tugas ml"}) RETURN n.uuid AS u', g=d
    )
    node = await EntityNode.get_by_uuid(driver, records[0]['u'])
    await node.load_name_embedding(driver)  # get_by_uuid does not load vectors; save() needs them
    node.summary = 'diubah lewat Graphiti'
    await node.save(driver)
    records, _, _ = await driver.execute_query('MATCH ()-[r:RELATES_TO {group_id: $g}]->() RETURN r.uuid AS u', g=d)
    edge = await EntityEdge.get_by_uuid(driver, records[0]['u'])
    await edge.load_fact_embedding(driver)
    edge.fact = 'fakta diubah'
    await edge.save(driver)

    changes = await V.diff(driver, version_group(kg, 1), d)
    s = changes['summary']
    assert (s['nodes_added'], s['nodes_removed'], s['nodes_changed']) == (0, 0, 1), s
    assert (s['edges_added'], s['edges_removed'], s['edges_changed']) == (0, 0, 1), s


async def test_copy_refuses_non_empty_target(driver, kg):
    await seed(driver, draft_group(kg))
    await V.commit(driver, kg, 'v1')
    await seed(driver, draft_group(kg))
    with pytest.raises(ValueError, match='not empty'):
        await V.copy_group(driver, draft_group(kg), version_group(kg, 1))
