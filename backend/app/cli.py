"""Command line entry point for trying the pipeline before the API/worker exist.

uv run chatkg parse  tests/fixtures/wa_ios_sample.txt --owner Pemilik --alias "Leon TC 24=Leon"
uv run chatkg check
uv run chatkg ingest tests/fixtures/wa_ios_sample.txt --owner Pemilik --alias "Leon TC 24=Leon" --kg demo
uv run chatkg ask "Tugas apa yang harus diingatkan?" --kg demo
uv run chatkg quota
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import logging
import sys
from datetime import datetime
from pathlib import Path

from app.config import get_settings
from app.kg.groups import draft_group


def _aliases(values: list[str]) -> dict[str, str]:
    out = {}
    for v in values:
        raw, _, canon = v.partition('=')
        if not canon:
            raise SystemExit(f'--alias must look like "Raw Name=Canonical", got {v!r}')
        out[raw.strip()] = canon.strip()
    return out


def _load(args):
    from app.ingest import parse_whatsapp, segment_episodes

    s = get_settings()
    path = Path(args.file)
    text = path.read_text(encoding='utf-8')
    parsed = parse_whatsapp(
        text,
        owner_name=args.owner,
        aliases=_aliases(args.alias),
        tz=args.tz or s.default_tz,
        date_order=args.date_order,
    )
    source_id = hashlib.sha256(text.encode()).hexdigest()[:12]
    others = [p for p in parsed.participants if p != args.owner]
    partner = args.partner or (', '.join(others) if others else '?')
    episodes = segment_episodes(
        parsed,
        source_id=source_id,
        owner_name=args.owner,
        partner=partner,
        filename=path.name,
        gap_hours=s.episode_gap_hours,
        max_messages=s.episode_max_messages,
    )
    return parsed, episodes, partner


def cmd_parse(args) -> int:
    parsed, episodes, partner = _load(args)
    print(f'date order: {parsed.date_order} · tz: {parsed.tz} · counts: {parsed.counts}')
    print(f'participants: {parsed.participants} · partner: {partner}')
    for ep in episodes:
        print(
            f'\n--- {ep.name} · ref {ep.reference_time:%Y-%m-%dT%H:%M:%SZ} · {ep.line_count}/{ep.message_count} lines'
        )
        print(ep.body)
    return 0


async def _check() -> int:
    from app.kg.graph import build_embedder, build_graphiti, build_reranker

    s = get_settings()
    ok = True
    emb = build_embedder(s)
    v = await emb.create('tugas ml besok')
    print(f'[ok] embedder {s.embedding_model_name}: dim={len(v)}')
    ranked = await build_reranker(s).rank('kapan tugas ml?', ['Tugas ML dikumpulkan besok', 'stiker lucu'])
    print(f'[ok] reranker {s.reranker_model_name}: top="{ranked[0][0]}" ({ranked[0][1]:.3f})')
    try:
        graphiti, _ = build_graphiti(s, with_llm=False)
        await graphiti.build_indices_and_constraints()
        records, _, _ = await graphiti.driver.execute_query('RETURN 1 AS one')
        print(f'[ok] neo4j {s.neo4j_uri}: {records[0]["one"]}, indices ready')
        await graphiti.close()
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f'[fail] neo4j {s.neo4j_uri}: {e}')
    if s.groq_api_key:
        from app.kg.graph import build_budget, build_groq

        client = build_groq(s, build_budget(s))
        try:
            text, billed = await client.complete(
                [{'role': 'user', 'content': 'Balas dengan JSON {"ok": true}'}],
                model=s.groq_small_model,
                max_tokens=256,
                temperature=0,
                json_mode=True,
            )
            print(f'[ok] groq {s.groq_small_model}: {text.strip()} ({billed} tokens)')
        except Exception as e:  # noqa: BLE001
            ok = False
            print(f'[fail] groq: {e}')
    else:
        print('[skip] groq: GROQ_API_KEY is empty')
    return 0 if ok else 1


async def _ingest(args) -> int:
    from app.kg.graph import build_graphiti
    from app.kg.ingest import ingest_episodes
    from app.kg.ontology import build_instructions

    s = get_settings()
    parsed, episodes, partner = _load(args)
    group_id = draft_group(args.kg)

    def on_wait(model: str, seconds: float, reason: str) -> None:
        resume = datetime.now().astimezone().timestamp() + seconds
        print(
            f'  … kuota Groq {model} ({reason}) habis, lanjut otomatis {datetime.fromtimestamp(resume):%Y-%m-%d %H:%M:%S}',
            flush=True,
        )

    def progress(event: str, data: dict) -> None:
        if event == 'episode_start':
            print(f'[{data["i"]}/{data["total"]}] {data["name"]} …', flush=True)
        elif event == 'episode_done':
            print(f'    selesai {data["seconds"]}s · {len(data["nodes"])} node · {len(data["edges"])} fakta')
            for n in data['nodes']:
                print(f'      node  {n}')
            for e in data['edges']:
                print(f'      fakta {e}')

    graphiti, _ = build_graphiti(s, on_quota_wait=on_wait)
    try:
        await graphiti.build_indices_and_constraints()
        date = f'{episodes[0].start_local:%d %b %Y}–{episodes[-1].end_local:%d %b %Y}' if episodes else ''
        instructions = build_instructions(
            owner=args.owner,
            partner=partner,
            date=date,
            tz=parsed.tz,
            participants=parsed.participants,
            at=episodes[0].start_local if episodes else None,
        )
        report = await ingest_episodes(
            graphiti, episodes, group_id=group_id, instructions=instructions, progress=progress
        )
    finally:
        await graphiti.close()
    print(
        f'\n{group_id}: {len(report.done)} episode diproses, {len(report.skipped)} dilewati (sudah ada), '
        f'{report.nodes} node, {report.edges} fakta, {report.seconds}s'
    )
    return 0


async def _ask(args) -> int:
    from app.kg.ask import ask
    from app.kg.graph import build_graphiti

    s = get_settings()
    group_id = args.group or draft_group(args.kg)
    graphiti, groq_client = build_graphiti(s)
    assert groq_client is not None
    try:
        pit = datetime.fromisoformat(args.at) if args.at else None
        result = await ask(
            graphiti,
            groq_client,
            args.question,
            group_id=group_id,
            top_k=args.top_k,
            point_in_time=pit,
            temperature=s.groq_answer_temperature,
        )
    finally:
        await graphiti.close()
    print(result.answer)
    print(f'\n({len(result.references)} fakta · {result.ms} ms · {result.group_id})')
    for r in result.references:
        print(f'  [{r.n}] {r.fact} (valid {r.valid_at} – {r.invalid_at or "sekarang"})')
    return 0


def cmd_quota(args) -> int:
    from app.kg.graph import build_budget

    s = get_settings()
    budget = build_budget(s)
    print(f'limits (after {s.groq_budget_ratio:.0%} margin): {budget.limits}')
    for model in (s.groq_model, s.groq_small_model):
        print(model, json.dumps(budget.usage(model)))
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.WARNING, format='%(levelname)s %(name)s: %(message)s')
    # 'property does not exist' notices on a fresh database are harmless noise.
    logging.getLogger('neo4j.notifications').setLevel(logging.ERROR)
    p = argparse.ArgumentParser(prog='chatkg')
    sub = p.add_subparsers(dest='cmd', required=True)

    def source_args(sp):
        sp.add_argument('file')
        sp.add_argument('--owner', required=True, help='Name to use for "Anda" (the exporting account)')
        sp.add_argument('--alias', action='append', default=[], help='"Raw Name=Canonical", repeatable')
        sp.add_argument('--partner', help='Chat partner/group label (default: other participants)')
        sp.add_argument('--tz', help='IANA timezone of the exporting phone (default DEFAULT_TZ)')
        sp.add_argument('--date-order', choices=['MDY', 'DMY'], help='Override date order detection')

    source_args(sub.add_parser('parse', help='Parse + segment a chat export, no LLM'))
    ing = sub.add_parser('ingest', help='Parse and extract into the KG draft group')
    source_args(ing)
    ing.add_argument('--kg', required=True)
    sub.add_parser('check', help='Check embedder, reranker, Neo4j and Groq')
    a = sub.add_parser('ask', help='Ask a question against a KG group')
    a.add_argument('question')
    a.add_argument('--kg', default='demo')
    a.add_argument('--group', help='Explicit group_id, e.g. kg_demo__v3')
    a.add_argument('--top-k', type=int, default=10)
    a.add_argument('--at', help='Point in time (ISO 8601, with offset)')
    sub.add_parser('quota', help='Show Groq quota usage')

    args = p.parse_args(argv)
    if args.cmd == 'parse':
        return cmd_parse(args)
    if args.cmd == 'quota':
        return cmd_quota(args)
    if args.cmd == 'check':
        return asyncio.run(_check())
    if args.cmd == 'ingest':
        return asyncio.run(_ingest(args))
    if args.cmd == 'ask':
        return asyncio.run(_ask(args))
    return 2


if __name__ == '__main__':
    sys.exit(main())
