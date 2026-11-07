"""Draft operations: review list (UI A6), review actions, manual edits (UI B1–B5)
and the graph view for the web viewer. Committed versions are read-only; every
write here checks that the target lives in ``kg_<kg>__draft``.

Graphiti's ``save()`` replaces all properties (``SET n = $data``) and
``get_by_uuid`` does not load vectors, so edits load the embedding first and
re-embed when the text changes. ``origin_uuid`` survives because Graphiti keeps
unknown properties in ``attributes``.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from graphiti_core import Graphiti
from graphiti_core.driver.driver import GraphDriver
from graphiti_core.edges import EntityEdge
from graphiti_core.nodes import EntityNode

from .groups import draft_group, version_group
from .versions import INTERNAL_NODE_KEYS, _plain, _q, diff, require_kg, resolve_group

# Relations where one source should point to a single target (design §4.5).
FUNCTIONAL_RELATIONS = {'RESPONSIBLE_FOR'}


class DraftError(ValueError):
    """Operation not allowed (not in the draft, unknown item, ...)."""


def _type_of(labels: list[str]) -> str:
    rest = [x for x in labels if x != 'Entity']
    return rest[0] if rest else 'Entity'


async def _base_group(driver: GraphDriver, kg_id: str) -> str | None:
    kg = await require_kg(driver, kg_id)
    return version_group(kg_id, kg.draft_base) if kg.draft_base else None


async def _episode_quotes(driver: GraphDriver, uuids: list[str]) -> dict[str, dict[str, str]]:
    if not uuids:
        return {}
    rows = await _q(
        driver,
        'MATCH (e:Episodic) WHERE e.uuid IN $u RETURN e.uuid AS uuid, e.content AS content, '
        'e.source_description AS source',
        u=list(set(uuids)),
    )
    return {r['uuid']: {'content': r['content'] or '', 'source': r['source'] or ''} for r in rows}


def _quote(content: str, words: list[str]) -> str:
    """The episode line that mentions the fact's entities, else the first line."""
    lines = [x for x in content.splitlines() if x.strip()]
    keys = [w.lower() for w in words if w]
    for line in lines:
        if any(k in line.lower() for k in keys):
            return line[:200]
    return (lines[0] if lines else '')[:200]


# ---------------------------------------------------------------- review (A6)


async def review_changes(driver: GraphDriver, kg_id: str) -> dict[str, Any]:
    kg = await require_kg(driver, kg_id)
    draft = draft_group(kg_id)
    if not kg.has_draft:
        return {'kg': kg_id, 'base': kg.latest or None, 'summary': {}, 'items': []}
    base = await _base_group(driver, kg_id)
    d = await diff(driver, base, draft)

    edges_all = [*d['edges']['added'], *d['edges']['changed'], *d['edges']['invalidated']]
    quotes = await _episode_quotes(driver, [ep for e in edges_all for ep in e.get('episodes', [])[:1]])

    def edge_item(e: dict, kind: str) -> dict[str, Any]:
        ep = quotes.get((e.get('episodes') or [None])[0] or '', {})
        return {
            'id': f'edge-{kind}:{e["uuid"]}',
            'kind': kind,
            'target': 'edge',
            'uuid': e['uuid'],
            'label': e['name'],
            'item': f'{e["source_name"]} —{e["name"]}→ {e["target_name"]}',
            'detail': e['fact'],
            'quote': _quote(ep.get('content', ''), [e['source_name'], e['target_name']]),
            'source': ep.get('source', ''),
            'valid_at': e.get('valid_at'),
            'invalid_at': e.get('invalid_at'),
            'changes': e.get('changes'),
        }

    items: list[dict[str, Any]] = []
    for n in d['nodes']['added']:
        items.append(
            {
                'id': f'node-add:{n["uuid"]}',
                'kind': 'add',
                'target': 'node',
                'uuid': n['uuid'],
                'label': f'Node · {n["types"][0] if n["types"] else "Entity"}',
                'item': n.get('name', ''),
                'detail': n.get('summary', ''),
            }
        )
    for n in d['nodes']['changed']:
        ch = {k: v for k, v in n['changes'].items() if k != 'summary'}
        text = '; '.join(f'{k}: {a or "—"} → {b or "—"}' for k, (a, b) in ch.items()) or 'ringkasan diperbarui'
        items.append(
            {
                'id': f'node-modify:{n["uuid"]}',
                'kind': 'modify',
                'target': 'node',
                'uuid': n['uuid'],
                'label': 'Node',
                'item': n['name'],
                'detail': text,
                'changes': n['changes'],
            }
        )
    for e in d['edges']['added']:
        items.append(edge_item(e, 'add'))
    for e in d['edges']['invalidated']:
        items.append(edge_item(e, 'invalidate'))
    for e in d['edges']['changed']:
        items.append(edge_item(e, 'modify'))
    for n in d['nodes']['removed']:
        items.append(
            {
                'id': f'node-remove:{n["key"]}',
                'kind': 'remove',
                'target': 'node',
                'uuid': None,
                'label': 'Node',
                'item': n.get('name', ''),
            }
        )
    for e in d['edges']['removed']:
        items.append(
            {
                'id': f'edge-remove:{e["key"]}',
                'kind': 'remove',
                'target': 'edge',
                'uuid': None,
                'label': e['name'],
                'item': f'{e["source_name"]} —{e["name"]}→ {e["target_name"]}',
                'detail': e['fact'],
            }
        )

    # Conflicts: a functional relation with several valid targets for one source.
    rows = await _q(
        driver,
        'MATCH (a:Entity {group_id: $g})-[r:RELATES_TO]->(b:Entity) '
        'WHERE r.name IN $rels AND r.invalid_at IS NULL AND r.expired_at IS NULL '
        'WITH a, r.name AS rel, collect(r.uuid) AS edges, count(DISTINCT b) AS targets WHERE targets > 1 '
        'RETURN a.name AS source, rel, edges',
        g=draft,
        rels=sorted(FUNCTIONAL_RELATIONS),
    )
    conflict_edges = {u: r for r in rows for u in r['edges']}
    for it in items:
        if it['target'] == 'edge' and it['uuid'] in conflict_edges:
            it['kind'] = 'conflict'
            it['id'] = f'edge-conflict:{it["uuid"]}'
            it['conflict_with'] = [u for u in conflict_edges[it['uuid']]['edges'] if u != it['uuid']]

    order = {'conflict': 0, 'add': 1, 'modify': 2, 'invalidate': 3, 'remove': 4}
    items.sort(key=lambda x: (order[x['kind']], x['target'], x['item']))
    counts: dict[str, int] = {}
    for it in items:
        counts[it['kind']] = counts.get(it['kind'], 0) + 1
    counts['node'] = sum(1 for it in items if it['target'] == 'node')
    counts['edge'] = sum(1 for it in items if it['target'] == 'edge')
    return {'kg': kg_id, 'base': kg.draft_base or None, 'summary': counts, 'items': items}


async def _in_draft(driver: GraphDriver, kg_id: str, uuid: str, *, edge: bool) -> None:
    query = (
        'MATCH ()-[x:RELATES_TO {uuid: $u}]->() RETURN x.group_id AS g'
        if edge
        else 'MATCH (x:Entity {uuid: $u}) RETURN x.group_id AS g'
    )
    rows = await _q(driver, query, u=uuid)
    if not rows:
        raise DraftError(f'{"edge" if edge else "node"} {uuid} not found')
    if rows[0]['g'] != draft_group(kg_id):
        raise DraftError('committed versions are read-only; edit the draft')


async def reject_change(graphiti: Graphiti, kg_id: str, item_id: str) -> None:
    """Undo one reviewed change in the draft."""
    driver = graphiti.driver
    kind, _, uuid = item_id.partition(':')
    if kind.endswith('-remove'):
        raise DraftError('removed items cannot be restored one by one; discard the draft instead')
    is_edge = kind.startswith('edge-')
    await _in_draft(driver, kg_id, uuid, edge=is_edge)
    if kind in ('node-add',):
        await delete_entity(driver, kg_id, uuid)
    elif kind in ('edge-add', 'edge-conflict'):
        await delete_edge(driver, kg_id, uuid)
    elif kind in ('edge-invalidate', 'edge-modify'):
        base = await _base_group(driver, kg_id)
        await _q(
            driver,
            'MATCH ()-[r:RELATES_TO {uuid: $u}]->() '
            'MATCH ()-[b:RELATES_TO {group_id: $base}]->() WHERE coalesce(b.origin_uuid, b.uuid) = r.origin_uuid '
            'SET r.name = b.name, r.fact = b.fact, r.fact_embedding = b.fact_embedding, '
            '    r.valid_at = b.valid_at, r.invalid_at = b.invalid_at, r.expired_at = b.expired_at',
            u=uuid,
            base=base,
        )
    elif kind == 'node-modify':
        base = await _base_group(driver, kg_id)
        await _q(
            driver,
            'MATCH (d:Entity {uuid: $u}) '
            'MATCH (b:Entity {group_id: $base}) WHERE coalesce(b.origin_uuid, b.uuid) = d.origin_uuid '
            'WITH d, b, d.group_id AS g, d.origin_uuid AS o '
            "REMOVE d:$([x IN labels(d) WHERE x <> 'Entity']) "
            'SET d = properties(b) SET d:$(labels(b)) SET d.uuid = $u, d.group_id = g, d.origin_uuid = o',
            u=uuid,
            base=base,
        )
    else:
        raise DraftError(f'unknown change {item_id!r}')


async def resolve_conflict(driver: GraphDriver, kg_id: str, keep_uuid: str) -> int:
    """Keep one edge of a functional-relation conflict; invalidate the others."""
    await _in_draft(driver, kg_id, keep_uuid, edge=True)
    rows = await _q(
        driver,
        'MATCH (a:Entity)-[k:RELATES_TO {uuid: $u}]->() '
        'MATCH (a)-[r:RELATES_TO {group_id: k.group_id, name: k.name}]->() '
        'WHERE r.uuid <> k.uuid AND r.invalid_at IS NULL AND r.expired_at IS NULL '
        'SET r.invalid_at = datetime(), r.expired_at = datetime() RETURN count(r) AS n',
        u=keep_uuid,
    )
    return rows[0]['n']


# ---------------------------------------------------------------- edits (B2–B4)


def _relation_name(value: str) -> str:
    name = re.sub(r'[^A-Z0-9]+', '_', value.strip().upper()).strip('_')
    if not name:
        raise DraftError('nama relasi wajib diisi')
    return name[:64]


async def create_edge(
    graphiti: Graphiti,
    kg_id: str,
    source_uuid: str,
    target_uuid: str,
    *,
    name: str,
    fact: str,
) -> dict[str, Any]:
    if source_uuid == target_uuid:
        raise DraftError('node sumber dan target harus berbeda')
    await _in_draft(graphiti.driver, kg_id, source_uuid, edge=False)
    await _in_draft(graphiti.driver, kg_id, target_uuid, edge=False)
    relation = _relation_name(name)
    statement = fact.strip()
    if not statement:
        raise DraftError('fakta relasi wajib diisi')
    rows = await _q(
        graphiti.driver,
        'MATCH (s:Entity {uuid: $s})-[r:RELATES_TO {name: $name}]->(t:Entity {uuid: $t}) '
        'WHERE r.invalid_at IS NULL AND r.expired_at IS NULL RETURN r.uuid AS uuid',
        s=source_uuid,
        t=target_uuid,
        name=relation,
    )
    if rows:
        raise DraftError('relasi aktif dengan nama dan arah yang sama sudah ada; edit relasi tersebut')
    edge = EntityEdge(
        source_node_uuid=source_uuid,
        target_node_uuid=target_uuid,
        name=relation,
        fact=statement,
        group_id=draft_group(kg_id),
        episodes=[],
        created_at=datetime.now(UTC),
    )
    await edge.generate_embedding(graphiti.embedder)
    await edge.save(graphiti.driver)
    return {'uuid': edge.uuid, 'fact': edge.fact, 'name': edge.name}


async def update_entity(
    graphiti: Graphiti,
    kg_id: str,
    uuid: str,
    *,
    name: str | None = None,
    summary: str | None = None,
    attributes: dict[str, Any] | None = None,
) -> dict[str, Any]:
    await _in_draft(graphiti.driver, kg_id, uuid, edge=False)
    node = await EntityNode.get_by_uuid(graphiti.driver, uuid)
    await node.load_name_embedding(graphiti.driver)
    renamed = name is not None and name.strip() and name.strip() != node.name
    if renamed:
        node.name = name.strip()
    if summary is not None:
        node.summary = summary
    for k, v in (attributes or {}).items():
        if k in INTERNAL_NODE_KEYS or k in ('name', 'summary'):
            raise DraftError(f'attribute {k!r} cannot be edited')
        node.attributes[k] = v
    if renamed or node.name_embedding is None:
        await node.generate_name_embedding(graphiti.embedder)
    await node.save(graphiti.driver)
    return {'uuid': node.uuid, 'name': node.name, 'summary': node.summary}


async def _drop_edge_refs(driver: GraphDriver, group_id: str, edge_uuids: list[str]) -> None:
    if edge_uuids:
        await _q(
            driver,
            'MATCH (e:Episodic {group_id: $g}) WHERE any(x IN e.entity_edges WHERE x IN $u) '
            'SET e.entity_edges = [x IN e.entity_edges WHERE NOT x IN $u]',
            g=group_id,
            u=edge_uuids,
        )


async def delete_edge(driver: GraphDriver, kg_id: str, uuid: str) -> None:
    await _in_draft(driver, kg_id, uuid, edge=True)
    await _q(driver, 'MATCH ()-[r:RELATES_TO {uuid: $u}]->() DELETE r', u=uuid)
    await _drop_edge_refs(driver, draft_group(kg_id), [uuid])


async def delete_entity(driver: GraphDriver, kg_id: str, uuid: str) -> int:
    """Delete a node and its facts from the draft. Returns the number of facts removed."""
    await _in_draft(driver, kg_id, uuid, edge=False)
    rows = await _q(
        driver,
        'MATCH (n:Entity {uuid: $u}) OPTIONAL MATCH (n)-[r:RELATES_TO]-() '
        'WITH n, collect(DISTINCT r.uuid) AS edges DETACH DELETE n RETURN edges',
        u=uuid,
    )
    edges = rows[0]['edges'] if rows else []
    await _drop_edge_refs(driver, draft_group(kg_id), edges)
    return len(edges)


async def merge_entities(
    graphiti: Graphiti,
    kg_id: str,
    source_uuid: str,
    target_uuid: str,
    *,
    name: str | None = None,
    summary_mode: str = 'concat',
) -> dict[str, Any]:
    """Move the source node's facts and mentions to the target, then delete the source."""
    driver = graphiti.driver
    if source_uuid == target_uuid:
        raise DraftError('source and target must differ')
    await _in_draft(driver, kg_id, source_uuid, edge=False)
    await _in_draft(driver, kg_id, target_uuid, edge=False)
    # Facts between the two would become self-loops: drop them.
    rows = await _q(
        driver,
        'MATCH (s:Entity {uuid: $s})-[r:RELATES_TO]-(t:Entity {uuid: $t}) '
        'WITH collect(r.uuid) AS u, collect(r) AS rs FOREACH (x IN rs | DELETE x) RETURN u',
        s=source_uuid,
        t=target_uuid,
    )
    dropped = rows[0]['u'] if rows else []
    moved_rows = await _q(
        driver,
        'MATCH (s:Entity {uuid: $s}), (t:Entity {uuid: $t}) '
        'CALL (s, t) { MATCH (s)-[r:RELATES_TO]->(x) CREATE (t)-[r2:RELATES_TO]->(x) SET r2 = properties(r) '
        '  SET r2.source_node_uuid = t.uuid DELETE r RETURN count(*) AS out_n } '
        'CALL (s, t) { MATCH (x)-[r:RELATES_TO]->(s) CREATE (x)-[r2:RELATES_TO]->(t) SET r2 = properties(r) '
        '  SET r2.target_node_uuid = t.uuid DELETE r RETURN count(*) AS in_n } '
        'CALL (s, t) { MATCH (e:Episodic)-[m:MENTIONS]->(s) MERGE (e)-[m2:MENTIONS]->(t) '
        '  ON CREATE SET m2 = properties(m) DELETE m RETURN count(*) AS mentions } '
        'RETURN out_n + in_n AS moved',
        s=source_uuid,
        t=target_uuid,
    )
    source = await EntityNode.get_by_uuid(driver, source_uuid)
    target = await EntityNode.get_by_uuid(driver, target_uuid)
    await target.load_name_embedding(driver)
    if summary_mode == 'concat' and source.summary and source.summary not in target.summary:
        target.summary = f'{target.summary} {source.summary}'.strip()
    renamed = bool(name and name.strip() and name.strip() != target.name)
    if renamed:
        target.name = name.strip()  # type: ignore[union-attr]
        await target.generate_name_embedding(graphiti.embedder)
    await target.save(driver)
    await _q(driver, 'MATCH (s:Entity {uuid: $s}) DETACH DELETE s', s=source_uuid)
    await _drop_edge_refs(driver, draft_group(kg_id), dropped)
    return {'uuid': target.uuid, 'name': target.name, 'moved': moved_rows[0]['moved'], 'dropped': len(dropped)}


async def update_edge(
    graphiti: Graphiti,
    kg_id: str,
    uuid: str,
    *,
    fact: str | None = None,
    name: str | None = None,
    invalidate: bool = False,
) -> dict[str, Any]:
    await _in_draft(graphiti.driver, kg_id, uuid, edge=True)
    edge = await EntityEdge.get_by_uuid(graphiti.driver, uuid)
    await edge.load_fact_embedding(graphiti.driver)
    changed = fact is not None and fact.strip() and fact.strip() != edge.fact
    if changed:
        edge.fact = fact.strip()  # type: ignore[union-attr]
        await edge.generate_embedding(graphiti.embedder)
    if name:
        edge.name = _relation_name(name)
    await edge.save(graphiti.driver)
    if invalidate:
        await _q(
            graphiti.driver,
            'MATCH ()-[r:RELATES_TO {uuid: $u}]->() SET r.invalid_at = datetime(), r.expired_at = datetime()',
            u=uuid,
        )
    return {'uuid': edge.uuid, 'fact': edge.fact, 'name': edge.name}


# ---------------------------------------------------------------- graph view (B1 / C1 / D2)


async def graph_view(
    driver: GraphDriver, kg_id: str, version: str | int | None = 'draft', limit: int = 500
) -> dict[str, Any]:
    """Nodes + facts of one version for the sigma viewer; draft nodes carry a change mark."""
    group = resolve_group(kg_id, version)
    node_rows = await _q(
        driver,
        'MATCH (n:Entity {group_id: $g}) '
        'OPTIONAL MATCH (n)-[r:RELATES_TO]-() WITH n, count(r) AS degree '
        'RETURN n.uuid AS id, n.name AS name, labels(n) AS labels, n.summary AS summary, '
        '  coalesce(n.origin_uuid, n.uuid) AS key, n {.*, name_embedding: null} AS props, degree '
        'ORDER BY degree DESC LIMIT $limit',
        g=group,
        limit=limit,
    )
    ids = [r['id'] for r in node_rows]
    edge_rows = await _q(
        driver,
        'MATCH (a:Entity {group_id: $g})-[r:RELATES_TO]->(b:Entity) WHERE a.uuid IN $ids AND b.uuid IN $ids '
        'RETURN r.uuid AS id, coalesce(r.origin_uuid, r.uuid) AS key, a.uuid AS source, b.uuid AS target, '
        '  r.name AS name, r.fact AS fact, r.valid_at AS valid_at, r.invalid_at AS invalid_at, '
        '  r.expired_at AS expired_at, coalesce(r.episodes, []) AS episodes',
        g=group,
        ids=ids,
    )
    marks: dict[str, str] = {}
    if group == draft_group(kg_id):
        review = await review_changes(driver, kg_id)
        for it in review['items']:
            if it['target'] == 'node' and it['uuid']:
                marks[it['uuid']] = 'add' if it['kind'] == 'add' else 'mod'
    episode_ids = [e for r in edge_rows for e in r['episodes'][:1]]
    quotes = await _episode_quotes(driver, episode_ids)
    nodes = [
        {
            'id': r['id'],
            'key': r['key'],
            'label': r['name'],
            'type': _type_of(r['labels']),
            'summary': r['summary'] or '',
            'degree': r['degree'],
            'mark': marks.get(r['id']),
            'props': {
                k: _plain(v)
                for k, v in r['props'].items()
                if k not in INTERNAL_NODE_KEYS and k not in ('name', 'summary') and v is not None
            },
        }
        for r in node_rows
    ]
    edges = [
        {
            'id': r['id'],
            'key': r['key'],
            'source': r['source'],
            'target': r['target'],
            'label': r['name'],
            'fact': r['fact'],
            'valid_at': _plain(r['valid_at']),
            'invalid_at': _plain(r['invalid_at']),
            'expired_at': _plain(r['expired_at']),
            'source_quote': quotes.get((r['episodes'] or [''])[0], {}).get('content', '')[:300],
        }
        for r in edge_rows
    ]
    return {'kg': kg_id, 'group_id': group, 'version': str(version or 'draft'), 'nodes': nodes, 'edges': edges}
