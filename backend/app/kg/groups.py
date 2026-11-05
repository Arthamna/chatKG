"""Graphiti group_id naming for KG versions (whole copy per version).

Graphiti only accepts ``[A-Za-z0-9_-]`` in a group_id, so the separator is a
double underscore and KG ids are limited to lowercase letters, digits and
single dashes, which keeps ``kg_<kg>__<part>`` unambiguous.
"""

from __future__ import annotations

import re

KG_ID_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')


def validate_kg_id(kg_id: str) -> str:
    if not KG_ID_RE.match(kg_id):
        raise ValueError(f'KG id {kg_id!r} must be lowercase letters/digits separated by single dashes')
    return kg_id


def version_group(kg_id: str, n: int) -> str:
    return f'kg_{validate_kg_id(kg_id)}__v{n}'


def draft_group(kg_id: str) -> str:
    return f'kg_{validate_kg_id(kg_id)}__draft'


def test_group(kg_id: str, run_id: str) -> str:
    return f'kg_{validate_kg_id(kg_id)}__test_{run_id}'
