# E10 第 2 批 · B2-S2a(小線):摘要表加 `shipped_quantity` 欄 + 三條 CHECK **v2(R1 25 must-fix + 4 nit 全折入)**

> 狀態:**R1 已折入,待 R2;不得開工**。
> 來由 = Sean 2026-08-06 拍板 **Q3=A**(v2 一份 plan 拆兩線)。
> R1 報告 = `docs/reviews/2026-08-06-b2-s2a-k1-codex-r1.md`(FAIL / 25 must-fix + 4 nit,逐條處置見 §0.5)。
> 姊妹檔 = **大線** `docs/specs/2026-08-06-e10-b2-s2b-recompute-wire-plan.md`。
> 前身 = `docs/specs/2026-08-06-e10-b2-s2-shipped-summary-plan.md` v2(**已作廢**)。
> 實跑證據 = `docs/reviews/2026-08-06-b2-s2-precheck-runs.md`。

---

## §0 定位

### 0.1 本線做什麼、不做什麼

| | 內容 |
|---|---|
| **做** | `order_item_quantity_summary` 加 `shipped_quantity` 欄 + C8 / C9 / C6′ + 全部受影響 COMMENT(含 **forward-override** 一處 live 矛盾字面)+ runbook forward 清單修正 + 驗收 harness |
| **做(plan 層)** | **quarantine 目錄機制設計**(Sean Q2=A)。🔴 **R1 #1:機制的實作 + 測試 + commit 是 S2a-1 的開工硬前置**,不是「另批再說」 |
| **不做(移交大線)** | helper 四軸化、`shipments` 重算 trigger、真值 backfill、break-glass oracle 四軸化、`a4a-verify` / `a1-verify` 修復、port 54329 |
| 🔴 **不做(Sean Q1=A;兩線都不含)** | `shipment_items` 那支重算 trigger —— 隨未來「開放改箱 / 放寬 X3」的片一起做 |

### 0.2 🔴 誠實邊界的正確措辭(R1 #24 修:v1 的字面大於事實)

~~小線上線後 `shipped_quantity` **恆** 0、C9 **恆真**、零效力~~

**正確**:小線上線後,**現有的應用 writer 路徑只會留下 0**(兩張出貨表對 `service_role` 只有 `SELECT`、
且重算鏈尚未接上)。⇒ 實務上會看到全 0。
🔴 **但 DB 並未強制它恆 0** —— owner / break-glass / 任何 SECURITY DEFINER 路徑寫入非 0 時,
**C8 / C9 / C6′ 當下就有效力**(CHECK 對被寫的值評估)。
⇒ 不得說「零效力」;正確說法是「**沒有 writer 會去觸發它,不是它擋不住**」。

### 0.3 前提事實(2026-08-06 親驗)

- **S1 三支已在正式站**(`supabase migration list` 帳本親查)。
- **正式站列數實查**:摘要表 = 0、`shipments` = 0、`shipment_items` = 0、
  `order_item_procurement` = 0、`order_items` = 42。
- **`provision` 吃整個 migrations 目錄**:文字錨 = `d1t2-rehearsal.sh` 的 `provision()` 內
  `for f in supabase/migrations/*.sql`,唯一硬編碼跳過 `20260723120000`。
  (R1 #27:改文字錨,不寫單行行號。)
- 🔴 **既有 live COMMENT 有一處自相矛盾**(R1 #10,見 §3.3-C)。
- 🔴 **runbook 的 forward-rebuild 清單沒有 S2a**(R1 #25,見 §3.6)。

### 0.5 R1 逐條處置(25 must-fix + 4 nit;**沒有一條被駁回**)

| R1 群 | # | 處置 | 落點 |
|---|---|---|---|
| A quarantine | 1 | ✅ 機制實作+測試+commit 升為 S2a-1 **開工硬前置** | §0.1 / §2 |
| | 2 | ✅ 型別 checkpoint **移出 promotion 前置**,改「從套了隔離區的拋棄庫生成並驗證」 | §3.5-E / §9 |
| | 3 | ✅ 改 **opt-in + 存在性斷言**,promotion 後依最終順序**重 provision 全套** | §3.5-B |
| | 4 | ✅ 誠實邊界重寫:漏的是**正常流程**的洞;D2 升級成**機械阻擋** | §3.5-C/D |
| | 5 | ✅ gate commit 規約重寫:pending 判準 = **manifest**,gate commit = move + manifest diff | §3.5-A |
| | 6 | ✅ **不改時間戳**;harness 靠 manifest/ID 定位,promotion 後重跑 | §3.5-A/B |
| B gate | 7 | ✅ G1 改 gate **有效已寄出包裹 JOIN 品項**,不用裸列數 | §3.4 |
| | 8 | ✅ 同一交易先**鎖寫入面**再跑 gate 與 ALTER | §3.4 |
| | 9 | ✅ G2 改 **lock probe + 等待交易檢查 + 可接受時長**,刪掉 10000 門檻 | §3.4 |
| C COMMENT | 10 | ✅ **forward-override** 那處 live 矛盾字面 + 納入 oracle | §3.3-C |
| | 11 | ✅ 「四條比較」實在 **`quantity` 欄** COMMENT | §3.3-A |
| | 12 | ✅ 拆兩類:**DB COMMENT** 走 catalog、**SQL 原始碼註解**走 `rg` 文字錨 | §3.3-B |
| | 13 | ✅ 第三份誠實邊界指定實體落點 | §3.7 |
| D 驗收 | 14 | ✅ 補 `shipped=0` 正測 | §4 項 7b |
| | 15 | ✅ fixture **五值全寫死互異** `q/o/i/c/s = 10/9/2/4/3` | §4 項 5 |
| | 16 | ✅ 靶⑧ 列舉 RHS mutants,各配能讓錯式放行的 fixture | §5 |
| | 17 | ✅ 項 4 改 **temp variant**:先加欄 → 造壞列 → 單獨跑約束段 | §4 項 4 |
| | 18 | ✅ **三個可重建狀態**(pre-S2a / post-S2a / fault) | §7 |
| | 19 | ✅ 指紋加 `col_description` 與各物件完整文字 | §4 項 12 |
| | 20 | ✅ 對應表重寫:逐靶「fresh state + 唯一 oracle + 唯一預期紅點」 | §5 |
| E 流程 | 21 | ✅ 收回「兩片各自可綠」;S2a-1 同片帶 quarantine-aware 基線 | §2 |
| | 22 | ✅ harness **拆三片** | §2 |
| | 23 | ✅ 鐵則 11 逐片列命令與預期數字 | §2.1 |
| | 24 | ✅ 誠實邊界改述 | §0.2 |
| | 25 | ✅ 同批更新 runbook forward 清單 + rehearsal | §3.6 |
| F nit | 26 | ✅ 統一改「代數蘊含」 | §1 |
| | 27 | ✅ 改文字錨 | §0.3 |
| | 28 | ✅ 刪掉重跑格的回滾推論 | §4 項 10 |

### 0.6 🛑 R2 FAIL 凍結公告(2026-08-06;**本檔不得用來開工**)

關卡1 **R2 = FAIL / 16 條 must-fix**(去重後),報告 `docs/reviews/2026-08-06-b2-s2a-k1-codex-r2.md`。
**兩輪用盡 ⇒ 停,不開 R3;R2 findings 刻意不折入**(方向題沒拍板前折了會白折)。

🔴 **v2 已知壞掉、不得照抄的四處(全是 v2 自己的修法引進的)**:

| 位置 | 病 |
|---|---|
| §3.4 的 `LOCK TABLE … IN SHARE MODE` | 與合法 writer **鎖序相反**(writer 先 `shipment_items` 再 `shipments`;本片先 `shipments` 再等 `shipment_items`)⇒ **真 `40P01` 死結面** |
| §3.4 的 `lock_timeout = '5s'` | 它限制「**我**等多久」,不限制「拿到鎖之後別人被擋多久」;且 code block **漏了 `statement_timeout`** |
| §3.7 的 `rg 'S2a apply 說明'` oracle | **該字串就寫在本 plan 自己身上** ⇒ `CURRENT.md` 沒更新也會綠,**恆綠、零判別力** |
| §2.1 的鐵則 11 DoD | 宣稱兩項全綠,§8 卻承認會 `command not found` ⇒ **把「必跑命令紅了仍繼續」寫進了 plan** |

另有一條**方向題**已升級成 Sean 的決策題:**plan 該不該寫「必須先做才量得到的數字」**
(鎖窗秒數 / harness 計數 / 實際估時)—— 詳 R2 報告末節與收工 STOP。

---

## §1 三條 CHECK 與蘊含

| # | 具名 | 定義 |
|---|---|---|
| **C8** | `oiqs_shipped_nonneg` | `shipped_quantity >= 0` |
| **C9** | `oiqs_shipped_le_instock` | `shipped_quantity <= instock_quantity` |
| **C6′** | `oiqs_cancelled_shipped_le_quantity` | `cancelled_quantity::bigint + shipped_quantity::bigint <= quantity::bigint` |

**`C9 ∧ C7 ⇒ C6′`** 是**代數蘊含**(非負整數上逐點成立)。
⇒ C6′ **不要求獨立負測**(要求了必然構造失敗,然後有人會去放寬 C9 讓它可構造)。
§4 項 8 的 `generate_series` 是**有限域 smoke**。
(R1 nit #26:全檔統一「代數蘊含」,不再出現「機器證明」。)

`::bigint` 沿用 A1 C7 的理由(文字錨 `**::bigint 不是裝飾**`)。**C9 單欄比較、不需要**。

---

## §2 片界(**四片**;R1 #22 拆 harness)

| 片 | 型 | 內容 | 估時 |
|---|---|---|---|
| **S2a-0** | 前置 | 🔴 **quarantine 機制實作 + 測試 + commit**(R1 #1:硬前置,不是「另批」) | 另批,不計入本線估時 |
| **S2a-1** | M | migration:加欄 + 三條 CHECK + 全部 COMMENT(含 forward-override)+ 檔內結構驗收 + **quarantine-aware 結構基線**(R1 #21) | 40 分 |
| **S2a-2** | 非 M | `b2s2a-verify.sh` **結構段**:項 1/2/3/9 + 環境 A 五靶 | 40 分 |
| **S2a-3** | 非 M | 同檔 **行為段**:項 4/5/6/7/7b + 環境 B 四靶(三個可重建狀態,§7) | 45 分 |
| **S2a-4** | 非 M | 同檔 **rollback / 故障注入段** + runbook forward 清單修正(§3.6)+ rehearsal | 40 分 |

🔴 **R1 #21 收回 v1 的「兩片各自可綠」**:實查沒有現有 harness 會因多一欄而紅;
更糟的是 `a1-verify.sh` 的 `drop_a1()` **先 DROP 摘要表再只重放舊 A1**
⇒ 它的 61/0 是在**沒有 `shipped_quantity` 欄**的表上量的。
⇒ **「沒有東西紅」不等於「綠」** ⇒ S2a-1 必須自帶可執行的結構基線。

### 2.1 鐵則 11 的片級 DoD(R1 #23;`package.json` 的 `test` 只跑 Vitest、不會跑 shell harness)

| 片 | commit 前必跑 | 預期 |
|---|---|---|
| S2a-1 | `pnpm typecheck` / `pnpm lint` / `pnpm build` | 各自全綠(本 worktree 根缺 `tsc`/`eslint`,尾段兩步改用 `node_modules/.pnpm/` 下實體跑,見 §8) |
| S2a-2/3/4 | 上述三項 + `bash -n scripts/b2s2a-verify.sh` + **實跑該 harness** | `bash -n` RC=0;harness 的 PASS/FAIL/MUT 三計數器**在 plan 內先凍結預期值**,實跑數字必須逐字相符 |

🔴 **任一紅即停,不繞道、不 disable/skip。**

---

## §3 設計

### 3.1 加欄與三條 CHECK

```sql
ALTER TABLE public.order_item_quantity_summary
  ADD COLUMN shipped_quantity integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT oiqs_shipped_nonneg     CHECK (shipped_quantity >= 0),
  ADD CONSTRAINT oiqs_shipped_le_instock CHECK (shipped_quantity <= instock_quantity),
  ADD CONSTRAINT oiqs_cancelled_shipped_le_quantity
    CHECK (cancelled_quantity::bigint + shipped_quantity::bigint <= quantity::bigint);
```

`NOT NULL DEFAULT 0` 在 PG11+ 不重寫表;三條 CHECK 各一次全表掃描;`ACCESS EXCLUSIVE` 持有到 COMMIT。

### 3.2 backfill:不寫,理由不是「0 列」

`shipped` 真值 = `shipment_items JOIN shipments`(過濾 `deleted_at IS NULL AND shipped_at IS NOT NULL`)。
`DEFAULT 0` 只有在**有效已寄出量為 0** 時才等於真值。
⇒ 真值填入由**大線的重算接線**承擔;本線不寫 backfill。
🔴 gate 見 §3.4(R1 #7 修:判準是「有效已寄出」,不是裸 `shipment_items` 列數)。

### 3.3 COMMENT:三類分開處理

#### A. DB COMMENT(走 catalog 驗)

| 物件 | 現況過期字面 | 要寫成 |
|---|---|---|
| **新欄** `shipped_quantity` | **不存在** | 來源 = `shipment_items JOIN shipments`;維護者 = A4a 四軸重算(**大線**);🔴 本線落地後現有 writer 路徑只會留下 0(**非 DB 強制**) |
| 表 COMMENT | 真相來源與「唯一 writer = A4a」因新欄變不完整 | 補第四軸來源 |
| **`quantity` 欄** COMMENT | 🔴 **「四條比較」在這裡**(R1 #11,不在表 COMMENT) | 五條比較 |
| 複合 FK COMMENT | 「三個數量」 | 四個數量 |
| C7 的 COMMENT | 契約債字面 | 見 §3.3-B |
| 🔴 **`shipment_items.shipped_quantity` 欄** | **自相矛盾**(§3.3-C) | forward-override |

#### B. SQL 原始碼註解(走 `rg` 文字錨驗,**不是** `obj_description`)

R1 #12:A1 的「契約債 ①」是 migration 檔裡的 `--` 註解,**catalog 查不到**。
⇒ 歷史 migration **不改**;由本片在自己的檔頭寫「A1 契約債清償聲明」,
驗收用 `rg` 對**本片檔案**的文字錨,不用 `obj_description`。

清償聲明必須逐字含:①加欄 ✅ ②納入 **C6′(C7 不動)** ✅ ③**刻意不做**
(Sean 08-05「無直送」⇒ `shipped ⊆ instock`,減了是重複扣)。
🔴 **不得只寫「已清償」而不寫第三項刻意不做。**

#### C. 🔴 forward-override 一處 live 矛盾字面(R1 #10)

`shipment_items.shipped_quantity` 的既有 COMMENT 逐字含:
「**強制點未定案** —— Sean 2026-08-05 **已拍 Q1=A** 走摘要表 CHECK(C9),由 S2 那片落地。」
—— 同一句自相矛盾,且**已 apply 到正式站**。

**處置**:歷史 migration 不改(它是已 apply 的紀錄);
**本片 migration 加一句 `COMMENT ON COLUMN public.shipment_items.shipped_quantity IS …` 覆寫**,
新字面 = 「本箱出貨數量。強制點 = 摘要表 CHECK `oiqs_shipped_le_instock`(C9,本片落地);
真值重算在大線 B2-S2b。」**納入 §4 項 9 的 oracle。**

🔴 **我的全樹 grep 為什麼漏掉它**:變體用了「尚未定案」,而這裡是「強制點未定案」**沒有「尚」字**。
⇒ **教訓:變體清單要含詞幹(`定案`)而非完整詞。** 寫進 §9 交棒。

### 3.4 apply gate(R1 #7 #8 #9 全部重寫)

🔴 **v1 的三個裸列數 gate 有兩個病**:G1 把必要條件寫成錯誤事實(草稿箱有品項但未寄出 ⇒ 真值仍 0,
卻被強迫走大線);G1/G3 是**快照**,通過後到 `ALTER` 取鎖前有 race。

**改成:同一交易內,先鎖寫入面,再跑真相 gate,再 ALTER。**

```
BEGIN;
SET LOCAL lock_timeout = '5s';
-- ① 鎖住兩張出貨表的寫入面(阻止 gate 與 ALTER 之間有人裝箱出貨)
LOCK TABLE public.shipments, public.shipment_items IN SHARE MODE;
-- ② 真相 gate:有效已寄出量必須為 0(不是裸列數)
--    SELECT count(*) FROM shipment_items si JOIN shipments s ON s.id = si.shipment_id
--     WHERE s.deleted_at IS NULL AND s.shipped_at IS NOT NULL   → 必須 = 0,否則 RAISE
-- ③ ALTER(§3.1)
COMMIT;
```

**鎖窗評估(R1 #9 修:刪掉沒有證據的 10000 門檻)**
- 不用列數當門檻。改**三件事**:
  1. **等待交易檢查**:`pg_stat_activity` 有無 `state='idle in transaction'` 且 `xact_start` 超過 N 秒者 ⇒ 有就停。
  2. **lock probe**:先在拋棄庫用同量級資料實測三條 CHECK 的掃描時長,取得**可接受時長上限**。
  3. `SET LOCAL lock_timeout = '5s'` ⇒ 搶不到鎖就整支失敗回滾,**不是無限等**。
- 🔴 **`LOCK TABLE … IN SHARE MODE` 會擋住寫入** ⇒ 本身就是一段可見的鎖窗,必須列進 apply 說明。

### 3.5 🔒 quarantine 目錄機制設計(Sean Q2=A;**實作是 S2a-1 的硬前置**)

#### A. 路徑、manifest 與 promotion(R1 #5 #6)

| 項 | 設計 |
|---|---|
| 隔離路徑 | `supabase/migrations-quarantine/` |
| **pending 判準** | 🔴 **由 `supabase/migrations-quarantine/manifest.txt` 定義**(一行一支),**不是「目錄非空」** —— 目錄裡的 README 之類不算 |
| 🔴 **不改時間戳** | R1 #6:harness 硬編 migration 路徑(`a1-verify.sh` 的 `MIG=`、`a4a-verify.sh` 同型)⇒ 改名會切斷連結。**檔名從進隔離區起就固定**,promotion 只 `git mv`、不改名 |
| 排序風險 | 不改名 ⇒ promotion 後若時間戳已非最大,`db push` 會拒亂序 ⇒ **這是 loud failure,可接受**;隔離期間**禁止**其他正式 migration 進目錄(見 D2) |
| gate commit | 內容 = **`git mv` + manifest 該行刪除**,兩者同一顆。commit message 列出被滿足的相依片 hash |

#### B. harness 怎麼看得到隔離區(R1 #3)

🔴 **v1 傾向「provision 預設連隔離區一起套」—— R1 打掉了**:
隔離區 A 按舊時間戳測成 `A→B`,期間正式站正常 push 了 B,promotion 後實際是 `B→A`
⇒ **綠證據不適用於正式順序**。

**改成 opt-in + 兩道保險**:
1. `PROVISION_INCLUDE_QUARANTINE=1` 顯式帶(預設**不**套)。
2. 隔離區的每一片**自帶存在性斷言**(harness 第一格就跑:「我這支已被套用」),忘了帶參數就紅。
3. 🔴 **promotion 之後,依最終順序重新 provision 全套並重跑該片的 harness** ——
   隔離期間的綠只是**過程證據**,promotion 後那次才是**結論證據**。

#### C. 誠實邊界重寫(R1 #4:v1 把最大的洞講輕了)

~~quarantine 擋不住 owner 直接 `psql -f`,只擋流程性失誤~~ ← **這個描述漏掉了正常流程的洞**

🔴 **真正的洞**:**不需要 owner 直跑 psql。** 隔離區非空期間,
**另一顆正式 migration 照樣可以 commit 並被 `supabase db push` 套用** ——
D1 只叫人「看一下隔離區」、D2(若只擋 commit)也不擋 apply
⇒ **正式站歷史與測試歷史分叉**,而隔離區那片的綠證據建立在錯誤的順序上。

#### D. 防呆(機制實作批的驗收條件)

| # | 防呆 | 級別 |
|---|---|---|
| D1 | apply 前置清單第一行 = 「manifest 是否為空」 | 人工,弱 |
| D2 | 🔴 **機械阻擋**:manifest 非空時,**禁止任何正式目錄的 migration 新增/promotion**(pre-commit)**且禁止 `db push`**(apply 腳本前置閘) | 機械,承重 |
| D3 | manifest 逐行記「在等哪些片」;gate commit 刪該行 | 機械(pending 判準本身) |
| D4 | gate commit message 列被滿足的相依片 hash | 稽核 |

🔴 **殘餘**:D2 的 `db push` 前置閘擋不住有人手動 `psql -f`。這條**才是**「只擋流程性失誤」的正確範圍。

#### E. 型別 checkpoint 不進 promotion 前置(R1 #2)

v1 讓 gate commit 等「型別已 commit」,而型別又只能 apply 後重生 ⇒ **循環,永遠動不了**。
**改**:promotion 前**只要求**「從**套了隔離區**的拋棄庫生成型別並驗證可編譯」;
**正式的 `database.types.ts` 重生留在 apply 之後**(§9 項 1)。

### 3.6 runbook forward-rebuild 清單(R1 #25)

`docs/runbooks/a4a-summary-rollback.md` 步驟 ⑥ 的 forward 重建逐字只列
「依序重放 **A1**(`20260730150000`)與 **A4a**(`20260803140000`)」—— **沒有 S2a**。

⇒ S2a 登了 ledger 之後跑那段:摘要表被 DROP、由 A1 重建成**五欄**,
而 `db push` **不會重跑已登記的 S2a** ⇒ **摘要表永久少一欄**,零告警。

**本線同批**:①forward 清單加 S2a ②rehearsal 驗「重建後 **六欄 / 十條 CHECK**」
③該步驟加一句「本清單每次有新片動到摘要表都必須更新」的契約債。

### 3.7 第三份誠實邊界的實體落點(R1 #13)

「apply 說明」不是抽象要求 ⇒ 指定落點 = **`docs/handoff/CURRENT.md` 的 apply 待辦區段**
(或主視窗指定的等價檔),文字錨 = `S2a apply 說明`,內容 = §0.2 的正確措辭 + §3.4 的鎖窗。
**promotion 前的 oracle**:`rg 'S2a apply 說明'` 必須命中。

---

## §4 驗收

| # | 條件 | oracle |
|---|---|---|
| 1 | 欄存在、型別 / NOT NULL / DEFAULT 逐字 | `pg_attribute` + `pg_attrdef` |
| 2 | 三條具名 CHECK 的 `pg_get_constraintdef` 逐字 | 字串全等 |
| 3 | **雙向**:摘要表 CHECK 具名集合**恰等** 10 條(A1 七 + 本線三) | 偷加第 11 條要紅 |
| 4 | 🔴 **既有列違反 C9 必紅**(R1 #17 修:正式 migration 同一個 `ALTER` 加欄+CHECK,照字面構造不出來)⇒ **temp variant**:先只加欄 → 造 `shipped=3/instock=2` → **單獨執行約束段** | 必 `23514` + conname;且 `cmp` 驗 variant 檔與正式檔確實不同 |
| 5 | **C9 只紅它負測**,**五值全寫死互異** `q/o/i/c/s = 10/9/2/4/3` | C4 `9≤10`✅ C5 `2≤9`✅ C7 `2+4≤10`✅ C6′ `4+3≤10`✅ ⇒ **只違反 C9**(`3>2`);SQLSTATE + **conname** |
| 6 | C9 邊界正測:`shipped = instock` 恰等放行 | 回查落庫值 |
| 7 | **C8 只紅它負測**:`q/o/i/c/s = 10/9/2/4/-1` | 只違反 C8 |
| 7b | 🔴 **C8 零值正測**(R1 #14:v1 只折了一半):`shipped=0` 寫入成功 | 回查落庫值 = 0 |
| 8 | C6′ 有限域 smoke:四重 `generate_series(0,6)` 計數 = 0 | 非 0 ⇒ §1 作廢。**非實作驗收** |
| 9 | §3.3-A 全部 DB COMMENT 新字面(**六個物件**,含 forward-override 的 `shipment_items.shipped_quantity`) | `obj_description` / **`col_description`** 逐字 |
| 9b | §3.3-B 的 SQL 原始碼註解(A1 契約債清償聲明三項,含「第三項刻意不做」) | `rg` 對**本片檔案**的文字錨 |
| 10 | 重跑本片必紅 | `42701 duplicate_column`。🔴 **只證明「拒絕重跑」,不證明原子回復**(R1 nit #28) |
| 11 | apply gate(§3.4):鎖 + 真相 JOIN gate 可跑 | 實跑輸出入帳;等待交易檢查與 lock probe 數字一併入帳 |
| 12 | 🔴 **故障注入**:具名 marker 人為 `RAISE` ⇒ 驗欄 / 三條 CHECK / **全部 COMMENT** 回復原狀 | 前後指紋含 `obj_description` **與 `col_description`**(R1 #19) |
| 13 | §3.6 runbook forward 清單含 S2a,且 rehearsal 驗六欄十 CHECK | rehearsal 實跑 |
| 14 | §3.7 apply 說明落點存在 | `rg 'S2a apply 說明'` 命中 |

---

## §5 突變靶(R1 #20 重寫:逐靶 fresh state + 唯一 oracle + 唯一預期紅點)

> v1 用「兩個大環境」代替隔離,被抓到項 4/10 沒有對應 mutant、靶①未證項 6、拿掉 C8/C9 會同時紅多格。
> ⇒ **每個靶自己一個 fresh state,只執行它那一格 oracle。**

| 靶 | fresh state | 動作 | **唯一**執行的 oracle | 唯一預期紅點 |
|---|---|---|---|---|
| ① | post-S2a | C9 `<=` → `<` | 項 2 | 定義字串不等 |
| ② | post-S2a | 拿掉 C9 | 項 3 | 集合少一條 |
| ③ | post-S2a | 拿掉 C8 | 項 3 | 集合少一條 |
| ④ | post-S2a | 欄 DEFAULT 0 → 1 | 項 1 | `pg_attrdef` 不等 |
| ⑤ | post-S2a | 任一 COMMENT 不寫 | 項 9 | 該物件字面不等 |
| ⑥ | post-S2a | 拿掉 C9 | 項 5 | 負測不再紅 |
| ⑦ | post-S2a | 拿掉 C8 | 項 7 | 負測不再紅 |
| ⑧a | post-S2a | C9 → `shipped <= quantity` | 項 5 | `3≤10` 放行 ⇒ 負測不紅 |
| ⑧b | post-S2a | C9 → `shipped <= ordered` | 項 5 | `3≤9` 放行 ⇒ 負測不紅 |
| ⑧c | post-S2a | C9 → `shipped <= cancelled` | 項 5 + **conname 比對** | 🔴 `3≤4` **放行** ⇒ 負測不紅(R1 #16:v1 的 `4/2/1/3` 在此靶會 `3>1` 仍紅同一個 conname ⇒ **假裝抓到**;五值 `10/9/2/4/3` 才分得開) |
| ⑨ | post-S2a | 故障注入 marker 挪到 COMMIT 之後 | 項 12 | 指紋不回復 |
| ⑩ | pre-S2a | temp variant 的約束段不執行 | 項 4 | 壞列沒被擋 |
| ⑪ | post-S2a | runbook forward 清單不加 S2a | 項 13 | rehearsal 重建後只有五欄 |

🔴 每個靶先驗「`sed` 真的改到東西」(`cmp`);**靶⑧ 三個變體缺一不可**。

---

## §6 Cut point 與回滾

- 單一 migration ⇒ 無片間 cut point;中途失敗由**項 12 故障注入實證**,不是論證。
- **回滾**:`DROP CONSTRAINT ×3` → `DROP COLUMN` → COMMENT 還原(含 forward-override 那句)。
- 🔴 **大線在位時不得單獨回滾小線**(R1 #「不得單獨回滾靠註解」):
  PG **不追蹤 PL/pgSQL 內的欄依賴** ⇒ 四軸 helper 在位時砍欄**不會被擋**,下一筆 A4a 才 `42703`。
  ⇒ **down migration 必須自己 fail-closed**:先查 helper 定義與 trigger 集合,
  偵測到四軸就 `RAISE` 拒跑;並配一格「大線在位時 down **必紅且零變更**」的負測。

---

## §7 harness:`scripts/b2s2a-verify.sh`(R1 #18:**三個可重建狀態**)

v1 只有單一 provision ⇒ provision 已套 S2a 之後跑項 4 / 項 12,重套先撞 `42701`,永遠到不了。

| 狀態 | 怎麼造 | 服務哪些格 |
|---|---|---|
| **pre-S2a** | provision 時 S2a 還在隔離區、不帶 opt-in | 項 4(temp variant)、靶⑩ |
| **post-S2a** | provision + 顯式套 S2a | 項 1/2/3/5/6/7/7b/9/9b、靶①-⑨ |
| **fault** | post-S2a 的庫上跑帶 marker 的 variant | 項 12、靶⑨ |

其餘:身分閘(抄 `a1-verify.sh` 的 workdir + cluster-id 三重把關)、全 `BEGIN…ROLLBACK`、
收尾零殘留(表結構 + 全部 COMMENT 指紋 = 開頭快照)。

🔴 **不得沿用 S1 harness 的假綠形狀**:逐條對照
`docs/reviews/2026-08-05-b2-s1-ablation-ledger.md` 的 #10 / #12 / #20 / #21 / #24。

---

## §8 誠實邊界

- §0.2 的措辭已按 R1 #24 改:**現有 writer 路徑只會留下 0,DB 未強制恆 0**。
- §3.4 的 gate 需要 `LOCK TABLE … IN SHARE MODE`,**本身就是可見鎖窗**,必須寫進 apply 說明。
- §3.5-C 的洞是**正常流程**的,不是只有 owner 越權;D2 的 `db push` 前置閘擋不住手動 `psql -f`。
- §3.5-B 的「promotion 後重 provision 全套」**沒有實測**,只有「provision 走 glob」是實測的。
- 本 worktree 根缺 `tsc` / `eslint` ⇒ `pnpm typecheck` / `pnpm lint` 會在尾段兩個非 turbo 步驟
  報 `command not found`;本輪改用 `node_modules/.pnpm/` 下的實體跑同一檢查,**兩者都 RC=0**。
  這是環境事實,**不是繞道**;S2a 施工時同樣會遇到。
- 本檔**已過 R1(FAIL/25+4,全折入),尚未過 R2**。

---

## §9 交棒

| # | 落在 | 內容 |
|---|---|---|
| 1 | 🔴 **Sean apply 之後**(不進 promotion 前置,R1 #2) | `database.types.ts` 重生 → nullable 校正 → `pnpm typecheck` |
| 2 | quarantine 機制實作批 | §3.5 A-E 全部,D2 是承重防呆 |
| 3 | 大線 | helper 四軸化、`shipments` 重算 trigger、真值 backfill、oracle 四軸化、harness 判別力修復、port 54329 |
| 4 | 未來「開放改箱 / 放寬 X3」的片 | `shipment_items` 重算 trigger + U/D 負測 + re-parent + 多列鎖序 |
| 5 | 🔴 **全樹字面對帳的方法論** | **變體清單要含詞幹**(`定案`)而非完整詞 —— 本輪就是因為只 grep「尚未定案」而漏掉「強制點未定案」(§3.3-C)。寫進 memory `feedback_claimed-sync-but-only-patched-touched-lines` |
| 6 | 任何動到摘要表的片 | runbook forward 清單要同步(§3.6 的契約債) |

---

## §10 送審指引

**R1** ✅ FAIL / 25 must-fix + 4 nit,**全折入**(§0.5)。**R2 待跑**,兩輪上限;R2 仍 FAIL ⇒ 停、整理決策題。

R2 重點應放在「**折入本身有沒有製造新問題**」:
1. §3.4 的 `LOCK TABLE … IN SHARE MODE` 會不會造成新的可用性問題?搶不到鎖時的處置對嗎?
2. §3.5-B 改 opt-in 之後,「忘記帶參數」的存在性斷言真的紅得起來嗎?
3. §5 拆成 11 個 fresh state,成本是不是已經超過 §2 的估時?
4. §3.3-C 的 forward-override:覆寫一個**已 apply 的** migration 寫下的 COMMENT,有沒有副作用?
5. §6 的 down fail-closed 自己會不會擋住合法的回滾?

—— v2 完 ——
