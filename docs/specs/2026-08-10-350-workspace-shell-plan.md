# #350 admin 工作區殼 — 側欄收窄 + 右側分割面板系統(片級 plan v1,待主視窗核)

> 真權威 = Sean 2026-08-09 逐字(`docs/phase-1-backlog.md:9404-9408`)+ wave-plan `:18` `:23` `:35`。
> 片型 = **標準片起跳,但整體命中鐵則 8**(跨 3+ 檔 + 動共用 layout)⇒ 本 plan 就是那個「動前提 plan」。
> 內容分級(鐵則 9)= **L1**(殼是結構不是內容;面板裡的文案隨各自的片走)。

## 0. 一句話

把 admin 從「側欄 + 單一內容區」改成「窄側欄 + 內容區 + **可調寬度的右側面板系統**」,
面板是**共用基礎設施**、不是訂單專屬 —— wave-plan `:23` 逐字:E 的取消畫面、B 的收款/對帳讀面
之後都要「掛進同一個右側面板系統」。

🔴 **這一句是本 plan 最重要的範圍判斷**:Sean 這次描述的是「點訂單編號 → 右邊開詳情」,
但那只是**第一個租戶**。殼的介面若為訂單量身訂做,E/B/347-3 接進來時要拆掉重做。

## 1. 現況地形(偵察實查,全部附 `檔案:行號`)

| 項目 | 現況 | 對本片的意義 |
|---|---|---|
| layout | **全 repo 只有一支** `apps/admin/src/app/layout.tsx:29-35`:`SidebarProvider` → `AppSidebar` + `SidebarInset`(內含 `Header` + `<main className='flex-1 p-6'>`)。orders/customers/settings **都沒有** segment layout | 殼是單層 ⇒ 改動集中、影響面清楚 |
| 側欄寬度 | **是 CSS 變數不是寫死 class**:`components/ui/sidebar.tsx:25-27` `SIDEBAR_WIDTH='16rem'` / `SIDEBAR_WIDTH_ICON='3rem'`,注入 `:128-129` | 🔴 **①「側欄收窄」幾乎零成本** —— 改常數 / 改預設 state,不碰狀態機 |
| 側欄狀態 | 已有 `collapsible='icon'`(`app-sidebar.tsx:48`)、`state:'expanded'\|'collapsed'`、**cookie 持久化**(`sidebar.tsx:23-24,69-84`)、⌘/Ctrl+B(`:92-102`) | 🔴 **面板寬度的持久化有現成範式可照抄**(同一支檔的 cookie 作法),不用自創 |
| 分割視窗積木 | 🔴 **全樹零命中**:`apps/admin/src` + `packages/ui/src` grep `resizable\|panel\|drag\|ResizeObserver` = 0;`packages/ui` **是空殼**(只有 `index.ts` + 一支 reducer);`@base-ui/react@^1.6.0` **沒有** resizable primitive;lockfile 無 `react-resizable-panels` | ⇒ **可調寬度必須自己刻,或新增依賴**(決策題 Q2) |
| 訂單詳情頁 | `app/orders/[id]/page.tsx`(**156 行**)**server component**、`force-dynamic`、`maxDuration=60`、三路 `Promise.allSettled`(`:86-90`);`components/orders/order-detail.tsx`(**387 行**)**無 `'use client'`**、server-rendered | 🔴 **面板必須容得下 server component + server action**,不能只是個 client 抽屜 |
| 詳情頁的 URL 依賴 | `page.tsx:47-65` 由 `params` 取 id + `isOrderId()` 守門 → `notFound()`;`searchParams` 讀 `r`(ResultBanner 結果碼)與 `correct`(更正模式) | 🔴 **這三件事都靠「它是一條 route」**;面板若不是 route,`notFound()` 與結果碼語意要重新設計 |
| client 島 | 只有 `note-compose-form.tsx:1`、`refund-section.tsx:1` 兩支 `'use client'`;其餘子區塊全 server | 面板不需要把整份 UI client 化 |
| server actions | 五支:`procurement-actions` / `workflow-form` / `cancel-actions` / `order-actions` / `note-actions` | 見 §3 的 E 窗匯流 |
| 列表→詳情 | `orders-table.tsx:114-139`(桌機)+ `:263-278`(手機):**純 `<Link href>` + `after:absolute after:inset-0` 整列命中**,`:116-120` 註解逐字寫「零 JS、真連結、鍵盤/中鍵/右鍵都正常」 | 🔴 **改成面板會動到一個刻意的零-JS 設計**(決策題 Q4) |
| 既有測試風險 | `app-sidebar.test.ts` = **文字層**斷言(只解析 `NAV_ITEMS` label/href、不驗 class/寬度)⇒ 收窄**不會**弄紅;`orders-table.test.tsx` 斷言欄數/rowSpan/膠囊 class,**沒有**一條斷 stretched-link;layout 與 order-detail **零 markup 測試** | ⚠️ **殼幾乎沒有測試在保護** —— 這是風險不是好消息(見 §5) |
| 施工衝突 | `git log -20 -- components/layout app/orders`:#350 **零 commit**、全新地;無未 commit 施工 | 無衝突 |

## 2. 範圍:切成三片(本 plan 只請批 350a/350b,350c 隨後)

母片超過鐵則 4 的 45 分鐘,且三塊的風險等級差很多:

| 片 | 做什麼 | 對外可見 | 風險 |
|---|---|---|---|
| **350a 側欄收窄** | 調 `SIDEBAR_WIDTH` / 預設 state,讓側欄窄到與文字對齊、訂單區吃回空間 | **是**(Sean 立刻看得到) | 低(改常數;既有測試不碰 class) |
| **350b 殼** | layout 加「內容區 + 右側面板槽」的可調寬度骨架 + 寬度持久化 + 空面板 | 幾乎無(面板無租戶時不出現) | **中高**(動唯一一支 layout) |
| **350c 訂單面板接線** | 訂單列表點編號 → 詳情進面板;決定 routing 機制 | 是 | **高**(動既有導航與 URL 語意) |

🔴 **建議先出 350a 單獨上線**:它是 Sean 逐字要求的一半、成本近乎零、且**與 350b/c 的架構決策完全解耦**
—— 讓他先拿到看得見的東西,而殼的決策題還在跑。

## 3. 🔴🔴 兩條匯流,主視窗點名要的

### 3-1 E 窗的 PRG 整頁化 × 「不切頁的面板」= 直接衝突,必須先解

`E-032-ACK:7` 逐字:E 窗 D2 = 「PRG action 改造:失敗改 redirect + 授權後 envelope parser +
**成功帶 rt** + revalidate 拋錯仍必導頁」。而 A13b-1 換路的理由本身就是
「React 19 form reset 競態 → 可能誤送整單取消」⇒ **PRG 整頁化是安全修法、不能為了面板退回去**。

衝突的精確形狀:詳情頁進了面板之後,面板裡的取消/改單 action 一 `redirect()`,
**整頁被帶走** ⇒ 面板關掉、寬度狀態丟失、員工回到列表要重新點開那張單。
而 Sean 要的是「90% 時間都在這個狀態下工作」。

⇒ **這條決定了 350c 的 routing 機制,不是施工細節**(決策題 Q1)。
若走 **parallel + intercepting routes**,面板本身就是一條 route ⇒ `redirect()` 導回帶面板的 URL
即可讓面板留著;`notFound()`、`ResultBanner` 的結果碼、瀏覽器上一頁**全部照舊可用**,
E 窗的 PRG **一行都不用改**。這是我推薦 A 案的主因。

### 3-2 E 窗有一個項目**明確停在本線上**

`E-032-ACK:3` 逐字:「D6-b 掛 **#350 線下**等可取消測試單」。
⇒ 350 收線時要回頭把 D6-b 接掉(它等的是一張**可取消的測試單**,不是等殼本身)。
**本 plan 把它列進 350c 的收線清單**,免得隨窗換代蒸發。

## 4. 決策題(請主視窗裁;Q1/Q2 會改變架構,排最前)

**Q1 — 面板用什麼機制渲染?**(決定 350c 全部形狀)

- **A =(推薦)Next.js parallel routes(`@panel` 槽)+ intercepting routes**
  面板是**真的 route** ⇒ ①詳情頁維持 **server component**、五支 server action 與 `revalidate` 全部照舊
  ②`notFound()` / `ResultBanner` 結果碼 / 上一頁 / 可分享網址 **全部天然成立**
  ③E 窗 PRG **零改動**(§3-1)。代價:Next 的 parallel/intercepting routes 本 repo **零先例**,
  要新學一組檔案慣例;`default.tsx` 漏寫會在重新整理時炸(已知坑,寫進驗收)。
- B = client state 渲染(面板內容用 client fetch)
  代價:詳情整份要 client 化或另開 API ⇒ **PII 白名單投影與 server-only 邊界要重畫**、
  五支 server action 的呼叫路徑改變 ⇒ 我判斷這條**與鐵則 12 ② 正面對撞**,不推薦。
- C = 面板內嵌 iframe 載 `/orders/[id]`
  最省事、server 面零改動,但 cookie/焦點/鍵盤/列印/深連結全部要另外處理,且兩份 layout 疊層。**不推薦。**

**Q2 — 可調寬度怎麼做?**(全樹零積木、零依賴)

- **A =(推薦)手刻**:pointer events + CSS 變數 `--workspace-panel-width` + cookie 持久化,
  **照抄 `sidebar.tsx:69-84` 既有的 cookie 範式**(同一個 repo、同一種東西、同一套慣例)。約 40-60 行。
- B = 新增 `react-resizable-panels` 依賴:少寫程式,但**本 repo UI 原語是 `@base-ui/react` 不是 Radix**,
  引入一個 React-only 的 panel lib 會多一條與現有體系無關的相依鏈;且新增依賴屬平台面、要另外走審。

**Q3 — 350a 要不要單獨先上?** 推薦 **要**(§2 理由)。

**Q4 — 列表的「整列可點」怎麼辦?**
現況是刻意的零-JS `<Link>` + `after:inset-0`(`orders-table.tsx:116-120` 註解逐字)。
- **A =(推薦)保留 `<Link href>` 不動**,由 intercepting route 接管 ⇒ 中鍵/右鍵/新分頁**仍然正常**,
  一般點擊被攔進面板。這是 A 案的附帶好處,也是我推薦 Q1=A 的第二個理由。
- B = 改 onClick + client state ⇒ 中鍵開新分頁、鍵盤操作、右鍵複製網址全部要自己補回來。

**Q5 — 手機怎麼辦?** Sean 逐字只講桌機(「畫面大約是現在視窗的一半」)。
推薦 **維持現狀**:小螢幕沒有分割的空間,點編號照舊整頁進詳情(backlog `:9406` 我已寫「手機行為維持現狀」)。

## 5. 🔴 風險:這片幾乎沒有測試在保護

偵察實查:root layout **零測試**、`order-detail.tsx` **零 markup 測試**、
`orders-table.test.tsx` **沒有一條**斷言 stretched-link。
⇒ 「改殼不會弄紅任何東西」**不是安全訊號,是盲區訊號** —— 改壞了沒有人會告訴我。

本片自帶的守門(不靠既有測試):
1. 側欄寬度常數的釘值格(改了要有人知道);
2. 面板槽的結構斷言(`@panel` 槽存在、`default.tsx` 存在 —— 漏它會在重新整理時 404,是該機制的頭號坑);
3. 列表連結**仍是真 `<Link href>`**的原始碼斷言(擋 Q4 被默默改成 onClick);
4. 每條配突變。

## 6. 不做什麼

- **不做 #348 客人 360 的內容**(那是它自己的 3-4 片,backlog `:9392`);本片只保證**槽位容得下它**。
- **不做商品卡內容**(Q1=A 已拍板規格,但實作隨它自己的片)。
- **不動 `ADMIN_ORDER_LIST_SELECT` 投影、不動任何 PII 邊界**。
- **不碰 347-3 搜尋 UI**(它之後掛進殼)。

## 7. rollback

350a:改回常數。350b/c:單一 commit revert;無 migration、無 schema、無資料寫入。
🔴 若 Q1=A,`app/orders` 底下會多出 parallel-route 目錄結構 —— revert 要連目錄一起,
不能只 revert layout(漏了會留下半套 route 慣例,那比沒做更難懂)。
