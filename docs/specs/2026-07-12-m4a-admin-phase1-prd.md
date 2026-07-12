# M-4a 後台第一期 PRD — 訂單+客戶管理+統一入口(2026-07-12)

> **狀態:v1.1(07-12 晚間修訂)。** v1.0=Sean 拍板 Q1=A/Q2=C/Q3=B/Q4=A 後定案;v1.1=依 Sean 指示徵詢 Codex(gpt-5.6-sol 架構批判)+ Gemini(生態研究)+ 兩路 web research 後,由 Claude triage 折入修訂。**排隊待開工。**
> 真權威鏈:本檔 + `docs/PHASE-1-MILESTONES.md` M-4a 段(413-463 行)。⚠️ PROJECT-OVERVIEW/PHASE-2-VISION 的「Medusa Admin」字面已被 ADR-0005 推翻,禁引用。鐵則 9:L3 內容,本 PRD 即動工前置文件。

---

## 0. 拍板紀錄

| 題 | 決定 | 內容 |
| --- | --- | --- |
| Q1(07-12) | **A** | 統一入口:登入一次、報價單後台與網站後台兩邊通(SSO,§3.1) |
| Q2(07-12) | **C** | 第一期=訂單管理+客戶管理一起完成才交付 |
| Q3(07-12) | **B** | 全 Claude:實作 Opus/Sonnet、Fable 只規劃+高風險審查;不開 Codex 寫入 |
| Q4(07-12) | **A** | 先收尾 #274/#275/search-vehicle,後台=下一個 milestone |
| 加項(07-12 晚) | **B+D** | email 通知(下單/出貨)+首頁推薦改最新商品=進第一期;A 商品網站側欄位、C 首頁輪播=第二期(Sean:「依照建議」) |
| 時機(07-12 晚) | **開動** | Sean:搜尋線剩 codex 背書、不衝突;原 Q4 gate 解除、後台線即刻開工 |
| 視覺基調(07-12 Sean 原話) | — | 後台=**明亮、乾淨**;不沿用前台深色 design(後台無 design-reference 約束,以好用為先) |

已採納語意(Sean 未反對,開工前可推翻):訂單上下移動/插入**只影響後台顯示順序**,不改訂單編號/成立時間/客人視角。

加項已拍(07-12 晚):email 通知+首頁最新商品=第一期;商品網站側欄位、首頁輪播=第二期。

## 1. 目標(白話)

Sean 與員工用同一個登入進報價單後台+網站後台;第一期:①訂單管理=Google Sheets 式工作表(上下移動、任意位置插入手動單、取消、詳情、雙軸篩選)②客戶管理=列表/詳情/tier 變更/經銷審核。介面明亮乾淨、鍵盤好用、像 Shopify/Linear 等現代工具。

## 2. 範圍

**做(第一期)**:M0 入口與地基(admin 殼+部署+staff 身分+稽核 log+SSO)/ 訂單線(含 email 通知:下單成功+出貨,outbox+Resend)/ 客戶線 / 前菜=首頁推薦改最新商品(純前台、可先行)(細節 §4-§6)。
**不做(明確排除)**:商品管理含網站側欄位編輯(第二期,07-12 晚拍)/ 首頁輪播管理(第二期)/ admin inbox 客服 / 員工多帳號完整權限(M-4b;第一期做「最小具名身分」§6.1)/ **已付款單取消與退款**(走 M-3 乙路後台退款線;第一期取消僅限 unpaid,不碰金流寫路徑)/ wallet(#202 HOLD)。

## 3. 架構決策

### 3.1 統一入口 SSO(v1.1 升級:一次性兌換碼制)

現況:報價單後台=Next.js 15/Vercel、quote.pcmmotorsports.com、共用密碼+TOTP 2FA、HMAC session `__Host-pcm_sess`;網站 admin=`apps/admin` 空殼;兩 Supabase 專案刻意分離(dllwkkfanaebrsuyuedy / bmpnplmnldofgaohnaok),**不合併、不跨庫直寫**。

**定案方案:一次性 authorization code 兌換**(Codex 批判後升級;原 v1.0「HMAC token 放 URL」否決——bearer token 進 query string 會留在瀏覽器歷史/Vercel access log/Referer,60 秒 TTL 只縮短不消除洩漏窗):

- 發起端(如報價單後台)產生 opaque code(≥256-bit 隨機、DB 只存 hash、TTL 60s、綁 state);URL 只帶 code。
- 收端(admin)以 **server-to-server** 回呼發起端兌換 API(驗共享 secret),兌換=同交易「驗證+標記已用」原子消耗(防併發重放);取回 amr/auth_time 後發自己的 `__Host-` session,303 導向乾淨 URL。
- 防護清單(高風險件 #1 驗收基準):state cookie 防 login CSRF、成功後旋轉 session id;return path 僅允許相對路徑 allowlist;兩方向**各自獨立 secret**(單邊被攻破不能偽造反向);時鐘偏移容忍 ±30s;`Referrer-Policy: no-referrer`。
- 敏感操作(tier 變更、取消訂單)要求 `amr` 含 totp 且 `auth_time` 近期(step-up 語意,門檻開工定)。
- 登出/撤銷語意(v1.1 補):第一期=兩邊 session 各自獨立登出;共用密碼輪替 SOP=兩邊 SESSION_SECRET/SSO secret 同批輪替(寫進 runbook)。
- 降級案(若 server-to-server 兌換工程量超出第一期):POST form auto-submit + no-referrer + jti 原子消耗,經高風險審查同意才可採。
- 跨 repo:報價單側(簽發+兌換 API+選單)=開工時單獨提案 Sean。

### 3.2 部署形

`apps/admin` 獨立 Next.js app、獨立 Vercel 專案、建議 `admin.pcmmotorsports.com`。所有資料存取走 server(Route Handler/Server Action)+`SUPABASE_SECRET_KEY` server-only;**寫入集中在少數 repository/RPC**(secret key 繞過 RLS=全庫權限,不讓個別 UI action 自由組查詢);middleware 驗 session 且每個寫入 handler 內再驗(雙層)。`apps/api` 殼本期不啟用。

### 3.3 UI 底座(定案;三方研究收斂:web research+Codex+Gemini)

- **骨架**=fork `Kiranism/next-shadcn-dashboard-starter`(App Router、shadcn/ui、內建 TanStack Table;MIT、2026-07 仍活躍)。**一次性 fork**:記錄來源 commit、砍掉不用頁面與其 auth、留 sidebar/topbar/theme/表單元件,**不追上游 merge**。開工第一步=最小整合驗證(Next 15+React 19+Tailwind 相容性 spike,Codex 提醒此步常比畫面費時)。
- **表格**=TanStack Table **釘 v8 精確版**(v9 仍 beta,無第一期收益);重表格畫面抄 `sadmann7/tablecn` 零件(視為可複製修改的零件、不再包通用表格框架)。
- **拖曳**=dnd-kit 經典組合(TanStack 官方 row-dnd 範例路徑)**或** Atlassian pragmatic-drag-and-drop(更輕、維護更活躍;Gemini 推薦):實作 slice 開頭 30 分 spike 二選一,不預辯。
- **UX 原則**(Gemini 意見採納):訂單詳情用 split-view 右側抽屜(少跳頁)、鍵盤快捷(j/k 移動、Enter 開單,第一期最小集)、Cmd+K 全域搜尋(可第二期)、色彩只給狀態 badge 與 CTA、light theme。
- 否決:Refine/react-admin(data provider 抽象與自寫資料層相抵、react-admin 行內編輯在付費版)、satnaing/shadcn-admin(Vite 非 Next)、AG Grid(付費、第一期規模不值)、iframe 嵌報價單後台(cookie/clickjacking 面)。

## 4. 訂單管理規格

現況:`orders`+`order_items`(migration `20260604120000_m3_s2a_orders_order_items.sql`);雙軸 `payment_status`(unpaid/paid/partiallyPaid/refunded)×`fulfillment_status`(notOrdered/ordered/inStock/shipped);無排序/取消/來源欄。

### 4.1 Schema 變更(一支 migration;高風險件 #2:交易模擬+零留痕+第二意見)

v1.1 依 Codex 批判修訂:

- `display_position bigint NULL`(**nullable,非 v1.0 的 NOT NULL**——NOT NULL 會弄壞既有 create_order RPC,「加欄不破壞」才成立)。語意:NULL=未手動排過;列表 `ORDER BY display_position NULLS FIRST, created_at DESC, id`(id=穩定第三鍵);首次拖曳才賦值。**整數稀疏間隔**(相鄰差 1024)取代 numeric fractional index(單/雙人使用下更簡單穩健);插入=鄰居整數中點,server 端計算(client 只傳「移動誰、放在哪兩筆之間、讀取時 version」,不信 client position);無間隙→同交易 advisory lock 局部重編。
- `order_source text NOT NULL DEFAULT 'web'` + CHECK(web/manual_phone/manual_line/manual_other)與 `payment_channel text NOT NULL DEFAULT 'tappay'` + CHECK(tappay/bank_transfer/cash/none)(**取代 v1.0 單一 is_manual**——「來源」與「金流管道」是兩件事:電話單也可能之後刷卡、網站單也可能改匯款)。⚠️ 與既有 `payment_method` 欄(20260604 初始表、nullable、confirm_payment 付款成功時寫 'tappay')的分界(07-12 Fable 審單 #1 定案):**payment_channel=管理/預期軸**(建單時定、admin 可改),**payment_method=金流事實軸**(只有金流 RPC 寫、付款成功才有值);報表「實收金額」一律按 method+payment_status,**禁用 channel 算錢**(unpaid web 單 channel 恆為預設 'tappay',是預期非事實);兩欄各加 COMMENT ON COLUMN 釘死語意。
- `cancelled_at timestamptz NULL`+`cancelled_reason text NULL`(營運軸獨立,不動 payment_status)。
- `version integer NOT NULL DEFAULT 1`(樂觀鎖:兩個分頁互改要能察覺;orders 與 customers 都加)。
- 不變式(CHECK 或監控擇一,開工定):`payment_channel<>'tappay'` 的單不得有 `tappay_rec_trade_id`;歷史資料不允許 CHECK 就先用測試+監控守。
- 索引:display_position、created_at、雙軸狀態、cancelled_at 篩選所需(server-side pagination 前置)。

### 4.2 功能

- **列表**:一列=一單;欄=位置把手/單號/日期/客人/品項摘要/金額/付款/出貨/備註;「工作排序」與「時間排序」兩檢視;雙軸篩選(M-4a-08 規格)+已取消篩選;server-side pagination。
- **移動/插入**:拖曳或 ↑↓;「在此列上/下插入」=開手動建單表單寫入指定 position。
- **手動建單**:`order_source=manual_*`;客人=既有會員或散客(customer_user_id 放寬 NULL 需加條件約束:非手動單必有 customer;並掃既有查詢/RLS/報表的 NULL 處理);品項=商品庫挑選(寫 product_snapshot)或自由文字行——⚠️ 現 schema 對 variant_sku/product_snapshot/地址發票快照有 NOT NULL 與白名單約束,**手動單合法填法=開工時逐條讀 migration 定案,不到 UI 才塞假值**(Codex 指名);表單帶 idempotency key(重送/重試不重複建單)。
- **取消**:限 unpaid 且未出貨;**原子條件更新**(同一 UPDATE 內驗 unpaid+未取消+未出貨,不先讀後寫——防與 late-success 扣款競速);寫 cancelled_at/reason;不硬刪(late-success 要查得到單);已付款單顯示「走退款(另案)」。⚠️ `cancelled_reason`=**可對客文案**(orders 對 authenticated 有表級 SELECT,會員看得到自己單此欄;07-12 Fable 審單 #1 定案)——內部原因寫 admin_audit_log.reason 不入 orders;未來內部備註欄走獨立表、勿直加 orders。
- **對帳隔離(高風險件 #4,v1.1 方向修正)**:隔離原則=**正向納入**——對帳/雙扣/告警管線從 `payment_charge_attempts`+rec_trade_id 出發連回訂單,而非掃 orders 負向排除;開工時驗 #250/W1 現況是否已是正向,不是則改。告警測試至少涵蓋:手動未付款、手動現金已付、手動單誤帶 rec_trade_id、網站單無 attempt、late-success、重複 callback、同 transaction id 指向兩單。
- **詳情**:split-view 抽屜;單頭+品項+付款紀錄(唯讀)+物流;連動 #217(order_items 無 product_id,詳情連結商品前必解)與 #240(會員端詳情共用讀取層)。

## 5. 客戶管理規格

現況:`customers`+3 子表(migration `20260523034911`);tier=general/store/premiumStore;`IAdminCustomerRepository`(`docs/specs/m-1-14-customer-schema.md:589`)未落地,本期實作。

- 列表/搜尋(姓名/電話/email;顯示 tier、訂單數)、詳情(基本資料/地址/車庫/訂單歷史)。
- **tier 變更**:server RPC+service key;寫入**統一稽核 log(§6.2,非 tier 孤表)**;要求 step-up(§3.1);**同 slice 治本 #215**(前台 tier 讀取改 server 查 DB;`apps/storefront/src/lib/tier.ts:53` 現只驗 cookie 字面;M-2-08 硬前置順路收掉)。
- 經銷申請審核:沿 M-4a-10/11;前台申請入口現況開工偵察,未建則降級為後台手動改 tier。增強候選(backlog):補件清單+LINE 通知(Gemini 意見,連動既有 LINE 基建)。

## 6. 統一地基(v1.1 新增;全部第一期做,防後悔)

1. **最小具名身分**:共用密碼登入後選人(Sean/員工名單)寫入 session=`actor`;沒有它稽核 log 全記成同一個 shared admin(M-4b 完整權限前的最小解;handler 預留 actor_id/required_amr,不寫死 isAdmin)。
2. **統一稽核 log**:append-only `admin_audit_log`(actor/action/target/before/after/reason/request_id/source_app/at);tier、取消、排序外的所有寫入都記。
3. **樂觀鎖**:orders/customers 帶 version 條件更新,衝突回 409 由 UI 重載。
4. **狀態變更全走 RPC/repository 白名單**,UI 藏按鈕不構成保護。
5. **時區**:DB 一律 timestamptz(UTC);後台顯示與日報邊界=Asia/Taipei 明訂。
6. **Email outbox**(email 已拍入第一期):事務信寫 outbox 表+背景送出+重試,不在訂單交易內直呼 Resend;第一期兩封=下單成功、出貨通知(業界最低標配五封先做兩封;取消/退款信併 M-3 退款線)。
7. **correlation/request id** 貫穿 admin 寫入→audit→DB→外部服務 log。

## 7. 高風險件(Fable 審+對抗審必過;其餘走一般 code-reviewer)

1. SSO 一次性兌換碼全流程(§3.1 防護清單=驗收基準)
2. orders schema migration(§4.1;含既有 create_order RPC 零接觸驗證)
3. tier 寫入+#215 治本+step-up
4. 手動單與金流對帳正向隔離(§4.2 測試清單)

## 8. Slice 骨架(開工時逐片出六件套)

- **M0 入口與地基**(4):骨架 fork+整合 spike+部署 | staff 身分+audit log+correlation 基建 | SSO 收端 | 報價單側簽發(跨 repo 提案後)
- **前菜**(1、可先行):首頁推薦改最新商品(純前台、不依賴後台)
- **訂單線**(8):migration | 列表+雙軸篩選+pagination | 工作排序(spike 拖曳庫→拖曳/插入) | 手動建單 | 詳情抽屜(吃 #217) | 取消+對帳正向驗證 | email 通知(outbox+Resend:下單/出貨) | smoke test
- **客戶線**(5):列表 | 詳情 | tier+#215+step-up | 經銷審核 | 測試收尾
- ≈18 slice、實作 5-7 個 Opus/Sonnet session;商品側欄位/輪播=第二期另計。

## 9. 開工條件與分工

Gate 已解除(07-12 晚 Sean 拍:搜尋線剩 codex 背書、不衝突、後台開動);開工第一步=報價單側 SSO 跨 repo 提案(已備:`docs/proposals/2026-07-12-quote-sso-issuer-proposal.md`,等 Sean 過目)。分工(Q3=B):實作 Opus(機械片 Sonnet)、Fable 審高風險件;Codex 維持唯讀審查(quota 恢復時背書)。Rollback:admin=新增面、獨立 app;migration 加欄不破壞(§4.1 nullable 策略);SSO 失敗回退=各自密碼登入。

## 10. 未來留門(不在第一期,架構先不擋路)

- **首頁輪播**:`homepage_banners` 表(image_url/link/sort/active/schedule)+後台 CRUD;前台元件視覺=Claude Design 分工。
- **AI 自動產圖管線**(Sean 願景:AI 研究品牌新品→產資訊圖→自動上輪播):留門=圖片欄位區分原圖/去背圖、產圖任務用非同步狀態機(pending/processing/completed)、banner 表加結構化 metadata(brand/vibe/main_color)供未來 prompt builder;產圖工具屆時另研究(Gemini 初查:Flux/Ideogram/Photoroom/Bannerbear 一類,未驗證)。
- B2B 審核補件清單+LINE 通知、手動單 fitment 適配警示:backlog 候選。

## 11. 連動索引

連動:#215(tier server 權威)、#217(order_items.product_id)、#240(訂單詳情)、#202(wallet HOLD)、M-3 乙路退款線(已付款取消的家)、#250/W1(對帳正向化驗證點)、`docs/specs/2026-06-02-quote-website-integration-phase1-plan.md`(兩庫分離)、memory `project_m4a-admin-phase1-decisions.md`。諮詢紀錄:Codex session 019f5598(批判全文已 triage 折入 v1.1)、Gemini/web research 結論折入 §3.3/§10。

— END —
