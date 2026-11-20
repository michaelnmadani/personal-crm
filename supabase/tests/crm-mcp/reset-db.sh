#!/bin/bash
# Builds a throwaway local copy of the CRM database for the connector tests:
# just enough of Supabase (stub.sql), every migration in order, then the live
# database's demo read-only rule (live-demo-rule.sql — not yet in a migration).
#
#   apt-get install -y postgresql && pg_ctlcluster 16 main start
#   supabase/tests/crm-mcp/reset-db.sh
#   DENO_NO_PACKAGE_JSON=1 deno run -A --node-modules-dir=none supabase/tests/crm-mcp/connector.test.ts
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
run() { su postgres -c "psql -q -v ON_ERROR_STOP=1 -d crm" < "$1" >/dev/null 2>/tmp/crm-mig.err || { echo "FAILED: $1"; grep -v "wal_level\|HINT" /tmp/crm-mig.err; exit 1; }; }
su postgres -c "psql -q -c 'drop database if exists crm' -c 'create database crm'" >/dev/null 2>&1
run "$HERE/stub.sql"
for f in "$HERE"/../../migrations/*.sql; do run "$f"; done
run "$HERE/live-demo-rule.sql"
su postgres -c "psql -q -c \"alter user postgres password 'local'\"" >/dev/null
echo "local db ready ($(ls "$HERE"/../../migrations/*.sql | wc -l) migrations)"
