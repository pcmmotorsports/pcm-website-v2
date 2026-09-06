# Plan · 匯款到期日界(Sean `Q-匯款到期 = 乙`)—— 線【帳號】`account` 2026-09-06

> **狀態:等主視窗批。批了才動。**
> 拍板逐字(`~/pcm-mailbox/明早Sean清單-20260906.md:97`):
> 「乙 = 改系統(改成「第 5 天整天都算, 隔天 00:00 才取消」⇒ 字不用改;每張單最多多活 24 小時;要再貼一支 SQL)」
> Sean 的答字在 `~/pcm-mailbox/端Sean-0905早上佇列.md:1317` 逐字「Q-匯款到期=乙(改系統日界)」。

## 1. 現況(全部當場量到,不是回憶)

| 事實 | 落點 | 逐字 |
|---|---|---|
| 現行那一代 | `scripts/latest-definition-of.sh expire_unpaid_orders` ⇒ `newest = live = 20260904230000` | `20260904230000_m4b_noncardpaid_settle_and_expire_leg.sql:401` `CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500)` |
| 到期述詞 | 同檔 `:455-459` | `AND o.created_at < pg_catalog.now() - CASE o.payment_channel` / `WHEN 'tappay' THEN interval '1 day'` / `WHEN 'bank_transfer' THEN interval '5 days'` / `WHEN 'cash' THEN interval '5 days'` |
| 白名單 | 同檔 `:454` | `AND o.payment_channel IN ('tappay', 'bank_transfer', 'cash')` |
| 客人看到的那一句 | `packages/domain/src/order/remittance-info.ts:127` | `請於 ${label}(含)之前完成匯款,逾期訂單將自動取消。` |
| 那一天怎麼算 | 同檔 `:93` | `new Date(t + PCM_REMITTANCE_EXPIRE_DAYS * 24 * 60 * 60 * 1000)` 再用 `Asia/Taipei` 取日曆日 |
| 排程 | `20260809170000_..._schedule.sql:77` | `cron.schedule('pcm-expire-unpaid-orders', '0 * * * *', …)` ⇒ **每小時整點(DB 是 UTC)** ⇒ 台北 00:00 那一發會跑到 |

**⇒ 落差就是 Sean 講的那個**:文案說「9/10(含)之前」,而 cron 是時戳比較 ⇒ 9/5 12:00 下單的單,9/10 12:00 之後任一整點就可能被取消,不是 9/10 整天。

## 2. 要改什麼(一句話)

把到期判準從「`created_at` + N 天那一刻」改成「**`created_at` 在台北的那一個日曆日 + N 天 + 1 天的 00:00(台北)**」。

新述詞(取代 `:455-459` 那五行,其餘一字不動):

```sql
       AND pg_catalog.now() >= pg_catalog.timezone(
             'Asia/Taipei',
             pg_catalog.date_trunc('day', pg_catalog.timezone('Asia/Taipei', o.created_at))
               + CASE o.payment_channel
                   WHEN 'bank_transfer' THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「乙 5天」
                   WHEN 'cash'          THEN interval '5 days'   -- 🔴 Sean 2026-09-03 逐字「甲 跟匯款一樣 5 天」
                 END
               + interval '1 day'                                -- 🔴 Sean 2026-09-06「隔天 00:00 才取消」
           )
```

驗算(N=5,台北):9/5 任何時刻下單 ⇒ 日曆日 9/5 ⇒ `+5 天` = 9/10 00:00 ⇒ `+1 天` = **9/11 00:00 取消**
⇒ 9/10 **整天有效** ⇒ 與畫面上的「9 月 10 日(含)之前」逐格對齊。

### 2-b 🛑 `tappay` **不動** —— 這是刻意的,不是漏掉

- 新述詞的 `CASE` **只列 bank_transfer / cash**,`tappay` 走**另一支**,維持原本的 `created_at < now() - interval '1 day'`。
- 理由三句:①Sean 那題的主詞是**匯款**(題目字面「請於 9/10(含)之前完成匯款」),刷卡沒有這句話,沒有要對齊的東西 ②刷卡棄單多活 24h 會**多佔住「同車只能有一張活單」**那道剛上線的守門(`⟦b4-BANKCARDRACE⟧` / `20260906500000`)⇒ 客人重下同一台車要多等一天 ③「不改」= 現況 = 不需要任何人拍板;「改」才是新行為。
- ⇒ 主視窗若判**要一起改**,那是產品題,我把它端給 Sean,不自己決定。

## 3. 怎麼落地

**要新 migration。** 沒有別條路 —— `prosrc` 住在正式庫,不改就不會變。

- 新檔:`supabase/migrations/20260906600000_m4b_expire_day_boundary.sql`(版本號動手當天再確認沒撞號)
- 形狀:`BEGIN` → 前置閘 → `CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders` **整支從 `20260904230000:401` 抄**(動手當天**重跑一次** `scripts/latest-definition-of.sh`,不照本檔抄 —— 本檔寫下的「來源是 20260904230000」是個會過期的座標)→ 事後斷言 → `COMMIT`。
- 🛑 **`20260828060000` 板上逐字標「禁止重貼」**(它是舊一代,重貼會用舊版蓋掉新版)—— 本片不碰它。
- **前置閘**(擋兩種世界):
  - 線上那支 `prosrc` 剝註解後**必須**含 `order_payments` / `sweeper_heartbeat` / `5 days` / `)<=0` ⇒ 少任一個 = 線上不是我以為的那一代 ⇒ `RAISE EXCEPTION` 停下。
  - 已含新形狀(`date_trunc('day'` + `Asia/Taipei`)⇒ `RAISE NOTICE` 說「已經做過了,不重跑」後**照常 REPLACE**(冪等,不是跳過)。
- **事後斷言**:沿用 `20260904230000:760-786` 那五組(⑤a `order_payments` / ⑤a2 `)<=0` / ⑤b `sweeper_heartbeat` / ⑤c `5 days` / ⑤d `payment_channel`),**再加兩組**:
  - ⑤e 剝註解後含 `Asia/Taipei` ⇒ 否則本片沒生效
  - ⑤f 剝註解壓空白後**不得**再含 `now()-CASE` 那個舊述詞形狀 ⇒ 防「新的加上去、舊的也還在」

## 4. 影響面

| 面 | 動不動 | 依據 |
|---|---|---|
| `pcm_cron.expire_unpaid_orders` | ✅ 唯一改動點 | — |
| 客人看到的字 | ❌ 不動 | `remittanceDeadlineLabel` 算的是「台北日曆日 + 5 天」,新日界正好是那一天的隔天 00:00 ⇒ 兩邊本來就對齊(台北無日光節約 ⇒ +120h 與 +5 個日曆日恆等) |
| `PCM_REMITTANCE_EXPIRE_DAYS = 5` | ❌ 不動 | 天數沒變,變的是日界 |
| 既有兩道字面守門 | ❌ 不會紅 | `remittance-info.test.ts:53/123` 盯的是 `WHEN 'bank_transfer' THEN interval '5 days'` **這串字面** —— 新述詞**逐字保留**它 ⇒ 綠。⚠️ 它們盯的是 `20260903080000` 與 `20260904230000` 兩支**舊檔**,新檔要**另外加一格**才盯得到(見 §5) |
| 其他讀 `payment_expired` 的 11 支檔 | ❌ 不動 | 它們讀的是**取消理由**,不是日界 |
| `⟦b4-NCPCRONRACE⟧` / `⟦b4-NCPCANCELROLLBACK⟧` | ❌ 不修也不惡化 | 板上 `:338` `:339` 兩列逐字「**未派**」⇒ 沒有別的窗在動這支函式;本片不碰鎖與 `EXCEPTION` 那兩段 |
| 已經在線上的未付匯款單 | ⚠️ 會多活 ≤24h | 這正是 Sean 拍的內容 |

## 5. 驗收條件(每條 yes/no)

1. **邊界表(真 Postgres,唯讀,零寫入)** —— 用 `~/pcm-mailbox/0905查證/run.sh` 跑一發**純運算式** `SELECT`(不碰任何表),餵 6 個時戳,印「舊述詞會不會取消 / 新述詞會不會取消」兩欄:
   | 下單(台北) | 現在(台北) | 舊 | 新 | 這一列在演什麼 |
   |---|---|---|---|---|
   | 9/5 12:00 | 9/10 11:59 | 不取消 | 不取消 | 兩版一致 |
   | 9/5 12:00 | 9/10 12:01 | **取消** | 不取消 | 🔴 **本片就是這一列**(Sean 題目裡的例子) |
   | 9/5 12:00 | 9/10 23:59 | 取消 | 不取消 | 第 5 天整天都算 |
   | 9/5 12:00 | 9/11 00:00 | 取消 | **取消** | 隔天 00:00 才取消 |
   | 9/5 00:00 | 9/10 00:01 | 取消 | 不取消 | **多活最久**的那一種(≈24h) |
   | 9/5 23:59 | 9/11 00:00 | 取消 | 取消 | **多活最短**的那一種(1 分鐘) |
   🔵 **新版永遠不早於舊版,而那是算得出來的**:`新界 − 舊界 = 1 天 − 下單當天的時刻` ∈ (0, 1 天]
   ⇒ 📌 **沒有任何一張單會因為本片【提早】被取消** —— 最後兩列就是那個區間的兩端。
   ⚠️ 而「算得出來」不是「量到了」⇒ 這張表的六列**要跑出來**才算過,不是照著推。
   🟢 正對照 = 有「取消/不取消」兩種值出現;🔵 負對照 = 餵一個 `NULL` channel ⇒ 兩欄都不取消。
2. **貼前/貼後對帳各一發**(教訓:貼板 48 只做了貼後 ⇒ 只有一個世界)。貼前:線上 `prosrc` 剝註解後 `strpos('Asia/Taipei') = 0`(期望 **0**);貼後:同一句期望 **> 0**。
3. **migration 自帶的七組事後斷言全過**(貼的時候會自己印,紅了就是沒過)。
4. **三綠** `TURBO_FORCE=1 pnpm typecheck / lint / build` rc=0(本片動 `.sql` + 1 支 `.ts` 測試 ⇒ 要跑 build)。
5. **vitest**:`remittance-info.test.ts` **連跑兩發**比四個數(`Test Files` / `Tests` / 紅格數 / **我餵幾條 vs 它跑幾支**);新增一格盯**新檔**的日界形狀(不然新檔漂掉零訊號),並配一格**負對照**(把新形狀換掉 ⇒ 那把尺要找不到)。
6. **記帳**:貼成功後 `supabase/APPLIED.tsv` 補一列。

## 6. Rollback

- 檔:`docs/specs/2026-09-06-expire-day-boundary-ROLLBACK.sql`(**真 SQL,不是註解** —— `20260904230000:790` 那一格踩過:標題寫「可直接貼」而三行都以 `--` 開頭)。
- 內容 = `CREATE OR REPLACE` 把 `20260904230000` 那一版**逐字**貼回去(`sed -n '401,<結束>p'` 抽,不重打)+ 一組事後斷言:剝註解後 `strpos('Asia/Taipei') = 0` 且含 `now() - CASE`。
- 🔵 **可逆性**:本片只改**判斷什麼時候取消**,不改資料形狀、不改欄位、不刪東西 ⇒ 還原之後行為完全回到今天。
- ⚠️ **不可逆的那一半**:還原之前已經**多活**的那些單,如果在那 24h 內被客人匯款成功,那筆訂單不會因為還原而變回未付 —— 那是好事,寫在這裡是因為「rollback 回到原狀」這句話對它不成立。

## 7. 風險與誠實申報

- 🔴 **時區寫死 `Asia/Taipei`** —— 這是對的(客人在台灣),而它讓述詞**依賴 tzdata**。DB 沒有那個時區名會直接拋錯 ⇒ 前置閘會擋下(`SELECT pg_catalog.timezone('Asia/Taipei', pg_catalog.now())` 跑不過就不貼)。
- 🔴 **索引**:新述詞把 `created_at` 包進函式 ⇒ 比舊版更難用索引。現況存量小(帳號窗 2026-09-05 量到正式庫訂單只有 2 張)、每小時一次 ⇒ 可接受。真的長起來的修法寫進註解:加 `AND o.created_at < pg_catalog.now() - interval '1 day'` 當**前置粗篩**(對所有可取消的列恆真 ⇒ 不改語意)。**本片不加**,因為現在加它是為一個量不到的問題付複雜度。
- ⚠️ **我沒驗的**:我**沒有**在真的 Postgres 上跑過整支函式(施工窗沒有寫入權)。§5 條 1 驗的是**述詞本身**,不是整支函式的行為;整支函式的行為靠 migration 自帶的事後斷言 + 貼後對帳。**這一格是真的缺口,不是免責貼紙。**
- ⚠️ 本片**不修** `⟦b4-NCPCRONRACE⟧`(cron 與收款的鎖)與 `⟦b4-NCPCANCELROLLBACK⟧`(`WHEN OTHERS` 不接 query cancel)—— 那兩件板上「未派」,不在本片範圍。

## 8. 體積

一支 migration(抄 + 改 5 行述詞 + 兩組斷言)+ 一支 rollback + 一格測試 + 一列板列。**估 35-45 分鐘。** 超過就拆成「migration」與「測試守門」兩片。

## 9. 要主視窗裁的(兩題,都不擋我寫碼)

```
Q-日界1(流程):tappay 的 1 天要不要也改成日界?
  甲 = 不改, 只動 bank_transfer / cash(推薦;理由見 §2-b)
  乙 = 一起改, 端 Sean 拍板
  A: 甲|乙

Q-日界2(流程):§5 條 1 那發唯讀 SELECT 要不要我直接跑?
  甲 = 跑(它是純運算式、不碰任何表, 走 0905查證/run.sh 唯讀那條路)(推薦)
  乙 = 不跑, 改成寫進貼板讓 Sean 貼
  A: 甲|乙
```
