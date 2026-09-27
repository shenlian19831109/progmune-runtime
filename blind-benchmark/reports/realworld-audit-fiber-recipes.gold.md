# Real-World Audit — fiber @ fiber-recipes

> 语料：./benchmarks/go-apps/fiber-recipes（vendored ./benchmarks/go-apps/fiber-recipes）。生成：2026-09-05。
> 方法：真实语料 → 检测器扫描 → **逐条人工金标标注** → 反证实验。

## 扫描

| 项 | 值 |
|----|----|
| 文件 | 369 |
| 路由/过程 | 0 |
| issues | 60 {"FIBER_ROUTE_NO_AUTH":60} |

## 逐条标注（人工）

| # | 规则 | 路由 | 文件 | 标注(TP/FP/加固类/能力令牌) | 依据 |
|---|------|------|------|------------------------------|------|
| 1 | FIBER_ROUTE_NO_AUTH | POST /enqueue |  |  | 
| 2 | FIBER_ROUTE_NO_AUTH | POST /messages |  |  | 
| 3 | FIBER_ROUTE_NO_AUTH | POST /events/results |  |  | 
| 4 | FIBER_ROUTE_NO_AUTH | POST /books |  |  | 
| 5 | FIBER_ROUTE_NO_AUTH | PUT /books |  |  | 
| 6 | FIBER_ROUTE_NO_AUTH | DELETE /books |  |  | 
| 7 | FIBER_ROUTE_NO_AUTH | POST /v1/books |  |  | 
| 8 | FIBER_ROUTE_NO_AUTH | POST /logout |  |  | 
| 9 | FIBER_ROUTE_NO_AUTH | POST  |  |  | 
| 10 | FIBER_ROUTE_NO_AUTH | PUT /:userID |  |  | 
| 11 | FIBER_ROUTE_NO_AUTH | DELETE /:userID |  |  | 
| 12 | FIBER_ROUTE_NO_AUTH | POST /verify/send/:email |  |  | 
| 13 | FIBER_ROUTE_NO_AUTH | POST /verify/check/:email/:code |  |  | 
| 14 | FIBER_ROUTE_NO_AUTH | POST /create |  |  | 
| 15 | FIBER_ROUTE_NO_AUTH | PUT /update/:id |  |  | 
| 16 | FIBER_ROUTE_NO_AUTH | DELETE /delete/:id |  |  | 
| 17 | FIBER_ROUTE_NO_AUTH | POST /create |  |  | 
| 18 | FIBER_ROUTE_NO_AUTH | PUT /update/:id |  |  | 
| 19 | FIBER_ROUTE_NO_AUTH | DELETE /delete/:id |  |  | 
| 20 | FIBER_ROUTE_NO_AUTH | POST /ciao |  |  | 
| 21 | FIBER_ROUTE_NO_AUTH | POST message |  |  | 
| 22 | FIBER_ROUTE_NO_AUTH | POST /api/v1/book |  |  | 
| 23 | FIBER_ROUTE_NO_AUTH | DELETE /api/v1/book/:id |  |  | 
| 24 | FIBER_ROUTE_NO_AUTH | POST /book |  |  | 
| 25 | FIBER_ROUTE_NO_AUTH | PUT /book/:id |  |  | 
| 26 | FIBER_ROUTE_NO_AUTH | DELETE /book/:id |  |  | 
| 27 | FIBER_ROUTE_NO_AUTH | POST /book |  |  | 
| 28 | FIBER_ROUTE_NO_AUTH | PUT /book/:id |  |  | 
| 29 | FIBER_ROUTE_NO_AUTH | DELETE /book/:id |  |  | 
| 30 | FIBER_ROUTE_NO_AUTH | POST / |  |  | 
| 31 | FIBER_ROUTE_NO_AUTH | POST /products |  |  | 
| 32 | FIBER_ROUTE_NO_AUTH | DELETE /products/{code} |  |  | 
| 33 | FIBER_ROUTE_NO_AUTH | PUT /products |  |  | 
| 34 | FIBER_ROUTE_NO_AUTH | POST /upload |  |  | 
| 35 | FIBER_ROUTE_NO_AUTH | POST /upload |  |  | 
| 36 | FIBER_ROUTE_NO_AUTH | POST /employee |  |  | 
| 37 | FIBER_ROUTE_NO_AUTH | PUT /employee/:id |  |  | 
| 38 | FIBER_ROUTE_NO_AUTH | DELETE /employee/:id |  |  | 
| 39 | FIBER_ROUTE_NO_AUTH | POST /employee |  |  | 
| 40 | FIBER_ROUTE_NO_AUTH | PUT /employee/:id |  |  | 
| 41 | FIBER_ROUTE_NO_AUTH | DELETE /employee/:id |  |  | 
| 42 | FIBER_ROUTE_NO_AUTH | POST /employee |  |  | 
| 43 | FIBER_ROUTE_NO_AUTH | PUT /employee/:id |  |  | 
| 44 | FIBER_ROUTE_NO_AUTH | DELETE /employee/:id |  |  | 
| 45 | FIBER_ROUTE_NO_AUTH | POST /posts |  |  | 
| 46 | FIBER_ROUTE_NO_AUTH | DELETE /posts/:id |  |  | 
| 47 | FIBER_ROUTE_NO_AUTH | PUT /posts/:id |  |  | 
| 48 | FIBER_ROUTE_NO_AUTH | POST /posts |  |  | 
| 49 | FIBER_ROUTE_NO_AUTH | DELETE /posts/:id |  |  | 
| 50 | FIBER_ROUTE_NO_AUTH | PUT /posts/:id |  |  | 
| 51 | FIBER_ROUTE_NO_AUTH | PUT /publish |  |  | 
| 52 | FIBER_ROUTE_NO_AUTH | POST / |  |  | 
| 53 | FIBER_ROUTE_NO_AUTH | POST /books |  |  | 
| 54 | FIBER_ROUTE_NO_AUTH | DELETE /books/:id |  |  | 
| 55 | FIBER_ROUTE_NO_AUTH | POST / |  |  | 
| 56 | FIBER_ROUTE_NO_AUTH | POST / |  |  | 
| 57 | FIBER_ROUTE_NO_AUTH | POST / |  |  | 
| 58 | FIBER_ROUTE_NO_AUTH | POST /temp |  |  | 
| 59 | FIBER_ROUTE_NO_AUTH | POST /api/v1 |  |  | 
| 60 | FIBER_ROUTE_NO_AUTH | POST /test |  |  | 

## 反证实验清单（人工执行）

1. **敏感性**：摘掉某条受保护 mutation 的认证 → 应报（若无反应 = 失明）
2. **0 flags 空洞检查**：语料金标是否全受保护（若全保护则 0 flags 正确；否则漏报）
3. **register/login 公开**：豁免词表是否正确放过
