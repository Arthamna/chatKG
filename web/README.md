# Chat → KG — Web UI

The React workspace uses the backend API and shares one design system across all routes. [Design specification](../DESIGN.md)

- **Stack:** React 19, Vite, Tailwind v4, and Radix UI primitives.
- **Graph:** Sigma.js and Graphology with `@sigma/node-border` and a ForceAtlas2 layout computed in the browser.
- **Data:** `src/lib/api.ts` calls `backend/app/api.py` under `/api`. Vite proxies it to `BACKEND_URL` (default `http://localhost:8000`). Set `VITE_API_URL` to call another origin.

```bash
# backend first: cd ../backend && uv run uvicorn app.api:app --port 8000
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
```

## Screens → routes → API

| Spec | Route | Main calls |
|---|---|---|
| A1 Knowledge Graphs · A2 new KG | `/kg` | `GET/POST /kgs` |
| A3 Upload chat (owner name, aliases, timezone, date order, episode preview) | `/upload?kg=` | `POST /kgs/{kg}/sources` |
| A4 Modeling (ontology + models, read-only) | `/upload/model?kg=&source=` | `GET /schema`, `GET /health`, `POST /kgs/{kg}/ingest-jobs` |
| A5 Extraction (polls the job every 2 s, quota waits shown) | `/upload/run?kg=&job=` | `GET /ingest-jobs/{id}`, `GET /kgs/{kg}/graph?version=draft` |
| A6 Review · A7 commit | `/upload/review?kg=` | `GET /draft/changes`, `POST …/reject`, `POST …/conflicts/{edge}/keep`, `POST /versions` |
| B1 Graph Editor · B2 edit · B3 merge · B4 delete · B5 commit | `/kg/:id/graph?version=` | `GET /graph`, `POST/DELETE /draft`, `PATCH/DELETE /draft/entities/{uuid}`, `POST …/merge`, `POST /versions` |
| C1 Versions & diff · C2 restore | `/kg/:id/versions?base=&compare=` | `GET /versions`, `GET /versions/diff`, `POST /versions/{n}/restore` |
| D1 / D2 Ask KG | `/ask?kg=&version=` | `POST /kgs/{kg}/ask` |

The header tabs point at the KG opened last. It is stored in `localStorage`; without one, the tabs lead to the KG list.
