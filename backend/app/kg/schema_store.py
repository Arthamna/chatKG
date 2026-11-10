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


def _validate_review(ontology: Ontology, baseline: Ontology) -> None:
    """Baseline definitions may be excluded from one extraction, but never reinterpreted."""
    current = {t.name: t for t in ontology.entity_types}
    for old in baseline.entity_types:
        new = current.get(old.name)
        if not new:
            continue
        attrs = {a.name: a.type for a in new.attributes}
        if any(a.name in attrs and attrs[a.name] != a.type for a in old.attributes):
            raise ValueError(f'Tipe atribut lama pada {old.name} tidak boleh diubah')


def merge_active_ontology(ontology: Ontology, baseline: Ontology) -> Ontology:
    """Keep excluded baseline definitions active while adding reviewed new definitions."""
    merged = baseline.model_copy(deep=True)
    entities = {t.name: t for t in merged.entity_types}
    for entity in ontology.entity_types:
        old = entities.get(entity.name)
        if not old:
            entities[entity.name] = entity
            continue
        attributes = {a.name: a for a in old.attributes}
        attributes.update({a.name: a for a in entity.attributes})
        entities[entity.name] = entity.model_copy(update={'attributes': list(attributes.values())}, deep=True)
    edges = {t.name: t for t in merged.edge_types}
    edges.update({t.name: t for t in ontology.edge_types})
    maps = {(m.source, m.target): m.model_copy(deep=True) for m in merged.edge_type_map}
    for mapping in ontology.edge_type_map:
        key = (mapping.source, mapping.target)
        if key not in maps:
            maps[key] = mapping.model_copy(deep=True)
            continue
        maps[key].relations = list(dict.fromkeys([*maps[key].relations, *mapping.relations]))
    return Ontology(
        entity_types=list(entities.values()),
        edge_types=list(edges.values()),
        edge_type_map=list(maps.values()),
        glossary={**baseline.glossary, **ontology.glossary},
    )


async def save_proposal(
    driver,
    source: dict,
    ontology: Ontology,
    baseline: Ontology,
    *,
    job_id: str,
    sampled: int,
    model: str,
):
    ontology.extend(baseline)
    data = {
        'revision': uuid.uuid4().hex,
        'base_revision': baseline.revision,
        'ontology': ontology.model_dump(),
        'baseline': baseline.model_dump(),
        'source_key': source_key(source),
        'sampled_episodes': sampled,
        'model': model,
        'extraction_instructions': '',
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


async def edit_proposal(
    driver,
    source: dict,
    revision: str,
    ontology: Ontology,
    *,
    extraction_instructions: str = '',
) -> dict:
    current = proposal(source)
    if not current or current['revision'] != revision:
        raise SchemaConflict('Revisi skema sudah berubah; muat ulang halaman')
    baseline = await active_schema(driver, source['kg_id'])
    if baseline.revision != current['base_revision']:
        raise SchemaConflict('Skema KG telah berubah; petakan ulang dengan skema terbaru')
    if not ontology.entity_types:
        raise ValueError('Minimal satu tipe entitas diperlukan')
    _validate_review(ontology, baseline)
    updated = {
        **current,
        'ontology': ontology.model_dump(),
        'extraction_instructions': extraction_instructions.strip(),
        'revision': uuid.uuid4().hex,
    }
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
    ontology = Ontology.model_validate(data['ontology'])
    if baseline.revision not in (data['base_revision'], ontology.revision):
        raise SchemaConflict('Skema KG telah berubah; petakan ulang sebelum ekstraksi')
    _validate_review(ontology, baseline)
    return {**data, 'active_ontology': merge_active_ontology(ontology, baseline).model_dump()}
