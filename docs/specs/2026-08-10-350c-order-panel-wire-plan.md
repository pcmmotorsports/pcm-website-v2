# #350c 訂單面板接線(片級 plan **v2** — searchParams 驅動)

> v1(intercepting route)已作廢:關卡1 codex 判 NO-GO,且**面板黏住**經真瀏覽器實測成立、兩種標準修法皆無效(`D-403-Q` §①)。
> 主視窗 2026-08-10 裁 **A 案**:searchParams 驅動、放棄 intercepting route,**Q4=A 正式推翻**(主視窗自收回)。
> 片型 = **高風險不降級**;內容分級 = **L1**。

## 0. 一句話

訂單列表點單號 → `/orders?panel=<id>`,`@panel` 槽讀 `searchParams.panel` 決定開不開;
**URL 一變槽就重算 ⇒ 黏住問題從根消失**。

## 1. 主視窗五條新裁(逐條落地)

| # | 裁決 | 落地 |
|---|---|---|
| ① | 桌機列表列 → `?panel=` 連結 | `orders-table.tsx:135` 改用注入的 href builder |
| ② | `/orders/[id]` 整頁版保留、其他 6 處跨頁連結**不改不攔** | A 案無攔截 ⇒ 天然成立,**零改動** |
| ③ | 手機照 Q5 維持整頁 | `orders-table.tsx:274` 手機卡片**一個字不動** |
| ④ | 窄面板排版用 `@container` | `order-detail.tsx:275` 一行(全檔斷點總數 = 1) |
| ⑤ | `notFound()` 面板自理 | 槽內**不呼叫 `notFound()`**,查無 → 面板內錯誤態 |

## 2. 實測基礎(不是假設)

| 行為 | 實測 |
|---|---|
| 軟導航到別區塊(`/customers`)+ `@panel/[...catchAll]` 回 null | ✅ 槽清空 |
| 瀏覽器上一頁 | ✅ 槽收起 |
| 硬導航 / F5 | ✅ 走 `default.tsx`,不 404 |
| 開面板(`?panel=<uuid>`)| ✅ 面板 576px、`container-type: inline-size`、內層自捲 |
| 關面板(面板內連結軟導航)| ✅ 面板收起、**篩選與頁碼原封保留** |
| ~~回父列表時槽自動清~~ | ❌ **攔截路由下不成立** —— A 案改由「槽頁被配對到並重算」達成 |
| ~~server action `redirect()` 後面板還在~~ | 🔴 **A 案下不成立**,見 §8 |

🔴 catch-all **仍要留**:它是「去別的區塊時清空槽」的唯一機制(實測)。

🔴🔴 **我在這裡犯過一次「把別的架構下的實測搬過來當已驗」**:v1 的探針證明的是「**攔截路由**下
`redirect()` 之後面板還在」,而 A 案根本沒有攔截路由,那格觀測**一格都不能沿用**。
code-reviewer 用原始碼就把它證偽了(五支 action 全都 `redirect('/orders/{id}')`)。
⇒ 換架構時,舊架構的實測表要**整張重驗**,不是逐列挑著留。

## 3. 檔案清單

| # | 檔 | 動作 |
|---|---|---|
| 1 | `lib/orders/order-list-href.ts`(併入既有 `order-list-view.ts`) | `buildOrderListHref(filter, page, panelOrderId?)` 多帶 `panel=` |
| 2 | `components/orders/orders-table.tsx` | 新 prop `buildPanelHref`;**只改桌機 `:135`**,手機 `:274` 不動 |
| 3 | `app/orders/page.tsx` | 傳 prop + 🔴 **加 `maxDuration = 60`** |
| 4 | `app/@panel/orders/page.tsx` **新** | 讀 `searchParams.panel` → 有值渲染詳情、無值回 `null`;`dynamic`+`maxDuration` |
| 5 | `app/@panel/[...catchAll]/page.tsx` **新** | 回 `null`(跨區塊清槽) |
| 6 | `components/orders/order-detail-route.tsx` **新** | 從 `orders/[id]/page.tsx` 抽出載入 + 組裝(兩個消費者:整頁版與面板版) |
| 7 | `app/orders/[id]/page.tsx` | 改成薄殼,委派 #6 |
| 8 | `app/globals.css` | 面板自己的捲動 |

### 🔴 3-1 `maxDuration`:A 案把它換了一條 segment(**本片唯一碰到錢的地方**)

`orders/[id]/page.tsx:16-38` 整段的理由不變:退款 action 的 POST **吃 route segment 的函式時限**,
adapter 有 30s 硬逾時,時限低於它 ⇒ 錢可能已動、帳本停在 `processing`。
A 案下面板掛在 **`/orders`**,而 `app/orders/page.tsx` **目前只有 `dynamic`、沒有 `maxDuration`**(實查)
⇒ **不補就是把退款丟回平台預設**。
做法:`app/orders/page.tsx` 與 `app/@panel/orders/page.tsx` **都宣告 60**,測試把三處(含 `orders/[id]`)釘在一起。
⚠️ 誠實界線:「slot 頁與 page 頁誰的 segment config 管轄 action POST」我**沒有實測**;三處同值 ⇒ 不論答案是誰都對。**這是繞過未知,不是解答未知。**

### 3-2 列表狀態不得被吃掉

`order-list-view.ts:305-325` 的 🔴 註逐字警告過:href builder 漏帶參數 = 翻頁/回跳時搜尋詞被靜默丟掉、列表 fail-open 變全部訂單。
⇒ `panel=` **必須走同一支 builder**,不得在 `orders-table.tsx` 自己拼字串。關閉連結 = 同一支 builder 不帶 `panel`。

### 3-3 面板捲動

只在 `.workspace-panel` 內層 `position:sticky; top:0; max-height:100svh; overflow-y:auto`。
⚠️ 誠實界線(codex 對 v1 的 must-fix,成立):`overflow-y:auto` **定義上就是新 scroll container**,
sticky 不會消除它 ⇒ **面板內**任何非 portal 的 `absolute` 下拉會被裁。現況 `multi-check-filter` 在左側 sibling、不在面板內,**暫時沒中**;
面板日後放下拉時要用 portal。350b 那兩格「row/content 不得成為 scroll container」的守門**維持不動、必須仍綠**。

## 4. 守門(針對 codex 對 v1 第 2/4/5 條的判別力批評重寫)

1. **三處 `maxDuration` 同值 + 皆 = 60**(改一處紅)。
2. **列表狀態保存**:給定含篩選/頁碼的 filter,`buildOrderListHref(f, 3, id)` 的 query 必須**同時**含篩選、`page=3`、`panel=id`
   —— 突變:builder 少帶任一參數 ⇒ 紅。(v1 第 2 條「字面路徑相似」已廢。)
3. **桌機改、手機不改**:`orders-table.tsx` 桌機那條走注入 href、手機那條仍是字面 `/orders/${id}`
   —— 突變:把手機也改成 panel href ⇒ 紅(釘住裁決③)。
4. **槽頁的開關語意**:無 `panel` → `null`;`panel` 非 UUID → `null`(不打 DB、不 `notFound()`)
   —— 突變:拿掉形狀閘 ⇒ 紅。
5. **catch-all 存在且回 null** —— 突變:改成回非 null ⇒ 紅。
6. 🔴 **真瀏覽器五態**(列表/開面板/關面板/跨區塊/F5)+ `<template>` 計數。
   **若 template 仍為 0,照實寫「這輪仍無判別力」**(`D-400-NOTE` 誠實界線 1;codex 對 v1 第 5 條的批評成立、不假裝)。

## 5. 不做什麼

- 不動其他 6 處 `/orders/[id]` 連結、不動手機路徑、不動 server action、不動 PII 投影。
- 不做 ✕ 圖示鍵(關閉 = 面板內的「返回訂單列表」連結,零 JS);要不要 ✕ 是品味題,Sean 拍。

## 6. rollback

單一 commit revert,**要連 `app/@panel/orders/` 與 `app/@panel/[...catchAll]/` 兩個目錄一起**。無 migration、無 schema、無資料寫入。

## 8. 🔴 已知未解:面板內送出任何表單會離開面板(code-reviewer 2026-08-10)

五支 server action 全部 `redirect(detailPath(orderId))` = `/orders/{id}`
(`cancel-actions.ts:214`、`note-actions.ts:162`、`refund-actions.ts`、`procurement-actions.ts`、`order-actions.ts`;
`order-edit-form.tsx:34` 的 `return_to` 也硬寫同一個路徑)。
⇒ 從面板按取消/加備註/採購/退款,**畫面會跳到整頁詳情、面板消失、列表的篩選與頁碼一起丟掉**。

**本片不修**:改 redirect 目標會動到 E 窗正在施工的 PRG 線與金流 action(鐵則 12 ①),
主視窗 2026-08-10 明令「不得自改、先落信申請」。
⇒ 已落 `D-404-Q` 請裁;在裁決之前,350c 交付的是**閱讀用的面板**(點開看、關掉回列表,列表狀態不掉),
不是「在面板裡完成一天工作」。**這個限制必須寫進 STOP 與 commit body,不得含糊帶過。**

## 7. 誠實界線(帶進 STOP)

1. 正式模式(`next start`)**未跑過** —— 登入閘 fail-closed 擋 303;只有 `pnpm build` + 真瀏覽器 webpack dev。
2. action POST 的計時 segment 未實測(§3-1)。
3. 面板內若放非 portal 下拉會被裁(§3-3)。
4. `E-032-ACK:3` 的 **D6-b** 掛本線,350 收線時接掉。
