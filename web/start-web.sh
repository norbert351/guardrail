#!/usr/bin/env bash
# GuardRail web (Next.js) durable daemon on :3050
set -e
cd /home/ubuntu/guardrail/web
if ! ss -tlnp 2>/dev/null | grep -q ':3050'; then
  NODE_ENV=production setsid nohup npx next start -p 3050 > /tmp/guardrail-web.log 2>&1 < /dev/null &
  echo "started web on :3050"
else
  echo "web already up on :3050"
fi
sleep 1
