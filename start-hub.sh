#!/bin/bash
# Progmune Immune Hub 启动脚本
source ~/.zshrc 2>/dev/null
cd ~/progmune-runtime
nohup /Users/shenlian/.local/node/bin/node server/hub.js > .hub.log 2>&1 &
echo $! > .hub.pid
echo "Progmune Immune Hub started (PID: $(cat .hub.pid))"
