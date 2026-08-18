# Plan — M-4a **B-5:`order_created` 通知信 enqueue**(2026-08-18 G4 重寫版)

> ✅ **2026-08-18 16:3x Sean 批准**(逐字「那就依照建議就好」,對應主視窗送的**甲=四份全批**;主視窗轉,我未直接聽到)。
> 🔴 **批准的射程(照抄,免得下一個人讀成別的)**:**批的是「可以開始做」**;
> **動 schema / 權限的部分仍要各自過對抗審查**,而 **migration 由主視窗 apply**(CLI 走 keychain,今日已證)。
> ⇒ **「已批」不等於「可以直接 apply」。**
> ~~⚠️ **未批准。**~~ 命中 **鐵則 8** + **鐵則 12 ①錢 / ②權限**(要動 `service_role` 的使用面)⇒ 提 plan 等 Sean 批。
> ✅ **`Q-G4-1` Sean 2026-08-18 14:0x 已拍 = 甲(掃描式)**(逐字「甲、甲、甲、甲」四題共用;主視窗轉)。
> 🔴 **他批的是【一個對 PRD §3.2 的偏離】,不是只批一個做法** ⇒ **PRD §4 B-5 的契約本體要標註**,
> 否則下一個讀 PRD 的人會把這個實作當成違約(已於本次同時標,見 PRD `:118` 那一列)。
> ⚠️ **plan 本體仍未批**(動 `service_role` 使用面 + 鐵則 8)。
> 🔴 **硬前置:B-4 先上**(`docs/specs/2026-08-18-m4a-b4-persist-notification-email-plan.md`)。B-4 沒上,本片撈到的每一筆 `notification_email` 都是 NULL。
> **真權威**:PRD `docs/specs/2026-07-18-b0-order-notification-email-prd.md` **§3.2(觸發與失敗語意)/ §4 B-5 列 / §5 R3 / §6 gate / §7 PII**。
> **量測環境**:主樹 `/Users/sean_1/pcm-website-v2`,branch `dev` @ `34d1754e`,2026-08-18 13:3x CST(行號當場量)。

---

## 1. 契約(逐字,不要重新發明)

```
PRD §4 B-5(🔴 **這是【原契約】,已被 `Q-G4-1` 取代;PRD `:117` 現在寫的是掃描式** —— GR nit 6):
             ~~「enqueue 掛 §3.2 兩個匯聚點」~~;**其餘不變**:「付款優先、全 catch;**可部署但不得宣稱功能上線**(gate 見 §6)」
PRD §3.2 失敗:「付款結果優先;enqueue 全 catch 不上拋;缺列由 C-1 對帳補寄 + 訊號 4 告警兜底」
PRD §3.2 NULL:「訂單欄 NULL → 取 customers.email → 既有 isSyntheticEmail 閘 → 合成域落 skipped_no_real_email」
PRD §7 PII   :「log／告警／錯誤訊息／回應 body 一律禁帶 email 原值」
```
🔴 **`可部署但不得宣稱功能上線` 是這片的交付定義** ⇒ 前一版審查的 `F5`(「做完仍一封不寄」)
**不是缺陷,是【設計好的落點】**(FRAME-2)。缺的只是把它明列出來 ⇒ 見 §7。

## 2. ✅ 掛哪裡:**Sean 已拍甲(掃描式)** —— 本節留著,因為【為什麼不是乙】是實作時會一直被問的那件事

**甲(推薦)· 掃描式**:在既有 `api/cron/email-sweep` route **前面加一步**,
掃「已 paid 但 outbox 沒有 `order_created` 列」的單 → enqueue。**結帳路徑一行都不動。**

**乙 · 照 PRD 字面內嵌**:掛進 `confirm-payment.ts` 與 `settle-charge.ts` 兩個 use-case、`confirmer.confirm` 成功之後。

| | 甲(掃描) | 乙(內嵌,PRD 字面) |
|---|---|---|
| `service_role` 進到哪 | 只進 email cron 的 composition(**那裡本來就有**,`apps/storefront/src/lib/email/composition.ts:47`) | 🔴 **進結帳路徑**:`ConfirmPaymentDeps`(`confirm-payment.ts:34`)/`SettleChargeDeps`(`settle-charge.ts:41`)+ **11 條路徑的 deps 建構全要動** |
| `settleCharge` 那半有沒有權限的路 | 不需要(掃描自己讀) | 🔴 **沒有**:`settleCharge` 走 `payment_confirmer`、**零 table 權限**且由 apply 期斷言強制 ⇒ 只能擴 RPC(破它「只回非 PII 對帳欄」的契約)或把 service_role 注進金流脊椎 |
| 拿不到 `paid_at` / `display_id` 的問題 | 不存在(掃描直接 select) | 要新增一支 port + 成交後補讀一次 orders |
| 首次 enqueue 失敗 | **下一輪自己再撈到**(天然可重入) | 🔴 **零救濟**:`settle-charge.ts:71-72` 第二個 `kind:'paid'` 短路 ⇒ 之後每次重入都不會再 enqueue,而 PRD 說的 `C-1` 兜底**沒有實作** |
| 客人收到信的延遲 | 一輪(pg_cron `*/5` ⇒ ≤5 分) | 秒級 |
| 對 PRD | 🔴 **對 §3.2「掛兩個匯聚點」的申報偏離**(要 Sean 批) | 逐字照做 |
| 片的大小 | 1 個 use-case + 1 個查詢 + route 一步 | 2 個 use-case + 1 port + 1 adapter + 11 條 deps + 11 格入口測試 |

🔴 **推薦甲的理由不是省事,是【乙的三條缺口沒有便宜的解】**:
`F2`(權限死路)、`F4`(把 `SUPABASE_SERVICE_ROLE_KEY` 變成結帳路徑的相依)、`V1`(首次失敗零救濟)。
**甲把三條一起消掉**,代價是「信晚 5 分鐘」與「一條要申報的 PRD 偏離」。
⚠️ **甲不是繞過 PRD,是把 PRD 自己 §6 gate #2 的 `C-1`(NOT EXISTS 對帳補寄)當成主路徑而不是備援。**

~~**以下 §3 起全部以【甲】書寫。Sean 選乙 ⇒ 本檔作廢重寫。**~~
✅ **他選了甲** ⇒ 下面就是要做的東西。乙那一欄留著當對照,**不要刪** ——
出事那天有人會問「為什麼不掛在付款當下」,答案在那一欄裡。

## 3. 範圍(甲案)

| 檔 | 改動 |
|---|---|
| 新 `packages/use-cases/src/enqueue-order-created-emails.ts` | 掃描 + enqueue(≈60 行) |
| 新 `packages/ports/src/IPaidOrderScanner.ts` | 一支窄 port:`listPaidWithoutOrderCreatedEmail(cutoff, limit)` → `{ orderId, displayId, paidAt, notificationEmail, customerEmail }[]` |
| 新 `packages/adapters/src/supabase/SupabasePaidOrderScannerAdapter.ts` | 兩個查詢(見 §4),service_role client |
| `apps/storefront/src/lib/email/composition.ts` | 加 `getEnqueueOrderCreatedDeps()`(**只要 outbox + scanner,不要 Resend**) |
| `apps/storefront/src/app/api/cron/email-sweep/route.ts` | 認證/限流之後、`sweepEmailOutbox` **之前**插一步 enqueue |
| 測試 | 見 §6 |

**明確不動**:`confirm-payment.ts` / `settle-charge.ts` / `charge-actions.ts` / 任何金流路徑 /
`SupabaseEmailOutboxAdapter`(含 `isSyntheticEmail`)/ migration / `vercel.json` / RLS / 金額 / tier。

### 3.1 🔴 為什麼 enqueue 要在 `sweepEmailOutbox` **之前**、且用**自己的 deps**

`getSweepEmailOutboxDeps()` 會 `requireEnv('RESEND_API_KEY')`;缺 ⇒ throw ⇒ route 503。
若 enqueue 共用它,**Resend 還沒設 env 的期間連「排進 outbox」都不會發生**。
⇒ 分開的 deps + 先跑 enqueue ⇒ **信先排進去、寄的那半晚點再開**,兩件事互不綁死。

## 4. 掃描怎麼寫(零 migration)

```
① select id, display_id, paid_at, notification_email, customer_user_id
     from orders
    where payment_status = 'paid' and paid_at >= <cutoff> and created_at >= <cutoff>
    order by paid_at asc  limit <N>
② select order_id from email_outbox where event_type = 'order_created' and order_id in (①的 id)
③ 差集 → 對每一筆:recipient = notification_email ?? customers.email(該 customer 的)
   → outbox.enqueue({ orderId, displayId, paidAt, recipientEmail })
```
🔴 **`cutoff` 同時卡 `paid_at` 與 `created_at`,是 PRD §5 R3 明文**(舊單在 cutoff 之後才晚翻 paid 會被誤納入「應該有信」的集合)。
🔴 **`cutoff` = 【B-4 這一片部署上線的時戳】**(Sean 2026-08-18 `Q-G4-5`=甲)。
~~「cutoff = flag 實際開啟時戳,不是部署時戳(PRD §5 R3 已釘死)」~~ **已被 `Q-G4-5` 推翻,留痕不刪**
—— 那條規則的前提(「部署後、開 flag 前建的單仍是 NULL」)已被 B-4 §4.1 抽掉,而 `Q-02` 之下**那個開啟事件不會發生**。
(GR `C2` 抓到:本檔 `:83-84` 相鄰兩行互相打架,而 `Q-G4-5` 的折抵當時**零字進到真正消費 cutoff 的這一節**
—— 量法 `grep -c 'Q-G4-5'` 當時 B-4 plan 4 / 本檔 **0**。)
⇒ **取值方式**:B-4 部署那一次的時戳,**寫進 commit body + `STATUS.md` 待動作欄**(見 B-4 plan §7 落點),本片讀常數、不代填。
⚠️ **`limit` 與 cutoff 都是 route 端常數,零 client 輸入**(鏡像 email-sweep route 的紀律)。

### 4.1 `V2` / `F13`:全不合格時**照 PRD 落一列**,不是靜默跳過

前一版寫「全不合格 ⇒ 不 enqueue + 一行 log」—— 那是**對 PRD §3.2 的未申報偏離**。
本版:**照樣呼 `enqueue`**,由 adapter 既有的閘決定終態:
```
SupabaseEmailOutboxAdapter.ts:198,208,222  isSyntheticEmail ⇒ status='skipped_no_real_email' 落一列
```
⇒ **有一列查得到的痕跡**,而不是一行沒有人在看的 log。
⚠️ 兩個候選都是 NULL / 空字串(理論上 B-4 之後不該發生)⇒ **不 enqueue、計數 +1**,計數進 route 的 counts-only 回應。

### 4.1-b 🔴🔴 這個 fallback 在【手動建單】那個世界會過度寄信(GR `C1`,must-fix)

```
PRD §3.2（:86）規定：訂單欄 NULL → customers.email → 寄（只有合成域才 skip）
Sean 2026-08-18 逐字：「那手建訂單可以不填email嗎？ 可以不發送」
⇒ 員工刻意不填 email 的手動單，客人若有真的註冊信箱 ⇒ 本片的 fallback【照樣寄】
⇒ 直接違反那句產品拍板，而本片八格測試【全綠】
```
🔴 **今天沒有可達路徑**(手動建單那片還沒做)—— **但本片現在批的正是那個述詞。**
⇒ **`#641` 的來源標記落地之後,本片的 fallback 述詞要一起改**(不是 orders 的事就與我無關:
**B-5 的 fallback 是 `#641` 的第四個消費者**,而 B-4 §10.3 原本只列了 B-6 / C-1 / 手動建單三個)。
⇒ 在那之前:**本片照 PRD §3.2 實作,而這一條寫進 §7 誠實揭示,不假裝它不存在。**
🔴 **counts-only、零 PII**(PRD §7)。

### 4.2 `F12`:adapter 的合成域閘比 schema 窄 —— 本片為什麼仍然不修它

```
packages/schemas/src/notification-email.ts     認子網域 + 去尾點(寬)
packages/adapters/.../SupabaseEmailOutboxAdapter.ts:163  只做完全等值比對(窄)
```
⇒ `x@sub.line.pcmmotorsports.local` 這種值,**schema 擋得住、adapter 擋不住**。
本片之後 **`enqueue` 的生產呼叫點只有一個(本掃描)**,而掃描的兩個來源都受 DB CHECK / 註冊驗證管
⇒ **今天沒有可達路徑把子網域合成值餵進 adapter。**
🔴 **但這是「今天沒有」不是「不會有」** ⇒ 列進 §7 誠實揭示 + backlog,**不在本片修**(改 adapter 的閘會動到已驗證過的狀態機)。

## 4.3 ✅ 那個天花板拆掉了(2026-08-19;原文留痕在下面,**不要刪**)

**做法**:差集從 app 端搬進 DB,用 PostgREST 的 anti-join ⇒ **結果集本身就只有待排的**
⇒ 已排過信的前綴不再出現在結果裡 ⇒ **天花板消失、翻頁整段拿掉**(單一查詢)。

```
select=…,email_outbox!left(order_id)
  &email_outbox.event_type=eq.order_created   ← 先用 event_type 篩【子表】
  &email_outbox=is.null                       ← 再看【父列】有沒有剩下的子列
```

🔴🔴 **這個字面差一個欄名就會靜默壞掉,而兩個世界都回 200**(2026-08-19 實測):
```
✅ email_outbox=is.null            ⇒ 只回沒排過的
🔴 email_outbox.order_id=is.null   ⇒ 回【全部的列】+ 空 embed  ← 看起來完全正常，前綴一列都沒短
```
⇒ `.test.ts` 有一格**逐列比對**的守門盯這個字面 + 一條**反向斷言**(毒分支不得出現)。
**只斷言 http=200 或「非空」的守門,對寫錯的那版照樣全綠。**

🔴 **`event_type` 那道篩子不能省**:一張單可能有 `order_shipped` 而**沒有** `order_created`
⇒ 少了它,那種單會被當成「排過了」而**永久跳過** ⇒ 那批客人**永遠收不到通知信**。
📌 這一格是 **G6 那六發沒涵蓋到的**(它量的是「有沒有任何 outbox 列」)⇒ G4 自己補量。

📌 索引已經有了、而且是**為這件事建的**:`email_outbox_order_idx (order_id, event_type)`
(`20260717020000_m4a_email_outbox.sql:113` 逐字「正是為此 anti-join 而設」)。

### ⚠️ 效度限定(引用本節請一起帶走)
```
· 量測環境 = 拋棄式 PostgREST 14.16 + PG 17.10，最小構造（兩表一 FK、4 列、無 RLS、無分頁）
· 🔴 正式站（Supabase 託管）的 PostgREST 版本【未確認】，而內嵌過濾語意在版本間改過
· 沒測：RLS 之下的行為、與 .range() 分頁組合
```
🔴 **上線前要做的一個動作(寫在這裡是因為它會被讀到,不是留在信裡)**:
在**正式站或 preview** 打同一組兩發,看回的是不是**互補的兩組**:
```
…&email_outbox.event_type=eq.order_created&email_outbox=is.null       ⇒ 應為「沒排過的」
…&email_outbox.event_type=eq.order_created&email_outbox=not.is.null   ⇒ 應為「排過的」
🔴 判準是【兩組互補且都不是全部】——「回全部」看起來像成功。
```
**同一段限定也寫在 `SupabasePaidOrderScannerAdapter.ts` 檔頭**;兩處都寫是刻意的
—— **改那支檔的人不一定會來讀這份 plan。**

<details>
<summary>~~原文(2026-08-18 那版:app 端差集 + keyset 翻頁 + 天花板)~~ —— 留痕不刪</summary>

原本的做法是「撈一頁 orders → 再查一次 email_outbox → app 端算差集 → keyset 翻頁直到收滿」,
而它有一個天花板:
```
單輪掃描上限 = MAX_PAGES(25) × PAGE_SIZE(200) = 5,000 筆
已排過信的單會永遠留在結果集裡、排在待排的前面，而且每天變長
⇒ 前綴超過 5,000 的那天，後面的單【永遠讀不到】，而 route 回 200、counts 全 0
估：5,000 / 30 封每日 ≈ 166 天（分母來源 sweep-email-outbox.ts:34，別人記的，我沒量）
```
當時列的三條路是「甲 DB 端 anti-join(要 migration)/ 乙 跨輪 cursor(要一張表)/
丙 PostgREST embedded anti-join(**未確認**)」—— **丙成立了,而且不必 migration。**
🔴 **當時我猜的那個丙的字面正是上面那個毒分支** ⇒ 猜對方向、猜錯字面,而那個錯法不會報錯。

</details>

## 5. 失敗語意

- 掃描/enqueue 整段的例外**不影響任何付款路徑**(本片不在付款路徑上)。
- 單筆 enqueue 失敗 ⇒ 計數 +1、**不中斷整輪**;**下一輪會再撈到它**(差集是即時算的)。
- 整輪有失敗 ⇒ route 回 **503 + counts**(鏡像既有 email-sweep 紀律:壞掉的 sweeper 不可吞成 200)。
- 🔴 **不得使用 `fail-closed` 這個詞**(PRD 明文:相反語意)。

## 6. 驗證(不降級)

三綠 `TURBO_FORCE=1` + vitest(自己跑)。

| # | 斷言 | 突變(必須紅) |
|---|---|---|
| 1 | 已 paid 且 outbox 無列 ⇒ **enqueue 被呼叫,且 `recipientEmail` = orders 那個具體值** | 把差集算反 |
| 2 | 已 paid 且 outbox **有**列 ⇒ **零呼叫**(不重複寄) | 拿掉差集過濾 |
| 3 | `notification_email` 為 NULL ⇒ 用 `customers.email`(PRD §3.2 fallback) | 拿掉 fallback |
| 4 | fallback 是合成域 ⇒ 落 `skipped_no_real_email` **一列**(不是靜默跳過) | 改回「不 enqueue + log」 |
| 5 | `paid_at` / `created_at` 早於 cutoff 的舊單 ⇒ **不撈** | 拿掉 `created_at` 那半(PRD §5 R3 那一格) |
| 6 | 單筆 throw ⇒ 其餘照跑、`errors` 計數 +1、route 503 | 把 per-item catch 拿掉 |
| 7 | route 回應**只有數字**、零 email 字面 | 把 recipient 塞進回應 |
| 8 | 缺 `RESEND_API_KEY` ⇒ **enqueue 仍然跑完**(§3.1) | 讓 enqueue 共用 sweep 的 deps |

🔴 **`#633` 驗收條款照抄不改**:❌「outbox 有列 = 成功」不可寫(`recipient_email` 為 null 時那一列照樣進得去,
在兩個世界印同一個東西);✅ 斷言 **`recipient_email` 不是 null 且等於某個具體值**。
🔴 **每加一道斷言當場配一發突變** —— 不配的話「我加了守門」與「守門恆綠」長得一樣。

## 7. 🔴 誠實揭示(本片做完之後,世界是什麼樣子)

1. **一封信都不會寄。** `email-sweep` route 的 firing 由 **E2b 的 pg_cron 是否存在**控制(route 檔頭逐字「本片不進 `vercel.json` crons…天然開關」),而當場量:
   ```
   grep -c crons vercel.json                    ⇒ 0（分母 6 行）
   grep -rn "cron.schedule" supabase/migrations ⇒ pcm-settle-sweep / pcm-anomaly-alert / pcm-expire-unpaid-orders
                                                   （查無 email 相關 job）
   ```
   ⇒ **這是 PRD §6 gate #1 的原文狀態,不是本片的缺陷。**
2. **出貨通知信仍然一封不會寄**(`order_shipped` 卡 E4 模板,`packages/use-cases/src/sweep-email-outbox.ts:113` throw)。那一半有主人:`docs/specs/2026-08-17-qc9-tracking-to-customer-plan.md` 的 `C9-b`。
3. **「通知孤兒已消滅」不得宣稱**(要 C-2 Resend bounce webhook,PRD §1)。
4. **`C-1` / `A-1` 告警仍然沒有實作**(PRD §6 gate #2/#3)⇒ 本片的可重入吸收了 `C-1` 的補寄功能,**但沒有做「有 paid 沒 outbox」的告警**。
5. **PII**:`email_outbox.recipient_email` 保留 **120 天**(PRD §7,Sean 2026-07-18 拍),清理 job `#281` **本片不做**。
6. **`customers.email` 是註冊當下的凍結快照**(`handle_new_auth_user` 只掛 `AFTER INSERT`,全樹零 UPDATE 同步)⇒ auth email 改過的客人,fallback 拿到的是舊值。**照 PRD 做,缺口登記在此。**
7. **`F12` 的窄閘縫**(§4.2)未修。
8. 🔴 **fallback 在手動建單世界會過度寄信**(§4.1-b;GR `C1`)——
   今天無可達路徑,而**手動建單那片一上線,這條就會真的寄錯**。修法綁 `#641` 的來源標記。
8. ⚠️ **未量**:`RESEND_API_KEY` / `ORDER_EMAIL_FROM` 在正式站的現值(repo 側無管道)。缺值行為已查:sweep route ⇒ `requireEnv` throw ⇒ 503。
9. 🔴🔴 **`cutoff` 指的「部署瞬間」到今天為止【沒有定義】**(codex 關卡2 R3 consider,採納)。
   它可能是:deployment ready / alias 切換 / 第一個新版本 request / 最後一個舊版本 request 結束 ——
   **部署不是一個與 `orders.created_at` 對齊的原子瞬間。**
   ```
   填【早】了 ⇒ 掃到 B-4 之前的舊單 ⇒ 客人收到關於幾個月前那張單的信   ← 顯眼、會被投訴
   填【晚】了 ⇒ 已由 B-4 處理、但 created_at < cutoff 的單【被永久排除】 ← 🔴 不顯眼:
                route 一路 200、counts 正常,只有少數客人沒收到信,而沒有任何東西紅
   ```
   ⇒ **這條不擋現在(env 未設 = 整段不跑),但它【擋住把 env 填成非 null 那一刻】。**
   啟用前要先做兩件:①定義唯一時間來源與誤差方向 ②對部署邊界區間做一次性對帳。
   ⚠️ **本片不做那兩件** —— 它們要有 prod access 與 Sean 的時間定義,不是實作時順手判的事。
10. 🔴 **「已有任意 `email_outbox` 列就算處理完」** —— scanner 只取 `order_id`、**不看狀態**
   (codex 關卡2 R3 consider,採納)。⇒ 下列終態的列都會**永久排除**該訂單:
   `skipped_no_real_email` / `failed@max` / 其他終態。
   ```
   失敗情境:某封信進了 failed@max ⇒ 之後每一輪都看到既有列而排除它
            ⇒ route 長期回 200 + enqScanned=0 + errors=0 ⇒ 與「完全正常、沒事可做」長得一樣
   ```
   🔴 **本片刻意不改成「看狀態決定要不要重排」** —— 唯一鍵與重複寄信的風險更重,
   貿然重排會把「至少寄一次」變成「可能寄很多次」。
   ⇒ **但這等於把「終態一定有別的機制在修」寫成了一個隱含依賴。** 那個機制(dead-man / 終態對帳)
   **今天不存在**(PRD §6 gate #2/#3 的 `C-1` / `A-1` 都沒實作,見上面第 4 條)。
   ⇒ **列為啟用前的明確依賴**,不是「以後再說」。

## 8. rollback

零 migration ⇒ `git revert` + 重部署。已排進 outbox 的列**不刪**(`dedup_key` 保證不重複寄)。

## 9. 送審指示(FRAME-1,硬要求)

派審查時,**把 PRD §3.2 / §5 R3 / §6 的內文直接貼進 prompt**,連同本檔全文。
**只貼檔名或檔頭,審查者看不到同一批契約** —— 上一輪就是這樣漏掉 V1/V2 兩條 must-fix。
🔴 並在 prompt 裡明寫:**「本片的契約是『可部署但不得宣稱功能上線』,請不要把『做完仍不會寄信』當成缺陷報回來。」**

## 10. 估時

use-case + adapter + composition + route 一步 ≈ 35 分鐘;8 格測試 + 8 發突變 ≈ 35 分鐘 ⇒ **≈ 70 分鐘 ⇒ 超過鐵則 4 上限,實作時切兩段**(段一:use-case + port + adapter + 測試;段二:composition + route + 測試)。
