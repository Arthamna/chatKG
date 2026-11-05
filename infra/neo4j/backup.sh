#!/usr/bin/env bash
# Offline dump of the self-hosted Neo4j (Community edition needs the DB stopped).
# Output: infra/neo4j/backups/neo4j-<timestamp>.dump
set -euo pipefail
cd "$(dirname "$0")/../.."

ts=$(date +%Y%m%d-%H%M%S)
docker compose stop neo4j
docker compose run --rm --no-deps neo4j \
  neo4j-admin database dump neo4j --to-path=/backups --overwrite-destination=true
mv infra/neo4j/backups/neo4j.dump "infra/neo4j/backups/neo4j-${ts}.dump"
docker compose start neo4j
echo "Backup written to infra/neo4j/backups/neo4j-${ts}.dump"
