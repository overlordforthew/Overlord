#!/bin/bash
set -euo pipefail
cd /root/overlord
node scripts/build-session-briefing.mjs
mkdir -p data/cron-heartbeats
date +%s > data/cron-heartbeats/session-briefing
