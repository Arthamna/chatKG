"""WhatsApp chat export parser (iOS format, Indonesian locale).

Rules follow design/backend-pipeline.md §4.2:
- invisible chars (U+200E, U+202F, U+00A0) are normalised before matching,
- lines without a ``[date, time]`` prefix continue the previous message,
- the encryption notice before the first message is dropped,
- ``Anda`` is the account owner and is renamed to ``owner_name``,
- date order (M/D vs D/M) is detected from the data when not given.
"""

from __future__ import annotations

import itertools
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo

DateOrder = Literal['MDY', 'DMY']
Kind = Literal['text', 'media', 'system']

OWNER_TOKENS = {'Anda', 'You'}

LINE_RE = re.compile(
    r'^\[(\d{1,2})/(\d{1,2})/(\d{2,4}), (\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AP]M)?\] ([^:]+?): (.*)$',
    re.IGNORECASE,
)
MEDIA_RE = re.compile(
    r'^<(stiker|gambar|video|audio|dokumen|gif|kontak|lokasi|foto)\b[^>]*tidak disertakan>$',
    re.IGNORECASE,
)
SYSTEM_PREFIXES = (
    'Menunggu pesan ini.',
    'Pesan ini dihapus',
    'Anda menghapus pesan ini',
    'Panggilan suara tak terjawab',
    'Panggilan video tak terjawab',
)
FORWARDED_PREFIX = '[Diteruskan] '
EDITED_SUFFIX = '<Pesan ini diedit>'

# Media kinds that carry context worth keeping as a token in the episode text.
KEEP_MEDIA_TOKENS = {'gambar': '[gambar]', 'foto': '[gambar]', 'dokumen': '[dokumen]', 'video': '[video]'}


@dataclass(frozen=True)
class Message:
    line_no: int
    ts_local: datetime
    sender_raw: str
    sender: str
    text: str
    kind: Kind
    media_type: str | None = None
    forwarded: bool = False
    edited: bool = False

    @property
    def ts_utc(self) -> datetime:
        return self.ts_local.astimezone(UTC)


@dataclass
class ParseResult:
    messages: list[Message]
    date_order: DateOrder
    tz: str
    skipped_preamble: list[str] = field(default_factory=list)

    @property
    def counts(self) -> dict[str, int]:
        out = {'total': len(self.messages), 'text': 0, 'media': 0, 'system': 0}
        for m in self.messages:
            out[m.kind] += 1
        return out

    @property
    def participants(self) -> list[str]:
        seen: dict[str, None] = {}
        for m in self.messages:
            seen.setdefault(m.sender, None)
        return list(seen)


def clean_line(s: str) -> str:
    for ch in ('\u200e', '\u200f', '\ufeff'):  # LRM, RLM, BOM
        s = s.replace(ch, '')
    s = s.replace('\u202f', ' ').replace('\xa0', ' ')  # narrow / no-break space
    return unicodedata.normalize('NFC', s).rstrip()


def _raw_rows(text: str) -> tuple[list[list], list[str]]:
    """Split into message rows: [line_no, d1, d2, y, h, mi, s, ampm, sender, body]."""
    rows: list[list] = []
    preamble: list[str] = []
    for no, line in enumerate(text.splitlines(), 1):
        line = clean_line(line)
        m = LINE_RE.match(line)
        if m:
            rows.append([no, *m.groups()])
        elif rows:
            if line:
                rows[-1][-1] += '\n' + line
        elif line:
            preamble.append(line)
    return rows, preamble


def detect_date_order(pairs: list[tuple[int, int]]) -> DateOrder:
    """Pick M/D or D/M. Unambiguous values win; otherwise the order whose
    consecutive messages are closest in time (chat logs move forward in small steps)."""
    if any(a > 12 for a, _ in pairs):
        return 'DMY'
    if any(b > 12 for _, b in pairs):
        return 'MDY'

    def total_step(order: DateOrder) -> int:
        dates = [datetime(2000, a, b) if order == 'MDY' else datetime(2000, b, a) for a, b in pairs]
        return sum(abs((y - x).days) for x, y in itertools.pairwise(dates))

    return 'MDY' if total_step('MDY') <= total_step('DMY') else 'DMY'


def parse_whatsapp(
    text: str,
    *,
    owner_name: str,
    aliases: dict[str, str] | None = None,
    tz: str = 'Asia/Jakarta',
    date_order: DateOrder | None = None,
) -> ParseResult:
    aliases = aliases or {}
    rows, preamble = _raw_rows(text)
    order = date_order or detect_date_order([(int(r[1]), int(r[2])) for r in rows])
    zone = ZoneInfo(tz)

    messages: list[Message] = []
    for no, a, b, y, h, mi, s, ampm, sender_raw, body in rows:
        month, day = (int(a), int(b)) if order == 'MDY' else (int(b), int(a))
        year = int(y) + (2000 if len(y) == 2 else 0)
        hour = int(h)
        if ampm:
            hour = hour % 12 + (12 if ampm.upper() == 'PM' else 0)
        ts = datetime(year, month, day, hour, int(mi), int(s or 0), tzinfo=zone)

        sender_raw = sender_raw.strip()
        sender = owner_name if sender_raw in OWNER_TOKENS else aliases.get(sender_raw, sender_raw)

        forwarded = body.startswith(FORWARDED_PREFIX)
        if forwarded:
            body = body[len(FORWARDED_PREFIX) :]
        edited = body.endswith(EDITED_SUFFIX)
        if edited:
            body = body[: -len(EDITED_SUFFIX)].rstrip()

        kind: Kind = 'text'
        media_type = None
        media = MEDIA_RE.match(body)
        if media:
            kind, media_type = 'media', media.group(1).lower()
        elif body.startswith(SYSTEM_PREFIXES):
            kind = 'system'

        messages.append(
            Message(
                line_no=no,
                ts_local=ts,
                sender_raw=sender_raw,
                sender=sender,
                text=body,
                kind=kind,
                media_type=media_type,
                forwarded=forwarded,
                edited=edited,
            )
        )

    return ParseResult(messages=messages, date_order=order, tz=tz, skipped_preamble=preamble)


def looks_like_whatsapp_ios(text: str, sample: int = 50, threshold: float = 0.8) -> bool:
    lines = [clean_line(x) for x in text.splitlines() if x.strip()][:sample]
    if not lines:
        return False
    # The preamble line and multi-line continuations are tolerated below the threshold.
    return sum(bool(LINE_RE.match(x)) for x in lines) / len(lines) >= threshold
