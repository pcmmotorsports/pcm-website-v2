# #347-2b 訂單關鍵字搜尋 UI 接線(片級 plan v1,待主視窗核)

> 承 `docs/specs/2026-08-09-347-2a-keyword-search-adapter-plan.md`(2a 已收割 `2891e2c8`)。
> 主視窗 2026-08-10 更正片界:佇列的「2b」= **347-2b**,不是出貨線 2b(那條 08-09 已全線收官)。
> 片型 = **標準片**(不碰錢/schema/平台設定;但碰 **PII 載體**,見 §4)。內容分級 = **L1**。

## 0. 一句話

`filter.keyword` 現在**零產出者**(實查:admin 全樹 grep `keyword` 在 `order-list-view.ts` / `page.tsx` /
`order-filter-*.tsx` **零命中**)。本片把它接起來:搜尋表單 → POST server action → PRG → 列表用它查。

## 1. 三條硬前置(2a plan `:111-120` 指定,逐條落地)

| # | 硬前置 | 落地 |
|---|---|---|
| ① | **Q-a=B:POST server action + PRG**,搜尋詞不進 URL | 新 `lib/orders/keyword-search-action.ts`;紅線一致性=347-1 POST-only + A13b「URL 只帶碼」 |
| ② | **翻頁 / 回跳必須保留搜尋詞** | 見 §2 —— 這是本片**唯一的架構決定** |
| ③ | **`keywordTruncated=true` 必須渲染提示**(含 0 筆)+ 突變 | 提示掛列表頂;守門一格 + 突變 |

statement_timeout:**免重量**,引用 `supabase/migrations/20260809180000…` 檔頭實量值即可(service_role=300s)。

## 2. 🔴 本片唯一的架構決定:搜尋詞不進 URL,那翻頁怎麼帶著它?

2a plan `:112-115` 已經把問題寫死了:`buildOrderListHref` 是把 filter 逐欄拼成 query string 的,
而搜尋詞**刻意不在 query string 裡** ⇒ 員工搜完按「下一頁」**搜尋詞就消失、列表靜默變成全部訂單**,
正是 `order-list-view.ts` 那條註解親自警告過的 fail-open 形狀。

**推薦 = A:server 端 cookie 當載體。**

- 搜尋 action:正規化 → 寫 `admin_order_keyword` cookie(**httpOnly**、`sameSite=lax`、**session cookie 不給 max-age**)→ `redirect('/orders')`(丟掉 `page`,搜尋一律回第 1 頁)。
- `app/orders/page.tsx`:`cookies()` 讀它 → 餵 `filter.keyword`。**分頁 `<Link>` 一個字不動**,搜尋詞天然跟著走。
- 清除搜尋:同一支 action 收到空字串 → 刪 cookie → PRG。
- 本 repo **已有兩處 cookie 前例**可照抄:`app/layout.tsx:41`(server 讀)與 `lib/session/*`(httpOnly 寫)。

替代案(不推薦,理由寫著給下一個人看):
- **B = 每個分頁鈕都改成 POST 表單** ⇒ 殺掉現有零-JS `<Link>` 分頁(中鍵/新分頁/鍵盤全失),為了一個軸賠掉整組導航。
- **C = 放回 URL** ⇒ 直接推翻 Q-a=B 與 347-1 的紅線,不在本片可拍板範圍。

### 🔴 2-1 A 案的兩個代價,必須連著修法一起收

1. **搜尋詞從畫面上消失了** —— URL 不帶、cookie 看不見 ⇒ 員工**不知道自己正在搜什麼**,
   只看到「列表怎麼少了一堆單」。⇒ **本片必須顯示一條「目前搜尋:XXX ✕」**,這不是加分項、是 A 案成立的前提。
2. **cookie 是跨分頁共用的** ⇒ 兩個分頁搜不同的詞會互相蓋。session cookie + 常駐顯示搜尋詞
   讓它**看得見、關得掉**;完全消除要走 B 案,代價更大。**這條寫進誠實界線,不假裝沒有。**

### 🔴 2-2 cookie 形狀(主視窗 2026-08-10 裁決條件③:在 plan 釘死)

| 項 | 值 | 為什麼 |
|---|---|---|
| 名稱 | `admin_order_keyword` | 與 `ADMIN_SESS_COOKIE` / `WORKSPACE_PANEL_COOKIE` 同命名族 |
| 值 | `encodeURIComponent(keyword)` | 搜尋詞**合法含中文 / 空白 / 逗號 / `%`**(2a domain 檔頭:本軸刻意無字元集守門)⇒ 不編碼會弄壞 `Set-Cookie` 標頭 |
| `httpOnly` | **true** | 搜尋詞是 PII,不給 client JS 讀 |
| `sameSite` | `lax` | 跨站送出無意義;`strict` 會讓從外部連結回來的第一次請求讀不到 |
| `secure` | `NODE_ENV === 'production'` | 本機 http 開發要讀得到 |
| `path` | `/` | 列表頁與未來的其他消費者都在同一棵樹下 |
| max-age | **不給**(session cookie) | 關瀏覽器就沒;搜尋詞可能含客人姓名,不長留 |

🔴 **讀取一律 fail-closed = 當沒搜尋**(裁決條件③):`decodeURIComponent` 擲錯、超過
`MAX_ORDER_KEYWORD_LENGTH`(120)、正規化不是 `ok` —— 任何一種都回 `null`,**不擲錯、不顯示錯誤**。
理由:cookie 是使用者可竄改的輸入,而「壞 cookie 讓整個訂單列表打不開」比「搜尋失效」嚴重得多。
⚠️ 這條配一組負測(壞值 / 超長值 / 非 `ok` 三格),突變:拿掉任一道閘 ⇒ 紅。

### 2-3 清除搜尋也走 PRG(裁決條件①)

✕ 走**同一支 server action**(送空字串)→ 刪 cookie → `redirect('/orders')`。
🔴 **不得**做成 client 捷徑(`router.replace` / 直接清 state)—— 那會讓「清除」繞過本片剛立的紅線,
變成兩條語意不同的路徑,而其中一條沒有人守。

## 3. 檔案清單

| # | 檔 | 動作 |
|---|---|---|
| 1 | `lib/orders/keyword-search-action.ts` **新** | `'use server'`:正規化 → 寫/刪 cookie → `redirect('/orders')` |
| 2 | `lib/orders/order-keyword-cookie.ts` **新** | cookie 名稱 + 讀取 + 正規化(**兩端唯一落點**,不讓 action 與 page 各寫一份) |
| 3 | `app/orders/page.tsx` | 讀 cookie → `filter.keyword`;`keywordTruncated` 提示 |
| 4 | `components/orders/order-filter-controls.tsx` | 關鍵字搜尋框改 **POST form**(`action={searchAction}`);既有兩軸(單號/供應商單號)**不動** |
| 5 | 守門 | 見 §4 |

## 4. 守門(每條配突變)

1. **搜尋詞不進 URL**:action 的 `redirect` 目標**不得含**搜尋詞 —— 突變:改成帶 `?q=` ⇒ 紅。
2. **翻頁保留**:給定 cookie 有值,`page.tsx` 解析出的 `filter.keyword` 必須是它;分頁 href 仍**不含**搜尋詞。
3. **`keywordTruncated=true` ⇒ 提示一定渲染,包含 total=0** —— 突變:拿掉提示 ⇒ 紅;
   🔴 **0 筆那格是重點**(2a plan `:132`:0 筆 + 沒提示 = 員工得到「查無此單」的錯誤結論)。
4. **搜尋詞常駐可見 + 可清除**(§2-1 代價 1)—— 突變:拿掉顯示 ⇒ 紅。
5. **cookie 是 httpOnly**(PII 不給 client JS 讀)—— 突變:拿掉旗標 ⇒ 紅。

## 5. 不做什麼

- 不動 RPC 簽章、不動 2a 的 domain/port/adapter(Q14 日期參數隨 **347-3**)。
- 不動既有單號 / 供應商單號兩軸(它們在 URL 是既有設計,本片不順手改)。
- 不做「可分享的搜尋網址」—— Q-a=B 已明文接受這個代價。

## 6. rollback

單一 commit revert。無 migration、無 schema、無資料寫入;cookie 殘留無害(下一版讀不到就當沒搜)。

## 7. 待確認(開工前想聽主視窗一句)

- §2 的 A 案(cookie 載體)與 §2-1 的兩個代價,**接受嗎?** 代價 1 的修法(常駐顯示搜尋詞)我當成前提直接做。
- cookie 生命週期我取 **session cookie**(關瀏覽器就沒)——理由是搜尋詞可能含客人姓名,不長留。
