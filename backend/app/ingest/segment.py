from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .whatsapp import KEEP_MEDIA_TOKENS, Message, ParseResult


@dataclass(frozen=True)
class Episode:
    seq: int
    name: str
    body: str
    reference_time: datetime
    start_local: datetime
    end_local: datetime
    message_count: int
    line_count: int
    source_description: str


def render_line(m: Message) -> str | None:
    """One episode line, or None when the message carries no information."""
    if m.kind == 'system':
        return None
    if m.kind == 'media':
        token = KEEP_MEDIA_TOKENS.get(m.media_type or '')
        if token is None:  # sticker, GIF, audio, contact, location
            return None
        body = token
    else:
        body = ' '.join(m.text.split())
    if m.forwarded:
        body = f'(meneruskan) {body}'
    return f'[{m.ts_local:%H:%M}] {m.sender}: {body}'


def _has_text(lines: list[str]) -> bool:
    return any(not line.endswith(tuple(KEEP_MEDIA_TOKENS.values())) for line in lines)


def segment_episodes(
    parsed: ParseResult,
    *,
    source_id: str,
    owner_name: str,
    partner: str,
    filename: str,
    gap_hours: float = 6,
    max_messages: int = 50,
) -> list[Episode]:
    groups: list[list[Message]] = []
    current: list[Message] = []
    gap = timedelta(hours=gap_hours)
    for m in parsed.messages:
        if current and (m.ts_local - current[-1].ts_local > gap or len(current) >= max_messages):
            groups.append(current)
            current = []
        current.append(m)
    if current:
        groups.append(current)

    episodes: list[Episode] = []
    for group in groups:
        lines = [x for x in (render_line(m) for m in group) if x]
        if not lines or not _has_text(lines):
            continue  # only stickers / images: nothing for the LLM
        seq = len(episodes) + 1
        start, end = group[0].ts_local, group[-1].ts_local
        tzname = start.tzname() or parsed.tz
        episodes.append(
            Episode(
                seq=seq,
                name=f'wa:{source_id}:{seq}',
                body='\n'.join(lines),
                reference_time=start.astimezone(UTC),
                start_local=start,
                end_local=end,
                message_count=len(group),
                line_count=len(lines),
                source_description=(
                    f'WhatsApp pribadi {owner_name}–{partner} · {filename} · {start:%d %b %Y} {tzname}'
                ),
            )
        )
    return episodes
