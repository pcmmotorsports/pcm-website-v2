# M-4a 後台第一期 PRD — 訂單+客戶管理+統一入口(2026-07-12)

> **狀態:定案(Sean 2026-07-12 拍板 Q1=A / Q2=C / Q3=B / Q4=A)、排隊待開工。**
> 真權威鏈:本檔(第一期範圍與新增項)+ `docs/PHASE-1-MILESTONES.md` M-4a 段(413-463 行、原 13 slice 清單)。
> ⚠️ `docs/PROJECT-OVERVIEW.md` 與 `docs/PHASE-2-VISION.md` 內「Medusa Admin」後台字面已被 ADR-0005(`docs/decisions/0005-custom-supabase-direct.md`)推翻,禁引用。
> 鐵則 9:訂單/客戶管理=L3 內容,本 PRD 即為動工前置文件。

---

## 0. 拍板紀錄(2026-07-12)

| 題 | 決定 | 內容 |
|---|---|---|
| Q1 | **A** | 統一入口:登入一次、報價單後台與網站後台兩邊通(SSO,見 §3) |
| Q2 | **C** | 第一期範圍=**訂單管理+客戶管理一起完成才交付**;商品管理/inbox 不在第一期 |
| Q3 | **B** | 全 Claude 實作:實作 session 用 Opus/Sonnet、Fable 只做規劃+高風險審查;**不開 Codex 寫入權限**(維持唯讀審查制度) |
| Q4 | **A** | 排程:先收尾進行中的線(#274 供應商上架、#275 lightech、search-vehicle 四線),後台=下一個 milestone |

補充語意確認(Sean 未反對即採納,開工前可再推翻):訂單「上下移動/插入」**只影響後台顯示順序**,不改訂單編號、成立時間、客人視角任何內容。

## 1. 目標(白話)

Sean 與員工用**同一個登入**進入報價單後台+網站後台;網站後台第一期提供:
1. **訂單管理**:像 Google Sheets 的訂單工作表——上下移動、任意位置插入手動訂單(電話/LINE 單)、取消訂單、看訂單詳情、雙軸狀態篩選。
2. **客戶管理**:客戶列表/搜尋/詳情、會員等級(tier)變更、經銷申請審核。

## 2. 範圍

**做(第一期)**
- M0 入口與地基:`apps/admin` 裝框架、部署、SSO 登入閘
- 訂單線:列表(Sheets 式)+手動排序+手動建單+取消(限未付款單)+詳情+雙軸篩選
- 客戶線:列表+詳情+tier 變更(server-authoritative、順路治本 #215)+經銷申請審核

**不做(第一期明確排除)**
- 商品管理(M-4a-06/07,第二期;商品源頭在報價單庫、每日同步,網站側可編輯面本來就窄)
- admin/inbox 客服(M-4a-12)
- 員工多帳號/角色細分(M-4b,`docs/PHASE-1-MILESTONES.md:549-582`)
- **已付款訂單的取消/退款**:退款走 M-3 乙路後台退款線(另案);第一期「取消」僅限 `payment_status=unpaid` 的單,完全不碰金流寫路徑
- 儲值金 wallet(#202 HOLD,法規未定)

## 3. 架構決策

### 3.1 入口與登入(Q1=A 的實作形)

現況(2026-07-12 偵察,報價單 repo=`/Users/sean_1/API大量上架/PCM報價單-V2`):
- 報價單後台=Next.js 15/Vercel、`quote.pcmmotorsports.com`,登入=全站單一共用密碼(`lib/auth.ts`)+HMAC session cookie `__Host-pcm_sess`(`lib/session.ts`)+選配 TOTP 2FA(`app/admin/security/`、middleware 驗 `amr`)。
- 網站 repo `apps/admin`=空殼(`apps/admin/package.json:5`),ADR-0005 定為 Next.js 自寫。
- 兩邊 Supabase 專案**刻意分離**:報價單 `dllwkkfanaebrsuyuedy` / 網站 `bmpnplmnldofgaohnaok`(`scripts/rpm-import.ts` 有 ALLOWED_TARGET_REF 硬檢查)。**本 PRD 不合併兩庫、不跨庫直寫。**

**推薦方案:甲=短效 token 跳轉 SSO(不共用 cookie)**

- 報價單後台選單加「網站管理」→ 導向 `admin.<domain>/api/sso?token=…`;token=HMAC 簽章短效(≤60s、含 iat/jti/amr;jti=一次性 nonce,收端用過即記錄、重放即拒),密鑰 `SSO_SECRET` 兩專案共享(各自 Vercel env)。
- 網站 admin 驗簽成功→發自己的 `__Host-` session cookie→進 dashboard;反向亦然(網站後台選單放「報價單」)。
- 體驗=登入一次兩邊通(一把鑰匙兩個房間);安全=兩邊 cookie 各自 host-only。

**否決方案:乙=父網域共用 cookie(`Domain=.pcmmotorsports.com`)**

- `__Host-` 前綴 cookie 依規範不得設 Domain,勢必降級為 `__Secure-`+父網域;屆時 `shop.pcmmotorsports.com`(前台、對公網)同網域可見後台 session,前台任何 XSS 即偷到後台門票。風險不成比例,否決。

2FA:沿用報價單後台既有 TOTP;token 內帶 `amr`,admin 側對「敏感操作」(tier 變更、取消訂單)可要求 `amr` 含 totp(開工時定,預設沿用報價單 middleware 同款判斷)。

跨 repo 影響:報價單側需加「簽發 SSO token+選單項」小改動 → **開工時單獨提案給 Sean**(跨 repo 動工需提案,唯讀偵察已完成)。

### 3.2 admin app 部署形

- `apps/admin` 獨立 Next.js app(monorepo 既有 workspace),部署為獨立 Vercel 專案,網域建議 `admin.pcmmotorsports.com`(開工時 Sean 在 Vercel/DNS 操作)。
- 所有資料存取走 server(Route Handler / Server Action)+ `SUPABASE_SECRET_KEY`(server-only);client 不 import 任何 service 模組(沿用 Server 端鐵則)。middleware 全站驗 session,**且每個寫入 handler 內再驗一次**(不信任 middleware 單層)。
- `apps/api` 殼此期不啟用:admin 自帶 route handlers 即可,避免多一層部署面(與 `apps/api/package.json:5` 的 M-1-03 規劃不衝突、留給後續)。

## 4. 訂單管理規格(Sheets 式)

資料現況:`orders`+`order_items`(migration `20260604120000_m3_s2a_orders_order_items.sql`);狀態雙軸 `payment_status`(unpaid/paid/partiallyPaid/refunded)×`fulfillment_status`(notOrdered/ordered/inStock/shipped);**無排序欄、無取消欄、無手動單標記**。

### 4.1 Schema 變更(一支 migration、鐵則 8+12 全套審)

`orders` 新增:

- `display_position numeric NOT NULL`(後台工作排序;新單=現有最大值+固定間隔;插入=取相鄰兩列中點〔fractional index,避免整批重排〕;既有單以 created_at 倒序回填)
- `cancelled_at timestamptz NULL` + `cancelled_reason text NULL`(取消=營運軸獨立欄位,**不動 payment_status**——那軸只記錢的事實)
- `is_manual boolean NOT NULL DEFAULT false` + `manual_note text NULL`(手動單標記;散客免綁會員時 `customer_user_id` 允許 NULL——此欄現況 NOT NULL 與否開工時查 migration 確認,若 NOT NULL 則放寬限 `is_manual=true` 列)

### 4.2 功能

- **列表**:表格,一列=一單;欄:位置把手、單號、日期、客人、品項摘要、金額、付款狀態、出貨狀態、備註。兩種檢視:「工作排序」(display_position)/「時間排序」(created_at);雙軸狀態篩選沿用 M-4a-08 規格(`docs/PHASE-1-MILESTONES.md:413-463`)。
- **上下移動/插入**:拖曳或 ↑↓ 按鈕;「在此列上/下插入」=開手動建單表單、寫入指定 position。
- **手動建單**:`is_manual=true`;客人=選既有會員或散客(姓名/電話文字欄);品項=從商品庫挑(寫 `product_snapshot` jsonb,與結帳線同構)或自由文字行;金額手填(整數、沿用金額鐵則)。**不觸發 TapPay、不產生 payment_charge_attempts、不進對帳/雙扣告警管線**——對帳線(#250 anomaly、W1 報表)必須以 `is_manual=false` 或 rec_trade_id 存在為前提過濾,開工時逐處確認(高風險件 #4)。
- **取消**:限 `payment_status=unpaid` 且未出貨;寫 cancelled_at/reason;列表顯示刪除線+可篩;**不硬刪**(memory 鐵律:孤兒/未付款單不硬刪,late-success 扣款要查得到單)。已付款單顯示「取消需走退款(另案)」。
- **詳情**:單頭+品項+付款紀錄(唯讀)+物流欄;連動 #217(`order_items` 無 `product_id`,`docs/phase-1-backlog.md` L5640,詳情品項連結商品前必解)與 #240(會員端詳情頁,後台版可共用讀取層)。

## 5. 客戶管理規格

資料現況:`customers`(user_id/email/name/phone/birthday/tier/wallet_balance)+`customer_addresses`/`customer_vehicles`/`customer_wallet_ledger`(migration `20260523034911`);tier enum=general/store/premiumStore;規劃字面 `IAdminCustomerRepository`(`docs/specs/m-1-14-customer-schema.md:589`)**未落地**,本期實作它。

- **列表/搜尋**:姓名/電話/email;顯示 tier、訂單數。
- **詳情**:基本資料、地址、車庫、訂單歷史(連回訂單詳情)。
- **tier 變更**:server route 內以 service key 寫,寫入審計(誰、何時、從/到;新表 `customer_tier_changes` 或 jsonb log,開工時定);**同 slice 治本 #215**(`docs/phase-1-backlog.md` L5599):前台 tier 讀取改 server 查 DB(`apps/storefront/src/lib/tier.ts:53` 現只驗 cookie 字面)——此為 M-2-08 硬前置,順路收掉。
- **經銷申請審核**:沿 M-4a-10/11 規格;前台申請入口現況開工時偵察(可能未建,則本期只做後台手動改 tier、申請流程降級為第二期)。

## 6. 高風險件清單(Fable 審+對抗審必過;其餘 slice 走一般 code-reviewer)

1. SSO token 設計+admin session(兩 repo、認證核心)
2. orders schema migration(§4.1;交易模擬+零留痕+第二意見)
3. tier 寫入路徑+#215 治本(權限、經銷價洩漏地雷)
4. 手動單與金流對帳線的隔離(#250 告警/W1 報表不得誤咬 is_manual 單)

## 7. Slice 切片草案(開工時逐片出六件套,此處僅骨架)

- **M0 入口**(3):admin 殼+部署+middleware session|SSO 收端|報價單側簽發端(跨 repo 提案後)
- **訂單線**(7):migration|列表+雙軸篩選|工作排序(拖曳/插入)|手動建單|詳情(吃 #217)|取消|smoke test+對帳隔離驗證
- **客戶線**(5):列表|詳情|tier 變更+審計+#215|經銷申請審核|測試收尾
- 合計 ≈15 slice(15-45 分/片)、實作 4-6 個 Opus/Sonnet session;Fable 介入點=各高風險件審查+PRD 級變更。

## 8. 開工條件與分工

- **Gate(Q4=A)**:#274/#275/search-vehicle 現行線收尾後才開 M0;開工第一步=報價單 repo SSO 小提案給 Sean。
- **分工(Q3=B)**:實作 session 主模型 Opus(機械片 Sonnet);Fable=plan 審/高風險審;Codex 維持唯讀審查(高風險件若 quota 恢復可加背書)。
- **Rollback**:admin 為新增面(獨立 app+新欄位),前台零改動(除 #215 tier 讀取);migration 均為加欄不破壞;SSO 失敗回退=兩邊各自密碼登入照舊。

## 9. 連動索引

#215(tier server 權威)、#217(order_items.product_id)、#240(訂單詳情)、#202(wallet HOLD 不做)、M-3 乙路退款線(已付款單取消的家)、`docs/specs/2026-06-02-quote-website-integration-phase1-plan.md`(兩庫分離架構)、memory `project_m4a-admin-phase1-decisions.md`(本次拍板)。

— END —
