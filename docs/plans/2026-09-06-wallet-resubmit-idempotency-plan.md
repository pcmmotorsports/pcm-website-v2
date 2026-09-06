# Plan v2 · 儲值金重送重複入帳去重 —— 線【帳號】`account` 2026-09-06

> **狀態:v1 被 codex(`gpt-6-astra` / effort high)判 FAIL —— 18 must-fix + 2 nit。本檔是折完的 v2,等主視窗批。零碼改動。**
> 拍板:Sean 2026-09-06 逐字「**甲=上線前必修(帳號窗做,高強度審查)**」。
> 題源:體檢窗 `-89` gpt-6-astra 派工包【2】(全程靜態讀碼)。
> 三題已裁(主視窗 `-f1`):Q-wallet1=甲 · Q-wallet2=乙 · Q-wallet3=甲。
> 🔴 **而 v2 讓 Q-wallet2 變成不用問的題** —— 見 §2:**不加參數、不改簽章、不 DROP。**
> 審查原文:`docs/reviews/2026-09-06-wallet-plan-codex-R1.txt`。

## 0. 🔴 先訂正 v1 裡我自己量錯的三處(codex #19 · #20;我逐一開檔複驗,它對)

| v1 寫的 | 事實 | 怎麼驗的 |
|---|---|---|
| ledger INSERT 在 `20260716210000:118` | ❌ **`:124`** | `grep -n 'INSERT INTO public.customer_wallet_ledger'` |
| `getRequestId()` 在 `wallet-actions.ts:45` | ❌ **`:42`** | `grep -n 'getRequestId()'` |
| 「`admin_adjust_wallet` **只有一代**」 | ❌ **body 定義點只有一個, 而這支函式【被改過】** | `20260905110000:36` 列了它與 md5 `ad55861b…`;`:171` 逐字 `EXECUTE format('ALTER FUNCTION public.%s SET search_path = %L', r.sig, '')` |

🛑 **第三條是最危險的那個** —— `latest-definition-of.sh` 數的是**body 定義點**,
而 `ALTER FUNCTION … SET search_path` **不改 body、不進它的分母**。
⇒ 📌 **「1 代」與「這支沒被改過」是兩句話, 而我把前者寫成了後者。**
⇒ 🔴 **直接後果**:v1 的 rollback 說「逐字抄 `:37-148` 還原」——
   那會把 `search_path` 從**空字串**(`20260905110000:171` 收緊的)打回 `public, pg_temp`,
   **而 body md5 完全相同 ⇒ 我那道 md5 錨會【印綠】。**(codex #11)

## 1. 病灶(逐字, 已複驗)

派工包逐字:「員工扣 500, DB 已提交但回應遺失, 同一操作再送 ⇒ 扣 1000;
`FOR UPDATE` 只排順序不辨認同一次業務操作, 前端 pending disable 擋不到提交成功後的重送。」

```
20260716210000:113  SELECT … FROM public.customers WHERE user_id = … FOR UPDATE;
20260716210000:124  INSERT INTO public.customer_wallet_ledger (…) VALUES (…);
```

⇒ `FOR UPDATE` 只讓兩發**排隊**, 排完**兩發都插**;ledger 上除 pkey 外**零 UNIQUE**。

## 2. 🔴🔴 v2 的核心:**這條路這個 repo 已經走過一次, 而 Sean 已經拍過板**

`apps/admin/src/proxy.ts:28-34` 逐字記著一個**已知例外**:

> 「`order_note.append` 這條路寫進 `admin_audit_log.request_id` 的**不是**本行產的 id,
>  而是表單帶回的一次性 token —— 因為 **A6 的冪等鍵就是 `p_request_id`**,而本行「每個 HTTP
>  request 一組新 id」會讓雙擊產生兩筆**刪不掉**的備註。
>  token 由 **server 在渲染表單時**產生(不是瀏覽器自造)⇒ 正常路徑仍是 server 權威」

完整設計在 `docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md` **§4**,
拍板在該檔 **§9 Q2 = C**(Sean 2026-08-02 深夜)。

### ⇒ 本片照抄那個形狀, 不自己發明

```
① 冪等鍵 = `p_request_id`(既有參數)⇒ 🟢 不加參數、不改簽章、不 DROP
   ⇒ codex #7(wrapper 保留原漏洞)· #8(新舊版本交錯)· #10(新物件 ACL)【整組消失】
   ⇒ 主視窗裁的 Q-wallet2=乙 也一併不需要了(我已回報)
② token 由 **server 在渲染表單時**產生(uuid v4, hidden input)—— 不是瀏覽器自造
③ 解析器**強制**該欄存在且為 uuid 形狀;缺 ⇒ `invalid`
   🔴 **不得 fallback 到 HTTP id** —— fallback = 靜默退回沒有冪等(A6 §4 逐字)
④ **查驗式冪等**:同鍵**且**內容相符 ⇒ 回 `'DUPLICATE'`;同鍵**而內容不符** ⇒ **RAISE**
   ⇒ 這一條直接答掉 codex #5(同鍵 ≠ 同一操作內容)
```

🛑 **A6 §4 的 F2 誠實代價也一併繼承**(不重新論證, 但要寫在本片檔頭):
把 `p_request_id` 改吃表單值 = **持 session 者可自選 / 重複那個稽核關聯值**,
推翻 `proxy.ts:22-25` 的「一律 server 新產」。Sean 2026-08-02 已拍 C 接受;
殘餘防線 = 上面④的查驗式冪等。⇒ 動錢層級要不要重問一次 = §9 唯一那題。

## 3. token 的生命週期(codex #1 #2 #3 #4 —— v1 整段沒寫)

| 情境 | token 怎樣 | 結果 | 涵蓋? |
|---|---|---|---|
| 雙擊 / 網路重送 | **同一個** | 第二發回 `DUPLICATE` | ✅ |
| 🔴 **結果未知**(DB 已扣、回應遺失) | **必須保留原 token 與原輸入** | 重送 ⇒ `DUPLICATE` ⇒ 顯示「已處理過」 | ✅ **本片最重要的一格** |
| 上一頁(bfcache 還原舊 DOM) | 同一個 | 內容沒改 ⇒ `DUPLICATE`;**內容改了 ⇒ RAISE** | ✅ 兩條各一格驗收 |
| 上一頁但頁面被重抓 / 卸載後重建 | **新的** | 真的第二筆 | ❌ **明寫不涵蓋** |
| 重新整理頁面 | **新的** | 真的第二筆 | ❌ **明寫不涵蓋** |
| 另開分頁重做同一筆 | **新的** | 真的第二筆 | ❌ **明寫不涵蓋** |

🔴 **「結果未知」那一格是本片存在的理由, 而 v1 把它漏了**(codex #1):
現行 `wallet-actions.ts` 失敗時 `redirectWith(…)` 去錯誤頁 ⇒ **表單重建 ⇒ 新 token** ⇒ 員工重送再扣一次。
⇒ ✅ 修法照 A6 §9 **Q1=A「錯誤路徑保留員工輸入」**:錯誤頁把**原 token + 原輸入**帶回去。
⇒ 🛑 **只加 hidden input 不夠** —— 錯誤路徑不改, 這一片就沒有修到它要修的那個情境。

🔵 **不涵蓋的三格要怎麼辦**:寫進 UI 文案與 runbook ——「不確定有沒有成功 ⇒ **先去看帳本**, 不要重按」。
   那是流程層, 不是本片能用 SQL 解的。**明寫, 不假裝涵蓋。**

## 4. DB 那一半

1. `customer_wallet_ledger` 加 `request_id text`(nullable)
   \+ **partial UNIQUE**(`WHERE request_id IS NOT NULL`)。
   🔴🔴 **而理由要寫對**(2026-09-06 鑽機當場證偽我原本那句):
   ⛔ ~~「partial ⇒ 既有列不受影響」~~ **因果反了** —— 保護既有列(NULL 鍵)的是
   **Postgres 唯一索引預設 `NULLS DISTINCT`**(每個 NULL 互不相等)⇒ **換成全表 UNIQUE,
   多筆 NULL 鍵一樣插得進去**。partial 的價值是**索引大小與意圖**。
   🛑 而**真正扛事的是「這個唯一索引存在」** —— 突變把它整個拿掉 ⇒ RPC **執行期**炸。
   🔬 **那個 3 是這樣數的**(2026-09-06 唯讀實跑,值會隨時間變 ⇒ 動工當天要重數):
   `bash scripts/readonly-prod-sql.sh` 跑 `SELECT count(*) FROM public.customer_wallet_ledger;` ⇒ **3**。
   🛑 **而「不受影響」也不是靠 partial predicate** —— ⛔ ~~原本這裡是這樣寫的~~,
   而上面那段已經訂正過:**保護舊列的是 `NULLS DISTINCT`**。這個 3 只是「有多少列會變成 NULL 鍵」,
   它**不是**任何一個結論的依據。驗那件事的是 §5 第 **6**、**7** 格。
   🔴 **而 nullable 是為了舊列, 不是為了新呼叫**(codex #6):
   **新版 RPC 拒收 NULL / 空字串 / 非 uuid 形狀** —— fail-closed, 與解析器同一道。
2. `CREATE OR REPLACE admin_adjust_wallet`(**同一組 6 參數**):
   - `INSERT … ON CONFLICT (customer_user_id, request_id) DO NOTHING`
     🔴 **必須指定衝突目標**(codex #13):裸 `ON CONFLICT DO NOTHING` 會**吞掉別的唯一衝突**。
   - `ROW_COUNT = 0` ⇒ **不是直接回 DUPLICATE**, 而是**去把那一列撈出來比對**
     (客戶 / 方向 / 金額 / 備註)⇒ 相符回 `'DUPLICATE'`、不符 **RAISE**。
     🔴 理由(codex #13):`ROW_COUNT=0` 只證明「沒插入」, 不證明「同一筆已完成」。
   - 前置閘照 `20260906700000` 那一套, **而加兩格**(codex #11):
     `proconfig` 必須是 `search_path=""`(不是只比 body md5)· ACL 白名單 · COMMENT 錨。
3. 🟢 **不加參數 ⇒ 不必 DROP ⇒ 沒有部署交錯問題**(codex #8 自然解掉)。
   ⚠️ 而**碼與 DB 的上線順序仍要管**:DB 先上(舊 app 傳 HTTP id 進去 ⇒ 每次不同 ⇒ **行為與今天相同, 不會壞**),
   app 後上。⇒ **這個方向是安全的**, 反過來才會壞。

## 5. 鑽機(codex #14 #15 #16 —— v1 那三格是免費的綠)

| 格 | 要證什麼 | 🔴 殺得掉它的突變 |
|---|---|---|
| 1 | 同鍵送兩次 ⇒ ledger **+1**、餘額動 **一次**、`total_deposit` 動一次、audit **+1**、第二發回 `DUPLICATE` | 拿掉去重 ⇒ 全部 +2 |
| 2 | **不同鍵**送兩次 ⇒ 全部 +2 | 「永遠回 DUPLICATE」的壞版本 ⇒ 這格紅 |
| 3 | 同鍵**而內容不同** ⇒ **RAISE**, 且**沒有任何一列被寫** | 只比鍵不比內容 ⇒ 這格綠不了 |
| 4 | 🔴 **跨連線同鍵競爭**(兩個 psql session 同時送)⇒ 只有一個成功 | 「先查再插」的壞版本 ⇒ 這格會雙插(v1 的「順序兩次」抓不到, codex #14) |
| 5 | 第一筆交易**失敗回滾**後用同鍵重送 ⇒ **要成功**(不是被誤擋) | 把鍵寫在交易外 ⇒ 這格紅 |
| 6 | 🔴 **partial 那個 predicate 真的在**:查 `pg_indexes.indexdef` 逐字含 `WHERE (request_id IS NOT NULL)` | 換成普通 UNIQUE ⇒ 這格紅(v1 只驗「多筆 NULL 插得進去」= 拔掉 UNIQUE 也綠, codex #15) |
| 7 | 舊列(NULL 鍵)仍可查、仍可再插一列 NULL | — |
| 8 | 🔴 **app 端真的把同一個 token 送到 RPC**:表單 → 解析器 → action → RPC 的參數 | action 每次自產鍵 / 表單沒帶 ⇒ 這格紅(codex #16;DB 手填同鍵全綠是假的) |
| 9 | 🔴 **錯誤路徑保留 token**:模擬 RPC 拋錯 ⇒ 錯誤頁帶回**同一個** token | 錯誤頁重建表單 ⇒ 這格紅 |
| 10 | 兩個 id(HTTP `x-request-id` 與冪等 token)**都進 attempt log** | 刪掉那行 log ⇒ 這格紅(A6 §4 F2 逐字要求) |

## 6. md5 錨怎麼定(codex #17)

🛑 v1 寫「新的貼完再量」⇒ **漏裝去重邏輯也會把錯的版本收成標準答案**。
✅ 改成:**新錨在拋棄式 PG 上、從【已通過上面十格】的產物先產出來**, 寫進 migration;
   貼後只做**比對**, 不再「量一個新的當預期」。

## 7. Rollback(codex #11 #12 —— v1 這一段是錯的)

```
🔴 ① 不得逐字抄 20260716210000:37-148 —— 那會把 search_path 打回 public, pg_temp
     而 body md5 相同 ⇒ 我的錨會印綠。✅ 還原後必須【另外】把 search_path 設回空字串,
     並把「proconfig = search_path=""」寫成事後斷言的一格。
🔴 ② ACL 與 COMMENT 也要一起還原(同 20260906700000 的教訓)。
🔴 ③ 「DROP COLUMN 會丟掉鍵」不是一句提醒就夠(codex #12):
     鍵一旦刪掉, 舊 POST 重播 / 重上新版後再送同鍵 ⇒ 找不到去重證據 ⇒ 再扣一次。
     ✅ 還原步驟第 0 步 = 先停掉調整入口(後台那顆鈕), 處理完在途請求, 才動 DB。
     ⚠️ 本片沒有「換回舊函式就是止血」這件事 —— 那是 supersede 那片的性質, 這裡不成立。
```

## 8. 誠實申報

- ⚠️ **存量 ledger 3 列** ⇒ 「今天有沒有發生過重複入帳」**量不到**;本片不宣稱修好了一個已發生的問題。
- ⚠️ **本片不宣稱「所有寫入路徑都去重了」**(codex 打不破那節指出):
  `#280` 的 `service_role` 對 ledger 的 **INSERT 權限仍然開著** ⇒ 持 service key 直插不經過本片。那是 `#280`。
- ⚠️ `#280` 的 `v_ws` 空白集不全**不夾帶**(空白備註不會破壞同鍵互斥)。
- ⚠️ codex 引的先例路徑 `note-repository.ts:102` **不存在**(該檔查無);
  但它那條 finding 的**實質**成立 —— 真正的先例是 `proxy.ts:28-34` + A6 §4, 我用的是後者。

## 9. 要主視窗裁的(只剩一題;原 Q-wallet2 作廢)

```
Q-wallet4:A6 §4 那個誠實代價(冪等鍵吃表單值 = 持 session 者可自選稽核關聯值),
          Sean 2026-08-02 已對【訂單備註】拍 C 接受。本片是【動錢】, 要不要重問一次?
  甲 = 沿用 2026-08-02 那個拍板, 不重問(推薦:同一個機制、同一個殘餘風險,
       而本片還多一道「內容不符就 RAISE」的查驗式冪等)
  乙 = 動錢層級不同, 重端給 Sean 拍一次
  A: 甲|乙
```
