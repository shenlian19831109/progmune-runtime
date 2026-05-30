#!/usr/bin/env node
const { execSync } = require("child_process");
const path = require("path");
const script = path.resolve(__dirname, "../dist/mcp-server.mjs");
execSync(`node "${script}"`, { stdio: "inherit" });
