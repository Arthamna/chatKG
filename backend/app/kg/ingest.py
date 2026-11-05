"""Run episodes through Graphiti into one group_id, resumably (design §4.4)."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from graphiti_core import Graphiti
from graphiti_core.nodes import EpisodeType

from app.ingest.segment import Episode

from .ontology import EDGE_TYPE_MAP, EDGE_TYPES, ENTITY_TYPES

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, dict], None]


@dataclass
class IngestReport:
    group_id: str
    done: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    nodes: int = 0
    edges: int = 0
    seconds: float = 0.0


async def existing_episodes(graphiti: Graphiti, group_id: str) -> dict[str, str]:
    """name -> uuid of episodes already stored in ``group_id``."""
    records, _, _ = await graphiti.driver.execute_query(
        'MATCH (e:Episodic {group_id: $gid}) RETURN e.name AS name, e.uuid AS uuid',
        gid=group_id,
    )
    return {r['name']: r['uuid'] for r in records}


async def ingest_episodes(
    graphiti: Graphiti,
    episodes: list[Episode],
    *,
    group_id: str,
    instructions: str,
    progress: ProgressCallback | None = None,
) -> IngestReport:
    """Episodes go in sequentially and in time order, because fact invalidation
    depends on order. Already-stored episode names are skipped, so a crashed or
    quota-paused job can simply be rerun."""
    report = IngestReport(group_id=group_id)
    started = time.monotonic()
    known = await existing_episodes(graphiti, group_id)
    previous: list[str] = []

    for i, ep in enumerate(sorted(episodes, key=lambda e: e.reference_time), 1):
        if ep.name in known:
            report.skipped.append(ep.name)
            previous = [known[ep.name]]
            continue
        if progress:
            progress('episode_start', {'i': i, 'total': len(episodes), 'name': ep.name})
        t0 = time.monotonic()
        result = await graphiti.add_episode(
            name=ep.name,
            episode_body=ep.body,
            source_description=ep.source_description,
            reference_time=ep.reference_time,
            source=EpisodeType.message,
            group_id=group_id,
            entity_types=ENTITY_TYPES,
            edge_types=EDGE_TYPES,
            edge_type_map=EDGE_TYPE_MAP,
            previous_episode_uuids=previous or None,
            custom_extraction_instructions=instructions,
        )
        previous = [result.episode.uuid]
        report.done.append(ep.name)
        report.nodes += len(result.nodes)
        report.edges += len(result.edges)
        if progress:
            progress(
                'episode_done',
                {
                    'i': i,
                    'total': len(episodes),
                    'name': ep.name,
                    'seconds': round(time.monotonic() - t0, 1),
                    'nodes': [
                        f'{n.name} ({", ".join(x for x in n.labels if x != "Entity") or "Entity"})'
                        for n in result.nodes
                    ],
                    'edges': [f'{e.name}: {e.fact}' for e in result.edges],
                },
            )
    report.seconds = round(time.monotonic() - started, 1)
    return report
