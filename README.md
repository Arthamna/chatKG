# chatKG

Turn WhatsApp exports into editable, versioned knowledge graphs and ask questions about them. The app uses FastAPI, React, Graphiti, OpenRouter free models, CPU-hosted embedding models, and a local Neo4j container.

## Setup

Install [Docker](https://docs.docker.com/get-docker/), [uv](https://docs.astral.sh/uv/getting-started/installation/), and Node.js 20.19+ (or 22.12+).

Then, from this folder (copy `.env.example` to `.env` first):

```bash
docker compose up -d
cd backend
uv sync --locked --managed-python
uv run uvicorn app.api:app --port 8000
```

In a second terminal:

```bash
cd web && npm ci && npm run dev
```

- Set `OPENROUTER_API_KEY` in `.env` before using AI mapping, extraction, or Ask. 

The default provider is `openrouter` and the default model is `openrouter/free`; only that router or model IDs ending in `:free` are accepted. No paid fallback is used. Restart the backend after changing configuration. To retain Groq, set `LLM_PROVIDER=groq` and `GROQ_API_KEY`.

Extraction is checkpointed per episode in Neo4j. `OPENROUTER_INCOMPLETE_RETRIES`
retries one truncated model response, while `INGEST_INCOMPLETE_RETRIES` retries the
outer extraction job and skips episodes that are already stored. Use
`EPISODE_MAX_MESSAGES` to keep each durable batch small (default: 20).

Neo4j Browser is available at <http://localhost:7474>. 
Local application data is written to `data/`.
Neo4j data is kept in its Docker volume.
