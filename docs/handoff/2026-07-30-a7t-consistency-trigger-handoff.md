# 交接:E10 第 1 批 A7-t「取消帳本主從一致 trigger」

> **狀態:code 收工 · 未 apply · 未 push。**
> 日期:2026-07-30 深夜 · Milestone M-4b · branch `dev`
> 片級 plan = `docs/specs/2026-07-30-e10-a7t-cancellation-consistency-trigger-plan.md`(**v2 縮減版**)
> 上一份交接 = `2026-07-30-a7-cancellations-handoff.md`(A7-1/A7-2)
> 施工權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`(A7-t 掛**第 24 列**、**不新增 DAG 列號**)

---

## 1. 一句話

在 `order_cancellations` / `order_cancellation_items` 兩張表上建 **4 支 trigger**,擋掉「有 header、零明細」的取消紀錄(Sean 2026-07-30 拍 Q1=A)+ 擋 `TRUNCATE`(拍 Q2=A、**不留逃生門**)。
**取消訂單仍按不下** —— 寫入端在 A8a1/A8a2、畫面在 A13a/A13b。

---

## 2. 🔴 接手第一件事:三個共用檔還沒寫回去

本片的 **STATUS.md / docs/handoff/CURRENT.md / docs/phase-1-backlog.md** 三處條目**刻意不在本片 commit 裡**。

**原因**:那三個檔在施工期間同時裝著**並行 session(型錄選車 UX)的未 commit 內容**。
我一度用整檔 `git add` 把他們的東西吞進 index(關卡2 codex R1 抓到),已全部撤出。

**接手動作(依序)**:
1. `git status` 確認型錄 UX 那條線是否已 commit
   —— 若那三個檔已乾淨(只剩 HEAD 內容),才進行下一步
2. 把下列三筆寫回,**與一筆 docs commit 同批**:
   - **STATUS.md**:②最後更新(本片摘要)/ ④下一步(A7-t 已收工 ⇒ 下一片 A7b 或 A1;**apply 待辦**)/ ⑤Sean 待決策(apply 是手動事)/ ⑦緊急 backlog 加 **#307**
   - **CURRENT.md**:本片交接段落 + 指向本檔
   - **phase-1-backlog.md**:新增 **#307**(內容見 §6)
     🔴 **#306 已被型錄 UX 那條線用掉**,本片是 **#307**;
     🔴 上次寫的時候**掉進 `​```markdown` 的「紀錄模板」程式碼區塊裡** ⇒ 這次務必確認它是真正的條目、不在任何 fence 內。

---

## 3. 產物(5 檔)

| 檔 | 是什麼 |
|---|---|
| `supabase/migrations/20260730140000_m4b_e10_a7t_cancellation_consistency_triggers.sql` | 2 函式 + **4 支 trigger** + 既有資料閘 + fail-closed 結構驗收 |
| `scripts/a7t-behavior-probe.sql` | **獨立檔、獨立交易**、**12 條案例**、逐案唯一 marker、整份 ROLLBACK + 交易外零殘留複驗 |
| `scripts/a7t-verify.sh` | 可重現 harness:結構突變 + 行為突變 + 探針自身突變 + 零突變對照 |
| `scripts/a7t-concurrency-probe.sh` | 併發**五情境**證據(A-D 隔離級 + **E TOCTOU 負測**);**自建自拆**、可觀察 barrier(不用固定 sleep)|
| `docs/specs/2026-07-30-e10-a7t-…-plan.md` | 片級 plan v2 |

### 四支 trigger

| 表 | trigger | 事件 |
|---|---|---|
| `order_cancellations` | `order_cancellations_items_presence_ac` | `AFTER INSERT OR UPDATE` · `DEFERRABLE INITIALLY DEFERRED` |
| `order_cancellation_items` | `order_cancellation_items_presence_ac` | `AFTER INSERT OR UPDATE OR DELETE` · 同上 |
| `order_cancellations` | `order_cancellations_block_truncate_bt` | `BEFORE TRUNCATE` · STATEMENT |
| `order_cancellation_items` | `order_cancellation_items_block_truncate_bt` | `BEFORE TRUNCATE` · STATEMENT |

**不變式恰一條**:每個存在的 `order_cancellations` 列,至少有一列 `order_cancellation_items` 指向它。
「取消量不超原始數量」**不屬本片** —— 由 A1 CHECK + A4a 重算 + A8a2 守門承接(`20260730130000:222-224` 逐字轉移,master plan 實查確認有人接)。

---

## 4. 怎麼重跑驗證(接手者請自己跑一次,不要只信本檔)

```bash
scripts/a7t-verify.sh all /tmp/a7tv
scripts/a7t-concurrency-probe.sh
scripts/a7-verify.sh all /tmp/a7v
```

預期尾行:`通過 27 / 失敗 0`、`通過 6 / 失敗 0`、`通過 37 / 失敗 0`(第三支 = A7-1 零回歸)。

🔴 **workdir 必須是短路徑**:PG Unix socket 上限 103 bytes,scratchpad 全路徑會讓 postmaster 啟動即死。
🔴 macOS 上跑 `pg_ctl` 少了 `LC_ALL=C` 會 `postmaster became multithreaded during startup`(本片踩過)。

---

## 5. 🔴 本片最重要的判斷:**砍範圍,而不是加防禦**

關卡1 codex 抓到一個併發漏洞,**實測為真**:header 有兩列明細、兩交易各刪一列時,
`REPEATABLE READ` 下兩邊都放行 ⇒ **零明細 header 真的落地**。

**但它提的修法「鎖 parent」被實測證偽 —— 仍然漏。** 鎖修得了「併發執行」,修不了「快照過期」。

四情境實測(`scripts/a7t-concurrency-probe.sh`):

| 隔離級 | 無鎖 | 鎖 parent |
|---|---|---|
| READ COMMITTED(PG 預設)、序列化 commit | **擋得住** | 更強 |
| REPEATABLE READ | **漏** | 🔴 **仍漏** |
| SERIALIZABLE | **PG 自己擋** | — |

⇒ 完整修法是**兩層**(鎖 parent + 隔離級 fail-closed 閘),不是一層。

**而本片決定不做**,因為觸發前提是「有人 DELETE/UPDATE 取消明細」,現行規劃內沒有那條路:
四張表零寫入 GRANT、production writer 路徑零命中、A8a1 寫 header / A8a2 寫 items / A9g 只讀、
資料模型是 append-only(多次部分取消 = 累積新 header)。退款側同型洞經獨立調查,結論相同。

🔴🔴 **但這個結論是「條件性」的,措辭必須精確**(關卡2 codex 兩條 must-fix,都成立):
- 「零寫入 GRANT」**不等於**「無人能刪改」—— table owner、superuser、
  以及 **A8a1/A8a2 那種 SECURITY DEFINER owner RPC 都不受表級 GRANT 限制**。
- 正確講法是「**目前沒有任何 application writer 實作**」,不是「物理上不可能」。
- ⇒ **A8a1/A8a2 只要寫下第一個 `UPDATE`/`DELETE`,漏洞當天可達。**

---

## 6. 合約債 → backlog **#307**(接手時要寫進 backlog)

> **日後任何片若要 DELETE 或 UPDATE `order_cancellation_items` 或 `order_refund_items` 的既有列,
> 必須先補上「trigger 內鎖 parent」+「隔離級 fail-closed 閘」;
> 否則取消側與退款側的主從一致防護都會靜默失效。**

- 依據 = `scripts/a7t-concurrency-probe.sh` 四情境實測(A/B 的「漏」是預期結果)
- 觸發條件:任何片要刪改既有明細列 / 任何片給四張表開出 INSERT 以外的寫入權 / 任何 writer 打算跑 `REPEATABLE READ`
- **已落點(本片 commit 內)**:migration 函式 COMMENT、master plan 的 **A8a2** 與 **A7b** 兩列、plan §2.2
- **待落點(接手時補)**:backlog #307

---

## 7. 🔴 審查鏈與「我自己犯的錯」

| 關 | 輪 | 審查者 | 結果 |
|---|---|---|---|
| 1 | R1 | codex `gpt-5.6-sol` xhigh | **NO-GO 19 must-fix + 2 nit** |
| 1 | R1' | Fable(換模型換角度) | **NO-GO 7 must-fix + 6 nit + 1 uncertain** |
| 2 | R1 | codex 同上 | **FAIL 20 must-fix + 2 uncertain + 1 nit** |
| 2 | R2 | codex 同上 | **FAIL 16 must-fix + 1 uncertain + 2 nit** → 全數折入、駁回 0 |

🔴 **關卡1 兩個模型抓到的大半不重疊**(重疊僅 5 條)⇒ 並行雙模型審 plan 是有回報的。
🔴 **關卡1 的結果不是「修 26 條」,是「plan v1 → v2 縮小範圍重寫」。**

### 施工中被自己的 harness 抓到、以及被 codex 抓到的錯(全部已修)

1. **探針 7 測錯對象** —— 用了 `'other'` 卻沒給 `reason_detail`,被 A7-1 既有 CHECK 先擋。
2. **後續每條行為突變都紅在探針 7** = **判別力歸零而 FAIL 數仍 0**。這正是 codex 對 harness 接線提的 must-fix,我在自己的突變段原樣重現。⇒ 突變判定改為「**必須紅在指定案例**」。
3. **「只留一支 trigger」的突變其實紅在 `SET CONSTRAINTS` 找不到名字** ⇒ 改成保留名字換綁 no-op。
4. **案例 12 原本不存在** —— 其他案例開頭都顯式設 DEFERRED,把 trigger 的**宣告預設值**整個蓋掉 ⇒ `INITIALLY IMMEDIATE` 突變**所有案例照樣全綠**,而 A8a1 上線後靠的正是那個預設值。
5. **5b 守門守錯東西** —— 我 sed 一次刪掉**所有**案例的復位,實際紅在探針 3,而註解與給 Sean 的報告都宣稱它守案例 11。⇒ 改成只突變案例 11 那一行 + 斷言替換數恰為 1。
6. **我把並行 session 的未 commit 內容吞進 index**(STATUS + backlog)。諷刺的是我前一則才剛跟 Sean 說「不把 CURRENT.md 放進 commit 免得吞掉他們的東西」。
7. **R2 又抓到我「宣稱修了但沒修對」** —— master plan 的合約債仍在表格外(R1 第 6 條),而我上一輪已經回報「已修」。⇒ 教訓:**改完必須用機器驗**(現在用 `awk` 逐列檢查表格未斷)。
8. **R2 抓到我把「待補」寫成「已落」** —— 撤出三個共用檔之後,plan 與 migration 註解仍寫著「合約債已同步落 backlog #307 / STATUS / CURRENT」。**那是字面 vs 事實**,已改成「尚未寫入 + 承接動作」。
9. **我改了已 apply 的 `20260730130000` 的註解** —— 與我自己 plan §4.5 的主張矛盾,且會造成靜默稽核分叉(Supabase CLI 只比版本號、不比內容)⇒ 已 `git checkout` 完全還原。

---

## 8. 🔴 A7-1 的「trigger = 0」斷言**不改**(前一份交接檔的指示是錯的)

`2026-07-30-a7-cancellations-handoff.md` 原本寫「A7-t 落地後 A7-1 那條斷言會當場紅、必須同片改掉」。
**兩個審查模型各自獨立確認那是錯的**,而且已用**實測**背書:

- migration 依版本序執行,A7-1(`…130000`)必然早於 A7-t(`…140000`)⇒ 執行當下 trigger 確實是 0
- `scripts/a7-verify.sh:59` 先 `DROP TABLE` 兩表再重套 A7-1 ⇒ trigger 隨表滅
- Fable 另外獵殺第三條路徑:A7-1 已在 production ledger ⇒ `db push` 不重跑;`.github/workflows/` 三檔無 migration 步驟
- ✅ **實測:A7-t 落地後 `scripts/a7-verify.sh all` 仍 37 / 0**

⇒ 它是**該時點**的斷言、不是**永遠**的斷言。前一份交接檔的兩處與 A7 片級 plan 均已加 supersession 註記。

---

## 9. 未做 / 待辦

- 🔴 **apply 未執行(刻意)** —— 決定理由:①R2 未定案前 apply,萬一有 must-fix 就得改一支已上線的 migration(= 本片才被抓過的坑)②**零急迫**:兩表零寫入 GRANT,沒有生產路徑會觸發這四支 trigger,真正需要它是 **A8a1 上線那刻** ③apply 實質單向,回滾要另寫 forward migration ④並行 session 正在提交,錯開 `db push` 避免 ledger 漂移。
  ⇒ **承接時點:下一個 session 或 A8a1 開工前**。指令 = `supabase db push`(需先移開 `.env.local`,見 memory `reference_supabase-cli-reads-env-local-blocker`)。
- 🔴 **三個共用檔未寫回**(見 §2)
- 🔴 **未 push**
- `docs/runbooks/2026-07-30-a7-rollback.md` 仍未撰寫 —— 承接時點 = A8a1 開工前置
- **rollback migration 若日後要寫**:plan §8 已定死必須自帶 preflight(斷言 `admin_cancel_order` 尚未存在 + 兩表零列),否則在 writer 上線後回滾等於重開「零明細 header」那條路

---

## 10. 誠實邊界(不放寬)

- 本機 **PG 17.10 非 Supabase**;`auth.uid()` 是 shim;**C locale ≠ 正式站 `en_US.UTF-8`**(#305)。
  本片 trigger 是 `count(*)` 與 uuid 比對、零字元類零 collation 依賴 ⇒ #305 對本片可轉移(逐項檢查後的斷言,非通則)。
- harness 證明「trigger 邏輯與觸發時機正確」,**不證明** Supabase ledger 原子性、真實併發、正式站鎖競爭。
- 併發 harness 用的是**等價最小重現**(int 主鍵兩表),不是 A7 真表 —— 證的是 PostgreSQL 隔離級語意。
- **本片對併發的立場是「不防」而非「已防」**(§5)。
- **零 TapPay 接觸面** —— 產出全為 SQL 與驗證腳本,不碰 `packages/adapters`、不呼叫任何外部 API。
  (Sean 2026-07-30 交代「TapPay 官方文件不要擅自猜測」已記為**常設規則**,承接點 = 退款線 A8b / RF2b 開工時親讀官方文件。)

---

## 11. 並行 session 注意

本 session 期間另有一條線在同 repo 工作(型錄選車 UX:`CascadeFilterTop` / `FilterDrawer` / `FilterSide` /
`ProductsPage` / `MobileVehicleSheet` / `ProductsMobileControls` / `docs/superpowers/` / `docs/decisions/0007-*` 等十餘檔)。
**其程式檔全程未觸碰。** 三個共用檔(STATUS / CURRENT / backlog)一度被我吞進 index、已全部撤出(§2)。

— END —
