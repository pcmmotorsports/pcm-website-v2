# 供應商主檔線 — 交接檔(2026-08-01 傍晚改寫)

> **接手入口。開工前整份讀完。** 前身版本(下午、S1a 之前)已被本檔取代;
> 更前身 = `docs/handoff/2026-08-01-a7c-applied-handoff.md`(A7c 線,已完成)。

---

## §0 一句話現況(2026-08-01 晚更新)

✅ **`S2-C` 併發 harness 已收工**(`scripts/s2c-concurrency.sh`、**36 PASS / 0 FAIL**、零 migration 改動、**未 push**)⇒ **下一片 = S3a**(§3-1)。詳見 §3-0。

**S1a + S1b + S2 三片皆已 apply 到正式站、型別已重 gen(ledger 尾筆 = `20260801160000`)。**
🔴 **型別檔的人工校正從「三處」變成「兩個函式共七處」** —— `admin_upsert_supplier` 的
`p_supplier_id` / `p_label` / `p_is_active` / `p_note` 四個參數必須補 `| null`
(這支函式的分流機制就是「NULL = 該欄不動」,而 PostgREST 表達不了「必填但可為 null」)。
`p_actor` / `p_request_id` **不補**(函式內 fail-closed 拒收 NULL)。詳見型別檔檔頭。
🆕 **下一片 = `S2-C` 併發 harness**(Sean 2026-08-01 晚拍 **B**「現在就補」;規格見 §3-0)。其後才是 S3a。

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git log --oneline -3 && git status --porcelain
```
預期:branch=`dev`、HEAD = S2(`e21a0b6`)、工作樹乾淨、**未推 1 筆**。
(hash 若不符,以 `git log` 當場結果為準 —— 本檔不寫死可達性,見 STATUS「最近 3 commit」欄的政策。)

🔴 **另有一個視窗在做前台(`apps/storefront/src/**`)。** 我的領域 =
`supabase/migrations/` / `scripts/` / `docs/specs/2026-08-01-e10-supplier-*`。
**`STATUS.md` 與 `docs/handoff/CURRENT.md` 是唯一真衝突點,改之前先問 Sean。**
一律 `git add <精確路徑>`,禁 `git add .` / `-A`;`--amend` 前先 `git log -1` 確認 HEAD 是自己那筆。

---

## §1 🔴 開新視窗第一件事:重排今晚的提醒

**今晚 22:04 的 TapPay 探測 cron 是 session-only —— 上一個視窗關掉就死了。**
## ✅ 本節已結案 —— **探測做完了,不要再排這個 cron**

**2026-08-01 深夜:兩題都有答案了**(詳 `docs/reference/tappay-reference.md` §2.3a):
①**API 支援多次部分退款** ②**超額退款被 `10051` 擋、且狀態零變動**。
交易 `D202607314b3cIL` 現況 `refunded_amount=4` / `amount=2`,**測試已完成,無須後續動作**。

### 🔴🔴 但這一節同時是一起事故的現場,教訓比結論重要

**同一個 22:04 的 one-shot cron 被排在兩個視窗**(`44b7ba58` 與 `e4739b3a`),
**兩個 agent 都真的對同一筆交易送出退款**。六元的測試交易被吃掉四元,**有 1 元無法歸屬是誰打的**。

🔴 **直接原因是本檔上一版的這句話(我寫的)**:
> ~~「開視窗第一件事永遠是『重排一次』,**重複排的成本遠低於漏排**。」~~

**這句話對「排程」成立,對「排程的內容」不成立。**
`CronCreate` 是 session-only、重排本身確實無副作用 —— 但這個 cron 的**內容是送退款**。
排程可以冪等,**動作不冪等**。我把前者的安全性推廣到後者,於是叫下一個視窗也排一份。

### 給後人的規則(取代上面那句)

- **cron / 排程的內容若含對外部系統的寫入**(退款、寄信、下單、部署、對 prod 寫資料)⇒
  **同一時間只准存在一份**。交接檔要寫「**由哪個視窗持有**」,不能只寫「記得重排」。
  其他視窗**只讀不打**。
- **執行前先 query 現況,與交接檔宣稱的起始狀態比對;不符 = 停下回報。**
  🔴 對方視窗當時**確實看到不符**(該原封不動、實查 `refunded_amount=2`),
  卻judged 成「指令的前提過期了」而調參數繼續打 —— **正確動作是停**。
  「狀態與預期不符」在對外寫入前一律是停止訊號,**不是需要聰明繞過的參數問題**。
- 純提醒/唯讀的 cron 才適用「寧可重複排」。

落檔 memory `feedback_duplicate-cron-double-fires-external-writes`。
內容(逐字):

> TapPay sandbox 部分退款探測,交易 `D202607314b3cIL`(2026-08-01 18:00 送批):
> 1. `python3 scripts/tappay-sandbox-refund-probe.py plan`(零 API 呼叫)
> 2. `python3 scripts/tappay-sandbox-refund-probe.py query`(唯讀)
> 🔴 **第 2 步若 `is_captured` 仍是 false 就停下回報**,不繞過、不改腳本
>    (未請款做部分退款必回 `10024`,測了沒意義)
> 3. 只有 `is_captured=true` 才跑 `python3 scripts/tappay-sandbox-refund-probe.py refund 10`
>
> 要回答:①API 支不支援多次部分退款 ②超額退款會不會被 API 拒。
> 🔴 Portal 按鈕消失只證明**介面**擋住、不證明 API 會拒,而 API 才是我們要走的路。
> 金鑰在 `.env.tappay-sandbox`,**值絕不貼進對話**。細節見 `2026-08-01-a7c-applied-handoff.md` §3。

---

## §2 已完成(可驗證的事實,不是宣稱)

| 片 | commit | 狀態 |
|---|---|---|
| **S1a** 供應商主檔 + 26 家 seed + 不可刪除 | `b5d918d` | 已 push、**已 apply**(08-01 傍晚) |
| **S1b** 採購表供應商欄改 FK | `3af433d` | 已 push、**已 apply**(08-01 傍晚) |
| 型別重 gen + 貼回三處人工校正 | `ff1347e` | 已 push |
| **S2** `admin_upsert_supplier` owner RPC | `e21a0b6` | 已 push、**已 apply**(08-01 晚) |
| S2 apply 後重 gen 型別 + 第四類人工校正 | `bd2add4` | 已 push |
| **S2-C** 併發 harness(`scripts/s2c-concurrency.sh`) | 本片 | **已 commit、未 push**;零 migration 改動 ⇒ 無需 apply |

**S2 做的事**:`suppliers` 的**寫入路徑到本片才存在**(S1a 對 service_role 只開 SELECT
⇒ 在此之前那張表沒有任何 app 層寫得進去的方法)。一支 `SECURITY DEFINER` owner RPC 吃三種動作:
`p_supplier_id` 為 NULL = 新增;有值時 `p_label` / `p_is_active` 各自 NULL = 該欄不動。
回固定碼 `CREATED / UPDATED / NO_CHANGE / NOT_FOUND / DUPLICATE_LABEL`;同交易寫 `admin_audit_log`。
驗證 harness = `scripts/s2-verify.sh`(**77 PASS / 0 FAIL**)。

**S2 的審查**:三輪、共 **42 條**、逐條親驗全成立、**駁回 0**、已全折 ——
R1 Claude opus `code-reviewer` FAIL 13(逐行正確性)→ R2 codex `gpt-5.6-sol` xhigh NO-GO 18
(結構與宣稱判別力)→ R3 Fable `adversarial-reviewer` FAIL 11(換角度質疑框架本身)。
🔴 **三輪 findings 幾乎零重疊** —— 每輪都打在前一輪看不到的層,**直到 R3 才收斂**。

**S1b 做的事**:`order_item_procurement` 的 `supplier_name` + `supplier_canonical_key`
→ **`supplier_id` uuid FK → `suppliers(id)`**(ON DELETE / ON UPDATE 皆 RESTRICT);
business key 換軸為 `(order_item_id, supplier_id)`(**約束名 `order_item_procurement_business_key` 不變**);
補回 `(supplier_id)` 索引;三段 COMMENT 同步;A2 `:123-126` 的合約債①明文結案。

**驗證數字**(本機 PG17.10、C locale、`d1t2-rehearsal.sh provision` 從零套完全部 migration):

| 輪次 | 結果 |
|---|---|
| s1a | **41 PASS / 0** |
| s1b | **47 PASS / 0** |
| s1a **再跑一次** | **41 PASS / 0** ← 這輪才是「s1b 不污染兄弟 harness」的證據 |
| 把 S1b 檔移開、重放成**只有 S1a** 的庫 | **40 PASS / 0**,走單片模式分支 |
| 三綠 | typecheck 0 / lint 0(未動 `.ts/.tsx` ⇒ 不需 build) |

**六道 fail-closed 閘已對正式站唯讀實查全部通過**:索引定義對稱差 0 / 無繼承子表 /
無欄級 ACL / ACL 攤平恰 `service_role:SELECT:false` / 兩表 0 列
⇒ **`db push` 不會被自己的閘誤擋**。

---

## §3 下一步(依序)

### §3-0 ✅ `S2-C` 併發 harness —— **已收工**(2026-08-01 深夜;規格原文保留在本節下半備查)

**產物** = `scripts/s2c-concurrency.sh`(533 行、**36 PASS / 0 FAIL**、零 migration 改動、未 push)。
**跑法**:`bash scripts/s2c-concurrency.sh /tmp/s2-work`。🔴 **必須序列跑**(§B 的突變是 committed DDL,
突變視窗內 `s2-verify.sh` 會真的讀到被改壞的函式)。

🔴 **規格的格1 照字面做出來沒有判別力,已改設計**:就算拿掉 `FOR UPDATE`,只要 B 改的是**不同**的值,
它的 `UPDATE … WHERE id=X` 照樣卡在 A 的列鎖上 ⇒「B 會不會卡住」量到的是 UPDATE 的鎖。
改成 **情境①「B 把名字改回原值 L0」** 才分岔:拿掉後 B 讀 stale → 判等 → **`NO_CHANGE` 在任何寫入前返回**
⇒ 不卡、零稽核列、A 的 L1 留在列上 = **改名遺失**。

🆕 **情境②(R3 換模型指出、當場補的,不是規格裡的)**:A 改名**並停用**、B 改成第三個值 L2 時,
**回傳碼與端狀態 label 在突變前後完全一樣**,判別力只剩兩處 —— 實測突變後
①稽核 `before` 記成 A 改之前的舊值 = **偽造歷史**(比缺一列更毒)
②`coalesce(p_is_active, v_before.is_active)` 吃到 stale 值 ⇒ **把 A 剛停用的供應商靜默翻回啟用**。

🔴 **證據結構(不得說滿)**:情境① 突變翻面的是 **1 個根因(B 讀到 stale 快照)+ 4 個相關症狀**,
不是 4 個獨立證據 —— `NO_CHANGE` ⇒ 提早返回 ⇒ 不卡 + 稽核 INSERT 走不到 + 沒人寫回 L0,全是單向推出的。
情境② 才提供**另一族**症狀(偽造稽核 / 停用被翻回)。

🔴 **沒測什麼(全綠不等於「併發已測過」,清單逐條在腳本檔頭)**:新增路徑的撞名競速
(migration `:223`「含與並行 session 撞名」那句宣稱**至今沒有任何測試背書**)/ 跨家撞 label /
停用 vs 改名交錯 / **PostgREST + service_role 那一層**(harness 以 owner 直連;正式站被擋的 B
可能吃角色層 `statement_timeout` 直接炸 `57014` 到 UI,而不是這裡看到的「等待然後成功」)。

**審查**:三輪、**14 條 must-fix**、逐條親驗 **13 條成立 / 駁回 1 條**、已全折 ——
R1 Claude opus `code-reviewer` **FAIL 5**(全在失敗與中斷路徑)→ R2 codex `gpt-5.6-sol` xhigh
**NO-GO 8**(探針 fail-closed 與宣稱判別力)→ R3 Fable `adversarial-reviewer` **FAIL 1**
(格2b 是兩個 `q()` 互比 ⇒ 連線層錯誤時兩邊字串相同、沒讀到資料也會綠)。
**駁回的那條** = codex 說「所有 psql 都沒加 `-X`」,實查 13 處全部都有(經 `-tAX` / `-qtAX` 帶入)。

**中斷安全(實測,非推論)**:突變視窗內送 **SIGHUP** 與 **SIGTERM** 各一次 ⇒ 皆 exit **130**、
函式 md5 還原、DB 零殘留;中斷後緊接著重跑仍 36/0。
**零污染**:`s1a → s1b → s2 → s1a` = **41 / 47 / 77 / 41**,與本片前基準逐一相符。

---

<details><summary>原規格(2026-08-01 晚寫、已完成,備查)</summary>

**要證的事**:`admin_upsert_supplier` 裡的 `SELECT … FOR UPDATE` **真的把同一家的並行改動序列化**。
現況只有**文字層**斷言(`prosrc` 裡那個字還在)—— 拿掉 `FOR UPDATE`,S2 的 77 條裡
**除了那一條之外一條都不會紅**,而兩個員工同時改同一家會 lost update + 稽核 before/after 鏈斷。

**三格**(產物建議 = `scripts/s2c-concurrency.sh`,別塞回 `s2-verify.sh`,那支已 700+ 行):

1. **擋得住**:連線 A `BEGIN` → 呼叫 RPC 改 X → **不 commit**;連線 B 對**同一家** X 呼叫 RPC
   → 必須**卡住**(不是失敗、是等)。A commit 後 B 才動。
2. **無 lost update**:B 解鎖後讀到的 `before` 必須是 **A 改完的新值**,不是 A 改之前的舊值;
   兩筆稽核的 `before/after` 首尾相接(A.after = B.before)。
3. **突變**:拿掉 `FOR UPDATE`(`CREATE OR REPLACE` + ROLLBACK,沿用 `s2-verify.sh` 的 `mut_block()`)
   ⇒ 第 1 格不再卡住、第 2 格讀到 stale before、鏈斷 ⇒ **兩格都必須轉紅**。沒有這格就沒證到承重。

🔴 **必須用 barrier,不准用 sleep/賽跑** —— memory `feedback_race-test-without-barrier-proves-nothing`
逐字:「沒有 barrier 的競賽測試綠了不代表任何事」。可重用的形狀 = `scripts/lib/a7bt-barrier-migration.py`
與 `scripts/a7bt-acl-rollback-lock.sh` 的鎖探針(那支的教訓:**「沒探到」若靜靜算過就是永久假綠**,
判準要正向看到 `PROBE-OK` 之類的字面,不能只看「沒出錯」)。

🔴 **開工前先讀**:memory `feedback_race-test-without-barrier-proves-nothing`(含 PG17 `MAINTAIN` 與
PUBLIC 斷言順序兩個附帶坑)、`reference_bash-background-kill-and-mutation-restore-traps`
(`kill -9 $!` 可能殺到子 shell;突變還原**別用** `git checkout`)。

**片型**:高風險片(鐵則 12 ②權限的延伸驗證)⇒ 收工前照樣走 code-reviewer + codex 關卡2。
**估時**:15-45 分鐘寫 + 審查另計。**零 migration 改動**(只加 harness)⇒ 不影響 apply 順序。

</details>

---

### §3-1 **下一片 = S3a**

1. **S3a** 讀模型 + server action(`listSuppliers`:預設只回 `is_active=true`、`ORDER BY label`)。
   🔴 驗收 14 明文要求「拿掉 active 過濾**必須有測試轉紅**」——只證明 inactive 列 JOIN 得到不算數。
   🔴 S3a **只做讀**;寫入呼叫端在 S3b(R3 更正片界,plan §5-11b)。
2. **apply**(Sean 手動 `supabase db push`;跑前移開 `.env.local`、跑完還原)。
   🔴 **push 之前先跑這行 preflight**(S2 的「零欄級 ACL」閘是第一次對正式站執行,S1b 只查過採購表):
   ```sql
   SELECT count(*) FROM pg_attribute
    WHERE attrelid='public.suppliers'::regclass AND NOT attisdropped AND attacl IS NOT NULL;
   ```
   預期 **0**;非 0 先查是誰授的,不要直接 push。
   🔴 **apply 後必重 gen 型別**(新增一支 RPC ⇒ `Functions` 區塊會變)+ 貼回 `create_order.Args`
   三處人工校正,**以 typecheck 轉綠為證**。這是 **S3b 的硬前置**(S3b 要 typed `.rpc()`)。
3. **S3b** `/settings/suppliers` 設定頁(列表字母序 + 新增 typeahead + 改名 + 停用開關)。
   🔴 **S3b 揹三條 S2 交下來的契約債,全在 plan §6**:
   ① 改名/停用 action **必須斷言回傳碼 ∈ `{UPDATED, NO_CHANGE}`** —— 收到 `CREATED` 表示呼叫端
   把 id 弄丟了,會靜默多一筆**刪不掉**的垃圾列且零錯誤(R3 實測)
   ② 撞到**已停用**的同名供應商也回 `DUPLICATE_LABEL`,而 `listSuppliers` 預設不回停用的
   ⇒ 需要「顯示停用同名 + 一鍵重新啟用」的出口,否則是 UI 死路
   ③ 逐檔 ≤400 行(鐵則 6),附 file manifest。

---

## §4 🔴 apply 時必須知道的三件事

1. **會一次套兩支**。正式站 ledger 最後一筆 = `20260801120000`(A7c);目錄裡有
   `20260801140000`(S1a)+ `20260801150000`(S1b)**兩支未登記** ⇒ `db push` 依序套兩支、
   **各自一個交易**(CLI 正常行為,不是整批回滾)。兩支都有 fail-closed 前置閘,
   順序錯或半批狀態會**當場擋下而不是寫壞資料**。
2. **apply 後必做型別重 gen**,而且 🔴 **重 gen 會沖掉 `create_order.Args` 內的三處人工校正**
   (`p_client_ip` / `p_client_ua` / `p_notification_email` 的 `| null`,PostgREST 表達不了
   「必填但可為 null」)⇒ 重 gen 後必須貼回,**以 typecheck 轉綠為證**。這坑已復發過一次。
3. **apply 之前不得宣稱型別已對齊**。現況安全的理由 = 全樹只有 `packages/adapters/src/supabase/database.types.ts`
   一個檔提到 `order_item_procurement`、**零 app code 消費**(本線實 grep 確認,非轉述)。

---

## §5b 🔴 S2 的誠實邊界(2026-08-01 晚新增)

- ✅ ~~**併發完全沒測**~~ **已由 S2-C 關掉(§3-0)** —— `scripts/s2c-concurrency.sh` 36/0:
  「同一家的改名 vs 改名」現在拿掉 `FOR UPDATE` 會有 7 條斷言轉紅(改名遺失 / 稽核鏈斷 /
  偽造稽核 / 停用被翻回)。🔴 **但只關掉這一個家族** —— 新增撞名競速、跨家撞 label、
  停用vs改名交錯、PostgREST + service_role 那一層**仍然沒測**(harness 以 owner 直連)。
  ⇒ **不得對外說「併發已經測過了」**,只能說「同一家改名的序列化已被證明承重」。
- 🔴 **近似重複三種形狀都不擋**:內部空白 / **大小寫**(`akoso` 與 `AKOSO` 並存是實測)/ 標點。
  防線一律是 S3b 的 typeahead(人眼)。**這是「已知不擋」清單,不是窮舉。**
- 🔴 **稽核 `actor` 不是經過驗證的身分** —— `apps/admin/src/lib/session/actor.ts:6-7` 逐字
  「以 cookie 承載、內容來自使用者自行選擇……**不是**登入 / 授權邊界」。
  S2 保證的是「稽核列一定有一個非空 actor 字串」,不是「那個字串是真的操作者」。真身分屬 E8-B。
- 🔴 **稽核不能反過來當「真的有寫入」的證據**:service_role 對 `admin_audit_log` 有 INSERT
  ⇒ 同一把 service key 可不碰 `suppliers` 就寫一列假稽核。既有權限模型、非 S2 引入。
- 🔴 **全部 ACL / SET ROLE 結論跑在 `scripts/d1-supabase-shim.sql` 手造的角色圖上**
  (三角色皆 NOLOGIN、零 membership、**沒有 PostgREST 那一層**)⇒ 證的是「PG 角色層擋得住」,
  **不等於**「拿 anon key 打 `/rest/v1/rpc/` 擋得住」。
- 🔴 `[[:cntrl:]]` 隨 `lc_ctype` 變 ⇒ 本機 C locale 的控制字元結論**不外推**正式站(#305 同族)。
- 🟡 **相鄰缺口不修**:S1a 對兩支 trigger 函式的 `REVOKE` 沒涵蓋 anon/authenticated/service_role
  (**無可利用性** —— trigger 函式直呼必炸 `can only be called as triggers`),
  修它要動已 apply 物件的 ACL = 另一支 migration 的決定,不夾帶。

---

## §5 🔴 誠實邊界(不得對外說滿)

- **沒跑第三輪換模型**。關卡2 跑了 **codex `gpt-5.6-sol` xhigh 兩輪**(鐵則 12 按字面滿足),
  但 codex 只設定一個模型,Fable / adversarial-reviewer 那條路依規則需 **Sean 指名**才動用
  ⇒ **兩輪同模型的共同盲點未被覆蓋**。兩輪都明說 DDL 未被擊破。
- **COMMENT 的驗收是 presence gate 不是語意守門** —— 把整段理由反過來寫、關鍵字還在就會全綠。
- **rollback 只在採購表 0 列時成立**;一旦 S2/A5a 開始寫入就**不可照抄**
  (舊兩個 NOT NULL 文字欄沒有值可以補;下游要逆序先撤 S3b → S3a → S2)。
- **`docs/handoff/CURRENT.md` 仍是過期的**(還寫「code 零行、等批准」)。Sean 拍板本輪只動 STATUS,
  避免與並行 session 撞車 ⇒ 留給前台那輪或下一個 session 補。
- **本機 C locale ≠ 正式站 `en_US.UTF-8`**(#305);字母排序屬 S3a/S3b,本線尚未測。
- **`MEMORY.md` 已 25.6 KB、超過 24.4 KB 讀取上限**(STATUS 上次記錄 22.6 KB)。
  撤條目需 Sean 拍板,未自行處理。

---

## §6 這條線今天踩到、值得後人對照的坑

1. **新 FK 會把既有守門降級成「觀察不到」** —— S1b 的 FK 讓 `TRUNCATE suppliers` 在 S1a 的
   `BEFORE TRUNCATE` trigger **之前**就被 PG 擋掉(`0A000`);刪供應商則相反(trigger 先炸 `P0001`,
   FK 的 `23503` 要停用 trigger 才看得到)⇒ **plan 原本要求的 `23503` 物理上不可達**,已更正。
   兩支 harness 都已改成兩層各自驗。落檔 = memory
   `feedback_new-fk-can-demote-an-existing-guard-to-unobservable`。
2. **harness 不得污染兄弟 harness** —— s1b 的一次合法改名把 `updated_at` 推進,
   害 s1a 的 touch 突變格轉紅。收尾要跑 **A → B → A 再一次**才證得了零污染。
3. **關卡2 兩輪 35 條,零條打在 DDL 上** —— 全部打在驗收判別力與文件同步。
   同款形狀今天出現第二次(A5b 是 37 條全打在 plan)。
   最丟臉的一條:我寫的「約束集合比對」只有一半(只擋多的、不擋少的),
   而 S1a 的 commit body **當天上午才自稱修掉同一個錯**。
4. **`indexrelid::regclass::text` 隨 search_path 變化**(實測:public 不在路徑時輸出帶 `public.` 前綴)
   ⇒ 拿它當結構閘的比較基準會在正式站誤擋。`pg_get_indexdef()` 實測與 search_path 無關,用它。
5. **`aclexplode` 不帶 `is_grantable` 等於漏一個洞** —— 實測 `GRANT SELECT … WITH GRANT OPTION`
   攤平後與普通 SELECT **字串完全相同**。
6. **codex 背景跑必加 `< /dev/null`**(hook 已擋);判活看**輸出有沒有長**,不是 `pgrep`。
   本次兩輪各 938s / 595s,都有 `tokens used` 完成標記。
7. **送審 = 凍結**。S1b session 違反過一次(codex 審查中改了受審檔的檔尾),已還原後才續。
   S2 這輪三次送審全程未動受審檔。

### S2 這片新增的坑(2026-08-01 晚)

8. **表級 ACL 攤平看不到欄級 GRANT** —— `pg_class.relacl` **只存表級授權**,欄級在
   `pg_attribute.attacl`。實測 `GRANT UPDATE (is_active) ON suppliers TO service_role` 之後,
   一條寫得很細的表級斷言(八權限 + `is_grantable` + PUBLIC 單查)**照樣全綠**,
   而 service_role 已經可以直接停用供應商、零稽核。
   ⇒ 「某表對某角色只該有 X 權限」這種守門**一定要兩條**。落檔 = memory
   `reference_pg-table-acl-flatten-blind-to-column-grants`。
   🔴 附帶教訓:`s1a-verify.sh` **本來就有**這條,但 S2 自己的 harness 沒抄過去 ——
   **兄弟 harness 有的斷言不會自動繼承**。
9. **靠參數 NULL 分流的 upsert RPC 會靜默降級** —— `p_supplier_id` 掉成 NULL 的改名回 `CREATED`、
   多一筆刪不掉的垃圾列、零錯誤。訊號在回傳碼裡,**但沒有人去看它就等於沒有**。
   落檔 = memory `feedback_null-dispatch-rpc-silently-downgrades`;🔴 **A5a 是同一個 upsert 形狀,
   開工時先決定要不要拆兩支**。
10. **兩條修法組合出第三個問題** —— 關卡2 要我「補 actor 長度/控制字元檢查」與「寫入前剝空白」,
    兩條各自都對,合起來變成「先驗**原值**、後剝空白」⇒ 同一支函式裡 label / note / actor
    **三種順序**,而 cookie 帶一個尾隨 CR 就整包拒收。R3 才抓到。
    ⇒ **逐條折 findings 之後要回頭看「這幾條改動彼此有沒有打架」**,不是折完就算。
11. **自我測試不能抄一份簡化版** —— `mutate_fn` 的三道自檢原本在 §0 有一份自己的複本,
    而複本的檢查順序與本尊不同 ⇒ 證明的是複本會發火。已抽成 `mut_block()` 唯一一份、
    §0 與 §C 共用,並重排順序讓三道**各自都有「只有它會發火」的形狀**。
12. **codex 的沙箱連不上 localhost DB** —— 這輪 codex 明說「TCP 與 Unix socket 均被唯讀沙箱拒絕,
    故未重跑 77/0」⇒ 它的 18 條全是 source-level 推論。**主對話必須逐條親驗**
    (本輪親驗結果:全部成立、駁回 0,但那是驗過才知道的)。Fable 那輪反而連得上、自己重跑了。

### S2-C 這片新增的坑(2026-08-01 深夜)

13. **「B 會不會卡住」量到的可能是別的鎖** —— 規格要求「拿掉 `FOR UPDATE` ⇒ B 不再被擋」,
    但 B 的 `UPDATE … WHERE id=X` 本身就會卡在 A 的列鎖上 ⇒ 照字面做出來那格**突變後不會轉紅**。
    要讓 `FOR UPDATE` 現形,得讓 B 走到**不需要 UPDATE 的那條路**(改回原值 ⇒ 判等 ⇒ `NO_CHANGE`)。
    ⇒ **併發守門的負測,要先問「拿掉它之後,還有沒有別的東西提供同樣的觀察」。**
14. **同一個根因的多個症狀不是多個證據** —— 情境① 的四條斷言(不卡 / `NO_CHANGE` / 零稽核列 /
    端狀態留 L1)全部由「B 讀到 stale 快照」單向推出。四條全紅只證明了**一件事**。
    要真的加證據面,得換情境(本片補的情境② 才是另一族症狀)。
15. **表面訊號全正常的那個變體,壞得比較兇** —— A 改名+停用、B 改第三個值時,
    突變前後**回傳碼與端狀態 label 完全相同**,只有稽核 `before` 與 `is_active` 會變。
    症狀 = **偽造的稽核歷史**(宣稱從 L0 改成 L2,而那一刻真值是 L1)+ **停用被靜默翻回啟用**。
    ⇒ **挑負測情境時,先找「壞了也看不出來」的那個,不是「壞了最明顯」的那個。**
16. **還原路徑靜默失敗 = harness 污染兄弟 harness 卻全綠** —— `q()` 對 boolean 回 `t`,
    拼進還原 SQL 變成 `is_active = t`(不存在的欄位)⇒ 整個還原交易中止,
    而我把 psql 輸出丟進 `/dev/null` ⇒ 沒有任何訊號。**還原是零留痕的承重點,不得靜默。**
17. **只掛 `trap … EXIT` 擋不住信號** —— 未被 trap 的 SIGTERM/SIGINT/SIGHUP 會讓 shell 直接死、
    **EXIT trap 根本不執行** ⇒ committed DDL 的突變視窗內被 kill 就把壞函式留在庫裡。
    而且第一版修完之後**中斷跑仍回報 exit 0**(trap 進來時 `$?` 是最後一句指令的狀態、不是信號)。
    修法 = `trap 'SIGNALLED=1; exit 130' INT TERM HUP` + `trap cleanup EXIT`,**且實測三種信號**。
18. **探針的 fail-closed 紀律要套到「每一個讀值」,不只讀計數** —— 我把計數探針做成
    「非純數字回 -1」,卻漏了格2b 那兩個**讀值互比**:`q()` 併 stderr ⇒ 連線層錯誤不含查詢字面
    ⇒ 兩邊拿到**完全相同**的錯誤字串 ⇒ 相等成立、沒讀到任何資料也全綠(R3 抓)。
    修法 = 兩邊各自對**字面值**斷言,不要互比。**「各修各的、合起來留縫」的典型。**
19. **只問「有沒有在等鎖」會被第三方代打** —— `pg_locks` 裡任何一把未授予的鎖都能讓那格變綠。
    用 `pg_blocking_pids()` 把「擋住 B 的**就是 A**」釘死(codex 抓)。
20. **codex 沙箱連不上 localhost DB,這次又一次成立** —— 它 8 條 must-fix 全是 source-level 推論,
    親驗後 **7 條成立、1 條錯**(它說「所有 psql 都沒加 `-X`」,實查 13 處全部都有)。
    ⇒ 同 §6-12:**主對話必須逐條親驗,連「聽起來很具體」的那種也要**。
    對照組:Fable 連得上、自己實跑了三組攻擊實驗,結論精準得多。

— END —
