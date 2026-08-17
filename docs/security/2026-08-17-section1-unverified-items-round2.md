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

> 🟢 **08-17 傍晚重驗(E 第三輪):下方「兜底沒在跑 = HIGH-結構」已解除,證據見本節末〈§5-b 重驗〉。** 中間的原始論證保留當歷史,引用請以 §5-b 為準。

**量到的(讀 code)**:
- `TAPPAY_3DS_ENABLED` 是 **env var**:`three-ds-flag.ts:19` = `process.env.TAPPAY_3DS_ENABLED === 'true'`(非 `'true'` 一律 off、**預設 off**)。
- `backend_notify_url` **只在 flag on 時**於 runtime 組(`three-ds-urls.ts`:charge-actions flag on 才組),**不是常駐設定**。
- route 檔頭(`tappay-notify/[secret]/route.ts:18`)寫的是**設計不變量**:「3DS-4 sweeper(**未實作**)前不設 backend_notify_url、不開 `TAPPAY_3DS_ENABLED`、不開放 prod 結帳」。
- **即使 webhook URL 被打**,無 flag ⇒ 無真 3DS 流 ⇒ 無 active attempt ⇒ route 處理序第 5 步 `findActiveByOrderId` = null → 200 drop(**端點對不上本機單就丟**)。

⇒ **判定(2026-08-17 重估:折扣的觸發條件成立、折扣作廢)**:我原本寫「折扣站得住,除非有人在 prod 把 `TAPPAY_3DS_ENABLED=true` 翻開而兜底還沒好」。**那個條件成立了。**

🔴 **量到的(五條)**:
① `TAPPAY_3DS_ENABLED = true`(Sean,Production)。
② `CRON_SWEEPER_ENABLED` 在 Production **不存在**(a4 `vercel env ls production`,分母 39 行,正向對照 `ANOMALY_ALERT_ENABLED` grep=1 ⇒ 那個 0 是量的)。
③ 未設 ⇒ `settle-sweep` route **200 no-op**(`route.ts:105` `CRON_SWEEPER_ENABLED !== 'true'` + `:102` 註解「嚴格 opt-in、只認 'true'、預設 off」)。
④ `route.ts:19` 自列的啟用三步,第 ② 步(Sean 設 `CRON_SWEEPER_ENABLED='true'`)**未做**。
⑤ tappay-notify `route.ts:17-18` **設計不變量**「3DS-4 前不開 `TAPPAY_3DS_ENABLED`、不開放 prod 結帳」**被違反**。

🔴 **「兜底掃描沒在跑」= 量到的(不再是推論)**:排程器 2026-07-23 已從 Vercel cron 搬到 pg_cron(`supabase/migrations/20260723120000` 建 `pcm-settle-sweep` `*/2`)⇒ 查 `vercel.json` 是**錯的分母**(我早先犯、已改、留痕)。但雙分支窮舉:pg_cron 活 + flag 未設 ⇒ 每 2 分打進來、route 200 no-op ⇒ 沒掃描;pg_cron 沒活 + flag 未設 ⇒ 沒被呼叫 ⇒ 沒掃描。**不論 pg_cron 活不活,結論都成立**(靠 ②③ 兩個量到的事實 + 窮舉,不靠題①)。

🔴 **仍未量(一條不拿掉)**:①best-effort 快路徑實際多常失敗(決定缺口多常咬人)②4a migration 有沒有進 prod ③**prod 是否真在收 3DS 單**(不變量說「不開放 prod 結帳」,單可能還沒進來)④pg_cron job 活不活(`pcm_audit_ro` 無 cron schema USAGE、查不到;不影響結論、影響修法)。

🔴 **等級 = HIGH-結構**:結構缺口=量到的、金流(鐵則 12①)、active(flag=true)⇒ HIGH-結構;**頻率未量 ⇒ 不拉滿**。修法=拍板題(設 `CRON_SWEEPER_ENABLED='true'`〔+ pg_cron 未活則 apply `20260723120000`〕,或把 `TAPPAY_3DS_ENABLED` 關回 false)——E 只出事實,拍板歸 Sean。

### §5-b 重驗(2026-08-17 傍晚,E 第三輪)—— sweeper 已真掃,HIGH-結構 解除

**背景**:Sean 08-17 下午設 `CRON_SWEEPER_ENABLED=true` 並重部署 ⇒ 上方②③④(env 不存在 ⇒ 200 no-op)過期。

**量具(兩世界會印不同值,非 200)**:`net._http_response.content`(pg_cron→pg_net 打 route 的**回應 body**)。
route 兩世界字面不同:disabled ⇒ `{"enabled":false,"skipped":"sweeper_disabled"}`(`route.ts:106`);enabled ⇒ `{"enabled":true,…counts}`(`route.ts:134`)。

**量具身分(附分母與 pattern)**:
- **disabled 態分得開**:`grep -rn "sweeper_disabled" --include="*.ts" --include="*.tsx" . | grep -v node_modules` ⇒ **2 命中**皆 settle-sweep(`route.ts:106` 本體 + `route.test.ts:130`);anomaly 印的是 `anomaly_alert_disabled`(同法 2 命中,`anomaly-alert/route.ts:106`)。
- 🔴 **enabled 態【分不開】,`"enabled":true` 不是 sweeper 專屬**:`anomaly-alert/route.ts:126` 與 `:130` 兩處也印 `enabled: true`(200 與 503 皆含)。⇒ **world_b 必須改用 sweeper 專屬欄位** `inboxClaimed`(`grep -rn "inboxClaimed" --include="*.ts" . | grep -v node_modules | grep -v test` ⇒ **3 命中全在** `packages/use-cases/src/sweep-settlements.ts:56,120,165`);anomaly 專屬欄取 `notifiersTotal`(`check-anomaly-alerts.ts:56`)。
- ⚠️ **`anom_off` / `anom_on` 兩個桶【從未被活列行使過】**(本窗零 anomaly 列)⇒ 它們目前是**未表演過的格**,不能當「已驗證可用」。**廉價轉正:今晚 `01:00 UTC` 之後重跑一次,期望 `anom_off ≥ 1`**(anomaly 的 flag 若仍關著就是 `anom_off`;開了則 `anom_on`)。**待辦,未做。**
- 🔴🔴 **重跑時段警告**:`pcm-anomaly-alert` 排程 `0 1 * * *`(`supabase/migrations/20260723120000…:131`)⇒ **在 01:00–07:00 UTC 之間重跑本查詢,anomaly 的列會進入 6h 窗**。用舊的 `"enabled":true` pattern 會把它算成 sweeper。下方查詢已改成**逐 job 歸戶 + 殘差桶**,任何時段重跑都算得清。

**量到的(`pcm_audit_ro` 唯讀 SELECT;單一快照 `snapshot_utc = 2026-08-17 07:27:43 UTC`)**:

```sql
-- 可重跑(任何時段皆可)
-- 🔴 判準:unattributed = 0 【且】 sweep_off+sweep_on+anom_off+anom_on+null_content+unattributed = total
--    只看 unattributed=0 不夠 —— 見下方「NULL 陷阱」。
WITH w AS (SELECT * FROM net._http_response WHERE created > now() - interval '6 hours')
SELECT count(*) AS total,
  count(*) FILTER (WHERE content LIKE '%sweeper_disabled%')       AS sweep_off,
  count(*) FILTER (WHERE content LIKE '%inboxClaimed%')           AS sweep_on,
  count(*) FILTER (WHERE content LIKE '%anomaly_alert_disabled%') AS anom_off,
  count(*) FILTER (WHERE content LIKE '%notifiersTotal%')         AS anom_on,
  count(*) FILTER (WHERE content IS NULL)                         AS null_content,  -- 🔴 必要,見下
  count(*) FILTER (WHERE content IS NOT NULL                                        -- 🔴 這道 guard 不可拿掉
                     AND content NOT LIKE '%sweeper_disabled%'
                     AND content NOT LIKE '%inboxClaimed%'
                     AND content NOT LIKE '%anomaly_alert_disabled%'
                     AND content NOT LIKE '%notifiersTotal%')     AS unattributed,
  count(*) FILTER (WHERE status_code<>200) AS non_200,
  count(*) FILTER (WHERE timed_out)        AS timedout,
  min(created) FILTER (WHERE content LIKE '%inboxClaimed%')       AS first_sweep_on,
  max(created) FILTER (WHERE content LIKE '%sweeper_disabled%')   AS last_sweep_off
FROM w;
```

🔴 **NULL 陷阱(為什麼 `unattributed = 0` 單獨看是假綠)**:
`NULL NOT LIKE '…'` 得到的是 **`NULL` 不是 `true`**(實測 `SELECT (NULL::text NOT LIKE '%x%') IS NULL` ⇒ `t`)⇒ 若不加 `content IS NOT NULL`,**`content` 為 NULL 的列不會進任何桶、也不會進 `unattributed`**;而 `status_code` 同時為 NULL ⇒ `status_code <> 200` 也是 NULL ⇒ **連 `non_200` 都躲過,只有 `total` 會多**。
⚠️ **pg_net 對「連線根本失敗」的列就是 `content`/`status_code` 雙 NULL、只填 `error_msg`** ⇒ **在「請求全部失敗」的世界裡,舊版查詢會印出 `unattributed = 0`**——正是「錯的那次和對的那次長得一樣」。
⇒ 故判準必須是**兩條**:`unattributed = 0` **且各桶總和 = `total`**。

| snapshot_utc | total | sweep_off | sweep_on | anom_off | anom_on | null_content | **unattributed** | non_200 | timedout |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-17 07:38:05 UTC | 180 | 153 | 27 | 0 | 0 | **0** | **0** | 0 | 0 |

加總核對:`153+27+0+0+0+0 = 180 = total` ✅ 兩條判準皆過。

- **兩個世界同一窗都在** ⇒ 內建負向對照,不必自餵:`sweep_off`(該快照 **153** 列)止於 `06:44:00 UTC`,`sweep_on`(該快照 **27** 列)起於 `06:46:00 UTC`。**兩個列數隨滾動窗漂移,兩個時刻不漂**(見下方效度三條)。
- **分母閉合是【歸戶閉合】不是算術巧合**:`153+27+0+0+0+0 = 180 = total` 且 **`unattributed = 0`** ⇒ 窗內每一列都被歸到具名 job;`anom_off/anom_on = 0` 是**量到的**(本窗不含 anomaly 的 01:00 那列),不是假設。
- **`total=180` 佐證排程節奏**:`*/2` 於 6h = 30/h × 6 = **180**,實測正好 180 ⇒ 該窗**零漏跑**。
- 首發真掃(`06:46:00`):`inboxClaimed:40, inboxProcessed:37, inboxRetried:3, flaggedNonUnpaid:3, stuckClaimed:1, stuckRetried:1, errors:0`。
- 🔴 **「DB 狀態真的變了」有【活對照組】,不是推論**:同一窗內那 **3 筆 `inboxRetried`** 在 `06:48/06:52/06:58/07:08` **反覆重現**(非 terminal 項每輪被重新認領)⇒ 證明「**未真正處理掉的東西會一直冒出來**」。而首發那 **37 筆 `inboxProcessed` 在其後 28 分鐘內零重現** ⇒ **排除了「只是被 lease 暫時藏住」那個世界**。retried 是這個量測自帶的正向對照。
- `non_200=0`、`timedout=0`(同一快照 FILTER 計數,非目視)。

⚠️ **這份紀錄的效度與保存期(三條)**:
1. **列數會漂**:`sweep_off/sweep_on` 隨滾動窗變 ⇒ **引用要連 `snapshot_utc` 一起帶走**。歷程:07:10 ⇒ 167/13、07:14 ⇒ 165/15、07:27 ⇒ 159/21。
   ⚠️ **前兩組是用【被污染的】舊 pattern(`"enabled":true`)量的**;它們之所以仍與逐 job 歸戶的數字相等,**只因本窗 `anom_on = 0`**(anomaly 的 01:00 那列在窗外)。**換一個時段就不成立** ⇒ 要複驗請一律用上方那支帶殘差桶的查詢,不要沿用這三組歷史數字的量法。
2. 🔴 **翻轉點【不是不漂,是會整段消失】**:`net._http_response` TTL 6h ⇒ `last_sweep_off = 06:44 UTC` 那列約於 **12:44 UTC 後被清掉,之後永不可復量**。⇒ **窗內不漂;離窗後不可復量,本檔即為該翻轉點的唯一記錄。**
3. **與部署時刻的因果:吻合但未證實**。翻轉點 06:44→06:46 UTC(台北 14:44→14:46)與 Sean「下午重部署」時序相符,但**我沒有部署時刻的取證**(在 Vercel Dashboard,不在我可讀範圍)⇒ 照 §6-b 標「**吻合但未證實**」。**本節結論不依賴這條因果** —— 就算重部署另有時間,兩個世界的翻轉本身仍是量到的。

**連帶收口(原「仍未量」四條中的兩條半)**:
- ④ pg_cron 活不活 ⇒ **活**(每 2 分真發請求,量到)。
- ② 4a migration 進 prod 沒 ⇒ **走過的路徑上是**(claim/flagNonUnpaidActive/markRetry/markProcessed 各 RPC 實際執行且 `errors:0`;**settled 寫入路徑未走過**,見誠實邊界)。
- ③ prod 有沒有單 ⇒ inbox 有 **40 筆 webhook 列**(存在=量到;**性質未知**,業務表對 `pcm_audit_ro` 鎖定、開不了列)。

**誠實邊界(三條)**:
1. `stuckSettled:0` 全程 ⇒ 「真的把一筆從未結算改成已結算」這條路徑**本窗未被行使**,閉環證的是掃描→認領→處理→退避全鏈,不含 settled 寫入那一步。
2. 殘餘 **3 筆 inbox + 1 筆 stuck 在退避循環**(06:48/06:52/06:58/07:08 間隔遞增),`settleCharge` 回 pending → markRetry,設計內行為非 error;`flaggedNonUnpaid:3` 已按 code 落 durable `needs_manual_review`(`sweep-settlements.ts:148,231`)。**這 4 筆是什麼,要有業務表權限的窗開列**——E 鎖定開不了。
3. 觀測窗 = `net._http_response` 6h TTL,更早歷史不可考。

**判定**:原 HIGH-結構(3DS 收單而無最終結算保證)**解除**——兜底已真跑、真消化積壓、零錯。殘餘追蹤項:上述 4 筆滯留 + `stuckSettled` 路徑未行使 + tappay-notify 設計不變量「不開放 prod 結帳」與 flag=true 的矛盾是否已由 Sean 知情接受(拍板歸 Sean)。

---

## §5-c 🔴 事前預言:`08:00 UTC` 那一輪會不會把四筆轉人工(**寫於 `07:51 UTC`,事件尚未發生**)

> 🔴 **本節寫在事件【之前】並先行 commit** —— 事後補寫的預測不是預測。結果另立 §5-d,不改本節一個字。

**背景(量到的)**:Sean 於 `postgres` 身分跑唯讀 SQL,查出**現存 4 列**:1 列 `payment_charge_attempts`(`2SQH2P` / 1500)+ 3 列 `payment_webhook_events`(`record_unverified`,6 / 101 / 340),**四列 `attempt_count = 7`、`needs_manual_review = 否`**。
對上我方 `net._http_response` 的 `07:44:00 UTC` 那輪:`inboxClaimed:3 / inboxRetried:3 / stuckClaimed:1 / stuckRetried:1` ⇒ **兩個獨立來源指向同一批**。

**機制(讀 code,附行號;`supabase/migrations/20260615120000_m3_3ds_4a1_webhook_sweeper_rpc.sql`)**:
```
claim 濾            attempt_count < 8                                  :79
退避                next_retry_at = now() + LEAST(2^(attempt_count-1),16) 分鐘   :135-137
達 ceiling 轉人工    needs_manual_review = (needs_manual_review OR attempt_count >= 8)   :139
孤兒 expirer        attempt_count >= 8 且未 processed/manual → 轉 manual   :56,64
```
`attempt_count = 7` ⇒ 退避 `LEAST(2^6,16) = 16` 分鐘 ⇒ `07:44 + 16min` = **`08:00 UTC`**(= 台北 16:00,與 Sean 查到的 `下次重試` 相符)。

### 🔴 預言(兩個世界印不同的值)

| 世界 | `08:00 UTC` 那輪 | `08:02` 起各輪 | 判準 |
|---|---|---|---|
| **A. ceiling 正常** | `inboxClaimed: 3`(+`stuckClaimed: 1`)→ `attempt_count` 變 8 → 轉 `needs_manual_review` | **`inboxClaimed: 0`,四筆不再出現** | 被 `:79` 的 `< 8` 濾掉 |
| **B. ceiling 壞掉** | 同上認領 | **`08:02`/`08:04`… 持續認領同一批** | 永遠不轉人工 = **卡死而沒人知道** |

**量法(唯讀,可重跑)**:
```sql
SELECT created, content FROM net._http_response
 WHERE created >= '2026-08-17 08:00:00+00' AND content LIKE '%inboxClaimed%'
 ORDER BY created;
```
**判準**:看 `08:02` 之後連續數輪的 `inboxClaimed` —— **歸零且不再回升 = 世界 A;持續為 3 = 世界 B**。

🔴 **若落在世界 B,那不是稽核發現,那是 bug** ⇒ 當場回報、不等報告寫完。
⚠️ **窗口**:`net._http_response` TTL **6h**,且這是**一次性事件**(這批走過 ceiling 就不會再走一次)⇒ **`08:04` 之後儘速量,錯過要等下一批。**
⚠️ **樣本性質**:三筆 `record_unverified`(6/101/340)**經 Sean 確認為他自己的 3DS 測試單**;**`2SQH2P`(1500,卡 7 天 20 小時)他未答 ⇒ 未確認**。**不得寫成「四筆都是測試資料」。**
📌 **但機制問題不因樣本是測試而消失** —— 判別句:**如果那是一筆真單,現在的行為會有任何不同嗎?** 不會 ⇒ 這個行為就是要查的東西。

---

## §5-d 預言結果:**世界 A 成立 —— ceiling 有效**(量於 `08:05`–`08:09 UTC`;§5-c 原文未改一字)

### 結果(唯讀 SELECT,`net._http_response`)

| UTC | status | inboxClaimed | stuckClaimed | expiredInboxAtCeiling | errors |
|---|---|---|---|---|---|
| 07:58 | 200 | 0 | 0 | 0 | 0 |
| 08:00 | 200 | **0** | 0 | 0 | 0 |
| **08:02** | 200 | **3** | **1** | 0 | 0 |
| 08:04 | **503** | 0 | 0 | 0 | **1** |
| 08:06 | 200 | 0 | 0 | **0** | 0 |
| 08:08 | 200 | 0 | 0 | **0** | 0 |

### ① substance ✅ 命中;tick ❌ 差一格(**且差在哪是事前寫下的**)

- **tick**:認領發生在 **`08:02`** 不是 §5-c 表格寫的 `08:00`。**成因事前已標**:`next_retry_at ≈ 08:00:00.033` 而 sweeper 於 `08:00:00.018` 開跑 ⇒ `.033 > .018` ⇒ 該輪不到期(claim 述詞 `next_retry_at <= now()`,`…4a1…:80`)。
- **substance**:判別器是「**再被認領一次之後就停,還是永遠停不下來**」⇒ **停了** ⇒ **世界 A**。

### ② 🔴 但「`inboxClaimed = 0`」單獨看**不足以**下這個結論 —— 我差點踩進去

`08:04/06/08` 的 `inboxClaimed = 0` 在**兩個世界一樣**:
- **世界 A**:已轉 `needs_manual_review` ⇒ 被 claim 的 `needs_manual_review = false` 濾掉。
- **世界 A'**:**只是又進入 16 分退避**(`08:02 + 16min = 08:18`)⇒ 未到期,同樣 claim 不到。
⇒ **兩者都印 0。** 要等到 `08:18` 之後才分得開 —— **除非另找一個現在就分得開的讀數。**

**那個讀數 = `expiredInboxAtCeiling`**(`expire_webhook_events_at_ceiling`,`…4a1…:56,64`):它掃的是 `attempt_count >= 8 AND processed = false AND needs_manual_review = false`。
- 那 3 列在 `08:02` 被 claim ⇒ `attempt_count` 由 7 **遞增為 8**(claim 自帶 `++`),且 `processed` 仍為 `false`。
- `08:06` 與 `08:08`(**皆 `200`、`errors = 0`,即 expirer 確實跑完沒 throw)量到 `expiredInboxAtCeiling = 0`。
- ⇒ **不存在「`attempt_count >= 8` 且未 processed 且未 manual」的列** ⇒ **那 3 列的 `needs_manual_review` 必為 `true`** ⇒ **世界 A 成立,現在就成立,不必等 `08:18`。**
(`stuckClaimed` 側同理:`expiredStuckAtCeiling` 於同兩輪亦為 `0`。)

### ③ 🔴🔴 而那個沒預測到的 `503`,**正好落在我要拿來當判別器的那個計數上**

`08:04` 回 **`503` / `errors: 1`**,其餘計數全 `0`。
🔴 四個前置守衛(`sweep-settlements.ts:137-151`)與 claim(`:160-164`)**都是裸 `catch {}`**,只做 `result.errors++` ⇒ **從 counts 分不出是哪一個 throw 的**。
⇒ 而 `expireEventsAtCeiling` **正是那四個之一** ⇒ **若 `08:04` throw 的是它,那一輪的 `expiredInboxAtCeiling = 0` 就不是「掃到 0」而是「根本沒掃成」** ⇒ **該輪讀數無效**。
✅ **故本節的結論只採用 `08:06` / `08:08` 這兩輪**(`200` + `errors = 0`,守衛確實跑完)。**`08:04` 一律不引用。**
📌 這件事的形狀:**一個沒被預測到的錯誤,剛好污染了我要用的那把量具** —— 若當時只看 `08:04` 就宣布 ceiling 有效,會是**用一個沒跑成的檢查當證據**。

### ④ 🆕 順帶撈到的可觀測性缺口(**新條,非本次預言範圍**)

`errors > 0 → 503` 這件事本身是對的(不吞成 200)。**但 503 之後沒有人能知道是哪一步壞的**:
- 四個守衛 + claim **共 5 處** `catch {}`,**皆不帶步驟識別、不帶 reason code**;`console.error` 印的是 counts,而 counts 在五種 throw 下**長得一樣**(全 0 + `errors:1`)。
- ⇒ **這一輪的 `503` 我查不出成因,而下一次也一樣查不出。**
- **本次影響**:單發、`08:06`/`08:08` 已自行恢復 ⇒ **不擴大解讀為故障**;但**若哪天變成持續 503,現有 telemetry 不足以定位**。
- **建議修法(給施工窗,E 不改 code)**:五處 `catch` 各帶一個固定步驟碼(如 `expire_inbox` / `expire_stuck` / `flag_non_unpaid` / `claim_inbox` / `claim_stuck`)進結構化 log —— **沿用姊妹片 `email-sweep` 的固定碼集做法即可,零 PII**。

### ⑤ 口徑

`08:02` 那輪把四筆推過 ceiling **是量到的**;`needs_manual_review` 轉為 `true` 是**由 `expiredInboxAtCeiling = 0` 推出的**(我無業務表 SELECT 權限,**沒有直接讀到那個旗標**)—— 推論鏈已完整列於 ②,但**它是推的不是讀的**,要直接證實請以 `postgres` 身分查該欄。
三筆 `record_unverified`(6/101/340)**經 Sean 確認為其測試單**;**`2SQH2P`(1500)他未答 ⇒ 未確認**。**不得寫成「四筆都是測試資料」。**

---

## §5-e 兩條與 `TAPPAY_3DS_ENABLED=true` 綁在一起的前置,逐字核對結果(2026-08-17 傍晚,B 窗提問)

### ① BLOCKER「WAF 對 tappay-notify 限流」= **乙(要擋)**,而現況**不擋** ⇒ **未滿足**

**不從「限流」這個詞推**(那個詞在兩個世界都讀得通),**讀原文**(`docs/specs/2026-06-14-m3-3ds-2-webhook-route-plan.md:176`,逐字):
> 🔴 **BLOCKER — Vercel Firewall/WAF** 對 `/api/checkout/tappay-notify/*` 限流已設:= inbox 膨脹(去重鍵 rec_trade_id 非 order、存在性閘擋不住同單海量不同 rec)+ settleCharge/Record API 出站放大 的**唯一 app 前防線**;**未設 → 不得設 backend_notify_url / 不得開 `TAPPAY_3DS_ENABLED` / 不得開放 prod 結帳**

**判定依據(兩處字面,不是語感)**:①它自稱**「防線」**;②它要防的是兩件**具體會發生的事**(inbox 膨脹、出站放大)。**`log` 模式對這兩件事一件都不防** —— 它只是把膨脹記錄下來。⇒ **要求的是乙。**

**現況(我 2026-08-17 實測,`v1/security/firewall/config/active`)**:規則 2 = `Log TapPay notify requests`,`action: "log"`,**`rateLimit: null`** ⇒ **它根本不是一條限流規則**,是純記錄規則。
⇒ 🔴 **BLOCKER 未滿足,而 `TAPPAY_3DS_ENABLED` 已是 `true`。**

### 🔴🔴 但這不是「有人忘了」—— 是**兩份文件互相牴觸**,而較新的那份是本窗自己寫的

`docs/security/2026-08-17-vercel-waf-setup-plan-hobby.md` 規則 2 節逐字:
> **永遠只 Log,不要擋** … **動作(Then):Log**(🔴 **不要改成 Deny/Challenge/Rate Limit**)
> 🔴 **為什麼只 Log**:這是 TapPay 付款結果通知的入口。**擋錯 = TapPay 的通知進不來 = 訂單付了款卻沒被標成已付**(錢的狀態不一致,鐵則 12①)

⇒ **兩份都在講錢的正確性,而結論相反**:
| 文件 | 日期 | 要求 | 怕的是 |
|---|---|---|---|
| 3DS-2 plan `:176` | 06-14 | **要擋**(唯一 app 前防線) | inbox 膨脹 / 出站放大 |
| WAF plan 規則 2 | 08-17 | **永遠不要擋** | 擋掉真通知 ⇒ 付了款沒標已付 |

⚠️ **WAF plan 沒有引用、也沒有提到那個 BLOCKER** ⇒ **它很可能是在不知情的狀況下寫的**(本窗前一任所寫;我沒有證據說它讀過那份 plan ⇒ **標未確認**,不寫成「它忽略了」)。

**⇒ 這不是我能拍的板:兩邊都是金流正確性,擋與不擋各有真實代價。**
📌 **但 WAF plan 自己寫了一條同時滿足兩邊的路**(規則 2 末段):**跟 TapPay 要固定 IP 段 → 設「只允許這些 IP」(IP Blocking,Hobby 免費)**,而**不是**限流。⇒ 這樣既有「防線」(擋掉非 TapPay 來源的洪水)、又不會誤擋真通知。**硬前置 = 拿到 TapPay 的 IP 清單。**

### ② `#231` 的 ②真 alert channel / ③cron 靜默死偵測

| 項 | 現況 | 依據 |
|---|---|---|
| ② **有沒有東西會主動發通知** | ✅ **有**。`checkAnomalyAlerts` 對「所有已設定管道」(LINE / Email)推播;`ANOMALY_ALERT_ENABLED=true`;排程 `0 1 * * *`(`20260723120000…:131`) | `packages/use-cases/src/check-anomaly-alerts.ts` 檔頭 |
| ③ **cron 停掉會不會有東西紅** | ❌ **不會** | 見下 |

🔴🔴 **③ 的形狀比「沒做」更糟,兩個獨立理由**:
1. **告警的觸發條件全部是「DB 裡有壞狀態」**(`open>0 \|\| refundingStuck>0 \|\| attemptManualReview>0 \|\| releasedStuck>0`),**沒有一條是「sweeper 沒跑」**。
   而 `attemptManualReview` **要靠 sweeper 活著才會被推上去**(轉人工發生在 `mark_*_retry` 的 `attempt_count >= 8`,見 §5-d)⇒ **sweeper 死掉 ⇒ 沒有東西遞增 ⇒ 沒有東西達 ceiling ⇒ 那個計數停在 0 ⇒ 不告警。**
   ⇒ **死掉的 sweeper 在【正好用來報告它的那個計數器】上產生沉默。**
2. **告警自己跟被監控的東西共用同一套基礎設施**:`pcm-settle-sweep` 與 `pcm-anomaly-alert` **同一支 migration、同一個 wrapper `pcm_cron.invoke_cron_route`、同一組 vault secret**(`20260723120000…:128-133`)⇒ **pg_cron / wrapper / secret 任一壞掉,兩個一起停,而停掉的那個正是要來通知你的那個。**

⚠️ **口徑(不要寫成「正在燒」)**:我今天實測**零漏跑**(6h 窗 180 列 = `*/2` 的理論值)、`errors` 只有 `08:04` **單發**且自行恢復。
⇒ 正確寫法是:**「偵測缺口:它壞了要靠人去查」** —— 我今天能證明 sweeper 活著,靠的是**我去看 `net._http_response`**,不是**它會叫**。**`#231` 自己寫的後果「sweeper 死了沒人發現」成立。**
⚠️ **未量**:是否有 repo 外的外部監控(uptime/Vercel 通知)覆蓋這一格 —— **不在我可讀範圍,標未確認。**

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
