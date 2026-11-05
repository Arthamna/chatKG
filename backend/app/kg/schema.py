"""Validated, serializable ontologies shared by discovery, review and Graphiti."""

from __future__ import annotations

import hashlib
import json
import keyword
from datetime import datetime
from typing import Literal

from graphiti_core.nodes import EntityNode
from pydantic import BaseModel, ConfigDict, Field, create_model, model_validator

from . import versions as V


class Definition(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Attribute(Definition):
    name: str = Field(pattern=r'^[a-z][a-z0-9_]*$', max_length=64)
    type: Literal['string', 'integer', 'number', 'boolean', 'datetime']
    description: str = Field(min_length=1, max_length=500)

    @model_validator(mode='after')
    def safe_name(self):
        if keyword.iskeyword(self.name) or self.name in EntityNode.model_fields or hasattr(BaseModel, self.name):
            raise ValueError(f'Atribut {self.name!r} digunakan oleh Python/Pydantic/Graphiti')
        return self


class EntityType(Definition):
    name: str = Field(pattern=r'^[A-Z][a-zA-Z0-9]*$', max_length=64)
    description: str = Field(min_length=1, max_length=500)
    attributes: list[Attribute] = Field(default_factory=list, max_length=20)

    @model_validator(mode='after')
    def unique_attributes(self):
        if self.name in {'Entity', 'Episodic', 'Community'}:
            raise ValueError('Nama tipe ini digunakan oleh Graphiti')
        if len({a.name for a in self.attributes}) != len(self.attributes):
            raise ValueError('Nama atribut harus unik dalam satu tipe')
        return self


class EdgeType(Definition):
    name: str = Field(pattern=r'^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$', max_length=64)
    description: str = Field(min_length=1, max_length=500)


class TypeMap(Definition):
    source: str
    target: str
    relations: list[str] = Field(min_length=1)


class Ontology(Definition):
    entity_types: list[EntityType] = Field(default_factory=list, max_length=40)
    edge_types: list[EdgeType] = Field(default_factory=list, max_length=80)
    edge_type_map: list[TypeMap] = Field(default_factory=list, max_length=160)
    glossary: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode='after')
    def valid_references(self):
        entities = {t.name for t in self.entity_types}
        edges = {t.name for t in self.edge_types}
        if len(entities) != len(self.entity_types) or len(edges) != len(self.edge_types):
            raise ValueError('Nama tipe harus unik')
        pairs = set()
        mapped = set()
        for m in self.edge_type_map:
            if m.source not in entities or m.target not in entities or not set(m.relations) <= edges:
                raise ValueError('Pemetaan relasi merujuk tipe yang belum didefinisikan')
            if (m.source, m.target) in pairs or len(set(m.relations)) != len(m.relations):
                raise ValueError('Pasangan tipe dan relasi harus unik')
            pairs.add((m.source, m.target))
            mapped.update(m.relations)
        if edges != mapped:
            raise ValueError('Setiap tipe relasi harus mempunyai pasangan sumber dan target')
        return self

    @property
    def revision(self) -> str:
        content = json.dumps(self.model_dump(), sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def extend(self, baseline: Ontology) -> None:
        """Review may extend an existing ontology, never reinterpret its identifiers."""
        current = {t.name: t for t in self.entity_types}
        for old in baseline.entity_types:
            if old.name not in current:
                raise ValueError(f'Tipe lama {old.name} tidak boleh dihapus atau diganti namanya')
            attrs = {a.name: a.type for a in current[old.name].attributes}
            if any(attrs.get(a.name) != a.type for a in old.attributes):
                raise ValueError(f'Atribut lama pada {old.name} tidak boleh dihapus atau diubah tipenya')
        if not {e.name for e in baseline.edge_types} <= {e.name for e in self.edge_types}:
            raise ValueError('Tipe relasi lama tidak boleh dihapus atau diganti namanya')
        mappings = {(m.source, m.target): set(m.relations) for m in self.edge_type_map}
        if any(not set(m.relations) <= mappings.get((m.source, m.target), set()) for m in baseline.edge_type_map):
            raise ValueError('Pasangan relasi lama tidak boleh dihapus')

    def graphiti_types(self):
        types = {'string': str, 'integer': int, 'number': float, 'boolean': bool, 'datetime': datetime}
        entities = {
            t.name: create_model(
                t.name,
                __doc__=t.description,
                **{a.name: (types[a.type] | None, Field(None, description=a.description)) for a in t.attributes},
            )
            for t in self.entity_types
        }
        edges = {t.name: create_model(t.name, __doc__=t.description) for t in self.edge_types}
        return entities, edges, {(m.source, m.target): m.relations for m in self.edge_type_map}


async def active_schema(driver, kg_id: str) -> Ontology:
    rows = await V._q(
        driver,
        'MATCH (k:KnowledgeGraph {id: $kg}) RETURN coalesce(k.draft_ontology, k.ontology) AS ontology',
        kg=kg_id,
    )
    if rows and rows[0]['ontology']:
        return Ontology.model_validate_json(rows[0]['ontology'])
    # Legacy graphs: use only types actually present, not the whole college template.
    kg = await V.require_kg(driver, kg_id)
    group = V.resolve_group(kg_id, 'draft' if kg.has_draft or not kg.latest else kg.latest)
    nodes = await V._q(
        driver,
        'MATCH (n:Entity {group_id: $g}) UNWIND labels(n) AS label '
        'WITH DISTINCT label WHERE NOT label IN ["Entity", "Episodic", "Community"] RETURN label ORDER BY label',
        g=group,
    )
    edges = await V._q(
        driver,
        'MATCH (a:Entity {group_id: $g})-[r:RELATES_TO]->(b:Entity {group_id: $g}) '
        'RETURN DISTINCT [l IN labels(a) WHERE l <> "Entity"][0] AS source, '
        '[l IN labels(b) WHERE l <> "Entity"][0] AS target, r.name AS relation',
        g=group,
    )
    from .ontology import ENTITY_TYPES

    entities = []
    for row in nodes:
        name = row['label']
        model = ENTITY_TYPES.get(name)
        attributes = []
        if model:
            for key, f in model.model_fields.items():
                annotation = str(f.annotation)
                kind = 'datetime' if 'datetime' in annotation else 'boolean' if 'bool' in annotation else 'string'
                attributes.append(Attribute(name=key, type=kind, description=f.description or key))
        entities.append(
            EntityType(name=name, description=(model.__doc__ or name) if model else name, attributes=attributes)
        )
    pairs: dict[tuple[str, str], set[str]] = {}
    for row in edges:
        if row['source'] and row['target'] and row['relation']:
            pairs.setdefault((row['source'], row['target']), set()).add(row['relation'])
    return Ontology(
        entity_types=entities,
        edge_types=[EdgeType(name=n, description=n) for n in sorted({n for names in pairs.values() for n in names})],
        edge_type_map=[TypeMap(source=s, target=t, relations=sorted(names)) for (s, t), names in sorted(pairs.items())],
    )
