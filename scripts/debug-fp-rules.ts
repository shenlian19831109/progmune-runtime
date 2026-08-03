#!/usr/bin/env npx ts-node
import { detectSafeguardViolations, detectProtocolViolations, SafeguardViolation, ProtocolViolation } from "../src/protocol-detector";

const calls = ["pg_getnameinfo_all", "pg_getaddrinfo_all", "socket", "errcode_for_socket_access", "bind", "connect", "send", "recv"];
const sv = detectSafeguardViolations(calls, "ident_inet", "c");
const pv = detectProtocolViolations(calls);

console.log("ident_inet:");
console.log("  Safeguards:", sv.map((v: SafeguardViolation) => `${v.rule} [${v.category}]`).join("; ") || "none");
console.log("  Protocols:", pv.map((v: ProtocolViolation) => `${v.protocol}: ${v.detail}`).join("; ") || "none");
