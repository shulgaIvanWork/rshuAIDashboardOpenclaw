#!/bin/bash
# Watchdog: перезапускает сервера если упали
for port in 3000 3001; do
  if ! curl -sf -o /dev/null "http://127.0.0.1:$port/" --connect-timeout 3; then
    echo "[$(date)] Port $port DOWN, restarting..."
    if [ "$port" = "3000" ]; then
      cd /root/.openclaw/workspace/projects/web-interface
      node server.js > /tmp/clover-web.log 2>&1 &
      echo "[$(date)] Web-interface restarted, PID: $!"
    elif [ "$port" = "3001" ]; then
      cd /root/.openclaw/workspace/projects/rshu-dashboard
      node server.js > /tmp/rshu-dashboard.log 2>&1 &
      echo "[$(date)] Dashboard restarted, PID: $!"
    fi
  fi
done
