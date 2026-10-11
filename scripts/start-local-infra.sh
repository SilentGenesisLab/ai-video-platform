#!/bin/bash
set -e
pgroot="$HOME/.local/share/ai-video-platform/pgdata"
test -d "$pgroot"
if ! /usr/lib/postgresql/16/bin/pg_ctl -D "$pgroot" status >/dev/null 2>&1; then
  /usr/lib/postgresql/16/bin/pg_ctl -D "$pgroot" -l "$HOME/.local/share/ai-video-platform/postgres.log" -o "-p 55432 -h 127.0.0.1 -k /tmp" start
fi
redisroot="$HOME/.local/share/ai-video-platform/redis-7.4.7"
if ! "$redisroot/src/redis-cli" -p 56379 ping >/dev/null 2>&1; then
  "$redisroot/src/redis-server" --bind 127.0.0.1 --port 56379 --daemonize yes --appendonly yes --dir "$HOME/.local/share/ai-video-platform"
fi
