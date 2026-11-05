"""Parse + segment one uploaded chat export with its mapping (shared by CLI and API)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from .segment import Episode, segment_episodes
from .whatsapp import DateOrder, ParseResult, looks_like_whatsapp_ios, parse_whatsapp


@dataclass
class PreparedSource:
    source_id: str
    parsed: ParseResult
    episodes: list[Episode]
    partner: str


def source_id_for(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def prepare_source(
    text: str,
    *,
    filename: str,
    owner: str,
    aliases: dict[str, str] | None = None,
    tz: str = 'Asia/Jakarta',
    date_order: DateOrder | None = None,
    partner: str | None = None,
    gap_hours: float = 6,
    max_messages: int = 50,
) -> PreparedSource:
    if not looks_like_whatsapp_ios(text):
        raise ValueError('File tidak dikenali sebagai export WhatsApp (format iOS "[tanggal, jam] Nama: pesan").')
    parsed = parse_whatsapp(text, owner_name=owner, aliases=aliases or {}, tz=tz, date_order=date_order)
    if not parsed.messages:
        raise ValueError('Tidak ada pesan yang terbaca di file ini.')
    sid = source_id_for(text)
    others = [p for p in parsed.participants if p != owner]
    label = partner or (', '.join(others) if others else '?')
    episodes = segment_episodes(
        parsed,
        source_id=sid,
        owner_name=owner,
        partner=label,
        filename=filename,
        gap_hours=gap_hours,
        max_messages=max_messages,
    )
    return PreparedSource(source_id=sid, parsed=parsed, episodes=episodes, partner=label)


def parse_aliases(values: list[str] | str | None) -> dict[str, str]:
    """'Raw Name=Canonical' entries (list or newline separated)."""
    if not values:
        return {}
    items = values.splitlines() if isinstance(values, str) else values
    out: dict[str, str] = {}
    for v in items:
        if not v.strip():
            continue
        raw, _, canon = v.partition('=')
        if not canon.strip():
            raise ValueError(f'alias harus berformat "Nama Asli=Nama Kanonik", bukan {v!r}')
        out[raw.strip()] = canon.strip()
    return out
