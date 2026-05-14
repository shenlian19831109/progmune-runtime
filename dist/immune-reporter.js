"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFingerprints = extractFingerprints;
exports.reportFingerprints = reportFingerprints;
exports.previewFingerprints = previewFingerprints;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const crypto = __importStar(require("crypto"));
const REPORT_ENDPOINT = process.env.PROGMUNE_HUB || "http://localhost:3000/report";
const FINGERPRINT_FILE = path.resolve(__dirname, "../.progmune_memory/fingerprints.json");
function getInstanceId() {
    const host = require("os").hostname();
    const cwd = process.cwd();
    return crypto.createHash("sha256").update(host + cwd).digest("hex").substring(0, 16);
}
function extractFingerprints() {
    const corpusDir = path.resolve(__dirname, "../failure_corpus");
    if (!fs.existsSync(corpusDir))
        return [];
    const fingerprints = [];
    const instanceId = getInstanceId();
    for (const dateDir of fs.readdirSync(corpusDir)) {
        const datePath = path.join(corpusDir, dateDir);
        if (!fs.statSync(datePath).isDirectory())
            continue;
        for (const file of fs.readdirSync(datePath)) {
            if (!file.endsWith(".json"))
                continue;
            const record = JSON.parse(fs.readFileSync(path.join(datePath, file), "utf-8"));
            const funcSeq = (record.actionSequence || [])
                .filter((a) => a.kind === "call")
                .map((a) => a.function);
            fingerprints.push({
                instance_id: instanceId,
                timestamp: record.timestamp,
                violatedSVL: record.violatedSVL,
                constraintType: record.constraintType,
                functionSequence: funcSeq,
                preState: record.ssgState ? [record.ssgState] : undefined,
                postState: undefined,
                count: 1,
            });
        }
    }
    return fingerprints;
}
async function reportFingerprints() {
    const fingerprints = extractFingerprints();
    if (fingerprints.length === 0) {
        return { success: true, message: "无新指纹需要上报" };
    }
    let reported = [];
    if (fs.existsSync(FINGERPRINT_FILE)) {
        reported = JSON.parse(fs.readFileSync(FINGERPRINT_FILE, "utf-8"));
    }
    const newFingerprints = fingerprints.filter(f => !reported.includes(f.functionSequence.join(",")));
    if (newFingerprints.length === 0) {
        return { success: true, message: "所有指纹已上报，无新增" };
    }
    const payload = JSON.stringify({ fingerprints: newFingerprints });
    return new Promise((resolve) => {
        const url = new URL(REPORT_ENDPOINT);
        const transport = url.protocol === "https:" ? https : http;
        const req = transport.request(REPORT_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => data += chunk);
            res.on("end", () => {
                if (res.statusCode === 200) {
                    const updated = [...reported, ...newFingerprints.map(f => f.functionSequence.join(","))];
                    const dir = path.dirname(FINGERPRINT_FILE);
                    if (!fs.existsSync(dir))
                        fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(FINGERPRINT_FILE, JSON.stringify(updated, null, 2));
                    resolve({ success: true, message: `成功上报 ${newFingerprints.length} 条新指纹` });
                }
                else {
                    resolve({ success: false, message: `上报失败: ${res.statusCode} ${data}` });
                }
            });
        });
        req.on("error", (e) => resolve({ success: false, message: `网络错误: ${e.message}` }));
        req.write(payload);
        req.end();
    });
}
function previewFingerprints() {
    return extractFingerprints();
}
