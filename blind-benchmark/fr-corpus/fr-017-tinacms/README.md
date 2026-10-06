# fr-017 tinacms 快照（2026-10-06）

GHSA-g74q-6g2f-874x —— 访问控制破坏：任意 TinaCloud 用户可对任意 clientId 授权。

- pre 快照 = parent c2c03c677f67b6fd3a2155d5227b9bf785b43288
- post 快照 = fix 0a927a4f8d228dd05ee7ca4be32899bc190e73af
- 真值文件 ×2（@tinacms/auth + next-tinacms-azure，同一缺陷两个变体）：
  - pre-auth-index.ts  / pre-azure-auth.ts —— 修复前：isAuthorized 从
    req.query.clientID / searchParams.get('clientID') 取身份锚点
  - post-auth-index.ts / post-azure-auth.ts —— 修复后：expectedClientID ??
    process.env.NEXT_PUBLIC_TINA_CLIENT_ID，取不到 fail-closed
- 经 GitHub contents API 获取（raw.githubusercontent 本网络不可达时备用通道）

验证记录（2026-10-06）：extractIR 对 4 文件
pre 2/2 命中 __progmune_request_anchored_identity__ / post 0/0。
