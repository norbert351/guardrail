#!/usr/bin/env bash
# GuardRail durable daemons — launched once, survive independent of the
# Hermes session. Restarts x402 merchant + agent supervisor if not running.
set -e
cd /home/ubuntu/guardrail/demo

TSX=./node_modules/.bin/tsx

# 1) x402 merchant on :8787
if ! ss -tlnp 2>/dev/null | grep -q ':8787'; then
  setsid nohup "$TSX" src/x402-server.ts --port=8787 > /tmp/guardrail-x402.log 2>&1 < /dev/null &
  echo "started x402 merchant"
else
  echo "x402 merchant already up"
fi

# 2) agent supervisor loop (every 300s)
if ! pgrep -f 'agent-loop.ts' >/dev/null; then
  setsid nohup "$TSX" src/agent-loop.ts --interval 300 --log /tmp/guardrail-loop.log > /tmp/guardrail-loop-super.log 2>&1 < /dev/null &
  echo "started agent loop"
else
  echo "agent loop already up"
fi

sleep 2
echo "--- listeners ---"
ss -tlnp 2>/dev/null | grep -E ':(3050|8787)\b' | awk '{print $4}' | sort -u
echo "--- procs ---"
ps aux | grep -E 'x402-server|agent-loop' | grep -v grep | awk '{print $2, $11, $12, $13}'
