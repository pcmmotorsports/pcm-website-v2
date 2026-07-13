# M-4a 訂單處理狀態(可設定 + 顏色)設計 — 2026-07-13 Fable

> **Sean 需求(2026-07-13)**:把 Google Sheet 的訂單工作方式搬進後台。訂單狀態不是只有「出貨」,而是他習慣的**收款×訂定×貨況合併標籤 + 顏色**、且要能自己設定(截圖=他現用的 9 個狀態+顏色+Sheet 實況)。
> **Sean 補充**:「不一定照 Sheet、有更好的訂單操作方式就做;我也不知道完整後台操作起來如何。**盡量優化介面與設計,先出雛形再改**。」
> **本檔 = Fable 設計**(資料模型 + slice 拆解 + 金流護欄 + seed 詞彙)。真權威 PRD=`docs/specs/2026-07-12-m4a-admin-phase1-prd.md`(本檔為其訂單狀態延伸)。實作視窗照此執行、有更好 UX 可提。

## 心法:雛形優先、Sean 對實體反應後迭代
Sean 是「看到實體才有反應」型(品味/操作題不靠文字想像)。目標=**盡快把一個乾淨、可點、可設定狀態的訂單管理雛形部署到 admin.pcmmotorsports.com**,讓 Sean 實際操作後說「這裡改、那裡加」。不 gold-plate、不追求一次到位;但**金流護欄與寫入安全不可因「只是雛形」而省**(見下)。

## Sean 的實際工作方式(截圖)
9 個狀態(標籤**逐字**、顏色近似待 Sean 微調;截圖 1 是他 Sheet 的下拉設定):
| 標籤 | 顏色(近似) | 語意 |
|---|---|---|
| 已收已定 | 奶油黃 #FBE4A6 | 收到款 + 訂單確定 |
| 已收未定 | 淺粉 #F8D7DA | 收到款 + 未確定 |
| 出貨完成 | 淺綠 #C6E7B3 | 已出貨 |
| 未收已定 | 鮭紅 #F2A0A0 | 未收款 + 已確定 |
| 未收出貨 | 深紅 #A52A2A | 未收款但已出貨(深底淺字) |
| 未收未定 | 亮黃 #F5F26B | 未收款 + 未確定 |
| 未收現貨 | 紫 #7B3FA0 | 未收款 + 現貨(深底淺字) |
| 現貨在庫 | 深綠 #2E7D46 | 現貨在庫(深底淺字) |
| 已取消 | 紅 #E57373 | 取消(Sheet 有) |

心智模型 = **單一「訂單狀態」欄(一個下拉、一個顏色),他手動設**。已定/未定(訂定)、現貨=系統目前沒有的維度、他當狀態值用。

### 🆕 需求擴充(Sean 2026-07-13 追加,均在雛形範圍)
- **出貨方式**:訂單要有出貨方式欄(自取/宅配/黑貓/DHL…;Sean Sheet 有「自取」+ DHL Express)。可顯示可設定。
- **發票**:客人訂貨紀錄有開發票需求 → 訂單要有發票資訊。**v1=簡單欄位**(發票號碼/金額/已開狀態;Sean Sheet 有「開發票 $10920 / 番号 60556739」+ 訂單編號/快捷編號)。**不做**台灣電子發票 API 串接(載具/統編/字軌)=大題、另議。
- **客戶資訊可見**:從訂單要能看到該客人資訊(姓名/電話/地址;Sean Sheet 有 買主/地址/戶型)= **訂單明細頁**呈現。🔴 地址/電話=PII、admin-only、走 service_role、明細頁**另立具名白名單**(含 address/phone、**仍零成本/經銷價/token**);不進列表(列表維持精簡)。
- **戶型(車行/直客)**:Sheet 有此欄;目前靠客戶 tier(store≈車行/general≈直客),是否訂單層獨立戶型=Sean 玩雛形後定。
- **收款紀錄/尾款**(收 X 尾 Y):獨立收款模型、大題,列後續(見 v1 不做)。

## 現況(偵察 + Fable 核對)
- 系統訂單狀態=**雙軸**:`payment_status`(unpaid/paid/partiallyPaid/refunded, Postgres ENUM `20260604120000:50`)× `fulfillment_status`(notOrdered/ordered/inStock/shipped, ENUM + 狀態機)。後台 `/orders` 顯示為**兩個獨立 pill**(`apps/admin/src/lib/orders/order-list-view.ts:55-81` hardcode 標籤)。
- 會員側有合併函式 `orderStatusLabel`(`apps/storefront/src/lib/orders/order-display.ts:40-58`)把雙軸併成一句中文、固定文案無顏色、註解說「未來移後台 CMS」——**對映邏輯可參考**。
- 後台訂單目前**純唯讀**(無 updateOrder、無 route handler 寫入、無 server action 動 orders)。稽核 log(`recordAdminAudit`)+ 樂觀鎖 `version` = **只有備件/schema、尚無呼叫端**(`apps/admin/src/lib/audit/context.ts:41-44`)。
- 🔴 orders 6 新欄(order_source/payment_channel/cancelled_at/cancelled_reason/version/display_position)**已在 prod**——**訂單列表已用這些欄、Sean 已見 30 筆真資料 = live 反證**。(偵察報告誤讀 migration `20260712203000` 檔頭「未 apply」註解=已知 **字面 vs 事實** 陷阱,以 live 行為為準、勿信檔頭。)`order_source`=web/manual_phone/manual_line/manual_other;`payment_channel`=tappay/bank_transfer/cash/none。
- 戶型:僅客戶層 `MemberTier`(store=經銷商≈車行 / general≈直客),**訂單層無戶型欄**。

## 設計:可設定的訂單處理狀態(workflow_status)
**核心 = 新增一個 Sean 可設定、有顏色、可管理的「訂單狀態」策展清單,當後台主要操作把手,與金流雙軸解耦共存。**

為何**不**改用「雙軸可設定 + 合併顯示」:Sean 的 已定/未定(訂定)是雙軸沒有的第三維 → 雙軸表達不出他的完整詞彙。故必須新增策展單欄(而非硬湊 N×M)。

### 🔴 金流護欄(硬性、雛形也不可違反)
- `workflow_status` = **Sean 的操作/顯示狀態**,**絕不驅動金流/對帳/退款/雙扣告警邏輯**。這些一律仍認 `payment_status`(金流真相軸)。
- 線上單(order_source=web、payment_channel=tappay)的 `payment_status` 仍由 TapPay 流程設定、**不被 workflow_status 覆蓋**。
- workflow_status 對線上單只作顯示/操作層;真正的錢一律看 payment_status。(記憶滿是金流雙扣/對帳事故,這條是紅線。)

### 資料模型
- 新表 `order_status_options`(策展詞彙,支撐截圖 1 的設定 UI):`{ code text PK, label text, color text(hex bg), text_color text('light'|'dark' 或算亮度), sort_order int, is_active bool DEFAULT true, created_at timestamptz }`。seed Sean 9 個(標籤逐字、顏色近似)。**soft-delete 用 is_active**(不硬刪、避免既有單指向消失)。
- `orders` 加 `workflow_status text NULL`(soft-ref `order_status_options.code`;nullable=舊單未設)。**不用 Postgres ENUM**(要可增刪改=ENUM 不適合)、**不用硬 FK**(Sean 改詞彙時彈性;用 is_active + 顯示端兜 NULL/未知 code)。
- backfill(二選一,Sean 定或雛形先預設):(a) 舊單依 payment_status×fulfillment_status **盡力對映**初始 workflow_status(參考 order-display.ts 對映);(b) 全留 NULL 由 Sean 自己設。**雛形預設 (a)**,Sean 測時可全清重設。
- ACL:order_status_options 讀寫=admin service_role;workflow_status 走既有 orders 表權限。經銷隔離:延續 `ADMIN_ORDER_LIST_SELECT` 具名白名單、禁 `select('*')`、零成本欄(新增 workflow_status 進白名單即可)。

### Slice 拆解(增量、雛形優先;每片可獨立部署給 Sean 看)
**Slice A(狀態 schema + 列表顯示,唯讀):** draft migration(orders 加 `workflow_status` + `shipping_method` + `invoice_number`/`invoice_amount`/`invoice_status` + 建 `order_status_options` + seed 9)→ Sean apply。後台 `/orders` 主「訂單狀態」欄改 workflow_status **彩色 badge**(舊雙軸 pill 降次要/tooltip);篩選改 by workflow_status。**唯讀先做完可部署**=Sean 雛形第一眼。
**Slice B(訂單明細頁,唯讀):** `/orders/[id]` 明細頁——顯示 **客戶資訊(姓名/電話/地址,PII、admin-only)** + 訂單品項 + **出貨方式** + **發票資訊** + 付款紀錄 + 狀態。🔴 **另立明細具名白名單** `ADMIN_ORDER_DETAIL_SELECT`(含 address/phone/shipping/invoice,**仍零成本/經銷價/tappay token**);地址 PII 走 service_role admin-only。唯讀=低風險、讓 Sean 看到完整操作面。
**Slice C(寫入路徑 — 設定狀態/出貨方式/發票,🔴 高風險件、後台第一個寫入):** server action/route 設 `workflow_status`(+ shipping_method/invoice)。**必接基建**:① 稽核 log `recordAdminAudit` before/after(真接 `admin_audit_log`、actor 走 M0-S2 picker/SSO amr)② 樂觀鎖 `WHERE version=$expected`+`version+1`、衝突 409 重載(PRD §6.3)③ Origin/CSRF 自驗(裸 route POST 不吃 Next 內建 Server Action CSRF;跨子網域 quote.*→admin.* same-site、Lax 擋不住 → 必自驗 Origin,Fable M0-S3 note)④ fail-closed + 不外洩 DB error。UI=列表 inline 下拉 / 明細改。**Fable 對抗審必跑**(值班台 review-inbox 丟單)。
**Slice D(設定 UI — 截圖 1,後):** 後台管理 order_status_options(增/刪/排序/改色);Sean 先用 seed 9 個、玩過雛形再定要不要自訂。

### v1 明確不做(未來片、寫 backlog、Sean 玩雛形後再排)
- **收款紀錄 / 尾款**(收 X 尾 Y、partiallyPaid 尚未啟用):獨立收款模型、大題。
- **戶型 車行/直客訂單層欄**:目前靠客戶 tier;要不要訂單獨立戶型 = Sean 玩雛形後定(他 Sheet 有這欄)。
- **手動建單**(散客 NULL):PRD §4.2 已規劃、另片(但 shipping_method/invoice 欄本設計已加,手動建單時可填)。
- **正式取消流程**(cancelled_at + unpaid guard,PRD §4.2):與 workflow_status「已取消」標籤區分——標籤=顯示,正式取消=獨立動作,另片。
- **台灣電子發票 API 串接**(載具/統編/字軌):v1 只做簡單發票欄位(號碼/金額/已開),真串接=大題另議。
- (🆕 出貨方式/發票欄/客戶資訊明細已從『不做』提為 in-scope,見 Slice A/B + 需求擴充。)

## 需要誰
- **Sean**:①**先設 Production Branch=dev**(否則雛形不會自動上正式、迭代不順)②apply migration(workflow_status + order_status_options,prod;Claude .env deny 擋)③玩雛形後回饋 UX + 微調顏色 + backfill 策略。
- **Fable**:Slice B(寫入路徑 + 稽核 + 鎖 + Origin)高風險對抗審。
- **實作視窗**:Slice A+B code 全寫、三綠、draft migration、卡 apply(Sean)與高風險審(Fable)前收束;**盡量優化 UI 讓雛形好看好用**(admin 既有 base-ui 元件系統、非 storefront 品牌設計)。

## 待 Sean 反應的點(非阻擋、看雛形後說)
1. workflow_status 當**主要**訂單狀態欄(雙軸降次要)是否合意。
2. 有沒有比「單一彩色狀態下拉」更順的操作(Sean 玩過再說;實作視窗雛形可先做這個最貼他 Sheet 的版本)。
3. 顏色 hex 微調 / backfill 對映 vs 全空 / 線上單自動初始化 vs 全手動。

## 連動
PRD §4(訂單線)、`order-list-view.ts`(現雙軸標籤)、`order-display.ts`(會員側合併函式,對映參考)、`admin_audit_log`(Slice B 接線點)、樂觀鎖 version(`20260712203000`)、memory `project_m4a-admin-phase1-decisions`。
