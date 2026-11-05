# Chat Knowledge Graph

Turn WhatsApp exports into editable, versioned knowledge graphs and ask questions about them. The app uses FastAPI, React, Graphiti, Groq, CPU-hosted embedding models, and a local Neo4j container.

## Setup

Install [Docker](https://docs.docker.com/get-docker/), [uv](https://docs.astral.sh/uv/getting-started/installation/), and Node.js 20.19+ (or 22.12+). Then, from this folder:

```bash
cp .env.example .env
docker compose up -d
cd backend && uv sync && uv run uvicorn app.api:app --port 8000
```

In a second terminal:

```bash
cd web && npm ci && npm run dev
```

Open <http://localhost:5173>. Add a Groq API key to `GROQ_API_KEY` in `.env` before using extraction or Ask; the rest of the app runs without it.

## Use

Create a knowledge graph, upload a WhatsApp export, review its extracted entities and relationships, then commit a version. You can edit the graph, compare or restore versions, and ask questions against any committed version.

## Useful commands

```bash
cd backend && uv run pytest     # backend tests
cd web && npm run build         # typecheck and build the frontend
docker compose down             # stop Neo4j
```

Neo4j Browser is available at <http://localhost:7474>. Local application data is written to `data/`; Neo4j data is kept in its Docker volume.
