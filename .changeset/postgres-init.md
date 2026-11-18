---
'@liasse/server': patch
---

The Postgres of `docker-compose.yml` and `docker-compose.coolify.yml` runs under an init. As PID 1, the postmaster took a health check `pg_isready` killed at its timeout under load for a crashed backend: it ended every session of the running server and ran crash recovery.
