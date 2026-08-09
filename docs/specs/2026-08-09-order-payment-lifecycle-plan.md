# 訂單付款生命週期片 — plan v1(2026-08-09)

> **狀態**:**v1 已批准、施工中**(Sean 對 §6 六題逐字 `Q1:a Q2:a Q3:a Q4:a Q5:a Q6:a`,批准經主視窗 `P-232-A` 轉達;
> 該信在信箱 `/Users/sean_1/pcm-mailbox/P-232-A.md`、**不在 repo**,拍板本體另落 memory `project_m4b-b2-shipments-db-decisions.md:76-83`)。
> 片型=**高風險片**(鐵則 12 ①錢 + ③DB 結構;鐵則 8 跨 3+ 檔)。
> **開工基底**:`dev` = `657b1217`。**內容分級**:全片無 L1/L2/L3 內容(純狀態機與排程,無文案 CRUD)。
> **開工令**:`P-230-A`。**拍板來源**:memory `project_m4b-b2-shipments-db-decisions.md:76-83`(08-09 三拍板+一追問)。
> **範圍**:三件同域(settle/裁決層)一次審 —— ①未付款 1 天自動失效 ②防雙付窗縮短 ③殭屍裁決缺席。

---

## §0 一句話

現在**沒有任何機制**會讓一張未付成的訂單自己走到終點:它永遠停在 `unpaid`、它的 attempt 永遠停在 `pending`,而那個 attempt 會在 10 分鐘內擋住這個人的所有重刷、在同一個購物車 session 下**永久**擋住。本片把這三段路各接上一個終點。

---

## §1 現況實測(全部帶 `檔案:行號`;沒有一條是推論)

### 1.1 防雙付窗的真值 = **10 分鐘**,而且沒有任何東西能縮短它

| 事實 | 位置 |
|---|---|
| per-user 閘:同 user、**異單**、attempt ∈ (pending, charged)、`created_at > now() - interval '10 minutes'`、且該單未 paid → 回 `user_in_flight` | `supabase/migrations/20260613130000_m3_3ds_0b_cart_session_dedup.sql:440` |
| 撞到這個閘時 **完全不做任何裁決** —— 直接 return,不打 Record、不 settle 那張在途單 | 同上 `:433-444` |
| sweeper 排程 = Supabase **pg_cron `*/2 * * * *`**(每 2 分鐘;不是 Vercel cron) | `supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql:128` |
| 但 sweeper 只認領 **年齡 > 600 秒** 的 stuck attempt | `apps/storefront/src/app/api/cron/settle-sweep/route.ts:60` |

🔴 **兩個 600 秒是同一個數字**(route.ts:54 的註解逐字寫「對齊 s2d user_in_flight 10 分閘」)⇒ **sweeper 對「縮短窗」的貢獻恆為 0**:它有資格動手的那一刻,窗已經自己到期了。每 2 分鐘跑一次跑得再勤也一樣。

**唯一能提早釋鎖的路徑只有一條**:同裝置、同 `cart_session_id` 回到站上按重新付款 → `preflightReleaseSibling` → `settle` 裁出 `failed`/`auth_or_pending` → release CAS 放行(`packages/use-cases/src/preflight-release-sibling.ts:96-121`)。
🔴 **release CAS 四閘含 `cart_session_id`**(同檔 `:32-36`)⇒ **Sean 換裝置重刷,這條路走不到**。他實測「數十秒到數分鐘」被擋 = 落在 10 分鐘窗內、且沒有任何裁決發生。

⚠️ callback 頁**已經**在回站當下呼 `settleCharge`(`apps/storefront/src/app/checkout/callback/page.tsx:125`),但它**只讀不放**:裁出 `auth_or_pending` 就渲染「處理中」,不釋鎖。所以「取消返回即時對帳」這件事,**對帳的部分已經有了、放行的部分沒有**。

### 1.2 殭屍 attempt 目前的終點 = 沒有終點

- 退避 `2^(settle_attempt_count-1)` 封頂 16 分,`settle_attempt_count >= 8` → `needs_manual_review = true`(`supabase/migrations/20260615120001_m3_3ds_4a2_attempt_sweeper_rpc.sql:210`)。
- 🔴 **轉人工只是加一個旗標,attempt 本體仍停在 `pending`/`charged`** —— `settle-charge.ts` 的 Fable R3 F2 註解逐字記過這件事(L2 之後位於 `:150-162`;行號會隨後續片位移,認那段文字別認行號)(Fable R3 更正:「那張單鎖到人工介入為止、沒有任何自動釋鎖」)。
- 效果:①10 分鐘內擋全帳號 ②**同一個 `cart_session_id` 永久** 撞 `needs_settle` → preflight → settle 回 `record_unverified` → `hold`「確認中稍候」,永遠。
- 時間軸估算:10 分(首次可認領)+ 1+2+4+8+16+16+16 分退避 ≈ **73 分鐘後進入永久殭屍態**。

### 1.3 `record_unverified` 是一個混合桶

`settle-charge.ts` step 4 的入口守門(L2 之前 `:91-117`,L2 之後 `:91-131`)把三種完全不同的事實壓成同一個 reason:
1. Record 查詢成功但 **0 筆**(=TapPay 這邊根本沒有這筆交易);
2. Record 回了紀錄但**識別/金額對不上**(=可能撈到別人的單);
3. `queryStatus` 不在白名單。

第 1 種是「幾乎可以確定沒扣款」,第 2 種是「危險、絕不可放行」。**現在無法分辨** ⇒ 件③要能安全落地,第一步就是把 not-found 從這個桶裡拆出來。

### 1.4 失效態可以掛哪:已經有一條乾淨的營運軸

| 事實 | 位置 |
|---|---|
| `orders.cancelled_at` / `cancelled_reason`(逐字「營運取消軸(獨立於 payment_status)」) | `supabase/migrations/20260712203000_m4a_orders_admin_columns.sql:56-57` |
| `payment_status` enum 五值 `unpaid/paid/partiallyPaid/refunded/partiallyRefunded` | `supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:50` + `20260725130000_*.sql:45` |
| admin 列表與明細**已經**會顯示「已取消」badge(讀 `cancelledAt !== null`) | `apps/admin/src/components/orders/orders-table.tsx:96,227`、`order-detail.tsx:249` |
| 客人端**已經**藏 unpaid 孤兒單(`.neq('payment_status','unpaid')`) | `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:358` |

### 1.5 既有 backlog 已經把方向定死過

`docs/phase-1-backlog.md:6329` 逐字:「🔴 孤兒/未付款單**絕不硬刪**(late-success 可能晚扣款 → 刪單=客人被扣款查無單=靜默多扣);Phase 1 處置固定=**留紀錄 + 藏 + 對帳掃描器收斂到終態**」。
本片 = 把這句話從「顯示層已做」補完成「資料層也有終態」。另 `#225`(`:5833`)= 殭屍 unpaid 單清理/標記,本片件①即其解。

---

## §2 三件的設計

### 件① 未付款 1 天自動失效

**掃描條件(全部必須成立才失效)**
```
payment_status = 'unpaid'
AND cancelled_at IS NULL
AND created_at < now() - interval '1 day'
AND NOT EXISTS (該單有 status IN ('pending','charged') 的 attempt)
```
🔴 最後一條是安全核心:**有 active attempt = 可能已扣款只是還沒收斂**,這種單一律不碰(留給 `needs_manual_review` 走人工)。少了這條,件①會把「正在被人工追的扣款單」標成失效。

**失效的形狀** → 決策題 Q1。推薦 **A = 沿用 `cancelled_at` + `cancelled_reason = 'payment_expired'`**:零 schema 改動、admin 兩處 badge 已經會顯示、且語意上它本來就是「營運軸、獨立於 payment_status」。系統失效與客服取消靠 `cancelled_reason` 常數分辨。

🔴 **反對新增 payment_status enum 值的理由(寫下來以免以後有人覺得那樣比較乾淨)**:PG enum 值加了不能刪;`payment_status` 現在被 begin/settle/confirm/sweeper 四層的 WHERE 直接比對(例:`20260613130000:407,441`、`20260615120001:99`),加一個值等於同時改動雙扣防線的每一道閘的語意 —— 這是本 repo 風險最高的四支 SQL,為了顯示層方便去動它們不划算。

**誰掃** → 決策題 Q5。推薦 **A = 新增一支窄權 RPC + 既有 pg_cron 新排一個 job**(`0 * * * *` 每小時即可;1 天的粒度不需要更密)。不掛進 `settle-sweep` route:那支的 60s 預算已被算到 ~50s(`route.ts:52-56` 逐字),再塞一段掃全表的工作會吃掉它的餘量。**不綁 Vercel cron**(memory `reference_pcm-platform-plans-*`:Hobby 方案,排程別預設綁 Vercel)。

**🔴 連動面(這是件①最容易漏的地方)**:失效單如果沒有從「兄弟單查找」與「cart dedup」裡排除掉,它會從「擋 10 分鐘」升級成**永久擋住那個 cart session**。要一起改的三處 WHERE:
- `find_active_sibling_own`(preflight 用)
- `begin_charge_attempt` 的 cart dedup 段(`20260613130000:400-412`)
- 同函式的 per-user 閘段(`:433-444`)
三處都要加 `AND o.cancelled_at IS NULL`。**沒有這三處,件① 是淨負作用。**

🔴🔴 **順手查出一個既有 bug(不是本片引入的)**:`admin_cancel_order` 已經會寫 `cancelled_at`(`supabase/migrations/20260804180000_m4b_e10_a8a1_admin_cancel_order.sql:242`),但上面三處 WHERE **一個都沒有** 看 `cancelled_at`(兩支 RPC 全檔 grep `cancelled_at` = 零命中)⇒ **今天客服取消一張未付款單,那張單照樣會擋住這位客人重新結帳**(同 cart session 是永久擋)。`find_active_sibling_own` 建於 `20260624`、`cancelled_at` 加於 `20260712` —— 典型的「新欄位沒回頭補進舊 WHERE」。件① 的三處連動改**同時修掉這個既有洞**;若 Sean 決定不做件①,這條要單獨立 backlog。

**失效單再付款** → 決策題 Q2。推薦 **A = 不復活、請客人重新下單**(購物車在失敗路徑本來就保留、重建成本低;復活等於要重驗庫存/價格/會員等級,是另一個片的量)。

**⚠️ 重估觸發(拍板時 Sean 逐字要求寫死)**:**開放匯款付款(後台第 15 項)時,「1 天」必須重看** —— 匯款常要 1-3 天,1 天會把正常等匯款的單殺掉。此條寫進 RPC 的 `COMMENT` 與 backlog,不只寫在 plan 裡。

### 件② 防雙付窗縮短

現況天花板已在 §1.1 量出來:**10 分鐘,零提早釋放路徑(換裝置時)**。兩個修法:

- **B1 callback 返回即時放行**:callback 已經在對帳(`page.tsx:125`),只差裁出 `failed` 時**同時**釋鎖。成本最低,但**只救同裝置**——Sean 遇到的正是換裝置。
- **B2 撞窗當下即時對帳**(推薦):`begin` 回 `user_in_flight` 時不直接報錯,而是先對那張在途單跑一次 `settleCharge`;裁出 `failed`(=Record 明確 -1/5、已 markFailed 釋鎖)就重試 `begin` 一次。裁不出來才照舊擋。**換裝置同樣有效**,因為它不依賴 cart session。

🔴 **B2 的三個必要護欄**(缺一就從修復變成新洞):
1. **節流**:每張在途單每 N 秒最多觸發一次 Record 查詢(否則重刷按鈕 = Record API 放大器 / DoS 面)。
2. **只放行 `failed`**:`auth_or_pending` / `record_unverified` / `record_unreachable` 一律維持擋住(fail-closed;這正是雙扣防線本身)。
3. **重試 begin 恰一次**:不迴圈。

🔴🔴 **件② 有一個本 plan 答不出來的硬前置**:客人在 3DS 頁按「取消」之後,**TapPay Record API 要多久才會回 `record_status = 5 (CANCEL)`**?
- 如果是秒級 ⇒ B2 幾乎能把窗壓到 0,件② 成立。
- 如果是分鐘級 ⇒ 即時對帳裁不出來(仍回 `4 PENDING` → `auth_or_pending` → 照擋),**件② 的天花板就是 TapPay 的索引延遲、不是我們的排程**。
✅ **已量(L1,2026-08-09)**:按取消 → Record 轉 CANCEL **≤1 秒**;但**放棄不碰**的單 44 分鐘全程 `4 PENDING`。
⇒ **件② 對「按取消」成立(= Sean 的情境)、對「直接關掉分頁」無效**,兩者要分開講,驗收文案不得一概而論。
完整數據見上方「🔴🔴 L1 probe 實測結果」一節。

### 🔴🔴 L1 probe 實測結果(2026-08-09,sandbox;直接推翻件③ 的一個前提)

兩筆同時起、唯一差異 = 有沒有人去 3DS 頁按取消。每筆從 charge 後 5 秒開始輪詢 Record:

| 組 | 情境 | 結果 |
|---|---|---|
| A | 在 3DS 頁按「取消」(= `GET /redirect/three-domain-secure/cancel/<urlId>`) | 取消送出 `12:27:10` → 下一次輪詢 `12:27:11` 已是 `record_status=5 (CANCEL)` ⇒ **索引延遲 ≤1 秒** |
| B | 建了單、**完全不碰**(= 關掉分頁) | **44.3 分鐘、90 次觀測,全程 `record_status=4 (PENDING)`**,從未轉終態 |

**對件② 的意義(好消息)**:客人**按取消**時,撞窗即時對帳裁得出來(≤1 秒)⇒ Q3=A 成立、窗可壓到「下一次動作當下」。
Sean 08-09 描述的正是按取消 ⇒ 他那個情境會被修好。
⚠️ 但客人**直接關掉分頁**時,Record 至少 44 分鐘仍是 `4 PENDING` ⇒ 即時對帳**裁不出來**、那條路只能靠時間。
件② 的驗收文案要據實描述,不能宣稱「取消後一定馬上能重刷」。

🔴🔴 **對件③ 的意義(壞消息,要重看設計)**:被放棄的 3DS 在 TapPay 端**不是「查無此筆」,而是恆為 `4 PENDING`**。
⇒ 那種殭屍走的 reason 是 `auth_or_pending`、**不是** `record_not_found`;
⇒ **件③ 若只認 not-found,對「客人放棄付款」這類殭屍完全沒有作用**(而那多半才是主要來源)。
P-221 當初記的「Record 連續 not-found」可能是把兩種殭屍搞混了。
**L5 開工前必須先回答:我們要自動裁定的殭屍,實際上是哪一種?**(`record_not_found` / 恆 `auth_or_pending` / 兩者)
—— 恆 `auth_or_pending` 的自動放行風險**高得多**(4 = 尚未授權,但也可能是授權中),不能沿用 not-found 那套條件。
本片(L2)的拆桶仍然是必要且正確的前置,只是它涵蓋的殭屍種類比原先設想的窄。

### 件③ 殭屍裁決缺席(Record 連續 not-found → 自動裁定未成交)

**第一步(必要前置,= L2、已實作)**:把 not-found 從 `record_unverified` 拆出來 —— 新增 pending reason
`record_not_found`。🔴 **實作時條件比本 plan 原稿嚴格得多**(原稿只寫 queryStatus + count 兩條;
兩輪審查各加了兩條,codex 關卡2 must-fix E 指出照原稿重做會漏掉三道雙扣防線)。**現行四條、缺一即落回
`record_unverified`**:
① **強識別**(本機已有 rec 或 bank)—— 弱識別只能用 order_number 反查,零筆多半是「我問錯了」;
② **`attempt.status === 'pending'`** —— `charged` 代表親眼看過 Record 給的 rec、交易存在過;`released` 鎖已釋;
③ `numberOfTransactionsReported === true` —— 筆數必須是 TapPay 真的回的,不是 parser 用 records.length 推的;
④ `numberOfTransactions === 0` **且** `records.length === 0` —— wire 不一致一律不採信。
其餘 unverified 情境(識別不符/金額不符/未知查詢碼)維持舊 reason、**永不自動放行**。

🔴 **這個 reason 的語意要講準**:它只代表「**這一次**查詢成功而 TapPay 回零筆」,**不是**「沒扣款」——
`bank_transaction_id` 在 charge **之前**就 durable,「錢已扣、索引還沒到」長得一模一樣。安全性必須由第二步的
「多次觀察 + 年齡閘」提供,不能由這個 reason 提供。

🔴 **拆桶不只是 TS 的事(L2 實作時查出的硬依賴)**:`last_settle_error` 存什麼,由 DB 兩支 retry RPC
(`mark_attempt_settle_retry` / `mark_webhook_retry`)的 allowlist CASE 決定;不在那份 allowlist 裡的碼會被
靜默正規化成 `'unknown'`。⇒ **只加 TS 不加 DB,L5 的判別條件永遠讀不到 `record_not_found`、自動裁定靜默不生效,
而且單元測試(mock 掉 RPC)會全綠**。故 L2 含一支 migration(比照 #251 零漂移做法),且 **L5 不得早於它 apply 上線**。

**第二步**:滿足下列全部才自動 `markFailed` 釋鎖 ——
```
attempt 仍 active(pending|charged)
AND order.payment_status = 'unpaid'
AND last_settle_error = 'record_not_found'   ← 🔴 見下方:這**不等於**「最近一次 settle 結果」
AND settle_attempt_count >= N
AND attempt.created_at < now() - T
```
🔴🔴 **`last_settle_error` 不是「最近一次結果」(Fable R3 F2,前兩輪都沒看到)**:只有 sweeper 的 ③ stuck
路徑會寫這一欄;② inbox 路徑寫的是 webhook event 的 `last_error`、同輪撞單的 dedup 連寫都跳過,而
**callback 與 preflight 的 settle 結果完全不落欄**。⇒ 這一欄會停在舊觀察上:t0 存了 `record_not_found`,
之後每輪都由 inbox 路徑對帳、實際早已轉成 `auth_or_pending`(Record 有這筆、正在授權),欄位卻沒變。
此時 L2 migration 頭寫的 TOCTOU 契約(status 仍 pending + order 仍 unpaid)**兩條都成立、擋不住** ⇒
L5 會對一筆**活的授權**釋鎖、客人重刷 = 雙扣。
⇒ **L5 的釋鎖前必須自己做一次新鮮的 Record 觀察**,或改走上面的出路 (a)(連續計數欄由所有 settle 路徑共同維護)。
**不得只憑這一欄的值放行** —— 這條寫進 L5 的驗收條件。

**N 與 T** → 決策題 Q4。推薦 **A:N=3、T=30 分鐘、零 schema**(直接用既有 `last_settle_error` + `settle_attempt_count` 兩欄,`20260615120001:75` 已有)。
🔴🔴 **原稿對 N 的判斷是錯的,已更正(codex 關卡2 must-fix B)**:原稿寫「計數只會偏多(更晚放行)、
不會偏少」—— **方向相反**。`settle_attempt_count` 在 **claim 當下**就遞增,與那一輪的結果是什麼無關
⇒ 兩次 `record_unreachable`/dedup 加上**一次** not-found 就湊到 `count >= 3`,實際只觀察過**一次**查無。
⇒ Q4=A 的「零 schema 近似」在安全方向上是**偏鬆**而不是偏緊,**不能照原推薦直接做**。
兩條出路,**要 Sean 重裁**:
  (a) L5 自帶一個「連續 not-found 次數」欄位(= 原 Q4 選項 B,加一欄、計數真的是連續的);
  (b) 維持零 schema,但把安全性整個壓在年齡閘 T 上(N 退化成噪音過濾、不當作證據強度)。
本 plan 傾向 **(a)** —— 這是動錢的放行條件,用一個「可能只看過一次」的計數當證據不划算。

🔴 **為什麼 T 不能省**:TapPay 索引延遲會讓剛送出的 charge 短暫 not-found;T 就是這個延遲的安全邊際。

🔴 **T 目前沒有夠格的量測依據(codex 關卡2 must-fix C)**:L1 probe 量到的是「**按下取消** → Record 轉
`5 CANCEL`」≤1 秒,那是**終態轉換**的延遲,**不是**「一筆**成功扣款**多久才在 Record 查得到」——
後者才是誤釋鎖的風險來源。L1 附帶量到的相關事實只有一條:**pay-by-prime 3DS 啟動後 ~5 秒,該筆就已經
在 Record 查得到**(第一次輪詢 = charge 後約 5 秒,已回 `count=1 / record_status=4`;更早沒量)。
這對「交易存在與否」是有力旁證,但**成功扣款路徑的索引延遲仍未直接量過** ⇒ T=30 分屬保守猜測,
**要嘛在 L5 開工前補量,要嘛把 T 訂得明顯大於任何合理索引延遲**(並在 L5 的 RPC COMMENT 寫明依據)。

### 件④(附帶,量最小)admin 列表預設不顯示失效單

`AdminOrderFilter`(`packages/domain/src/order/types.ts:217`)加一個「含已取消/失效」的開關,列表預設關。連動:`SupabaseOrderAdapter` 的 list 查詢 + 篩選列 UI + URL 參數。**實作可切給後續片**(開工令 §2 逐字允許),本 plan 只列連動面。

---

## §3 片切分(6 片 L1-L6,依 DAG)

| 片 | 內容 | 鐵則 12 | 前置 |
|---|---|---|---|
| L1 | ~~sandbox probe:量 3DS 取消 → Record 轉 CANCEL 的延遲~~ **已完成 2026-08-09,結果見上方「L1 probe 實測結果」** | — (零 code、零 repo 寫入) | ~~Sean 授權~~ 已授權(P-232-A ②) |
| L2 | 件③ 第一步:`record_not_found` reason 拆桶(型別 + use-case + **retry RPC allowlist migration**) | ①錢③ | — |
| L3 | 件① migration:失效 RPC + pg_cron job + **三處 WHERE 加 `cancelled_at IS NULL`** | ①③ | — |
| L4 | 件② B2:撞窗即時對帳 + 節流 + 重試一次 | ①錢 | L1(數字決定要不要做)、L2 |
| L5 | 件③ 第二步:not-found 自動裁定放行 | ①錢 | L1(定 T)、L2、L4 |
| L6 | 件④ admin 列表預設隱藏 | — | L3 |

L3 與 L2/L4/L5 無資料依賴,可並行;**L1 擋 L4 與 L5**。

---

## §4 測試設計(反恆真紀律;每條斷言配自己的突變)

1. **件① 的安全條件要能被單獨殺死**:構造「有 active attempt 的 1 天前 unpaid 單」→ 突變掉 `NOT EXISTS` 那條 ⇒ **只有這筆**變成被失效。🔴 fixture 的年齡要坐在 1 天邊界的**兩側各一筆**,且**不得**讓某一筆同時被兩個條件擋住(否則證明不了是哪條在擋 —— 08-09 LINE 片踩過的同一個坑,見 memory `feedback_negative-test-observation-supplied-by-another-mechanism`)。
2. **三處 WHERE 的連動**:失效單 + 同 cart session 再結帳 ⇒ 必須 `proceed`。突變:拿掉任一處的 `cancelled_at IS NULL` ⇒ 只紅對應那一條(三條各自可分辨,不共用 fixture)。
3. **件② 只放行 failed**:四種 settle outcome 各一條負測,只有 `failed` 那條放行。突變:把 `auth_or_pending` 也放行 ⇒ 只紅一條。
4. **件② 節流真的生效**:連按兩次 ⇒ 第二次不得再打 Record。突變:拿掉節流 ⇒ 該條紅(斷言要數 **Record 呼叫次數**,不是數回傳值 —— 回傳值兩次都一樣,量錯東西)。
5. **件③ 不得誤放行**:`record_unverified`(識別不符)重複 N 次以上 ⇒ **永不**放行。這條是件③ 的安全核心,突變=把 `record_not_found` 判斷放寬回 `record_unverified` ⇒ 該條紅。
6. **觀測性**(08-09 R3 教訓:修法把閘往前移會消滅原本的證據鏈):件①/件③ 每次自動裁決都要留一行結構化 log(`orderId` / `attemptId` / 原因 / 計數,零 PII)。沒有它,上線後「殭屍清光了」和「掃描器根本沒跑」在觀測上長得一模一樣。

---

## §5 風險 / rollback / 誠實邊界

- **最大風險 = 件① 誤殺已扣款單**。防線:§2 件① 的 `NOT EXISTS(active attempt)` + 只寫 `cancelled_at`(**不動 `payment_status`、不刪任何資料**)⇒ rollback = 一句 `UPDATE orders SET cancelled_at=NULL, cancelled_reason=NULL WHERE cancelled_reason='payment_expired'`,完全可逆。
- **第二風險 = 件②/件③ 把雙扣防線開太大**。防線**兩者不同,不可混為一談(codex 關卡2 must-fix D)**:
  - 件②(撞窗即時對帳)只在 Record **明確回終態**(`record_status` -1/5,已 `markFailed`)時放行;
  - 件③(殭屍裁定)放行依據是**零筆查無**,那**不是**終態 —— 它的安全性完全來自「多次觀察 + 年齡閘 T」
    加上第一步那四道產生條件。這條要寫清楚,否則後人會以為件③ 也有終態背書。
- **誠實邊界(現在不知道、plan 不假裝知道)**:
  1. ~~TapPay 取消後 Record 的索引延遲~~ **已量(≤1 秒;放棄型 44 分鐘仍 PENDING)**。
     🔴 但**仍未量**的是另一個數字:「一筆**成功扣款**多久才在 Record 查得到」—— 那才是件③ T 的依據。
     目前只有旁證:charge 後 ~5 秒該筆已可查到(當時 `record_status=4`)。
  2. ~~正式站現在有幾張殭屍 pending / 幾張 >1 天的 unpaid 單~~ **已由主視窗盤點(P-232-A ②):殭屍 0 / pending 0 /
     unpaid >1 天 0 = 零歷史包袱** ⇒ L3 的 migration 不需回填,件① 上線當下對存量的影響是 0(純預防)。
  3. `settle_attempt_count` 的實際分佈(有沒有單已經到 ceiling)—— 未查(存量 0 ⇒ 目前無意義,
     但 L5 上線後要能看得到)。
  4. **`record_not_found` 判定當下沒有留任何 log**(Fable R3 F4):callback / preflight 路徑的 not-found
     不經 retry RPC ⇒ 事後零痕跡,災難當天只看得到 sweeper 寫過的欄位值。一行零 PII log 即可,**併 L5 做**。
- **本片不做**:不改 `payment_status` enum、不動 A8 取消線的 `order_cancellations` 與庫存回退(unpaid 單無庫存佔用,走那條重機制是浪費)、不做失效單復活、不碰 refund 線。

---

## §6 決策題(給 Sean;答案會改變架構的排前面)

```
Q1 未付款 1 天「失效」記在哪裡?
A: 沿用既有 cancelled_at + cancelled_reason='payment_expired'(零 schema、後台已會顯示「已取消」badge、可一句 SQL 回滾)  ← 推薦
B: 新開一個 expired_at 欄位(語意最乾淨,但 domain/mapper/型別/後台各接一輪,多一片的量)
C: payment_status 加一個 'expired' 值(PG enum 加了不能刪,而且會同時改動四支雙扣防線 SQL 的比對語意,最貴)
A: A|B|C

Q2 失效掉的單,客人事後想付款怎麼辦?
A: 不復活,請他重新下單(購物車在付款失敗時本來就保留,重建很快)  ← 推薦
B: 可以復活(要重驗庫存/價格/會員等級,是另一片的量)
A: A|B

Q3 防雙付窗要怎麼縮短?(現值實測=10 分鐘、換裝置時零提早釋放)
A: 撞窗當下就對帳一次,查出「確定沒扣到款」立刻放行(換裝置也有效 = 你上次遇到的情況)  ← 推薦
B: 只在 3D 取消返回網站那一刻對帳放行(最省,但只救同一台裝置)
C: A+B 都做
A: A|B|C

Q4 殭屍單(TapPay 那邊查不到這筆交易)要試幾次、隔多久才自動判定沒成交?
A: 查無 3 次以上、且這筆已經超過 30 分鐘 → 自動放行(用現成欄位、零 schema)  ← 推薦
B: 要求「連續」3 次查無才算(比較嚴謹,但要加一個新欄位記連續次數)
A: A|B

Q5 誰負責定時掃出過期的未付款單?
A: 新開一支資料庫排程 job(每小時跑一次,與現有每 2 分鐘的對帳掃描分開)  ← 推薦
B: 塞進現有的對帳掃描器(省一個 job,但那支的 60 秒預算已經用到 ~50 秒,會擠爆)
A: A|B

Q6 開工前的兩件事要不要做?
A: 兩件都做:①sandbox 實測「3D 取消後多久 TapPay 才查得到取消」②唯讀盤點正式站現在有幾張殭屍單  ← 推薦
B: 只盤點正式站,sandbox 實測跳過(那 Q3/Q4 的數字就只能用猜的、且事後無法證明有沒有效)
A: A|B
```

— plan v1 結束。**六題已於 2026-08-09 全拍 A、施工中**;各片實作若推翻本 plan 的設計,更正寫回本檔並在該段標明(L2 已有一處:見 §2 件③ 的 DB allowlist 硬依賴)。
