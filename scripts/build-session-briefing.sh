#!/bin/bash
set -euo pipefail
mkdir -p /root/overlord/logs
# Keep this shim log scoped to the current run so stale lines cannot trip cron-health.
: > /root/overlord/logs/session-briefing.log
cd /root/overlord
node scripts/build-session-briefing.mjs
mkdir -p data/cron-heartbeats
date +%s > data/cron-heartbeats/session-briefing
