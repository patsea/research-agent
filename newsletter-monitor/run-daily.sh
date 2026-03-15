#!/bin/bash
LOCKFILE="/tmp/newsletter-monitor-$(date +%Y%m%d).lock"
[ -f "$LOCKFILE" ] && echo "Already ran today" && exit 0
touch "$LOCKFILE"
curl -s -X POST http://localhost:3041/api/run \
  -H "Content-Type: application/json" \
  -d '{"daysBack":1}' >> /tmp/jsa-newsletter-monitor.log 2>&1
echo "Run triggered at $(date)" >> /tmp/jsa-newsletter-monitor.log
