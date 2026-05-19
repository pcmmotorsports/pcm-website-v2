# Phase 1 安全檢查時序統一表(Security Timeline)

> **Status:** 🟢 拍板 / 2026-05-01 / C4=C 三權分立
> **拍板人:** Sean(C4 拍板選 C 三權分立)
> **層級:** docs/architecture/、衝突仲裁僅次 STATUS.md / NORTHSTAR / 0002-0003 ADR、本檔在 ADR 之下、`CLAUDE.md`「Server 端鐵則」之上
> **本檔角色:** Phase 1 安全議題唯一規劃文件、各 milestone 對應條目進驗收條件、M-6 整合驗收回查
>
> 配合閱讀:
> - `CLAUDE.md`「Server 端鐵則(會員與價格)」(本檔對應其字面、不複製)
> - `docs/lessons-learned.md` §6 GitHub 認證、附錄 A 第一輪事件年表(2026-04-23 RLS / SSH 全切)
> - `docs/decisions/0002-architecture-pivot.md` §4.2(依賴規則 ESLint 守門)
> - `docs/decisions/0003-domain-entity-naming.md` §4(9 衝突處置表、第 6 條三層價格)
> - `docs/PHASE-1-MILESTONES.md`(各 milestone 範圍、本檔 §3 對應)
> - `docs/patterns/slice-checkpoint.md`(L1/L2/L3 三層保險、本檔 §5 對應)
> - `docs/tools-and-skills.md` §6 Supabase RLS 段
> - `docs/phase-1-backlog.md` #4(GCP SA JSON 路徑)、#7(GitHub Actions CI gate L3)

---

## §1 Why(背景)

### 1.1 C4 拍板 C 三權分立的理由

C4 議題是「Phase 1 安全檢查項目該怎麼分布」。三候選:

- **A — 散落各 milestone 各自處理**:每個 milestone 自己管自己的安全項、無集中規劃
- **B — 全部擠到 M-6 上線前一週驗**:集中但太晚、發現問題已無 buffer 修
- **C — 三權分立**(本檔採用):規劃集中(本檔)、執行分散(各 milestone 驗收條件)、整合收網(M-6-08 上線前 checklist 全項回查)

選 C 的本質:**安全議題在「規劃是否周全」與「執行是否落地」是兩件事、不該綁同一個 milestone**。本檔負責規劃集中、各 milestone 負責執行分散、M-6-08 負責收網漏網。

### 1.2 第一輪教訓(本檔起點)

- **2026-04-23 Supabase RLS 警告事件**:Supabase Dashboard 寄 150 筆 advisor 警告、表全部 RLS 未開、緊急開啟 + 密碼重設(`docs/lessons-learned.md` 附錄 A)
- **2026-04-23 GitHub token 洩漏 + SSH 全切**:Sean 貼 `git remote -v` 含 embedded `ghp_` token 進對話、立即 revoke + 全切 SSH(`docs/lessons-learned.md` §6.2、附錄 A)

兩事件**同一天觸發、都是「散落各時點才發現」的代表**。本檔目的就是預先排程、把安全項排進各 milestone 驗收、不靠運氣。

### 1.3 三級會員與經銷價洩漏鐵則

`CLAUDE.md`「Server 端鐵則(會員與價格)」段已明文:

- 會員等級驗證**必在 server 端重新檢查**、不信任 client 送的欄位
- Client component **不得 import** `@/lib/prisma` 或任何洩漏經銷價的模組
- 經銷價**絕不傳到一般會員瀏覽器**
- 金額用整數(分 / 角)或 `Decimal`、**禁用 `number` 處理價格**(浮點誤差)

這條鐵則是合規紅線、不能等 M-6 才驗。本檔 §3 把它拆解到對應 milestone 的執行條目。

### 1.4 本檔不重複描述、用對應索引

本檔不重新定義「Server 端鐵則」「SSH only」等字面、那些字面在 `CLAUDE.md` / `lessons-learned.md` / 0002-0003 ADR / `tools-and-skills.md` 已是真權威。本檔只做兩件事:

1. **時序排程**:把已存在的鐵則對應到 M-0 ~ M-6 各 milestone 的執行時點
2. **對應索引**(§4):每項列出權威來源、避免重複維護字面

---

## §2 安全檢查項目分類

依議題本質分 6 類(類別字母在 §3 主表用作 ID prefix):

| 類 | 名稱 | 涵蓋 |
|---|---|---|
| **A** | 認證與授權 | 登入 / session / RLS / role-based 權限 |
| **B** | 資料驗證 | server-side validation / 金額型別 / 輸入消毒 |
| **C** | 敏感資訊保護 | env / token / 經銷價洩漏 / PII / 第三方 SA key |
| **D** | 依賴安全 | npm audit / Snyk / dependency drift |
| **E** | OWASP Top 10 | XSS / CSRF / SQL Inject / SSRF / 安全 header |
| **F** | 部署與基礎建設 | SSH / production secret / network egress / CI gate |

---

## §3 安全檢查時序統一表(主表)

順序按啟動時機(milestone)排、相同時機按類別 A/B/C/D/E/F 排。

| # | 類 | 檢查項 | Owner Milestone | 啟動時機(slice) | 驗收條件(可驗) | 對應權威來源 | M-6-08 回查 |
|---|---|---|---|---|---|---|---|
| **A1** | A | Supabase RLS 全表 enable(走「開 RLS 不寫 policy + Medusa service role bypass」策略) | M-0 | setup 階段已啟動、M-0-08 確認字面歸位 | Supabase Dashboard advisor 0 筆 RLS 未開警告 | `tools-and-skills.md` §6.2 + `lessons-learned.md` 附錄 A 04-23 | ✅ |
| **C1** | C | `.env` 全 key 不入 git、`.gitignore` 全 repo 掃過(含子 package) | M-0 | setup 階段已啟動、M-0-08 確認 | `git ls-files` 不含任何 `.env*`(除 `.env.example` template);grep 全 repo 無 `ghp_` / `sk_` 字面 | `lessons-learned.md` §6.2 + 附錄 A 04-23 token 事件 | ✅ |
| **C2** | C | GCP Service Account JSON 路徑規範(放 `~/Documents/pcm-credentials/`、不入 repo) | M-0 規劃 → M-5-02 落地 | 本檔記錄、`docs/patterns/credentials-management.md` 待寫(backlog #4) | 規範文件存在、sync-engine 用 `GCP_CREDENTIALS_PATH` 環境變數讀 | `phase-1-backlog.md` #4 | ✅ |
| **D1** | D | `npm audit` 進 CI gate 規劃(實際落地在 backlog #7 GitHub Actions slice) | M-0 規劃 → backlog #7 落地 | 本檔記錄、未來 L3 slice 落地 | `npm audit` 在 CI workflow 跑、高危 CVE 必修或進 backlog 認證可接受 | `phase-1-backlog.md` #7、`slice-checkpoint.md` §6 | ✅ |
| **F1** | F | SSH only、兩 repo remote 皆 `git@github.com:...` 格式、無 `ghp_` token | M-0 | setup 階段已啟動、每 slice 起手檢查覆驗 | `git remote -v \| grep -v ghp_` 全 SSH 格式;`ssh -T git@github.com` 通 | `lessons-learned.md` §6.1 + 附錄 A 04-23 SSH 全切 | ✅ |
| **B1** | B | packages 邊界 import 規則 ESLint 守門(`domain ← ports ← use-cases ← adapters / apps`、`ui` / `schemas` 不 import domain) | M-1 | M-0-03(已建)、M-1 起每 slice 受守 | `pnpm lint` 對刻意違規 import 跳錯;`docs/architecture/dependency-rules.md`(待寫、M-0-03) | `0002-architecture-pivot.md` §4.2 | ✅ |
| **C3** | C | client component 不得 import server-only module(經銷價防洩漏鐵則)、用 TypeScript `package.json#exports` + path alias 阻擋 | M-1 | M-1 任一 client component slice、M-1-14 Customer adapter 同步 | client bundle grep 無 `prisma` / `@/lib/server-only` 字面;TS exports 阻擋 server module 對 client 可見 | `CLAUDE.md`「Server 端鐵則 § 敏感資訊」 | ✅ |
| **C4** | C | product 經銷價欄位設計(`product.priceByTier: Map<MemberTier, Money>`、不直接 expose 給一般客人) | M-1 schema → M-2 落地 | M-0-05/06 schema design 含、M-1-02 domain entity、M-2-08 Pricing Price List | domain entity `priceByTier` 不在 client wire response、server-side render 後才傳對應 tier 的 price | `0003-domain-entity-naming.md` §4 第 6 條 + `CLAUDE.md`「Server 端鐵則」 | ✅ |
| **A2** | A | Customer 認證 server-side 驗證(login / register、不信任 client) | M-2 | M-1-14 Customer adapter、M-2-01 tier 落地 | login / register API 必過 server-side schema 驗;失敗 audit log | `CLAUDE.md`「Server 端鐵則 § 三級會員價格驗證」 | ✅ |
| **A3** | A | `customer.tier` 欄位 server-side 驗(client 送 tier 一律 ignore、server 從 DB 重新查) | M-2 | M-2-02(server-side tier 驗證 use-case) | client devtools 改 tier header / cookie 不影響 server 回的價;server 重查 customer.tier | `CLAUDE.md`「Server 端鐵則 § 三級會員價格驗證」 | ✅ |
| **B2** | B | 經銷價 server-side 重新驗(client 送的價格不信、server 從 customer.tier 重新算) | M-2 | M-2-09(tier-aware price 顯示) | client 送 price 欄位 server 一律忽略;cart 加 line item 時 server 從 product.priceByTier × customer.tier 重算 | `CLAUDE.md`「Server 端鐵則 § 三級會員價格驗證」 | ✅ |
| **B3** | B | 金額型別:整數(分 / 角)或 `Decimal`、禁 `number`(浮點誤差) | M-2 | M-2-08(Pricing Price List)、貫穿 M-3 cart / order | domain Money type 為整數或 Decimal;TS lint rule 阻擋 number 處理 price 欄位(候選、Phase 1 靠 review) | `CLAUDE.md`「Server 端鐵則 § 三級會員價格驗證」 | ✅ |
| **C5** | C | Supabase RLS policy 寫 customer / customer_group 表(M-2 起 RLS 從 enable-only 升級為有 policy、tier 驗證依賴) | M-2 | M-2-01 / M-2-02 同步 | customer 表 RLS policy 限「自己只能看自己的 tier」;Medusa service role bypass 但其他 role 受 policy | `tools-and-skills.md` §6.2 + `CLAUDE.md`「Server 端鐵則」 | ✅ |
| **A4** | A | cart / order 認證 server-side(客人不能改別人的 order) | M-3 | M-3-04(Order adapter)、M-3-06(CartPage) | order API 必過 server-side customer ownership check;改別人的 order ID 回 403 | `CLAUDE.md`「Server 端鐵則」 | ✅ |
| **B4** | B | cart 金額 server-side 重算(client 送的小計不信、server 從 line items 重算) | M-3 | M-3-05(calculate-shipping use-case)、M-3-06(CartPage) | client 送 cart.total server 一律重算;運費 / 稅金 / 折扣 server 端決定 | `CLAUDE.md`「Server 端鐵則」 | ✅ |
| **B5** | B | TapPay sandbox prime 驗證(server 端解密、不從 client 信任 amount) | M-3 | M-3-08(TapPay sandbox 整合) | TapPay prime + amount 由 server 端比對 cart 總額;不直接信任 client 傳的 amount;失敗 audit log | `CLAUDE.md`「Server 端鐵則」+ TapPay 官方文件 | ✅ |
| **C6** | C | TapPay App Key / Partner Key 在 `.env`、不入 git、不貼對話 | M-3 | M-3-08 同步 | `git ls-files` 不含 TapPay key;Vercel / Railway env vars dashboard 設定;對話無 key 字面 | `CLAUDE.md`「敏感資訊」+ C1 同類 | ✅ |
| **C7** | C | 訂單號 / 客人手機 / 地址 PII server-side 才能查全、列表頁只回部分遮蔽 | M-3 | M-3-04(Order adapter)、M-3-09(訂單詳情) | 列表 API 回的 customer 物件遮蔽手機(09xx****56)/ 地址(僅縣市);詳情 API 才回全字面、且必過 ownership check | `vehicle-service-ecosystem.md` §11.3 隱私原則 | ✅ |
| **A5** | A | admin 員工權限 server-side enforce(M-4a-13 UI disabled 不夠、M-4b-01 server-side 再驗) | M-4a / M-4b | M-4a-13(UI disabled)、M-4b-01(server-side enforce) | 員工 API 直接打受限 endpoint(繞過 UI)、server 拒絕並 audit log | `PHASE-1-MILESTONES.md` M-4b §9.7 | ✅ |
| **A6** | A | 改金額紅線 server-side enforce、集中 use-case `packages/use-cases/update-product-price.ts`、`role !== 'sean'` 直接 reject + audit log | M-4a / M-4b | M-4a-13(UI disabled)、M-4b-03(改金額審核 workflow) | 員工身分打 update-price API 一律 reject;Sean 身分通過;每次成功 / 失敗都 audit log | `PHASE-1-MILESTONES.md` M-4b §9.7 + `CLAUDE.md`「Server 端鐵則」 | ✅ |
| **C8** | C | admin / inbox 客服訊息含 PII、log 不留全字面 | M-4a | M-4a-12(客服分頁) | server log 對 LINE / Email / 電話內容做欄位遮蔽;debug log 不含全 PII | C7 同原則 + `vehicle-service-ecosystem.md` §11.3 | ✅ |
| **C9** | C | GCP Service Account JSON 不入 repo、走環境變數 `GCP_CREDENTIALS_PATH` | M-5 | M-5-02(sheets-api adapter) | sync-engine 啟動時讀 `GCP_CREDENTIALS_PATH`、檔案存於 `~/Documents/pcm-credentials/`、不在 repo;`git ls-files` 不含 `.json` SA key | `phase-1-backlog.md` #4 + C2 對應規範 | ✅ |
| **C10** | C | Google Sheets API scope 最小權限(只讀範本 sheet、不全 drive) | M-5 | M-5-02 同步 | GCP Console 上 SA scope 為 `spreadsheets.readonly` + 限定 sheet ID;不要 `drive` 全域 | GCP IAM 最佳實務 + `phase-1-backlog.md` #4 | ✅ |
| **F2** | F | sync-engine 在本機機器、network egress 限縮到 sheets API + Supabase domain | M-5 | M-5-01(sync-engine 骨架) | sync-engine 啟動文件規範 outbound 連線;若日後 firewall 設定、列入 `apps/sync-engine/README` | `tools-and-skills.md` §1 sync-engine 段(本機機器設定) | ✅ |
| **D2** | D | `npm audit` 全綠、有高危 CVE 必修或 backlog 條目認證可接受 | M-6 | M-6-08(上線前 checklist) | `pnpm audit` 高危 0 筆、中危進 backlog 認證、低危觀察 | `phase-1-backlog.md` #7 + D1 對應 | ✅ |
| **E1** | E | OWASP Top 10 自驗 checklist(XSS / CSRF / SQL Inject / 安全 header / SSRF / 認證錯誤處理 / 加密傳輸 / 不安全反序列化 / 已知漏洞元件 / 監控不足) | M-6 | M-6-08(上線前 checklist) | 10 條每條手驗、結果寫進 `docs/security/owasp-2026-q3.md`(M-6-08 產出) | OWASP Top 10 (2021) 公開 checklist | ✅ |
| **E2** | E | 安全 header(CSP / HSTS / X-Frame-Options / X-Content-Type-Options)Vercel 設定 | M-6 | M-6-06(Vercel production env vars + 安全 header) | `next.config.js` headers() 設定 4 條 header;Vercel preview URL 用 securityheaders.com 跑 A 級 | Next.js / Vercel 官方安全 header 文件 | ✅ |
| **F3** | F | Vercel production env vars 完整檢查 | M-6 | M-6-06 同步 | M-6-08 checklist 對 Vercel env vars 全項勾;漏一條 build 過但 runtime 出錯(對齊 §10.7 風險 2) | `PHASE-1-MILESTONES.md` M-6 §10.7 | ✅ |
| **F4** | F | Railway production env vars 完整檢查 | M-6 | M-6-07(Railway production env vars) | M-6-08 checklist 對 Railway env vars 全項勾;Medusa 啟動所需 env(DATABASE_URL / JWT_SECRET / COOKIE_SECRET 等)無漏 | `PHASE-1-MILESTONES.md` M-6 §10.7 + M-3-01 setup | ✅ |
| **F5** | F | production 上線前 production secret 全部換新、不沿用 dev / sandbox key | M-6 | M-6-08(上線前 checklist) | TapPay 切 production key、Supabase production project key、所有 env 對齊 production scope;dev / sandbox key 不殘留 | `CLAUDE.md`「敏感資訊」+ NORTHSTAR §1.2 上線時切 production | ✅ |
| **F6** | F | Supabase 升 Pro $25/月(DB 8GB / bandwidth 250GB / Storage 100GB / pg_jieba extension)、search 切 tsvector + pg_jieba | M-6 | M-6-08(上線前 checklist) | Sean 在 Supabase Dashboard 完成升級、checklist 確認 plan = Pro;升 Pro 後 search 切 tsvector + pg_jieba(對齊 medusa-schema-design.md §2.5 兩階段切換要點) | ADR-0004 Q1=A2 + Q2=A2 + Q3=A1、`docs/phase-1-backlog.md` #57 ✅ | ✅ |

**總計 31 條安全檢查項**:M-0 = 5、M-1 = 3、M-2 = 5、M-3 = 5、M-4a/4b = 3、M-5 = 3、M-6 = 7。

---

## §4 跟 CLAUDE.md / lessons-learned 對應索引

本檔不複製字面、只引用權威來源。對應索引避免重複維護:

| 本檔項目 | 權威來源 | 字面位置 |
|---|---|---|
| 三級會員價格 server-side 驗(A2 / A3 / B2) | `CLAUDE.md` | 「Server 端鐵則(會員與價格)」§ 三級會員價格驗證 |
| 金額用整數 / Decimal、禁 number(B3) | `CLAUDE.md` | 「Server 端鐵則」§ 敏感資訊 / 三級會員價格驗證 |
| env / token 不入 git、不貼對話(C1 / C6 / C9) | `CLAUDE.md` + `lessons-learned.md` | `CLAUDE.md`「敏感資訊」+ `lessons-learned.md` 附錄 A 04-23 |
| SSH only、不貼 `ghp_` token(F1) | `lessons-learned.md` | §6.1 + 附錄 A 04-23 SSH 全切 |
| RLS 起手 enable(M-0 A1)→ M-2 起加 policy(C5) | `tools-and-skills.md` + `lessons-learned.md` | `tools-and-skills.md` §6.2 + `lessons-learned.md` 附錄 A 04-23 |
| client 不 import server module(C3) | `CLAUDE.md` | 「Server 端鐵則 § 敏感資訊」 |
| 經銷價 priceByTier 不洩漏(C4) | `0003-domain-entity-naming.md` + `CLAUDE.md` | `0003` §4 第 6 條 + `CLAUDE.md`「Server 端鐵則」 |
| packages 邊界 import 守門(B1) | `0002-architecture-pivot.md` | §4.2 依賴規則(由 ESLint 守門) |
| GCP SA JSON 路徑規範(C2 / C9) | `phase-1-backlog.md` | #4 GCP JSON key 路徑安全規範 |
| dependency audit 進 CI(D1 / D2) | `phase-1-backlog.md` + `slice-checkpoint.md` | #7 GitHub Actions CI gate L3 + §6 三層保險 |
| 訂單 / 客戶 PII 隱私(C7 / C8) | `vehicle-service-ecosystem.md` | §11.3 隱私原則 |
| 改金額紅線 server-side enforce(A6) | `PHASE-1-MILESTONES.md` | M-4b §9.7 |
| 員工權限 server-side enforce(A5) | `PHASE-1-MILESTONES.md` | M-4b §9.7 |
| Vercel / Railway env vars 完整檢查(F3 / F4) | `PHASE-1-MILESTONES.md` | M-6 §10.7 風險 2 |
| production 上線時切 production key(F5) | `PHASE-1-NORTHSTAR.md` | §1.2 不做(Phase 1 用 sandbox)+ 上線時切 production |

---

## §5 與 L1/L2/L3 三綠 checkpoint 的關係

### 5.1 兩個 timeline 的層級

| Timeline | 關注 | 機制 | 落點 |
|---|---|---|---|
| **三綠 checkpoint**(`slice-checkpoint.md`) | typecheck + lint + build 工程綠燈 | L1(規則層、Code 自律)→ L2(busboy-end pre-flight、M-0-09)→ L3(GitHub Actions、backlog #7) | slice 邊界 |
| **本檔 安全 timeline** | 安全議題 milestone 落地 | 規劃集中(本檔)→ 執行分散(各 milestone 驗收)→ 收網(M-6-08) | milestone 邊界 |

兩個 timeline **層級不同**:三綠 checkpoint 在每個 slice 結束前自動跑、本檔安全 timeline 在每個 milestone 完成時對應驗收。

### 5.2 兩個 timeline 的交集點

大多數安全檢查項目落在 server-side 行為驗證(本檔 §3)、跟 typecheck / lint / build 工程綠燈不重疊。但有兩處明確交集:

- **§3.B1 packages 邊界 import 守門** = 由 L1 ESLint 規則守門、L2 busboy-end pre-flight 跑 lint 攔、L3 CI gate 終驗 → 三綠 checkpoint 直接守
- **§3.D 依賴安全(D1 / D2)** = 由 L3 CI gate 自動跑 `npm audit` 攔(backlog #7)、本檔記錄 M-0 規劃 + M-6 終驗

其他安全項目(A / B 主體、C 大部分、E / F)是 runtime 行為或文件規範、三綠 checkpoint 抓不到、必須靠各 milestone 對應 slice 的驗收條件 + M-6-08 全項回查。

### 5.3 為什麼安全 timeline 不直接靠三綠 checkpoint

三綠 checkpoint 是「工程綠燈」、抓的是 type / lint / build error。但安全議題大多是:

- **語意正確**:server-side 驗證有沒有真的重新查 DB(type 過但邏輯錯)
- **行為正確**:client 改 tier 後 server 是不是真的 ignore(type 過但實作 honor)
- **配置正確**:`.env` key 有沒有真的入 git(type 不管文件)
- **整合正確**:Vercel env vars 有沒有真的設(本地 build 過但 production 缺)

這些都需要 milestone 驗收 / M-6-08 整合驗收才能 catch、不是 typecheck 能涵蓋。**兩個 timeline 互補、不重疊**。

---

## §6 三視角檢查

| 視角 | 理由 |
|---|---|
| **擴充性** | Phase 2 啟動時直接接續本表、9 大藍圖每個 context 加新檢查項 append 即可、舊條不重整。Vehicle / Booking / Wallet / Shop 4 個 Phase 2 主 context 加進來時、各自走「新增 §3 主表條目 + §4 對應索引 + M-N 整合驗收」三步、不重寫本檔結構 |
| **可維護性** | 一份文件 single source of truth、`CLAUDE.md` / `lessons-learned.md` / 0002-0003 ADR / `backlog` 對應索引(§4)避免重複維護字面。權威來源變動時、只動權威來源檔、本檔索引指向不變;若索引指向 stale、grep 全 repo 找本檔可立即覆驗 |
| **bug 可追蹤性** | 每項有 owner milestone + 啟動時機 + 驗收條件、出事查本表立即知道哪個 milestone 應該 catch、責任明確。事故發生時、grep 本檔找對應條目、查該 milestone 是否已落地、若已落地查驗收條件是否真的驗、若未落地查為何延遲、責任鏈不混淆 |

---

## §7 不在本檔範圍(劃線)

以下項目**本檔不規劃、不混入**(避免本檔被誤用為其他 ADR 替代):

- **業務邏輯**(訂單流程 / 權限規則 / 價格規則本身):屬 `docs/decisions/` 與 `docs/features/`、本檔只管「規則的安全執行邊界」、不管規則本身
- **視覺 / 結構 / 路由 / 元件命名**:屬 `design-reference/` submodule(視覺真權威)、本檔不管 UI 安全感觀
- **Phase 2 9 大藍圖功能**(車輛履歷 / 店家端 / 預約 / 保養提醒等):屬 `PHASE-2-VISION.md` / `vehicle-service-ecosystem.md`、本檔僅 Phase 1 範圍、Phase 2 啟動時擴本檔 §3 加新條
- **第三方 SaaS 自身安全**(Supabase / Vercel / Railway / TapPay 內部安全):信任供應商、本檔只管 PCM 端配置(env / API key / scope / endpoint)、不對供應商內部安全做斷言
- **員工內部安全教育**(釣魚信 / 社交工程 / 密碼管理習慣):非工程範圍、Sean 內部訓練負責、本檔不規劃
- **L3 CI gate 實作細節**(`.github/workflows/ci.yml` 寫法):屬 backlog #7 未來 slice、本檔僅做 D1 規劃記錄、不展開 workflow 字面
- **L2 busboy-end pre-flight 實作細節**(`pcm-tools/scripts/busboy-end.js` 改動):屬 M-0-09 slice、本檔僅 §5 引用 L2 機制、不展開腳本字面

---

## §8 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 2026-05-01 | 初始化 security-timeline.md(C4 拍板 C 三權分立、§3 主表 30 條 M-0~M-6、§4 對應索引、§5 與三綠 checkpoint 關係、§6 三視角、§7 劃線) | Claude.ai + Sean / 由 Claude Code(M-0-08)落地 |
| 2026-05-03 | §3 主表加 #F6 Supabase 升 Pro trigger(M-6-08、對齊 ADR-0004 Q1=A2);總計 30 → 31 條、M-6 6 → 7 條 | Claude Code(M-0-10c) |
| 2026-05-19 | #C4 落地補強:base `products` 表改欄位級 GRANT(migration `20260519031049`、REVOKE 整表 ALL、column-GRANT 14 公開欄)、阻 anon / authenticated 繞 `products_public` view 直取 `price_by_tier` / `price_store` / `metadata` | Claude Code(Codex 審查後續處置 Slice A) |

— 文件結束 —
