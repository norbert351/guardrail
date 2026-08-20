#!/usr/bin/env bash
# GuardRail public preview tunnel for :3050
set -e
cloudflared tunnel --url http://127.0.0.1:3050 --no-autoupdate 2>&1
