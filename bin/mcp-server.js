#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');
const script = path.resolve(__dirname, '../src/mcp-server.ts');
execSync(`npx ts-node "${script}"`, { stdio: 'inherit' });
