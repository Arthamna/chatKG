from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from graphiti_core.driver.driver import GraphDriver

from .groups import draft_group, validate_kg_id, version_group

SCHEMA_QUERIES = [
    'CREATE CONSTRAINT kg_id IF NOT EXISTS FOR (k:KnowledgeGraph) REQUIRE k.id IS UNIQUE',
    'CREATE INDEX version_kg IF NOT EXISTS FOR (v:Version) ON (v.kg_id, v.n)',
    'CREATE INDEX entity_copy IF NOT EXISTS FOR (n:Entity) ON (n.group_id, n._copy_of)',
    'CREATE INDEX episodic_copy IF NOT EXISTS FOR (n:Episodic) ON (n.group_id, n._copy_of)',
    'CREATE INDEX entity_origin IF NOT EXISTS FOR (n:Entity) ON (n.group_id, n.origin_uuid)',
]

# Properties that are bookkeeping, not content, when comparing two versions.
INTERNAL_NODE_KEYS = {'uuid', 'group_id', 'origin_uuid', '_copy_of', 'name_embedding', 'created_at', 'labels'}
EDGE_COMPARE_KEYS = ('name', 'fact', 'valid_at', 'invalid_at', 'expired_at')


def _now() -> str:
    return datetime.now(UTC).isoformat()


async def _q(driver: GraphDriver, query: str, **params: Any) -> list[dict[str, Any]]:
    records, _, _ = await driver.execute_query(query, **params)
    return [dict(r) for r in records]


async def ensure_schema(driver: GraphDriver) -> None:
    for q in SCHEMA_QUERIES:
        await _q(driver, q)


# ---------------------------------------------------------------- groups


async def delete_group(driver: GraphDriver, group_id: str) -> int:
    rows = await _q(
        driver,
        'MATCH (n {group_id: $g}) WHERE n:Entity OR n:Episodic OR n:Community '
        'WITH n, count(*) AS c DETACH DELETE n RETURN sum(c) AS deleted',
        g=group_id,
    )
    return int(rows[0]['deleted'] or 0) if rows else 0


async def group_stats(driver: GraphDriver, group_id: str) -> dict[str, int]:
    rows = await _q(
        driver,
        'CALL () { MATCH (n:Entity {group_id: $g}) RETURN count(n) AS nodes } '
        'CALL () { MATCH (:Entity {group_id: $g})-[r:RELATES_TO]->(:Entity) RETURN count(r) AS edges } '
        'CALL () { MATCH (e:Episodic {group_id: $g}) RETURN count(e) AS episodes } '
        'RETURN nodes, edges, episodes',
        g=group_id,
    )
    r = rows[0]
    return {'nodes': r['nodes'], 'edges': r['edges'], 'episodes': r['episodes']}


async def copy_group(driver: GraphDriver, src: str, dst: str) -> dict[str, int]:
    if src == dst:
        raise ValueError('src and dst must differ')
    existing = await group_stats(driver, dst)
    if existing['nodes'] or existing['episodes']:
        raise ValueError(f'target group {dst} is not empty')

    await _q(
        driver,
        'MATCH (n {group_id: $src}) WHERE n:Entity OR n:Episodic '
        'CREATE (m) SET m = properties(n) SET m:$(labels(n)) '
        'SET m.uuid = randomUUID(), m.group_id = $dst, '
        '    m.origin_uuid = coalesce(n.origin_uuid, n.uuid), m._copy_of = n.uuid',
        src=src,
        dst=dst,
    )
    # 2. Facts between entities, with remapped endpoints.
    await _q(
        driver,
        'MATCH (a:Entity {group_id: $src})-[r:RELATES_TO]->(b:Entity {group_id: $src}) '
        'MATCH (a2:Entity {group_id: $dst, _copy_of: a.uuid}), (b2:Entity {group_id: $dst, _copy_of: b.uuid}) '
        'CREATE (a2)-[r2:RELATES_TO]->(b2) SET r2 = properties(r) '
        'SET r2.uuid = randomUUID(), r2.group_id = $dst, r2.origin_uuid = coalesce(r.origin_uuid, r.uuid), '
        '    r2._copy_of = r.uuid, r2.source_node_uuid = a2.uuid, r2.target_node_uuid = b2.uuid',
        src=src,
        dst=dst,
    )
    # 3. Episode -> entity mentions.
    await _q(
        driver,
        'MATCH (e:Episodic {group_id: $src})-[r:MENTIONS]->(n:Entity {group_id: $src}) '
        'MATCH (e2:Episodic {group_id: $dst, _copy_of: e.uuid}), (n2:Entity {group_id: $dst, _copy_of: n.uuid}) '
        'CREATE (e2)-[r2:MENTIONS]->(n2) SET r2 = properties(r) SET r2.uuid = randomUUID(), r2.group_id = $dst',
        src=src,
        dst=dst,
    )
    # 4. uuid lists: fact -> episodes, episode -> facts.
    await _q(
        driver,
        'MATCH ()-[r:RELATES_TO {group_id: $dst}]->() '
        'CALL (r) { UNWIND coalesce(r.episodes, []) AS old '
        '  OPTIONAL MATCH (e:Episodic {group_id: $dst, _copy_of: old}) RETURN collect(e.uuid) AS eps } '
        'SET r.episodes = eps',
        dst=dst,
    )
    await _q(
        driver,
        'MATCH (e:Episodic {group_id: $dst}) '
        'CALL (e) { UNWIND coalesce(e.entity_edges, []) AS old '
        '  OPTIONAL MATCH ()-[r:RELATES_TO {group_id: $dst, _copy_of: old}]->() RETURN collect(r.uuid) AS edges } '
        'SET e.entity_edges = edges',
        dst=dst,
    )
    # 5. Drop the temporary markers.
    await _q(driver, 'MATCH (n {group_id: $dst}) WHERE n._copy_of IS NOT NULL REMOVE n._copy_of', dst=dst)
    await _q(driver, 'MATCH ()-[r:RELATES_TO {group_id: $dst}]->() REMOVE r._copy_of', dst=dst)
    return await group_stats(driver, dst)


# ---------------------------------------------------------------- KGs & versions


@dataclass
class Version:
    n: int
    group_id: str
    kind: str
    message: str
    author: str
    created_at: str
    nodes: int
    edges: int
    parent: int | None = None


@dataclass
class KnowledgeGraph:
    id: str
    name: str
    description: str
    created_at: str
    latest: int
    draft_base: int | None
    has_draft: bool
    stats: dict[str, int] = field(default_factory=dict)


def _version(r: dict[str, Any]) -> Version:
    return Version(
        n=r['n'],
        group_id=r['group_id'],
        kind=r['kind'],
        message=r['message'],
        author=r.get('author') or '',
        created_at=r['created_at'],
        nodes=r.get('nodes') or 0,
        edges=r.get('edges') or 0,
        parent=r.get('parent'),
    )


async def create_kg(driver: GraphDriver, kg_id: str, name: str, description: str = '') -> KnowledgeGraph:
    validate_kg_id(kg_id)
    rows = await _q(
        driver,
        'MERGE (k:KnowledgeGraph {id: $id}) ON CREATE SET k.name = $name, k.description = $d, k.created_at = $now '
        'RETURN k.created_at = $now AS created',
        id=kg_id,
        name=name,
        d=description,
        now=_now(),
    )
    if not rows[0]['created']:
        raise ValueError(f'KG {kg_id!r} already exists')
    kg = await get_kg(driver, kg_id)
    assert kg is not None
    return kg


async def get_kg(driver: GraphDriver, kg_id: str) -> KnowledgeGraph | None:
    rows = await _q(
        driver,
        'MATCH (k:KnowledgeGraph {id: $id}) '
        'OPTIONAL MATCH (v:Version {kg_id: $id}) '
        'RETURN k {.*} AS k, max(v.n) AS latest',
        id=kg_id,
    )
    if not rows:
        return None
    k, latest = rows[0]['k'], rows[0]['latest'] or 0
    draft = await group_stats(driver, draft_group(kg_id))
    has_draft = k.get('draft_base') is not None or bool(draft['nodes'] or draft['episodes'])
    current = draft if has_draft else (await group_stats(driver, version_group(kg_id, latest)) if latest else draft)
    return KnowledgeGraph(
        id=k['id'],
        name=k['name'],
        description=k.get('description') or '',
        created_at=k['created_at'],
        latest=latest,
        draft_base=k.get('draft_base'),
        has_draft=has_draft,
        stats=current,
    )


async def list_kgs(driver: GraphDriver) -> list[KnowledgeGraph]:
    rows = await _q(driver, 'MATCH (k:KnowledgeGraph) RETURN k.id AS id ORDER BY k.created_at')
    out = []
    for r in rows:
        kg = await get_kg(driver, r['id'])
        if kg:
            out.append(kg)
    return out


async def require_kg(driver: GraphDriver, kg_id: str) -> KnowledgeGraph:
    kg = await get_kg(driver, kg_id)
    if kg is None:
        raise KeyError(f'KG {kg_id!r} not found')
    return kg


async def delete_kg(driver: GraphDriver, kg_id: str) -> dict[str, int]:
    """Delete one KG and every graph snapshot/metadata owned by it."""
    kg = await require_kg(driver, kg_id)
    versions = await list_versions(driver, kg_id)
    deleted_graph_nodes = await delete_group(driver, draft_group(kg_id))
    for version in versions:
        deleted_graph_nodes += await delete_group(driver, version.group_id)
    rows = await _q(
        driver,
        'CALL () { MATCH (j:IngestJob {kg_id: $id}) WITH collect(j) AS xs, count(j) AS n '
        '  FOREACH (x IN xs | DETACH DELETE x) RETURN n AS jobs } '
        'CALL () { MATCH (s:Source {kg_id: $id}) WITH collect(s) AS xs, count(s) AS n '
        '  FOREACH (x IN xs | DETACH DELETE x) RETURN n AS sources } '
        'CALL () { MATCH (v:Version {kg_id: $id}) WITH collect(v) AS xs, count(v) AS n '
        '  FOREACH (x IN xs | DETACH DELETE x) RETURN n AS versions } '
        'MATCH (k:KnowledgeGraph {id: $id}) DETACH DELETE k '
        'RETURN jobs, sources, versions',
        id=kg.id,
    )
    counts = rows[0] if rows else {'jobs': 0, 'sources': 0, 'versions': len(versions)}
    return {'graph_nodes': deleted_graph_nodes, **counts}


async def list_versions(driver: GraphDriver, kg_id: str) -> list[Version]:
    rows = await _q(driver, 'MATCH (v:Version {kg_id: $id}) RETURN v {.*} AS v ORDER BY v.n DESC', id=kg_id)
    return [_version(r['v']) for r in rows]


async def ensure_draft(driver: GraphDriver, kg_id: str) -> str:
    """Create the draft as a copy of the latest version (empty for a new KG)."""
    kg = await require_kg(driver, kg_id)
    gid = draft_group(kg_id)
    if kg.has_draft:
        return gid
    if kg.latest:
        await copy_group(driver, version_group(kg_id, kg.latest), gid)
    await _q(
        driver,
        'MATCH (k:KnowledgeGraph {id: $id}) SET k.draft_base = $n, k.draft_ontology = k.ontology',
        id=kg_id,
        n=kg.latest,
    )
    return gid


async def _record_version(
    driver: GraphDriver, kg_id: str, n: int, kind: str, message: str, author: str, parent: int | None
) -> Version:
    stats = await group_stats(driver, version_group(kg_id, n))
    rows = await _q(
        driver,
        'MATCH (k:KnowledgeGraph {id: $id}) '
        'CREATE (v:Version {kg_id: $id, n: $n, group_id: $g, kind: $kind, message: $msg, author: $author, '
        '  created_at: $now, nodes: $nodes, edges: $edges, parent: $parent}) '
        'SET v.ontology = coalesce(k.draft_ontology, k.ontology) '
        'CREATE (k)-[:HAS_VERSION]->(v) '
        'WITH v OPTIONAL MATCH (p:Version {kg_id: $id, n: $parent}) '
        'FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END | CREATE (v)-[:PARENT]->(p)) '
        'RETURN v {.*} AS v',
        id=kg_id,
        n=n,
        g=version_group(kg_id, n),
        kind=kind,
        msg=message,
        author=author,
        now=_now(),
        nodes=stats['nodes'],
        edges=stats['edges'],
        parent=parent,
    )
    return _version(rows[0]['v'])


async def commit(driver: GraphDriver, kg_id: str, message: str, *, kind: str = 'edit', author: str = '') -> Version:
    """Freeze the draft as version n+1 (whole copy), then drop the draft."""
    kg = await require_kg(driver, kg_id)
    if not kg.has_draft:
        raise ValueError(f'KG {kg_id!r} has no draft to commit')
    n = kg.latest + 1
    await copy_group(driver, draft_group(kg_id), version_group(kg_id, n))
    version = await _record_version(driver, kg_id, n, kind, message, author, kg.draft_base or None)
    await _q(
        driver,
        'MATCH (k:KnowledgeGraph {id: $id}), (v:Version {kg_id: $id, n: $n}) SET k.ontology = v.ontology',
        id=kg_id,
        n=n,
    )
    await discard_draft(driver, kg_id)
    return version


async def restore(driver: GraphDriver, kg_id: str, k: int, message: str = '', *, author: str = '') -> Version:
    """Copy version k into a new version n+1; nothing is overwritten."""
    kg = await require_kg(driver, kg_id)
    if not 1 <= k <= kg.latest:
        raise ValueError(f'version v{k} does not exist')
    n = kg.latest + 1
    await copy_group(driver, version_group(kg_id, k), version_group(kg_id, n))
    version = await _record_version(driver, kg_id, n, 'restore', message or f'Restore dari v{k}', author, k)
    await _q(
        driver,
        'MATCH (k:KnowledgeGraph {id: $id}), (old:Version {kg_id: $id, n: $old}), '
        '(v:Version {kg_id: $id, n: $n}) SET v.ontology = old.ontology, k.ontology = old.ontology',
        id=kg_id,
        old=k,
        n=n,
    )
    return version


async def discard_draft(driver: GraphDriver, kg_id: str) -> int:
    deleted = await delete_group(driver, draft_group(kg_id))
    await _q(driver, 'MATCH (k:KnowledgeGraph {id: $id}) REMOVE k.draft_base, k.draft_ontology', id=kg_id)
    return deleted


def resolve_group(kg_id: str, version: str | int | None) -> str:
    """'draft' | 'v3' | 3 | None (draft) -> group_id."""
    if version in (None, '', 'draft'):
        return draft_group(kg_id)
    n = int(str(version).lstrip('v'))
    return version_group(kg_id, n)


# ---------------------------------------------------------------- diff


def _plain(value: Any) -> Any:
    if hasattr(value, 'iso_format'):
        return value.iso_format()
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


async def _snapshot(driver: GraphDriver, group_id: str) -> tuple[dict[str, dict], dict[str, dict]]:
    node_rows = await _q(
        driver,
        'MATCH (n:Entity {group_id: $g}) '
        'RETURN coalesce(n.origin_uuid, n.uuid) AS key, n.uuid AS uuid, '
        "  [x IN labels(n) WHERE x <> 'Entity'] AS types, n {.*, name_embedding: null} AS props",
        g=group_id,
    )
    nodes: dict[str, dict] = {}
    for r in node_rows:
        props = {k: _plain(v) for k, v in r['props'].items() if k not in INTERNAL_NODE_KEYS and v is not None}
        nodes[r['key']] = {'key': r['key'], 'uuid': r['uuid'], 'types': sorted(r['types']), **props}
    edge_rows = await _q(
        driver,
        'MATCH (a:Entity {group_id: $g})-[r:RELATES_TO]->(b:Entity) '
        'RETURN coalesce(r.origin_uuid, r.uuid) AS key, r.uuid AS uuid, r.name AS name, r.fact AS fact, '
        '  r.valid_at AS valid_at, r.invalid_at AS invalid_at, r.expired_at AS expired_at, '
        '  coalesce(a.origin_uuid, a.uuid) AS source, coalesce(b.origin_uuid, b.uuid) AS target, '
        '  a.name AS source_name, b.name AS target_name, a.uuid AS source_uuid, b.uuid AS target_uuid, '
        '  coalesce(r.episodes, []) AS episodes',
        g=group_id,
    )
    edges = {r['key']: {k: _plain(v) for k, v in r.items()} for r in edge_rows}
    return nodes, edges


def _node_changes(a: dict, b: dict) -> dict[str, list]:
    keys = (set(a) | set(b)) - {'key', 'uuid'}
    return {k: [a.get(k), b.get(k)] for k in sorted(keys) if a.get(k) != b.get(k)}


async def diff(driver: GraphDriver, base_group: str | None, compare_group: str) -> dict[str, Any]:
    """Compare two groups by origin_uuid. ``base_group=None`` diffs against empty."""
    base_nodes, base_edges = await _snapshot(driver, base_group) if base_group else ({}, {})
    cmp_nodes, cmp_edges = await _snapshot(driver, compare_group)

    nodes = {
        'added': [cmp_nodes[k] for k in cmp_nodes.keys() - base_nodes.keys()],
        'removed': [base_nodes[k] for k in base_nodes.keys() - cmp_nodes.keys()],
        'changed': [
            {'key': k, 'uuid': cmp_nodes[k]['uuid'], 'name': cmp_nodes[k].get('name'), 'changes': ch}
            for k in cmp_nodes.keys() & base_nodes.keys()
            if (ch := _node_changes(base_nodes[k], cmp_nodes[k]))
        ],
    }
    edges: dict[str, list] = {'added': [], 'removed': [], 'changed': [], 'invalidated': []}
    edges['added'] = [cmp_edges[k] for k in cmp_edges.keys() - base_edges.keys()]
    edges['removed'] = [base_edges[k] for k in base_edges.keys() - cmp_edges.keys()]
    for k in cmp_edges.keys() & base_edges.keys():
        a, b = base_edges[k], cmp_edges[k]
        ch = {f: [a[f], b[f]] for f in (*EDGE_COMPARE_KEYS, 'source', 'target') if a[f] != b[f]}
        if not ch:
            continue
        newly_invalid = (a['invalid_at'] is None and b['invalid_at'] is not None) or (
            a['expired_at'] is None and b['expired_at'] is not None
        )
        edges['invalidated' if newly_invalid else 'changed'].append({**b, 'changes': ch})
    for bucket in (*nodes.values(), *edges.values()):
        bucket.sort(key=lambda x: str(x.get('name') or x.get('fact') or ''))
    summary = {f'nodes_{k}': len(v) for k, v in nodes.items()} | {f'edges_{k}': len(v) for k, v in edges.items()}
    return {'base': base_group, 'compare': compare_group, 'summary': summary, 'nodes': nodes, 'edges': edges}
