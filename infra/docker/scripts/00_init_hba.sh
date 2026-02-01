#!/bin/bash
# Allow replication connections
echo "host replication replicator 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"
# Allow standard connection to the 'replicator' database (for health checks)
echo "host replicator replicator 0.0.0.0/0 md5" >> "$PGDATA/pg_hba.conf"