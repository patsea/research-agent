#!/bin/bash
LOCKFILE="/tmp/signal-scanner-$(date +%Y%m%d).lock"
[ -f "$LOCKFILE" ] && echo "$(date): Already ran today — skip" && exit 0
touch "$LOCKFILE"
echo "$(date): Starting signal scanner pipeline"
cd "$(dirname "$0")"
node pipeline/run.js >> data/launchd.log 2>> data/launchd.err
echo "$(date): Done (exit $?)"
