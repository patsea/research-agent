#!/bin/bash
LOCKFILE="/tmp/podcast-monitor-$(date +%Y%m%d).lock"
[ -f "$LOCKFILE" ] && echo "Already ran today" && exit 0
touch "$LOCKFILE"
cd "$(dirname "$0")"
[ -f .env ] && export $(grep -v '^#' .env | xargs)
/usr/local/bin/node pipeline/run.js >> /tmp/jsa-podcast-monitor.log 2>&1
