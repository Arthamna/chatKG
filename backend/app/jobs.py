"""In-process ingest job runner.

The API process also runs the ingest worker so the CPU models load once (the
host has 4–8 GB RAM for models; a separate worker would load them twice). Jobs
run one at a time because the provider quota is shared, and their state is
stored as ``:IngestJob`` nodes in Neo4j, so queued or paused jobs resume after a
restart. Ingest itself is resumable (stored episodes are skipped).
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from graphiti_core import Graphiti

from app.ai.openrouter_llm import IncompleteCompletion
from app.config import Settings
from app.ingest.prepare import prepare_source
from app.kg import versions as V
from app.kg.ingest import existing_episodes, ingest_episodes
from app.kg.ontology import build_instructions
from app.kg.schema import Ontology, active_schema
from app.kg.schema_store import SchemaConflict, proposal, save_proposal, source_key

logger = logging.getLogger(__name__)

ACTIVE = ('queued', 'running', 'retrying', 'waiting_quota')
MAX_LOG = 200

IngestFn = Callable[..., Awaitable[Any]]


def _now() -> str:
    return datetime.now(UTC).isoformat()


class JobRunner:
    def __init__(
        self,
        graphiti: Graphiti,
        settings: Settings,
        *,
        budget: Any | None = None,
        ingest_fn: IngestFn = ingest_episodes,
        llm: Any | None = None,
    ) -> None:
        self.graphiti = graphiti
        self.settings = settings
        self.budget = budget  # QuotaBudget, to report quota waits on the job
        self.ingest_fn = ingest_fn
        self.llm = llm
        self.submission_lock = asyncio.Lock()
        self._run_task: asyncio.Task | None = None
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._current: str | None = None
        self._cancelled: set[str] = set()
        self._retry_tasks: set[asyncio.Task] = set()

    @property
    def driver(self):
        return self.graphiti.driver

    # ---- persistence ----
    async def _update(self, job_id: str, **fields: Any) -> None:
        fields['updated_at'] = _now()
        await V._q(self.driver, 'MATCH (j:IngestJob {id: $id}) SET j += $f', id=job_id, f=fields)

    async def _log(self, job_id: str, line: str) -> None:
        rows = await V._q(self.driver, 'MATCH (j:IngestJob {id: $id}) RETURN j.log AS log', id=job_id)
        log = json.loads(rows[0]['log'] or '[]') if rows else []
        log.append(f'{datetime.now().astimezone():%H:%M:%S}  {line}')
        await self._update(job_id, log=json.dumps(log[-MAX_LOG:]))

    async def get(self, job_id: str) -> dict[str, Any] | None:
        rows = await V._q(self.driver, 'MATCH (j:IngestJob {id: $id}) RETURN j {.*} AS j', id=job_id)
        return self._public(rows[0]['j']) if rows else None

    async def list(self, kg_id: str) -> list[dict[str, Any]]:
        rows = await V._q(
            self.driver, 'MATCH (j:IngestJob {kg_id: $kg}) RETURN j {.*} AS j ORDER BY j.created_at DESC', kg=kg_id
        )
        return [self._public(r['j']) for r in rows]

    @staticmethod
    def _public(j: dict[str, Any]) -> dict[str, Any]:
        out = dict(j)
        out['log'] = json.loads(j.get('log') or '[]')
        out['last_episode'] = json.loads(j['last_episode']) if j.get('last_episode') else None
        return out

    # ---- lifecycle ----
    async def start(self) -> None:
        rows = await V._q(
            self.driver,
            'MATCH (j:IngestJob) WHERE j.status IN $active RETURN j.id AS id ORDER BY j.created_at',
            active=list(ACTIVE),
        )
        for r in rows:
            await self._update(r['id'], status='queued')
            await self.queue.put(r['id'])
        self._task = asyncio.create_task(self._worker(), name='ingest-worker')

    async def stop(self) -> None:
        for task in list(self._retry_tasks):
            task.cancel()
        if self._retry_tasks:
            await asyncio.gather(*self._retry_tasks, return_exceptions=True)
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def submit(
        self,
        kg_id: str,
        source_id: str,
        *,
        kind: str = 'ingest',
        snapshot: dict | None = None,
        force: bool = False,
        model: str | None = None,
    ) -> dict[str, Any]:
        async with self.submission_lock:
            return await self._submit(kg_id, source_id, kind=kind, snapshot=snapshot, force=force, model=model)

    async def _submit(self, kg_id, source_id, *, kind, snapshot, force, model):
        source = await source_record(self.driver, source_id)
        if not source or source['kg_id'] != kg_id:
            raise ValueError('Source bukan milik KG ini')
        jobs = [j for j in await self.list(kg_id) if j['source_id'] == source_id and j.get('kind', 'ingest') == kind]
        for job in jobs:
            if job['status'] in ACTIVE:
                if kind == 'schema' and model and job.get('model') != model:
                    raise SchemaConflict('Pemetaan aktif memakai model lain; batalkan sebelum mengganti model')
                if (
                    kind == 'ingest'
                    and snapshot
                    and job.get('schema_snapshot')
                    and json.loads(job['schema_snapshot'])['revision'] != snapshot['revision']
                ):
                    raise SchemaConflict('Ekstraksi masih memakai revisi sebelumnya; batalkan sebelum mengganti skema')
                return job
        if kind == 'schema' and not force and proposal(source):
            baseline = await active_schema(self.driver, kg_id)
            if proposal(source)['base_revision'] == baseline.revision and jobs and jobs[0]['status'] == 'done':
                return jobs[0]
        if kind == 'ingest' and snapshot:
            kg = await V.require_kg(self.driver, kg_id)
            group = V.resolve_group(kg_id, 'draft' if kg.has_draft or not kg.latest else kg.latest)
            rows = await V._q(
                self.driver,
                'MATCH (e:Episodic {group_id: $group}) WHERE e.name STARTS WITH $prefix RETURN count(e) > 0 AS present',
                group=group,
                prefix=f'wa:{Path(source["path"]).stem}:',
            )
            present = rows[0]['present']
            for job in jobs:
                previous = json.loads(job['schema_snapshot']) if job.get('schema_snapshot') else None
                if present and previous and previous['revision'] == snapshot['revision'] and job['status'] == 'done':
                    return job
                if present and job.get('done', 0) and (not previous or previous['revision'] != snapshot['revision']):
                    raise SchemaConflict(
                        'Chat ini sudah pernah diekstrak ke graph aktif dengan revisi skema berbeda. '
                        'Ekstraksi ulang diblokir agar fakta tidak duplikat. Jika hasil lama masih di draft, '
                        'buang draft lalu ulangi; jika sudah di-commit, edit graph atau unggah export yang berbeda.'
                    )
        job_id = uuid.uuid4().hex[:12]
        await V._q(
            self.driver,
            'CREATE (j:IngestJob {id: $id, kg_id: $kg, source_id: $sid, status: "queued", total: 0, done: 0, '
            '  nodes: 0, edges: 0, error: null, resume_at: null, created_at: $now, updated_at: $now, log: "[]", '
            '  kind: $kind, model: $model, schema_snapshot: $snapshot, source_json: $source})',
            id=job_id,
            kg=kg_id,
            sid=source_id,
            now=_now(),
            kind=kind,
            model=model or (snapshot or {}).get('model') or self.settings.llm_model,
            snapshot=json.dumps(snapshot) if snapshot else None,
            source=json.dumps(
                {
                    k: source.get(k)
                    for k in (
                        'id',
                        'kg_id',
                        'filename',
                        'path',
                        'owner',
                        'aliases',
                        'tz',
                        'date_order',
                    )
                }
                | {'gap_hours': self.settings.episode_gap_hours, 'max_messages': self.settings.episode_max_messages}
            ),
        )
        if kind == 'schema':
            await V._q(self.driver, 'MATCH (s:Source {id: $sid}) SET s.schema_job_id = $job', sid=source_id, job=job_id)
        await self.queue.put(job_id)
        job = await self.get(job_id)
        assert job is not None
        return job

    async def cancel(self, job_id: str) -> None:
        self._cancelled.add(job_id)
        job = await self.get(job_id)
        if job and job['status'] in ACTIVE:
            await self._update(job_id, status='cancelled', resume_at=None)
            if self._current == job_id and self._run_task:
                self._run_task.cancel()

    async def retry(self, job_id: str) -> dict:
        async with self.submission_lock:
            job = await self.get(job_id)
            if not job or job['status'] not in ('failed', 'cancelled'):
                raise SchemaConflict('Hanya job gagal atau dibatalkan yang dapat dilanjutkan')
            if self._current == job_id:
                raise SchemaConflict('Job masih berhenti; coba lanjutkan lagi setelah beberapa saat')
            self._cancelled.discard(job_id)
            await self._update(
                job_id,
                status='queued',
                error=None,
                resume_at=None,
                finished_at=None,
                retry_attempt=None,
                retry_max=None,
                retry_reason=None,
                batch_retry_attempt=0,
            )
            await self.queue.put(job_id)
            return await self.get(job_id)

    async def _worker(self) -> None:
        while True:
            job_id = await self.queue.get()
            if job_id in self._cancelled:
                continue
            self._current = job_id
            try:
                self._run_task = asyncio.create_task(self._run(job_id))
                await self._run_task
                if job_id in self._cancelled:
                    await self._update(job_id, status='cancelled', resume_at=None, finished_at=_now())
            except asyncio.CancelledError:
                if job_id not in self._cancelled:
                    raise
                await self._update(job_id, status='cancelled', resume_at=None, finished_at=_now())
            except Exception as e:
                if await self._retry_incomplete_job(job_id, e):
                    logger.warning('ingest job %s incomplete; scheduled from checkpoint', job_id)
                else:
                    logger.exception('ingest job %s failed', job_id)
                    await self._update(job_id, status='failed', error=str(e)[:1000], resume_at=None)
                    await self._log(job_id, f'gagal: {e}')
            finally:
                self._current = None
                self._run_task = None

    async def _retry_incomplete_job(self, job_id: str, error: Exception) -> bool:
        """Requeue an incomplete ingest without discarding durable episodes.

        ``OPENROUTER_INCOMPLETE_RETRIES`` retries one structured LLM request.
        This is the outer retry: Graphiti starts the current episode again while
        episodes already committed to Neo4j are skipped by ``ingest_episodes``.
        """
        job = await self.get(job_id)
        maximum = max(0, self.settings.ingest_incomplete_retries)
        if (
            not job
            or job.get('kind', 'ingest') != 'ingest'
            or not isinstance(error, IncompleteCompletion)
            or maximum == 0
        ):
            return False
        attempt = int(job.get('batch_retry_attempt') or 0) + 1
        if attempt > maximum:
            return False
        delay = min(60.0, max(0.0, self.settings.ingest_retry_base_seconds) * (2 ** (attempt - 1)))
        resume = (datetime.now(UTC) + timedelta(seconds=delay)).isoformat()
        await self._update(
            job_id,
            status='retrying',
            error=None,
            resume_at=resume,
            retry_attempt=attempt,
            retry_max=maximum,
            retry_reason='melanjutkan batch dari episode yang sudah tersimpan',
            batch_retry_attempt=attempt,
        )
        await self._log(
            job_id,
            f'batch belum selesai; melanjutkan dari checkpoint ({attempt}/{maximum}) dalam {delay:g}s',
        )
        task = asyncio.create_task(self._requeue_after(job_id, delay), name=f'ingest-retry-{job_id}')
        self._retry_tasks.add(task)
        task.add_done_callback(self._retry_tasks.discard)
        return True

    async def _requeue_after(self, job_id: str, delay: float) -> None:
        await asyncio.sleep(delay)
        job = await self.get(job_id)
        if job and job['status'] == 'retrying' and job_id not in self._cancelled:
            await self.queue.put(job_id)

    async def _run(self, job_id: str) -> None:
        job = await self.get(job_id)
        if job is None or job['status'] == 'cancelled':
            return
        src = (
            json.loads(job['source_json'])
            if job.get('source_json')
            else await source_record(self.driver, job['source_id'])
        )
        if src is None:
            raise RuntimeError(f'source {job["source_id"]} not found')
        if src['kg_id'] != job['kg_id']:
            raise ValueError('Source bukan milik KG ini')
        text = Path(src['path']).read_text(encoding='utf-8')
        s = self.settings
        prepared = prepare_source(
            text,
            filename=src['filename'],
            owner=src['owner'],
            aliases=json.loads(src.get('aliases') or '{}'),
            tz=src.get('tz') or s.default_tz,
            date_order=src.get('date_order') or None,
            gap_hours=src.get('gap_hours', s.episode_gap_hours),
            max_messages=src.get('max_messages', s.episode_max_messages),
        )
        if job.get('kind') == 'schema':
            await self._discover(job, src, prepared)
            return
        snapshot = json.loads(job['schema_snapshot']) if job.get('schema_snapshot') else None
        ontology = Ontology.model_validate(snapshot['ontology']) if snapshot else None
        active_ontology = (
            Ontology.model_validate(snapshot.get('active_ontology', snapshot['ontology'])) if snapshot else ontology
        )
        if snapshot:
            baseline = await active_schema(self.driver, job['kg_id'])
            if baseline.revision not in (snapshot['base_revision'], active_ontology.revision):
                raise SchemaConflict('Skema KG berubah saat antre; petakan ulang')
        group_id = await V.ensure_draft(self.driver, job['kg_id'])
        if active_ontology:
            await V._q(
                self.driver,
                'MATCH (k:KnowledgeGraph {id: $kg}) SET k.draft_ontology = $schema',
                kg=job['kg_id'],
                schema=active_ontology.model_dump_json(),
            )
        episodes = prepared.episodes
        known = await existing_episodes(self.graphiti, group_id)
        saved = sum(ep.name in known for ep in episodes)
        await self._update(
            job_id,
            status='running',
            total=len(episodes),
            done=saved,
            started_at=job.get('started_at') or _now(),
            group_id=group_id,
            resume_at=None,
            retry_reason=None,
        )
        await self._log(job_id, f'{len(episodes)} episode dari {src["filename"]}')
        if saved:
            await self._log(job_id, f'melanjutkan dari checkpoint; {saved}/{len(episodes)} episode sudah tersimpan')

        # Callbacks are synchronous; their writes go through one queue so they land in
        # order (a late "running" must never overwrite the final "done").
        updates: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

        async def apply_updates() -> None:
            while True:
                kind, payload = await updates.get()
                try:
                    if kind == 'update':
                        await self._update(job_id, **payload)
                    else:
                        await self._log(job_id, payload)
                except Exception:
                    logger.exception('job %s: progress update failed', job_id)
                finally:
                    updates.task_done()

        writer = asyncio.create_task(apply_updates())

        def on_wait(model: str, seconds: float, reason: str) -> None:
            resume = (datetime.now(UTC) + timedelta(seconds=seconds)).isoformat()
            updates.put_nowait(('update', {'status': 'waiting_quota', 'resume_at': resume, 'waiting_reason': reason}))

        def progress(event: str, data: dict) -> None:
            if job_id in self._cancelled:
                raise asyncio.CancelledError
            if event == 'episode_start':
                updates.put_nowait(('update', {'status': 'running', 'resume_at': None, 'current': data['name']}))
                updates.put_nowait(('log', f'episode {data["i"]}/{data["total"]} · {data["name"]}'))
            elif event == 'episode_done':
                last = json.dumps({'nodes': data['nodes'], 'edges': data['edges']})
                updates.put_nowait(
                    ('update', {'status': 'running', 'resume_at': None, 'done': data['i'], 'last_episode': last})
                )
                line = (
                    f'episode {data["i"]}/{data["total"]} selesai · {len(data["nodes"])} entitas, '
                    f'{len(data["edges"])} fakta · {data["seconds"]}s'
                )
                updates.put_nowait(('log', line))

        previous = getattr(self.budget, 'on_wait', None)
        if self.budget is not None:
            self.budget.on_wait = on_wait

        def on_retry(attempt: int, maximum: int, reason: str, delay: float) -> None:
            resume = (datetime.now(UTC) + timedelta(seconds=delay)).isoformat()
            updates.put_nowait(
                (
                    'update',
                    {
                        'status': 'retrying',
                        'resume_at': resume,
                        'retry_attempt': attempt,
                        'retry_max': maximum,
                        'retry_reason': 'respons OpenRouter terpotong',
                    },
                )
            )
            updates.put_nowait(('log', f'respons OpenRouter terpotong; mencoba lagi ({attempt}/{maximum})'))

        try:
            instructions = build_instructions(
                owner=src['owner'],
                partner=prepared.partner,
                date=f'{episodes[0].start_local:%d %b %Y}–{episodes[-1].end_local:%d %b %Y}' if episodes else '',
                tz=prepared.parsed.tz,
                participants=prepared.parsed.participants,
                at=episodes[0].start_local if episodes else None,
                glossary=ontology.glossary if ontology else None,
            )
            extra = (snapshot or {}).get('extraction_instructions', '').strip()
            if extra:
                instructions += (
                    '\n\nInstruksi tambahan pengguna (berlaku hanya jika tidak bertentangan dengan aturan di atas):\n'
                    f'{extra}'
                )
            kwargs = {'ontology': ontology} if ontology else {}
            model_context = (
                self.llm.use_model(job.get('model') or self.settings.llm_model)
                if self.llm is not None and hasattr(self.llm, 'use_model')
                else nullcontext()
            )
            retry_context = (
                self.llm.use_retry_callback(on_retry)
                if self.llm is not None and hasattr(self.llm, 'use_retry_callback')
                else nullcontext()
            )
            with model_context, retry_context:
                report = await self.ingest_fn(
                    self.graphiti,
                    episodes,
                    group_id=group_id,
                    instructions=instructions,
                    progress=progress,
                    **kwargs,
                )
        except asyncio.CancelledError:
            if job_id in self._cancelled:
                await updates.join()
                await self._log(job_id, 'dibatalkan')
                return
            raise
        finally:
            if self.budget is not None:
                self.budget.on_wait = previous
            await updates.join()
            writer.cancel()
        stats = await V.group_stats(self.driver, group_id)
        await self._update(
            job_id,
            status='done',
            done=len(episodes),
            nodes=stats['nodes'],
            edges=stats['edges'],
            finished_at=_now(),
            resume_at=None,
            skipped=len(getattr(report, 'skipped', [])),
            retry_attempt=None,
            retry_max=None,
            retry_reason=None,
        )
        await self._log(job_id, f'selesai · draft berisi {stats["nodes"]} entitas, {stats["edges"]} fakta')

    async def _discover(self, job, src, prepared):
        from app.ai.discovery import discover_schema

        if not self.llm:
            raise ValueError('API key LLM belum diisi')
        baseline = await active_schema(self.driver, job['kg_id'])
        await self._update(job['id'], status='running', started_at=_now(), total=1)
        await self._log(job['id'], 'Memetakan tipe dari sampel episode')
        pending = []

        def on_wait(model, seconds, reason):
            pending.append(
                asyncio.create_task(
                    self._update(
                        job['id'],
                        status='waiting_quota',
                        waiting_reason=reason,
                        resume_at=(datetime.now(UTC) + timedelta(seconds=seconds)).isoformat(),
                    )
                )
            )

        previous = getattr(self.budget, 'on_wait', None)
        if self.budget is not None:
            self.budget.on_wait = on_wait

        def on_retry(attempt, maximum, reason, delay):
            pending.append(
                asyncio.create_task(
                    self._update(
                        job['id'],
                        status='retrying',
                        retry_attempt=attempt,
                        retry_max=maximum,
                        retry_reason='respons OpenRouter terpotong',
                        resume_at=(datetime.now(UTC) + timedelta(seconds=delay)).isoformat(),
                    )
                )
            )
            pending.append(
                asyncio.create_task(
                    self._log(job['id'], f'respons OpenRouter terpotong; mencoba lagi ({attempt}/{maximum})')
                )
            )

        try:
            chosen_model = job.get('model') or self.settings.llm_model
            model_context = self.llm.use_model(chosen_model) if hasattr(self.llm, 'use_model') else nullcontext()
            retry_context = (
                self.llm.use_retry_callback(on_retry) if hasattr(self.llm, 'use_retry_callback') else nullcontext()
            )
            with model_context, retry_context:
                ontology, sampled = await discover_schema(self.llm, prepared, baseline, model=chosen_model)
        finally:
            if self.budget is not None:
                self.budget.on_wait = previous
            if pending:
                await asyncio.gather(*pending)
        current = await source_record(self.driver, src['id'])
        if not current or source_key(current) != source_key(src):
            raise SchemaConflict('Mapping peserta berubah saat pemetaan; petakan ulang')
        await save_proposal(
            self.driver,
            src,
            ontology,
            baseline,
            job_id=job['id'],
            sampled=sampled,
            model=job.get('model') or self.settings.llm_model,
        )
        await self._update(
            job['id'],
            status='done',
            done=1,
            sampled_episodes=sampled,
            total_episodes=len(prepared.episodes),
            finished_at=_now(),
            resume_at=None,
        )
        await self._log(job['id'], f'{sampled}/{len(prepared.episodes)} episode disampel; skema siap ditinjau')


# ---------------------------------------------------------------- sources


async def save_source(
    driver,
    *,
    kg_id: str,
    source_id: str,
    filename: str,
    path: str,
    owner: str,
    aliases: dict[str, str],
    tz: str,
    date_order: str | None,
    counts: dict[str, int],
) -> None:
    await V._q(
        driver,
        'MATCH (k:KnowledgeGraph {id: $kg}) '
        'MERGE (s:Source {id: $id, kg_id: $kg}) '
        'ON CREATE SET s.created_at = $now '
        'SET s.filename = $fn, s.path = $path, s.owner = $owner, s.aliases = $aliases, s.tz = $tz, '
        '    s.date_order = $order, s.messages = $total, s.text_messages = $text, s.media = $media '
        'MERGE (k)-[:HAS_SOURCE]->(s)',
        kg=kg_id,
        id=source_id,
        now=_now(),
        fn=filename,
        path=path,
        owner=owner,
        aliases=json.dumps(aliases),
        tz=tz,
        order=date_order,
        total=counts['total'],
        text=counts['text'],
        media=counts['media'],
    )


async def source_record(driver, source_id: str) -> dict[str, Any] | None:
    rows = await V._q(driver, 'MATCH (s:Source {id: $id}) RETURN s {.*} AS s', id=source_id)
    return rows[0]['s'] if rows else None
