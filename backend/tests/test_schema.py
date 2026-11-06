import copy
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.ai.discovery import discover_schema, sample_episodes
from app.kg.ingest import ingest_episodes
from app.kg.schema import Ontology
from app.kg.schema_store import merge_active_ontology, proposal, source_key


def example_schema(domain='commerce'):
    item = 'Product' if domain == 'commerce' else 'Appointment'
    return {
        'entity_types': [
            {'name': 'Person', 'description': 'Orang', 'attributes': []},
            {
                'name': item,
                'description': 'Informasi dalam percakapan',
                'attributes': [
                    {'name': 'scheduled_at', 'type': 'datetime', 'description': 'Waktu jika disebutkan'},
                ],
            },
        ],
        'edge_types': [{'name': 'DISCUSSES', 'description': 'Membahas'}],
        'edge_type_map': [{'source': 'Person', 'target': item, 'relations': ['DISCUSSES']}],
        'glossary': {},
    }


@pytest.mark.parametrize('domain', ['commerce', 'appointments'])
def test_dynamic_models_do_not_force_college_types(domain):
    ontology = Ontology.model_validate(example_schema(domain))
    entities, edges, pairs = ontology.graphiti_types()
    assert set(entities) == {'Person', 'Product' if domain == 'commerce' else 'Appointment'}
    assert set(edges) == {'DISCUSSES'}
    assert pairs[('Person', ontology.entity_types[1].name)] == ['DISCUSSES']
    model = entities[ontology.entity_types[1].name]
    assert model().scheduled_at is None
    assert isinstance(model(scheduled_at='2026-11-05T12:00:00+07:00').scheduled_at, datetime)


@pytest.mark.parametrize('attribute', ['uuid', 'summary', 'name', 'model_dump', 'class', '__dict__'])
def test_reserved_attributes_are_rejected(attribute):
    data = example_schema()
    data['entity_types'][1]['attributes'][0]['name'] = attribute
    with pytest.raises(ValidationError):
        Ontology.model_validate(data)


def test_invalid_references_duplicates_and_unsafe_types():
    for mutate in (
        lambda d: d['edge_type_map'][0].update(target='Missing'),
        lambda d: d['entity_types'].append(d['entity_types'][0]),
        lambda d: d['entity_types'][1]['attributes'][0].update(type='object'),
        lambda d: d.update(edge_type_map=[]),
    ):
        data = example_schema()
        mutate(data)
        with pytest.raises(ValidationError):
            Ontology.model_validate(data)


def test_extension_preserves_old_types_attributes_and_mappings():
    original = Ontology.model_validate(example_schema())
    extended = copy.deepcopy(example_schema())
    extended['entity_types'].append({'name': 'Store', 'description': 'Toko', 'attributes': []})
    Ontology.model_validate(extended).extend(original)
    for data in (example_schema('appointments'), example_schema()):
        data['entity_types'][1]['attributes'] = []
        with pytest.raises(ValueError):
            Ontology.model_validate(data).extend(original)


def test_excluded_baseline_type_stays_active_but_not_in_extraction_schema():
    baseline = Ontology.model_validate(example_schema())
    selected = Ontology(
        entity_types=[baseline.entity_types[0]],
        edge_types=[],
        edge_type_map=[],
        glossary={},
    )

    active = merge_active_ontology(selected, baseline)

    assert {item.name for item in selected.entity_types} == {'Person'}
    assert {item.name for item in active.entity_types} == {'Person', 'Product'}
    assert {item.name for item in active.edge_types} == {'DISCUSSES'}


def test_excluded_baseline_attribute_stays_active_but_not_in_extraction_schema():
    baseline = Ontology.model_validate(example_schema())
    selected_data = example_schema()
    selected_data['entity_types'][1]['attributes'] = []
    selected = Ontology.model_validate(selected_data)

    active = merge_active_ontology(selected, baseline)

    selected_product = next(item for item in selected.entity_types if item.name == 'Product')
    active_product = next(item for item in active.entity_types if item.name == 'Product')
    assert selected_product.attributes == []
    assert [attribute.name for attribute in active_product.attributes] == ['scheduled_at']


def test_sampling_is_bounded_and_covers_beginning_middle_end():
    episodes = [
        SimpleNamespace(name=str(i), start_local=datetime(2026, 11, 5), body='short\n' * 500) for i in range(40)
    ]
    sampled = sample_episodes(episodes)
    assert len(sampled) == 8
    assert sampled[0]['episode'] == '0' and sampled[-1]['episode'] == '39'
    assert all(len(s['body']) <= 1500 and s['body'].splitlines()[-1] == 'short' for s in sampled)
    assert sample_episodes([]) == []
    assert len(sample_episodes(episodes[:1])) == 1


async def test_discovery_semantic_repair_and_grounded_input():
    baseline = Ontology.model_validate(example_schema())
    llm = SimpleNamespace(
        generate_response=AsyncMock(side_effect=[example_schema('appointments'), baseline.model_dump()])
    )
    prepared = SimpleNamespace(
        parsed=SimpleNamespace(participants=['Ana', 'Budi'], tz='Asia/Jakarta'),
        episodes=[SimpleNamespace(name='ep', start_local=datetime(2026, 11, 5), body='Ana: Produk ini tersedia?')],
    )
    result, count = await discover_schema(llm, prepared, baseline)
    assert result == baseline and count == 1 and llm.generate_response.await_count == 2
    messages = llm.generate_response.call_args.args[0]
    assert 'existing_schema' in messages[1].content and 'Produk ini tersedia?' in messages[1].content


async def test_ingest_passes_reviewed_schema_and_resumes_completed_episodes():
    schema = Ontology.model_validate(example_schema())
    graphiti = SimpleNamespace(
        driver=SimpleNamespace(execute_query=AsyncMock(return_value=([{'name': 'old', 'uuid': 'old-id'}], None, None))),
        add_episode=AsyncMock(return_value=SimpleNamespace(episode=SimpleNamespace(uuid='new-id'), nodes=[], edges=[])),
    )
    episodes = [
        SimpleNamespace(name=name, reference_time=datetime(2026, 11, 5), body='message', source_description='test')
        for name in ('old', 'new')
    ]
    report = await ingest_episodes(graphiti, episodes, group_id='kg_test__draft', instructions='test', ontology=schema)
    assert report.skipped == ['old'] and report.done == ['new']
    kwargs = graphiti.add_episode.call_args.kwargs
    assert set(kwargs['entity_types']) == {'Person', 'Product'}
    assert kwargs['edge_type_map'] == {('Person', 'Product'): ['DISCUSSES']}
    assert kwargs['previous_episode_uuids'] == ['old-id']


def test_changed_participant_mapping_invalidates_proposal():
    import json

    src = {'id': 's', 'owner': 'A', 'aliases': '{}', 'tz': 'Asia/Jakarta', 'date_order': None}
    src['schema_json'] = json.dumps({'source_key': source_key(src), 'ontology': example_schema()})
    assert proposal(src)
    assert proposal({**src, 'owner': 'Different'}) is None
