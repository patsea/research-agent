#!/bin/bash
LOCKFILE="/tmp/email-scan-$(date +%Y%m%d).lock"
[ -f "$LOCKFILE" ] && echo "$(date): Already ran today — skip" && exit 0
touch "$LOCKFILE"
echo "$(date): Starting email scan"
cd "$(dirname "$0")"
node scan.js >> logs/launchd.log 2>> logs/launchd.err
echo "$(date): Done (exit $?)"
