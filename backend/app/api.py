"""REST API for the web UI (design/backend-pipeline.md §9).

Run: ``uv run uvicorn app.api:app --port 8000`` (the web dev server proxies /api).
One process hosts the API and the ingest worker (see app/jobs.py).
"""

from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime
from typing import Annotated, Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import Settings, get_settings
from app.ingest.prepare import parse_aliases, prepare_source
from app.jobs import JobRunner, save_source, source_record
from app.kg import draft as D
from app.kg import versions as V
from app.kg.ontology import DEFAULT_GLOSSARY, EDGE_TYPE_MAP, EDGE_TYPES, ENTITY_TYPES, INSTRUCTIONS_TEMPLATE

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------- wiring


def _build(settings: Settings):
    from app.kg.graph import build_graphiti

    has_llm = bool(settings.groq_api_key)
    graphiti, groq_client = build_graphiti(settings, with_llm=has_llm)
    budget = groq_client.budget if groq_client else None
    return graphiti, groq_client, budget


def create_app(build=_build, settings: Settings | None = None, ingest_fn=None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        graphiti, groq_client, budget = build(settings)
        await graphiti.build_indices_and_constraints()
        await V.ensure_schema(graphiti.driver)
        kwargs = {'ingest_fn': ingest_fn} if ingest_fn else {}
        runner = JobRunner(graphiti, settings, budget=budget, **kwargs)
        await runner.start()
        app.state.graphiti, app.state.groq, app.state.runner = graphiti, groq_client, runner
        try:
            yield
        finally:
            await runner.stop()
            await graphiti.close()

    app = FastAPI(title='Chat → KG API', lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=['http://localhost:5173', 'http://localhost:4173'],
        allow_methods=['*'],
        allow_headers=['*'],
    )
    app.state.settings = settings
    _routes(app)
    return app


def _g(request: Request):
    return request.app.state.graphiti


def _d(request: Request):
    return request.app.state.graphiti.driver


async def _kg(request: Request, kg_id: str) -> V.KnowledgeGraph:
    kg = await V.get_kg(_d(request), kg_id)
    if kg is None:
        raise HTTPException(404, f'KG {kg_id!r} tidak ditemukan')
    return kg


def _slug(name: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    return re.sub(r'-+', '-', s) or 'kg'


class NewKG(BaseModel):
    name: str
    id: str | None = None
    description: str = ''


class CommitIn(BaseModel):
    message: str = Field(min_length=1)
    kind: str = 'edit'


class RestoreIn(BaseModel):
    message: str = ''


class EntityPatch(BaseModel):
    name: str | None = None
    summary: str | None = None
    attributes: dict[str, Any] | None = None


class MergeIn(BaseModel):
    target_uuid: str
    name: str | None = None
    summary_mode: str = 'concat'


class EdgePatch(BaseModel):
    fact: str | None = None
    name: str | None = None
    invalidate: bool = False


class AskIn(BaseModel):
    question: str = Field(min_length=1)
    version: str = 'latest'
    top_k: int = Field(10, ge=1, le=50)
    point_in_time: datetime | None = None
    include_invalid: bool = True
    model: str | None = None


class JobIn(BaseModel):
    source_id: str


def _kg_json(kg: V.KnowledgeGraph) -> dict[str, Any]:
    return asdict(kg)


def _preview(sid: str, prepared, filename: str) -> dict[str, Any]:
    p = prepared.parsed
    eps = prepared.episodes
    return {
        'source_id': sid,
        'filename': filename,
        'date_order': p.date_order,
        'tz': p.tz,
        'counts': p.counts,
        'participants': p.participants,
        'partner': prepared.partner,
        'date_from': eps[0].start_local.isoformat() if eps else None,
        'date_to': eps[-1].end_local.isoformat() if eps else None,
        'episodes': [
            {
                'name': e.name,
                'start': e.start_local.isoformat(),
                'end': e.end_local.isoformat(),
                'messages': e.message_count,
                'lines': e.line_count,
                'body': e.body,
            }
            for e in eps
        ],
    }


def _routes(app: FastAPI) -> None:
    @app.exception_handler(D.DraftError)
    async def _draft_error(request: Request, exc: D.DraftError):
        from fastapi.responses import JSONResponse

        return JSONResponse({'detail': str(exc)}, status_code=409)

    @app.get('/api/health')
    async def health(request: Request):
        s: Settings = request.app.state.settings
        try:
            await _d(request).execute_query('RETURN 1')
            neo4j = True
        except Exception:  # noqa: BLE001
            neo4j = False
        return {
            'neo4j': neo4j,
            'neo4j_uri': s.neo4j_uri,
            'groq': bool(request.app.state.groq),
            'groq_model': s.groq_model,
            'groq_small_model': s.groq_small_model,
            'entity_extractor': s.entity_extractor,
            'embedding_model': s.embedding_model_name,
            'reranker_model': s.reranker_model_name if s.reranker != 'none' else None,
        }

    @app.get('/api/quota')
    async def quota(request: Request):
        groq = request.app.state.groq
        if not groq:
            return {'limits': None, 'models': {}}
        s: Settings = request.app.state.settings
        b = groq.budget
        return {'limits': asdict(b.limits), 'models': {m: b.usage(m) for m in (s.groq_model, s.groq_small_model)}}

    @app.get('/api/schema')
    async def schema():
        def fields(model):
            return {k: (f.description or '') for k, f in model.model_fields.items()}

        return {
            'entity_types': [
                {'name': k, 'description': (m.__doc__ or '').strip(), 'attributes': fields(m)}
                for k, m in ENTITY_TYPES.items()
            ],
            'edge_types': [{'name': k, 'description': (m.__doc__ or '').strip()} for k, m in EDGE_TYPES.items()],
            'edge_type_map': [{'source': a, 'target': b, 'relations': rels} for (a, b), rels in EDGE_TYPE_MAP.items()],
            'glossary': DEFAULT_GLOSSARY,
            'instructions_template': INSTRUCTIONS_TEMPLATE,
        }

    # ---- KGs ----
    @app.get('/api/kgs')
    async def list_kgs(request: Request):
        return [_kg_json(k) for k in await V.list_kgs(_d(request))]

    @app.post('/api/kgs', status_code=201)
    async def create_kg(request: Request, body: NewKG):
        kg_id = body.id or _slug(body.name)
        try:
            kg = await V.create_kg(_d(request), kg_id, body.name, body.description)
        except ValueError as e:
            raise HTTPException(409 if 'exists' in str(e) else 422, str(e)) from e
        return _kg_json(kg)

    @app.get('/api/kgs/{kg_id}')
    async def get_kg(request: Request, kg_id: str):
        return _kg_json(await _kg(request, kg_id))

    # ---- sources (A3) ----
    @app.post('/api/kgs/{kg_id}/sources', status_code=201)
    async def upload_source(
        request: Request,
        kg_id: str,
        file: Annotated[UploadFile, File()],
        owner: Annotated[str, Form()],
        aliases: Annotated[str, Form()] = '',
        tz: Annotated[str, Form()] = '',
        date_order: Annotated[str, Form()] = '',
    ):
        await _kg(request, kg_id)
        s: Settings = request.app.state.settings
        raw = await file.read()
        try:
            text = raw.decode('utf-8-sig')
            prepared = prepare_source(
                text,
                filename=file.filename or 'chat.txt',
                owner=owner.strip(),
                aliases=parse_aliases(aliases),
                tz=tz or s.default_tz,
                date_order=(date_order or None),  # type: ignore[arg-type]
                gap_hours=s.episode_gap_hours,
                max_messages=s.episode_max_messages,
            )
        except (UnicodeDecodeError, ValueError) as e:
            raise HTTPException(422, str(e)) from e
        sid = f'{kg_id}-{prepared.source_id}'
        upload_dir = s.data_dir / 'uploads'
        upload_dir.mkdir(parents=True, exist_ok=True)
        path = upload_dir / f'{prepared.source_id}.txt'
        path.write_text(text, encoding='utf-8')
        await save_source(
            _d(request),
            kg_id=kg_id,
            source_id=sid,
            filename=file.filename or 'chat.txt',
            path=str(path),
            owner=owner.strip(),
            aliases=parse_aliases(aliases),
            tz=prepared.parsed.tz,
            date_order=date_order or None,
            counts=prepared.parsed.counts,
        )
        return _preview(sid, prepared, file.filename or 'chat.txt')

    @app.get('/api/sources/{source_id}')
    async def get_source(request: Request, source_id: str):
        src = await source_record(_d(request), source_id)
        if src is None:
            raise HTTPException(404, 'source tidak ditemukan')
        return src

    # ---- ingest jobs (A5) ----
    @app.post('/api/kgs/{kg_id}/ingest-jobs', status_code=202)
    async def start_job(request: Request, kg_id: str, body: JobIn):
        await _kg(request, kg_id)
        if not request.app.state.groq:
            raise HTTPException(503, 'GROQ_API_KEY belum diisi; ekstraksi butuh Groq')
        if await source_record(_d(request), body.source_id) is None:
            raise HTTPException(404, 'source tidak ditemukan')
        return await request.app.state.runner.submit(kg_id, body.source_id)

    @app.get('/api/kgs/{kg_id}/ingest-jobs')
    async def list_jobs(request: Request, kg_id: str):
        return await request.app.state.runner.list(kg_id)

    @app.get('/api/ingest-jobs/{job_id}')
    async def get_job(request: Request, job_id: str):
        job = await request.app.state.runner.get(job_id)
        if job is None:
            raise HTTPException(404, 'job tidak ditemukan')
        return job

    @app.post('/api/ingest-jobs/{job_id}/cancel')
    async def cancel_job(request: Request, job_id: str):
        await request.app.state.runner.cancel(job_id)
        return await request.app.state.runner.get(job_id)

    # ---- draft & review (A6, B) ----
    @app.post('/api/kgs/{kg_id}/draft')
    async def ensure_draft(request: Request, kg_id: str):
        await _kg(request, kg_id)
        return {'group_id': await V.ensure_draft(_d(request), kg_id)}

    @app.delete('/api/kgs/{kg_id}/draft')
    async def discard_draft(request: Request, kg_id: str):
        await _kg(request, kg_id)
        return {'deleted': await V.discard_draft(_d(request), kg_id)}

    @app.get('/api/kgs/{kg_id}/draft/changes')
    async def draft_changes(request: Request, kg_id: str):
        await _kg(request, kg_id)
        return await D.review_changes(_d(request), kg_id)

    @app.post('/api/kgs/{kg_id}/draft/changes/{item_id}/reject')
    async def reject_change(request: Request, kg_id: str, item_id: str):
        await D.reject_change(_g(request), kg_id, item_id)
        return await D.review_changes(_d(request), kg_id)

    @app.post('/api/kgs/{kg_id}/draft/conflicts/{edge_uuid}/keep')
    async def keep_conflict(request: Request, kg_id: str, edge_uuid: str):
        n = await D.resolve_conflict(_d(request), kg_id, edge_uuid)
        return {'invalidated': n}

    @app.patch('/api/kgs/{kg_id}/draft/entities/{uuid}')
    async def patch_entity(request: Request, kg_id: str, uuid: str, body: EntityPatch):
        return await D.update_entity(
            _g(request), kg_id, uuid, name=body.name, summary=body.summary, attributes=body.attributes
        )

    @app.delete('/api/kgs/{kg_id}/draft/entities/{uuid}')
    async def delete_entity(request: Request, kg_id: str, uuid: str):
        return {'edges_removed': await D.delete_entity(_d(request), kg_id, uuid)}

    @app.post('/api/kgs/{kg_id}/draft/entities/{uuid}/merge')
    async def merge_entity(request: Request, kg_id: str, uuid: str, body: MergeIn):
        return await D.merge_entities(
            _g(request), kg_id, uuid, body.target_uuid, name=body.name, summary_mode=body.summary_mode
        )

    @app.patch('/api/kgs/{kg_id}/draft/edges/{uuid}')
    async def patch_edge(request: Request, kg_id: str, uuid: str, body: EdgePatch):
        return await D.update_edge(_g(request), kg_id, uuid, fact=body.fact, name=body.name, invalidate=body.invalidate)

    @app.delete('/api/kgs/{kg_id}/draft/edges/{uuid}')
    async def delete_edge(request: Request, kg_id: str, uuid: str):
        await D.delete_edge(_d(request), kg_id, uuid)
        return {'deleted': uuid}

    @app.get('/api/kgs/{kg_id}/graph')
    async def graph(request: Request, kg_id: str, version: str = 'draft', limit: int = 500):
        kg = await _kg(request, kg_id)
        if version == 'latest':
            version = 'draft' if kg.has_draft or not kg.latest else f'v{kg.latest}'
        return await D.graph_view(_d(request), kg_id, version, limit)

    # ---- versions (A7, B5, C) ----
    @app.get('/api/kgs/{kg_id}/versions')
    async def versions(request: Request, kg_id: str):
        kg = await _kg(request, kg_id)
        return {'kg': _kg_json(kg), 'versions': [asdict(v) for v in await V.list_versions(_d(request), kg_id)]}

    @app.post('/api/kgs/{kg_id}/versions', status_code=201)
    async def commit(request: Request, kg_id: str, body: CommitIn):
        await _kg(request, kg_id)
        try:
            return asdict(await V.commit(_d(request), kg_id, body.message, kind=body.kind))
        except ValueError as e:
            raise HTTPException(409, str(e)) from e

    @app.post('/api/kgs/{kg_id}/versions/{n}/restore', status_code=201)
    async def restore(request: Request, kg_id: str, n: int, body: RestoreIn):
        await _kg(request, kg_id)
        try:
            return asdict(await V.restore(_d(request), kg_id, n, body.message))
        except ValueError as e:
            raise HTTPException(409, str(e)) from e

    @app.get('/api/kgs/{kg_id}/versions/diff')
    async def version_diff(request: Request, kg_id: str, base: str, compare: str):
        await _kg(request, kg_id)
        return await V.diff(_d(request), V.resolve_group(kg_id, base), V.resolve_group(kg_id, compare))

    # ---- ask (D) ----
    @app.post('/api/kgs/{kg_id}/ask')
    async def ask(request: Request, kg_id: str, body: AskIn):
        from app.kg.ask import ask as run_ask

        kg = await _kg(request, kg_id)
        groq = request.app.state.groq
        if not groq:
            raise HTTPException(503, 'GROQ_API_KEY belum diisi; jawaban butuh Groq')
        version = body.version
        if version == 'latest':
            if not kg.latest and not kg.has_draft:
                raise HTTPException(409, 'KG ini belum punya data')
            version = f'v{kg.latest}' if kg.latest else 'draft'
        group_id = V.resolve_group(kg_id, version)
        s: Settings = request.app.state.settings
        result = await run_ask(
            _g(request),
            groq,
            body.question,
            group_id=group_id,
            top_k=body.top_k,
            point_in_time=body.point_in_time,
            include_invalid=body.include_invalid,
            model=body.model,
            temperature=s.groq_answer_temperature,
        )
        refs = [asdict(r) for r in result.references]
        sub = await _subgraph(_d(request), [r['edge_uuid'] for r in refs])
        return {
            'answer': result.answer,
            'references': refs,
            'subgraph': sub,
            'ms': result.ms,
            'group_id': group_id,
            'version': version,
        }


async def _subgraph(driver, edge_uuids: list[str]) -> dict[str, Any]:
    if not edge_uuids:
        return {'nodes': [], 'edges': []}
    rows = await V._q(
        driver,
        'MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity) WHERE r.uuid IN $u '
        'RETURN r.uuid AS id, r.name AS name, r.invalid_at IS NOT NULL AS stale, '
        "  a.uuid AS s, a.name AS sn, [x IN labels(a) WHERE x <> 'Entity'][0] AS st, "
        "  b.uuid AS t, b.name AS tn, [x IN labels(b) WHERE x <> 'Entity'][0] AS tt",
        u=edge_uuids,
    )
    nodes: dict[str, dict] = {}
    edges = []
    for r in rows:
        nodes[r['s']] = {'id': r['s'], 'label': r['sn'], 'type': r['st'] or 'Entity'}
        nodes[r['t']] = {'id': r['t'], 'label': r['tn'], 'type': r['tt'] or 'Entity'}
        n = edge_uuids.index(r['id']) + 1
        edges.append(
            {'id': r['id'], 'source': r['s'], 'target': r['t'], 'label': f'[{n}] {r["name"]}', 'stale': r['stale']}
        )
    return {'nodes': list(nodes.values()), 'edges': edges}


app = create_app()
