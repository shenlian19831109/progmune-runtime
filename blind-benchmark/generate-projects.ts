/**
 * Blind Benchmark Project Generator v2
 * Generates ~40 diverse projects with valid TypeScript.
 */

import * as fs from "fs";
import * as path from "path";

const GEN_DIR = path.resolve(__dirname, "generated");

export const TYPES: Array<{ id: string; name: string; entities: string[] }> = [
  { id: "analytics", name: "Analytics API", entities: ["Event","Metric","Dashboard","Report"] },
  { id: "apigateway", name: "API Gateway", entities: ["Route","Cache","Upstream","Policy"] },
  { id: "inventory", name: "Inventory System", entities: ["Item","Stock","Supplier","Warehouse"] },
  { id: "messaging", name: "Email Service", entities: ["Template","Campaign","Subscriber","Bounce"] },
  { id: "notifications", name: "Notification Service", entities: ["Channel","Alert","Preference","Subscription"] },
  { id: "payment", name: "Payment Processor", entities: ["Transaction","Refund","Invoice","Webhook"] },
  { id: "search", name: "Search Engine", entities: ["Index","Query","Facet","Synonym"] },
  { id: "workflow", name: "Workflow Engine", entities: ["Workflow","Step","Instance","Audit"] },
  { id: "githost", name: "Git Host", entities: ["Repo","Branch","Commit","Release"] },
  { id: "xclone", name: "Social Platform", entities: ["Post","Like","Follow","Feed"] },
];

export interface Style {
  id: string; desc: string;
  authFn: string; registerName: string; loginName: string; logoutName: string;
  tokenGen: string; hashing: string; idxPrefix: string; passwordStore: string;
  // Functions that have no auth by design (to test detection)
  noAuthFns: string[];
}

export const STYLES: Style[] = [
  { id: "A", desc: "plain", authFn: "getUser", registerName: "register", loginName: "login", logoutName: "logout",
    tokenGen: `"tok_" + Math.random().toString(36)`, hashing: "none", idxPrefix: "next", passwordStore: "password",
    noAuthFns: ["listEvents","getMetric"],
  },
  { id: "B", desc: "sha256", authFn: "validateSession", registerName: "createAccount", loginName: "authenticate", logoutName: "invalidateSession",
    tokenGen: `"s_" + Date.now().toString(36)`, hashing: "sha256", idxPrefix: "idc", passwordStore: "passwordHash",
    noAuthFns: ["listTemplates","getCampaign"],
  },
  { id: "C", desc: "express", authFn: "verifyToken", registerName: "signup", loginName: "signin", logoutName: "signout",
    tokenGen: `"sess_" + (++seq)`, hashing: "none", idxPrefix: "seq", passwordStore: "password",
    noAuthFns: ["getAllItems","getSupplier","listChannels","getAlert"],
  },
  { id: "D", desc: "enterprise", authFn: "getCurrentUser", registerName: "registerNewUser", loginName: "doLogin", logoutName: "doLogout",
    tokenGen: `"jwt_" + Math.random().toString(36).slice(2)`, hashing: "md5", idxPrefix: "counter", passwordStore: "hashedPassword",
    noAuthFns: ["listWorkflows","getStep","findRepos","getBranch"],
  },
];

// ── Code generators ──

function genAuth(t: typeof TYPES[0], s: Style): string {
  const hasImport = s.hashing !== "none" ? `import * as crypto from "crypto";\n` : "";
  return `${hasImport}// ${t.name} - auth module
interface User { id: string; name: string; email: string; ${s.passwordStore}: string; }
interface Session { token: string; userId: string; }
const allUsers: User[] = [];
const allSessions: Session[] = [];
let ${s.idxPrefix} = 1;

export function ${s.registerName}(name: string, email: string, password: string): User {
  ${s.hashing === "sha256" ? `const hp = crypto.createHash("sha256").update(password).digest("hex");` : s.hashing === "md5" ? `const hp = crypto.createHash("md5").update(password).digest("hex");` : `const hp = password;`}
  const u: User = { id: \`u\${${s.idxPrefix}++}\`, name, email, ${s.passwordStore}: hp };
  allUsers.push(u);
  return u;
}

export function ${s.loginName}(email: string, password: string): Session | null {
  ${s.hashing !== "none" ? `const hp = crypto.createHash("${s.hashing}").update(password).digest("hex");` : `const hp = password;`}
  const u = allUsers.find(x => x.email === email && x.${s.passwordStore} === hp);
  if (!u) return null;
  const sess: Session = { token: ${s.tokenGen}, userId: u.id };
  allSessions.push(sess);
  return sess;
}

export function ${s.authFn}(token: string): User | null {
  const sess = allSessions.find(x => x.token === token);
  if (!sess) return null;
  return allUsers.find(u => u.id === sess.userId) || null;
}

export function ${s.logoutName}(token: string): void {
  const idx = allSessions.findIndex(x => x.token === token);
  if (idx >= 0) allSessions.splice(idx, 1);
}
`;
}

function genEntity(e: string, s: Style, typeId: string): string {
  const lower = e.toLowerCase();
  const plural = lower + "s";
  const prefix = lower[0];

  // Some list/get functions intentionally skip auth
  const listName = s.id === "C" ? `getAll${e}s` : `list${e}s`;
  const deleteName = s.id === "C" ? `remove${e}` : `delete${e}`;
  const listNoAuth = s.noAuthFns.includes(listName);
  const getNoAuth = s.noAuthFns.includes(`get${e}`);

  return `// ${typeId} - ${lower} module
import { ${s.authFn} } from "./auth";

interface ${e} { id: string; title: string; body: string; ownerId: string; createdAt: number; }
const store: ${e}[] = [];
let ${s.idxPrefix} = 1;

export function create${e}(token: string, title: string, body: string): ${e} | null {
  const user = ${s.authFn}(token);
  if (!user) return null;
  const item: ${e} = { id: \`${prefix}\${${s.idxPrefix}++}\`, title, body, ownerId: user.id, createdAt: Date.now() };
  store.push(item);
  return item;
}

export function ${listName}(): ${e}[] {
  ${listNoAuth ? "// Note: intentionally returns all items" : `// Returns all ${plural}`}
  return store;
}

export function get${e}(id: string): ${e} | null {
  ${getNoAuth ? "// Note: no auth check on getter" : `// Returns ${lower} by id`}
  return store.find(x => x.id === id) || null;
}

export function ${deleteName}(token: string, id: string): boolean {
  const user = ${s.authFn}(token);
  if (!user) return false;
  const idx = store.findIndex(x => x.id === id);
  if (idx < 0) return false;
  store.splice(idx, 1);
  return true;
}
`;
}

function genServer(t: typeof TYPES[0], s: Style): string {
  const ents = t.entities.slice(0, 2);
  const imports = ents.map(e => {
    const listFn = s.id === "C" ? `getAll${e}s` : `list${e}s`;
    const delFn = s.id === "C" ? `remove${e}` : `delete${e}`;
    return `import { create${e}, ${listFn}, get${e}, ${delFn} } from "./${e.toLowerCase()}";`;
  }).join("\n");

  const routes = ents.map(e => {
    const p = e.toLowerCase() + "s";
    const listFn = s.id === "C" ? `getAll${e}s` : `list${e}s`;
    const delFn = s.id === "C" ? `remove${e}` : `delete${e}`;
    return [
      `  if (path === "/${p}" && method === "POST") return { data: create${e}(token!, body.title, body.body) };`,
      `  if (path === "/${p}" && method === "GET") return { data: ${listFn}() };`,
      `  if (path.startsWith("/${p}/") && method === "GET") return { data: get${e}(path.split("/")[2]) };`,
      `  if (path.startsWith("/${p}/") && method === "DELETE") return { data: ${delFn}(token!, path.split("/")[2]) };`,
    ].join("\n");
  }).join("\n\n");

  return `// ${t.name} - server entry point
import { ${s.registerName}, ${s.loginName}, ${s.authFn}, ${s.logoutName} } from "./auth";
${imports}

export function handleRequest(method: string, path: string, body: any, token?: string): any {
  if (path === "/register" && method === "POST") return { data: ${s.registerName}(body.name, body.email, body.password) };
  if (path === "/login" && method === "POST") {
    const session = ${s.loginName}(body.email, body.password);
    return session ? { token: session.token } : { error: "Unauthorized", status: 401 };
  }
  if (path === "/logout" && method === "POST") { ${s.logoutName}(token!); return { ok: true }; }

${routes}

  return { error: "Not found", status: 404 };
}
`;
}

// ── Main ──
// Guarded so importing this module (for TYPES/STYLES) does not regenerate projects.

if (require.main === module) {
  // Clean old generated projects
  for (const d of fs.readdirSync(GEN_DIR)) {
    const p = path.join(GEN_DIR, d);
    if (fs.statSync(p).isDirectory() && d.includes("_")) {
      fs.rmSync(p, { recursive: true });
    }
  }

  let count = 0;
  for (const t of TYPES) {
    for (const s of STYLES) {
      const projId = `${t.id}_${s.id}`;
      const dir = path.join(GEN_DIR, projId, "src");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "..", "tsconfig.json"),
        '{"compilerOptions":{"target":"ES2020","module":"commonjs","strict":true,"esModuleInterop":true},"include":["src"]}');
      fs.writeFileSync(path.join(dir, "auth.ts"), genAuth(t, s));
      for (const e of t.entities.slice(0, 2)) {
        fs.writeFileSync(path.join(dir, `${e.toLowerCase()}.ts`), genEntity(e, s, t.id));
      }
      fs.writeFileSync(path.join(dir, "server.ts"), genServer(t, s));
      count++;
    }
  }
  console.log(`Generated ${count} projects (${TYPES.length} types × ${STYLES.length} styles)`);
}
