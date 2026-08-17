# E-698 §1「還沒驗證」九項 —— 第二輪能從 code 推進的部分

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**面**:網站庫 storefront(`pcm-website-v2`)
- **承接**:`E-698` §1 的九項未驗清單。本輪推進**不需正式站、不需 anon key** 的那幾項(靠讀 code + 官方文件 + React 語意);其餘仍卡在 anon key / Dashboard。
- **口徑**:量到的(讀 code)與推出來的分開標。

## 逐項狀態

| # | 項目 | 本輪結果 | 還缺什麼 |
|---|---|---|---|
| 1 | facet-counts 放大 108× | 🔴 **anon key 到了也量不到** —— 放大是 **server 端 RPC fan-out(Vercel app route)**,anon key 打的是 Supabase REST、看不到內部 RPC 次數 ⇒ **維持「讀來的 108×」不升級**(a4 拍板:量不到就別因打過而升級) | 要真量倍數得從 app 內側觀測(非外部 REST) |
| 2 | facet-counts key 空間規模 | 未推進 | 有權限的人數合法組合(**帳號被鎖**) |
| 3 | 會不會被打爆 | 未推進(**明文不在正式站壓測**) | 非正式環境評估 |
| 4 | tappay-notify 限流委派 Vercel WAF | 未推進 | Vercel WAF 規則(**Dashboard,Sean**;已立 backlog `#607`) |
| **5** | **tappay-notify 端點還沒真上線** | ✅ **見下 §5,升級成 code 強制 gate** | 只缺 `TAPPAY_3DS_ENABLED` 的**正式站 env 現值** |
| **6** | **cache() 只同請求內對同 handle 去重** | ✅ **見下 §6,code + React 語意確認** | 無(結構已定;實測只確認計數) |
| 7 | resolveCartLines 400 往返 | ✅ 結構已定(§7,有上限 200+循序=LOW);**app server action,外部 REST 量不到、實測只確認計數不改結構** | — |
| 8 | login/forgot 節流粒度 | ✅ 已收口(`supabase-recovery-throttle-granularity`;Sean 截圖=自建 Resend、判輕) | — |
| 9 | 報價單 anon 經 REST 實看到什麼(net/pg_stat) | ✅ **已收口**:net/extensions 經 REST **406 不可達**、db-schemas 白名單=public+graphql_public(`quote-db-round2` §2) | — |

---

## §5:tappay-notify「還沒真上線」—— 不只是註解,是 code 強制的 gate(嚴重度**維持折扣**)

**量到的(讀 code)**:
- `TAPPAY_3DS_ENABLED` 是 **env var**:`three-ds-flag.ts:19` = `process.env.TAPPAY_3DS_ENABLED === 'true'`(非 `'true'` 一律 off、**預設 off**)。
- `backend_notify_url` **只在 flag on 時**於 runtime 組(`three-ds-urls.ts`:charge-actions flag on 才組),**不是常駐設定**。
- route 檔頭(`tappay-notify/[secret]/route.ts:18`)寫的是**設計不變量**:「3DS-4 sweeper(**未實作**)前不設 backend_notify_url、不開 `TAPPAY_3DS_ENABLED`、不開放 prod 結帳」。
- **即使 webhook URL 被打**,無 flag ⇒ 無真 3DS 流 ⇒ 無 active attempt ⇒ route 處理序第 5 步 `findActiveByOrderId` = null → 200 drop(**端點對不上本機單就丟**)。

⇒ **判定**:E-698 說這條「替嚴重度打折」——**折扣站得住,而且比原本更硬**:它不是一句可能過期的註解,是「flag 預設 off + 3DS-4 未實作」兩道 code gate。**除非有人在 prod 把 `TAPPAY_3DS_ENABLED=true` 翻開(而 3DS-4 還沒好)**,折扣才失效。

🔴 **未確認(缺哪一道)**:`TAPPAY_3DS_ENABLED` 的**正式站現值**。它是 env var(Vercel),**DB 端與本機樹(無 .env.local)都讀不到**。缺的檢查 = 看 Vercel prod env 的 `TAPPAY_3DS_ENABLED`(Sean / Dashboard;`vercel env` 需授權,唯讀窗沒有)。若量到 `=true` 而 3DS-4 未實作 ⇒ 嚴重度往上調。

---

## §6:cache() 去重範圍 —— per-request per-argument(結構確定)

**量到的(code + React 語意)**:`fetchProductByHandle = cache(async (handle) => ...)`(`products.ts:759`),React `cache()`。檔內註解(`:754-758`)自陳「同一請求內去重、React per-request memoization、跨請求不共享」。

- React `cache()` 按**參數**做 per-request memoization ⇒ **同請求 + 同 handle** 才回快取(詳情頁 `generateMetadata` + default export 用同 slug 各呼一次,這是它去重的實際情境)。
- **相異 handle 不共享**:同請求內 200 個**不同** handle = 200 個 cache key = **200 次查詢**(cache 不跨參數去重)。
- 跨請求不共享、不影響新鮮度。

⇒ **判定**:E-698 §1#6 的敘述正確。它**不是**多 handle 的放大緩衝(那是 `resolveCartLines` §1#7 的事)。「實測 200 handle」只會**確認計數**(200 次),**不改變結構結論**——結構從 React `cache()` 的 per-argument 語意即可斷。

---

## §7:resolveCartLines「400 往返」—— 是**有上限 + 循序**的成本,不是無界洞(結構已定)

**量到的(讀 `apps/storefront/src/app/cart/actions.ts`)**:
- `MAX_LINES = 200`(對齊 create_order RPC「品項≤200」),輸入 `lines.slice(0, MAX_LINES)` ⇒ **截斷到 200**(非 reject;對公開價顯示而言截斷可接受,不是「少印」那類病)。
- 每行 `await fetchProductByHandle(productId)` 在 **`for...of` 內循序 await(非 `Promise.all`)** ⇒ **循序、不併發**。
- 每個 found handle 約 **2 次查詢**(`findByHandle` embed 變體 + `listInheritedFitments`,`products.ts` 內恆呼);not-found 只 1 次。`cache()` 對同請求重複 handle 去重。
- ⇒ **最壞 = 200 個相異 handle × 2 = 400 次循序往返/請求**。E-698 的「400 上界推算」**結構確認成立**(200 常數 × 2 查詢)。
- **無 auth**(設計:只解析公開 general 價、逐欄白名單 `unitPrice` only、無 priceByTier/store/cost)⇒ 匿名可達。

**判定(嚴重度 LOW,而且 E-698 擔心的那個 200 常數正是緩解)**:
- 🔴 **與 `fetchShipmentCandidates` 對照(同「無界 fan-out」家族,但方向相反)**:cart 是 **有上限(200)+ 循序** ⇒ 每請求成本**有界**(≤400)、**不併發**(不撞 pooler 連線上限);shipment 是 **無界 + `Promise.all` 併發** ⇒ 那才是要修的。**cart 的 200 截斷 = 已經在擋了。**
- **無資料曝露**(只公開 general 價);amplification 是「一請求 ≤400 循序查詢」的 DoS 味道,匿名可重複,但**每請求有界**。典型購物車遠不到 200 相異品、`cache()` 再去重 ⇒ 400 是最壞上界、非常態。
- **未推進的那半**:實打一發 200 行請求量真實往返數與延遲 = **需 anon key / 非正式環境**;但那只會**確認**這個上界,不改結構結論(結構從循序 await + 2 查詢/handle 即可斷)。

## 8. §1#1 觀測點規格(要在正式站真量 facet-counts 放大,施工窗照這加;E 出規格、不實作)

**為什麼外部 anon key 量不到**:放大是 **server 端 fan-out**(`vehicle-facet-counts.ts`:一次 facet-counts 請求 → 對 `search_catalog_by_vehicle` 發 **92 分類(15 大類 + 77 子類)+ 16 品牌 = 108** 次 `p_limit=1` 查詢)。外部只看得到 HTTP 回應,看不到 server 內部發了幾次 RPC。`108×` 是 **2026-07-31 本機打正式 Supabase 量的**(檔頭 `:16`);正式站的真實 per-request 次數/延遲/快取命中率**沒在正式站量過**(`:50-52` 自陳「正式站延遲完全沒量」)。

**要量什麼(per facet-counts request,結構化一行 log)**:
1. `rpc_count` — 這次實際發了幾次 `search_catalog_by_vehicle`(冷 miss=~108、快取命中=0、部分分類短路可能 <108)。
2. `duration_ms` — fan-out 總時間。
3. `cache_hit` — `unstable_cache` 命中(true→~0 RPC)或 miss(false→full fan-out)。
4. `fanout_rejected` — 是否被 `MAX_CONCURRENT_FANOUTS = 3`(`:69`)擋(→null→503)。
5. `facet_key_count` — 這次算了幾個 facet(92+16 的當下值,隨字典變)。

**在哪加(只加觀測、不改 fan-out 行為)**:
- `vehicle-facet-counts.ts` fan-out 迴圈:request-scoped 計數器,每發一次 RPC +1;`fetchVehicleFacetCounts` 收尾 emit 上面 5 欄一行 log。
- `cache_hit`:`unstable_cache` callback 有沒有被呼叫到(進 callback=miss)。
- `fanout_rejected`:`activeFanouts >= MAX_CONCURRENT_FANOUTS`(`:177`)分支命中時記一次。

**怎麼讀回來**:log → Vercel logs / 既有 sink 聚合,看正式站 `rpc_count` 分布(確認真是 ~108 還是更多/更少)、p95 `duration_ms`、cache miss 率、被拒率。**這才是把「讀來的 108×」升成「正式站量到」的那道檢查。**

🔴 **紀律**:純加觀測、不改 fan-out 行為;log 不帶 PII(facet 是公開車輛資料);**每 request 一行、不是每 RPC 一行**(否則 log 量本身變成新放大面)。

## 口徑

本檔只對網站庫 storefront 成立。#5 的 env 現值、#1(app 內側觀測,規格見 §8)/#2/#3 的實打面仍缺(anon key / 非正式環境 / Dashboard），已逐項標明缺哪一道。#6/#7/#9 結構或外部面已定。
