#!/bin/sh
set -eu
umask 077
backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
backup_file="$backup_dir/aivideo-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U aivideo -d aivideo -Fc > "$backup_file.partial"
mv "$backup_file.partial" "$backup_file"
printf 'Backup saved: %s\n' "$backup_file"
