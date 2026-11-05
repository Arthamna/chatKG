from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.ingest import detect_date_order, looks_like_whatsapp_ios, parse_whatsapp, segment_episodes

FIXTURE = Path(__file__).parent / 'fixtures' / 'wa_ios_sample.txt'
ALIASES = {'Leon TC 24': 'Leon'}


@pytest.fixture
def sample_text() -> str:
    return FIXTURE.read_text(encoding='utf-8')


@pytest.fixture
def parsed(sample_text):
    return parse_whatsapp(sample_text, owner_name='Pemilik', aliases=ALIASES)


def test_sample_counts_and_order(parsed):
    assert parsed.date_order == 'MDY'
    assert parsed.counts == {'total': 17, 'text': 10, 'media': 6, 'system': 1}
    assert parsed.participants == ['Pemilik', 'Leon']
    assert parsed.skipped_preamble and parsed.skipped_preamble[0].startswith('Pesan dan telepon')


def test_sample_message_details(parsed):
    first = parsed.messages[0]
    assert first.sender_raw == 'Anda' and first.sender == 'Pemilik'
    assert first.ts_local.isoformat() == '2026-11-02T00:07:41+07:00'
    assert first.ts_utc == datetime(2026, 11, 1, 17, 7, 41, tzinfo=UTC)

    fwd = parsed.messages[2]
    assert fwd.forwarded and fwd.text == 'Ingatim buat tugas ml besok sama tf'
    assert parsed.messages[3].kind == 'system'
    assert parsed.messages[5].kind == 'media' and parsed.messages[5].media_type == 'stiker'
    # 12:xx PM stays noon, 12:xx AM becomes 00:xx
    assert parsed.messages[13].ts_local.hour == 12


def test_sample_episodes_match_design_table(parsed):
    eps = segment_episodes(parsed, source_id='src1', owner_name='Pemilik', partner='Leon', filename='chat.txt')
    assert [e.reference_time.strftime('%Y-%m-%dT%H:%M:%SZ') for e in eps] == [
        '2026-11-01T17:07:41Z',
        '2026-11-02T01:57:49Z',
        '2026-11-03T12:06:29Z',
        '2026-11-04T05:33:45Z',
    ]
    assert [e.body.splitlines() for e in eps] == [
        ['[00:07] Pemilik: Ingatim buat tugas ml besok sama tf', '[00:07] Pemilik: Besok ya'],
        [
            '[08:57] Leon: (meneruskan) Ingatim buat tugas ml besok sama tf',
            '[12:00] Pemilik: Ingatin lagi tugas ml nya besok',
        ],
        [
            '[19:06] Leon: tugas ml',
            '[22:25] Pemilik: jangkrik kok isa dapat stiker ini',
            '[22:34] Leon: abid nyebar',
        ],
        [
            '[12:33] Pemilik: Info kode',
            '[12:33] Pemilik: Pbkk',
            '[12:34] Leon: belum',
            '[12:49] Leon: [gambar]',
        ],
    ]
    assert eps[0].name == 'wa:src1:1'
    assert eps[0].source_description == 'WhatsApp pribadi Pemilik–Leon · chat.txt · 02 Nov 2026 WIB'
    assert all(e.reference_time.tzinfo is not None for e in eps)


def test_detects_format(sample_text):
    assert looks_like_whatsapp_ios(sample_text)
    assert not looks_like_whatsapp_ios('hello\nworld\n')


def test_date_order_rules():
    assert detect_date_order([(25, 12), (26, 12)]) == 'DMY'
    assert detect_date_order([(12, 25), (12, 26)]) == 'MDY'
    # 2/11 -> 3/11: D/M steps one day, M/D steps one month
    assert detect_date_order([(2, 11), (3, 11), (4, 11)]) == 'DMY'


def test_invisible_chars_multiline_and_edited():
    text = (
        '‎[25/12/25, 9:05:00 PM] Budi: baris satu\n'
        'baris dua\n'
        '[25/12/25, 9:06:00 PM] Anda: oke <Pesan ini diedit>\n'
        '‎[25/12/25, 9:07:00 PM] Budi: <gambar tidak disertakan>\n'
    )
    p = parse_whatsapp(text, owner_name='Saya')
    assert p.date_order == 'DMY'
    assert p.messages[0].text == 'baris satu\nbaris dua'
    assert p.messages[0].ts_local.hour == 21
    assert p.messages[1].edited and p.messages[1].text == 'oke' and p.messages[1].sender == 'Saya'
    assert p.messages[2].media_type == 'gambar'


def test_media_only_session_is_dropped():
    text = (
        '[1/5/26, 10:00:00 AM] Budi: <stiker tidak disertakan>\n'
        '[1/5/26, 10:01:00 AM] Budi: <gambar tidak disertakan>\n'
        '[1/6/26, 10:00:00 AM] Budi: halo\n'
    )
    p = parse_whatsapp(text, owner_name='Saya', date_order='MDY')
    eps = segment_episodes(p, source_id='s', owner_name='Saya', partner='Budi', filename='f')
    assert len(eps) == 1 and eps[0].body == '[10:00] Budi: halo' and eps[0].seq == 1


def test_max_messages_splits_episode():
    text = ''.join(f'[1/5/26, 10:{i:02d}:00 AM] Budi: pesan {i}\n' for i in range(5))
    p = parse_whatsapp(text, owner_name='Saya', date_order='MDY')
    eps = segment_episodes(p, source_id='s', owner_name='Saya', partner='Budi', filename='f', max_messages=2)
    assert [e.line_count for e in eps] == [2, 2, 1]


def test_instructions_state_local_offset():
    from app.kg.ontology import build_instructions

    text = build_instructions(owner='P', partner='L', date='x', tz='Asia/Jakarta', participants=['P', 'L'])
    assert 'UTC+07:00' in text and '2026-11-04T12:33:00+07:00' in text
