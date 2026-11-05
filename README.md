# Chat Knowledge Graph

Turn WhatsApp exports into editable, versioned knowledge graphs and ask questions about them. The app uses FastAPI, React, Graphiti, OpenRouter free models, CPU-hosted embedding models, and a local Neo4j container.

## Setup

Install [Docker](https://docs.docker.com/get-docker/), [uv](https://docs.astral.sh/uv/getting-started/installation/), and Node.js 20.19+ (or 22.12+).

On Windows, install uv from PowerShell:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
$env:Path = "$HOME\.local\bin;$env:Path"
uv --version
```

Restart other terminals (including your editor) to pick up the updated PATH. Use standard CPython, not MSYS2/MinGW Python: dependencies such as PyTorch need compatible Windows wheels. The backend pins Python 3.12; `--managed-python` lets uv download and use CPython without relying on the system interpreter.

Then, from this folder (copy `.env.example` to `.env` first):

```bash
docker compose up -d
cd backend
uv sync --locked --managed-python
uv run uvicorn app.api:app --port 8000
```

Run Python commands with `uv run` so they use `backend/.venv` and its installed packages. In your editor, select `backend/.venv/Scripts/python.exe` on Windows (`backend/.venv/bin/python` on Linux/macOS). Use `uv sync` for this project: plain `pip install -e .` does not read the CPU-only PyTorch index in `[tool.uv.sources]`.

In a second terminal:

```bash
cd web && npm ci && npm run dev
```

Open <http://localhost:5173>. Set `OPENROUTER_API_KEY` in `.env` before using AI mapping, extraction, or Ask. The default provider is `openrouter` and the default model is `openrouter/free`; only that router or model IDs ending in `:free` are accepted. No paid fallback is used. Restart the backend after changing configuration. To retain Groq, set `LLM_PROVIDER=groq` and `GROQ_API_KEY`.

## Use

Create a knowledge graph, fill in participant mapping, and upload a WhatsApp iOS `.txt` export. AI automatically proposes entity and relation types from up to eight evenly spaced episode samples (up to 1,500 characters per sample, at complete line boundaries). Review and edit the types, attributes, relation directions, and glossary, then choose **Setujui & ekstrak**. Extraction processes all episodes using the approved schema and opens the resulting draft in the Graph Editor. Review and commit when ready.

Later uploads reuse and extend the KG's schema. Existing type identifiers and attribute types are protected. Schemas are snapshotted with jobs and graph versions; restore also restores the version's schema. Failed or cancelled extraction can resume with the original schema, skipping completed episodes. Use **Petakan ulang** if sampling missed types or the KG schema has changed.

Free capacity and model availability vary. `OPENROUTER_RPM` and `OPENROUTER_RPD` set a shared conservative request budget (defaults: 20/minute and 50/day). HTTP 429/503 responses respect `Retry-After`; quota waits and jobs survive backend restarts. Graphiti makes several LLM calls per episode, so long files can exhaust the daily allowance. Embedding/reranking models run locally and download on first use.

`OPENROUTER_MAX_TOKENS` sets the default output token budget per generation (4096 by default), including reasoning tokens where the model uses them. If schema mapping stops early, the error reports the actual model, finish reason, requested budget, and any usage counts returned by OpenRouter. Check the effective setting after restarting the backend. Process environment variables take priority over `.env`, and `backend/.env` takes priority over the root `.env`.

The reusable discovery prompt is in `backend/app/ai/discovery.py`; its validated JSON contract is `Ontology` in `backend/app/kg/schema.py`. Graphiti receives dynamic Pydantic entity/edge models and a source/target relation map; the frontend still receives the existing `nodes`/`edges` graph format.

References: [OpenRouter free router](https://openrouter.ai/docs/guides/routing/routers/free-router), [structured output](https://openrouter.ai/docs/guides/features/structured-outputs), [Pydantic dynamic models](https://docs.pydantic.dev/latest/examples/dynamic_models/).

## Useful commands

```bash
cd backend && uv run pytest     # backend tests
cd web && npm run build         # typecheck and build the frontend
docker compose down             # stop Neo4j
```

Neo4j Browser is available at <http://localhost:7474>. Local application data is written to `data/`; Neo4j data is kept in its Docker volume.
