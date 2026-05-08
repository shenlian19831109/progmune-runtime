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
exports.runAndCheck = runAndCheck;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function runAndCheck(code) {
    // 把临时文件写入 test-login 目录，使用它的 tsconfig 编译
    const tmpDir = path.resolve("test-login");
    const tmpFile = path.join(tmpDir, "_temp_check.ts");
    fs.writeFileSync(tmpFile, code);
    try {
        (0, child_process_1.execSync)(`npx ts-node --project ${tmpDir}/tsconfig.json ${tmpFile}`, {
            timeout: 5000,
            encoding: "utf-8",
        });
        fs.unlinkSync(tmpFile);
        return { success: true };
    }
    catch (e) {
        if (fs.existsSync(tmpFile))
            fs.unlinkSync(tmpFile);
        return { success: false, error: e.stderr?.toString() || e.toString() };
    }
}
