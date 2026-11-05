"""Source proposals and immutable job snapshots, stored as JSON Neo4j properties."""

from __future__ import annotations

import hashlib
import json
import uuid

from . import versions as V
from .schema import Ontology, active_schema


class SchemaConflict(ValueError):
    pass


def source_key(source: dict) -> str:
    fields = {k: source.get(k) for k in ('id', 'owner', 'aliases', 'tz', 'date_order')}
    return hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()[:16]


def proposal(source: dict) -> dict | None:
    if not source.get('schema_json'):
        return None
    data = json.loads(source['schema_json'])
    return data if data['source_key'] == source_key(source) else None


async def save_proposal(driver, source: dict, ontology: Ontology, baseline: Ontology, *, job_id: str, sampled: int):
    ontology.extend(baseline)
    data = {
        'revision': uuid.uuid4().hex,
        'base_revision': baseline.revision,
        'ontology': ontology.model_dump(),
        'baseline': baseline.model_dump(),
        'source_key': source_key(source),
        'sampled_episodes': sampled,
    }
    rows = await V._q(
        driver,
        'MATCH (s:Source {id: $sid, kg_id: $kg}) WHERE s.schema_job_id = $job '
        'SET s.schema_json = $schema RETURN s.id AS id',
        sid=source['id'],
        kg=source['kg_id'],
        job=job_id,
        schema=json.dumps(data),
    )
    if not rows:
        raise SchemaConflict('Source berubah saat pemetaan; unggah atau petakan ulang')
    return data


async def edit_proposal(driver, source: dict, revision: str, ontology: Ontology) -> dict:
    current = proposal(source)
    if not current or current['revision'] != revision:
        raise SchemaConflict('Revisi skema sudah berubah; muat ulang halaman')
    baseline = await active_schema(driver, source['kg_id'])
    if baseline.revision != current['base_revision']:
        raise SchemaConflict('Skema KG telah berubah; petakan ulang dengan skema terbaru')
    if not ontology.entity_types:
        raise ValueError('Minimal satu tipe entitas diperlukan')
    ontology.extend(baseline)
    updated = {**current, 'ontology': ontology.model_dump(), 'revision': uuid.uuid4().hex}
    rows = await V._q(
        driver,
        'MATCH (s:Source {id: $sid, kg_id: $kg}) WHERE s.schema_json = $previous '
        'SET s.schema_json = $schema RETURN s.id AS id',
        sid=source['id'],
        kg=source['kg_id'],
        previous=source['schema_json'],
        schema=json.dumps(updated),
    )
    if not rows:
        raise SchemaConflict('Revisi skema sudah berubah; muat ulang halaman')
    return updated


async def approved_snapshot(driver, source: dict, revision: str) -> dict:
    data = proposal(source)
    if not data or data['revision'] != revision:
        raise SchemaConflict('Setujui skema terbaru sebelum ekstraksi')
    baseline = await active_schema(driver, source['kg_id'])
    if baseline.revision not in (data['base_revision'], Ontology.model_validate(data['ontology']).revision):
        raise SchemaConflict('Skema KG telah berubah; petakan ulang sebelum ekstraksi')
    Ontology.model_validate(data['ontology']).extend(baseline)
    return data
