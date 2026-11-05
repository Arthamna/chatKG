import pytest
from graphiti_core.helpers import validate_group_id

from app.kg.groups import draft_group, version_group
from app.kg.groups import test_group as scratch_group


def test_group_ids_pass_graphiti_validation():
    for gid in (version_group('project-alpha', 12), draft_group('demo'), scratch_group('demo', 'ab12')):
        assert validate_group_id(gid)
    assert version_group('demo', 3) == 'kg_demo__v3'
    assert draft_group('demo') == 'kg_demo__draft'


@pytest.mark.parametrize('bad', ['Demo', 'a__b', 'a_b', 'a:b', '-a', 'a-', ''])
def test_rejects_ambiguous_kg_ids(bad):
    with pytest.raises(ValueError):
        draft_group(bad)
