# B2-S2b 大線 apply 停點包(2026-08-07)

> **這份文件的用途**:Sean 說「排」的那一刻,**一次照做完**的完整序列。
> **狀態**:唯讀預備 —— 本文件產出時**未 push、未併 dev、未 apply**。
> **產出方式**:所有字面(hash / 檔名 / 數字 / 指令)皆由當下 `git` 與實跑取得,**未引用記憶**;
> 每一節都標了取得方式,複核者可原樣重跑。
>
> 對應派工 = 主視窗 `B-164-A` ①。

---

## §0 🔴🔴 先讀:兩件在寫這份文件時**才發現**的事

這兩件都不是原本 plan 裡的,是為了寫 apply 序去比對 `origin/dev` 時量出來的。

### 0.1 我們的分支**落後 dev 三支 migration**,而且時間戳序是倒掛的

取得方式:
```bash
cd /Users/sean_1/pcm-a4a-chain
comm -23 <(git ls-tree -r --name-only HEAD supabase/migrations/ | sort) \
         <(git ls-tree -r --name-only origin/dev supabase/migrations/ | sort)   # 只在我們這邊
comm -13 <(git ls-tree -r --name-only HEAD supabase/migrations/ | sort) \
         <(git ls-tree -r --name-only origin/dev supabase/migrations/ | sort)   # 只在 dev 那邊
```

| 只在**我們**分支(本線新增) | 只在 **origin/dev**(我們缺) |
|---|---|
| `20260806100000_m4b_e10_b2_s2a_summary_shipped_quantity.sql` | `20260806200000_m4b_e10_a9h_m_a5a_preserve_optional_fields.sql` |
| `20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql` | `20260807120000_m4b_e10_a9v_nine_code_writer_revoke.sql` |
| | `20260807130000_m4b_e10_a9b2_m_supplier_order_no_upper.sql` |

🔴 **合併後照檔名排序,我們兩支排在 dev 三支<u>之前</u>**:
```
… 20260805170200 (S1b) → 20260806100000 (S2a) → 20260806180000 (S2b)
  → 20260806200000 (a9h_m) → 20260807120000 (a9v) → 20260807130000 (a9b2_m)
```
⇒ **若 dev 那三支已經套進正式站,而我們兩支在其後才套,實際套用序 ≠ 檔名序。**
**這件事我查不到答案**(我沒有正式站的可見度,也不該去查)⇒ **列為 apply 前必須由 Sean / 主視窗確認的一條**,見 §3 P0。

### 0.2 **合併之後 `b2s2b-verify.sh` 會直接 `die`** —— 而且那是設計好的

`scripts/b2s2b-verify.sh` 的 **`NEWEST_TS`** 閘(grep 這個字找得到;**本文一律不寫行號** ——
行號會漂,本線在 S2b-5 就因為寫錯行號吃過一條 must-fix)把時間序尾端**硬釘**成本片:
```bash
NEWEST_TS="$(ls supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1)"
[ "$NEWEST_TS" = "20260806180000" ] || die "…"
```
合併 dev 之後尾端會變成 `20260807130000` ⇒ **這道閘會 die**。
🔴 它的 die 訊息自己就寫了處置,逐字:
> 「本檔的『post-S2b 基準庫』與『pre-S2b 前綴』兩個定義都已經漂了。
> 處置 = 決定基準要不要含那些新片,並同批更新本行與 `MD5_HELPER_4AXIS`,**不是把這道閘拿掉**。」

⇒ **merge 之後、跑任何 harness 之前,必須先做這個決定**,見 §3 P1。

### 0.3 🟢 已查證**無功能衝突**(不要因為 0.1/0.2 就以為兩邊打架)

`20260806200000_a9h_m` 有 4 行提到本線的面,逐行看過**全部是它自己的驗收斷言**,不是寫入:
```bash
git show origin/dev:supabase/migrations/20260806200000_m4b_e10_a9h_m_a5a_preserve_optional_fields.sql \
  | grep -nE "order_item_quantity_summary|shipped_quantity|pcm_a4a|shipments"
```
- 它 `DROP` / `CREATE` 的是 **`public.admin_upsert_item_procurement`**(A5a 的 RPC),**不碰**本線任何物件。
- 它那條「A4a 重算 trigger 應恰 1 支」的斷言**完全限定**在下列條件(read-back 補:另有
  `tgenabled='O'` 與 `NOT tgisinternal`,共**五**條;結論不變)
  `tgname='order_item_procurement_summary_recompute_zc'` **且** `tgrelid='public.order_item_procurement'`
  **且** `tgfoid='public.pcm_a4a_procurement_summary_recompute()'`
  ⇒ 本線新增的 `shipments_summary_recompute_ac`(掛在 `shipments`)**不會**被它數到。**兩邊不衝突。**
- 另兩支(`a9v` / `a9b2_m`)對本線的面 **0 命中**(同一條 grep)。

---

## §1 要併的 24 顆 commit

取得方式:`git log --oneline origin/dev..HEAD`(在 `/Users/sean_1/pcm-a4a-chain`)。
順序 = 新→舊;**併的時候是整條 24 顆一起**,不逐顆挑。

| # | hash | 一句話 |
|---|---|---|
| 24 | `25031f87` | S2b-F:三支 S1 harness 的 fixture 對齊 C9(30 條紅歸零、零斷言被動) |
| 23 | `8cc30055` | S2b-5:項30 註解蓋寫守門(兩組凍結指紋 + 三邊同源 + 負測ⓐⓑⓒ) |
| 22 | `f420849a` | S2b-4c:三支 S1 harness 回歸格 + 實錘本線讓它們 30 條轉紅 |
| 21 | `f70ff20e` | S2b-4b:a1-verify 專屬埠 + 跑完即 teardown、a4a-verify 分埠、埠分配做成守門 |
| 20 | `18d35294` | S2b-2b 之三:項29 stale-high 三格 + 覆蓋帳機制化 |
| 19 | `8dac852e` | B-159-A 裁定落檔:項19 維持第三態 + 併發驗證移交 writer RPC 片 |
| 18 | `9f48bf99` | S2b-2b 之二:項19 barrier(三 session 真併發;標 `inconclusive`) |
| 17 | `55afe530` | S2b-2b 之一:環境A 結構突變矩陣(外部 oracle 十維 + 八發靶) |
| 16 | `482ce423` | S2b-3b 第三段:PR4 造洞實證 + 出貨資料面集合斷言 |
| 15 | `94e78e92` | S2b-3b 第二段:依賴清單五/六 + DROP 序 + 債④ rehearsal 守門 |
| 14 | `5ca71ba6` | S2b-3b 第一段:出貨側停寫/回權 + divergence 第四軸驗收 |
| 13 | `b3340ac9` | S2b-3a 後段:真相式六塊同步守門 + 九發突變 |
| 12 | `ff366bff` | S2b-3a 前段:真相式四軸化 + 六塊標記註解 |
| 11 | `3f8dce0e` | S2b-2b 第一段:行為突變矩陣(六發靶 + 消融重證轉觀察) |
| 10 | `14daef09` | S2b-2a:建 `b2s2b-verify` 行為 harness |
| 9 | `4ef591b2` | **S2b-1:`shipped` 第四軸接線**(helper 四軸化 + shipments 重算 trigger + 真值 backfill) |
| 8 | `0da7ecfc` | S2b-4a R2 確認輪 PASS |
| 7 | `f1b968c3` | S2b-4a:a4a-verify 判別力修復 |
| 6 | `e906a548` | S2b/S2a plan 狀態字面回填 |
| 5 | `4adc7629` | B2-S2b 大線 plan v2 |
| 4 | `cdf7e89f` | B2-S2a-4:回滾/故障注入段 |
| 3 | `26e4963e` | B2-S2a-3:harness 行為段 |
| 2 | `931ef99a` | B2-S2a-2:harness 結構段 |
| 1 | `665934ec` | **B2-S2a-1:摘要表加 `shipped_quantity` 欄 + C8/C9/C6′ + 七物件 COMMENT** |

🔴 **產生或修改 migration 的是<u>三</u>顆**(第一版寫「只有 #1 與 #9」是錯的,read-back 抓到):
**#1 `665934ec`**(建 S2a 那支)、**#9 `4ef591b2`**(建 S2b 那支)、
**#12 `ff366bff`**(**修改** S2b 那支:四軸化真相式 + `SHIPPED-TRUTH-BEGIN/END` 標記)。
其餘 21 顆是 harness / plan / docs。

---

## §2 merge 指令

🔴 **push 與 merge 都是 Sean 的動作**,本節只是把指令寫好讓他一鍵複製。**我不執行。**

```bash
cd /Users/sean_1/pcm-website-v2 && git fetch origin && git status
```
```bash
cd /Users/sean_1/pcm-a4a-chain && git fetch origin && git merge origin/dev
```
> 🔴 **先把 dev 併進來、在 worktree 解決衝突並重跑 harness**,再推分支 —— 不要反過來。
> 理由 = §0.2:併進來之後 `NEWEST_TS` 閘會 die,那個決定要在**受控的 worktree 裡**做完。

併完、§3 全綠之後才:
```bash
cd /Users/sean_1/pcm-a4a-chain && git push origin a4a-chain
```

---

## §3 apply 前 preflight(逐條可執行)

> 每條都有「指令 / 預期輸出 / 紅了怎麼辦」。**任一條紅 ⇒ 停,不 apply。**

### P0 🔴 先確認:dev 那三支 migration 在正式站的狀態

**為什麼是第一條**:§0.1 的時間戳倒掛只有在「dev 三支已套、我們兩支未套」時才是問題。

- **要確認什麼**:正式站的 migration ledger 裡,`20260806200000` / `20260807120000` / `20260807130000` 是否已套。
- **誰做**:Sean 或主視窗(我沒有正式站可見度,也不該去查)。
- **紅了怎麼辦**(= 三支已套):**停下來討論**,不要直接套我們兩支。
  兩條路:①接受亂序並逐條論證無依賴(§0.3 已證 `a9h_m` 與本線無功能衝突,但**只證了那一支**)
  ②把我們兩支的時間戳往後改(**會改 migration 檔名 ⇒ 本線所有凍結的路徑字面同批更新**,成本高)。
  🔴 **這一題不屬執行者可拍的板。**

### P1 🔴 merge 之後:處理 `NEWEST_TS` 與 `MD5_HELPER_4AXIS`

```bash
cd /Users/sean_1/pcm-a4a-chain && ls supabase/migrations/*.sql | sed 's|.*/||; s|_.*||' | sort | tail -1
```
- **預期**:併 dev 之後會印 `20260807130000`(不再是 `20260806180000`)。
- **要做的決定**:「post-S2b 基準庫」要不要含 dev 那三支?
  - 含 ⇒ 把 `scripts/b2s2b-verify.sh` 裡 `NEWEST_TS` 那一行的釘值改成新的尾端,並**同批**重新量 `MD5_HELPER_4AXIS`
    (量法寫在該檔該常數的註解裡:對已套完全前綴的庫跑
    `SELECT md5(pg_get_functiondef('public.pcm_a4a_recompute_order_item_summary(uuid)'::regprocedure))`)。
  - 不含 ⇒ 需要一個「只重放到 `20260806180000`」的 provision 模式,**本線沒有做這件事**。
- 🔴 **不得把這道閘拿掉**(它的 die 訊息逐字這樣寫)。

### P2 S2a 的 apply 前置閘(既有,唯讀)

🔴🔴 **正式站一定要走這個形狀 —— 零參數**(read-back 抓到我第一版寫成帶連線字串,
那會**把憑證寫進 argv 與 shell history**;腳本自己的註解逐字說「**憑證一律不進 argv**」):
```bash
cd /Users/sean_1/pcm-a4a-chain && PGHOST=… PGPORT=… PGDATABASE=… PGUSER=… scripts/b2s2a-verify.sh gate
```
- 密碼走 **`~/.pgpass`**(權限 600)—— 不進 argv、不進 history。
- **帶連線字串那個形狀只准用在本機無密碼的拋棄庫**,腳本會自己擋並印出理由。
- 用法出處:`scripts/b2s2a-verify.sh` 檔頭「用法(正式站)」那段 + gate 模式的參數閘(grep `pgpass`)。
- **預期**:全綠、離開碼 0。
- **紅了怎麼辦**:**停到主視窗回覆為止、不設時限**(本線一路遵守的紀律)。

### P3 三支 S1 harness 在全前綴庫全綠 ✅(本次已成立)

```bash
cd /Users/sean_1/pcm-a4a-chain && PORT=<未占用埠> scripts/d1t2-rehearsal.sh provision /tmp/s1v \
  && U="postgresql://postgres@127.0.0.1:<同一埠>/postgres" \
  && scripts/b2s1a1-verify.sh "$U" && scripts/b2s1a2-verify.sh "$U" && scripts/b2s1b-verify.sh "$U"
```
- **預期(2026-08-07 實跑,連跑兩輪一致)**:
  `b2s1a1` **PASS=60 / FAIL=0**、`b2s1a2` **PASS=46 / FAIL=0**、`b2s1b` **PASS=64 / FAIL=0**。
- 🔴 **埠不得用**(逐字取自 `scripts/b2s2b-verify.sh` 用法區的黑名單):
  `54329 / 54331 / 54342 / 54351 / 54353 / 54355 / 54357 / 54359 / 54361(a1-verify)/ 54363(a4a-verify)`。
  另 **`54365`** 是 `b2s2b-verify.sh` 的建議用埠(不在那份黑名單裡,但**同時跑 P3 與 P4 會撞**)。
- **紅在 `23503 / order_item_quantity_summary_item_fk`**:多半是庫裡留了一列**四軸皆 0**的摘要
  (`b2s1b` 的前提斷言會先指路)⇒ 刪掉那列再跑:
  🔴🔴 **下面這句 DML <u>只准</u>在本機拋棄式庫上跑,絕不可對正式站執行**
  (它是全文唯一一條 DML;read-back 指出第一版沒有這條限定字):
  ```sql
  DELETE FROM public.order_item_quantity_summary
   WHERE ordered_quantity=0 AND instock_quantity=0 AND cancelled_quantity=0 AND shipped_quantity=0;
  ```
- **紅在 `23514 / oiqs_shipped_le_instock`**:代表 fixture 的到貨補課掉了 ⇒ 回頭看 commit `25031f87`。
- 🔴 **merge 之後這三個數字也會變**:`d1t2-rehearsal.sh` 的 provision 是 `for f in supabase/migrations/*.sql`
  **無上界** ⇒ 併進 dev 三支之後基準庫就不是同一個。**先做完 P1 再跑 P3**(與 P4 同一個理由;
  第一版只在 P4 寫了這條警語,P3 漏了)。

### P4 本線自己的 harness

```bash
cd /Users/sean_1/pcm-a4a-chain && PORT=54365 scripts/b2s2b-verify.sh all /tmp/b2s2bv
echo "rc=$?"
python3 scripts/b2s2b-truth-sync.py .
```
- **預期(2026-08-07 實跑)**:`PASS=78 FAIL=0 INCONCLUSIVE=1`、`CELL=25`、**離開碼 3**;truth-sync rc=0。
  (腳本實印的那一行帶尾綴 `(CELL=$CELL / 期望 25、總格 78)` ⇒ 上面是**摘要不是逐字輸出**。
  三個值各自有凍結常數佐證:`EXPECT_TOTAL=78` / `EXPECT_CELL=25` / `EXPECT_INCONC=1`。)
- 🔴 **離開碼 3 不是失敗** —— 三態是 `0=全過 / 1=有紅 / 3=無紅但有待裁`。
  待裁的**不是整個項19**,而是它四發靶裡的**一發**:`BMUT-L2A-INCONCLUSIVE`
  (plan 指定的「拿掉 `ORDER BY`」實測**不翻面**)。另三發 `BMUT-0 / L1 / L2b` 照常入 PASS 帳。
  主視窗 `B-159-A` 裁 Q1=C 維持第三態,終局判定綁本 preflight。
  (腳本自身也有「整格標 inconclusive」的措辭 ⇒ 兩處措辭本來就不一致,這裡採**機器可讀**的那個。)
- **merge 之後這一步會先撞 P1**(`NEWEST_TS`),先做完 P1 再跑。

### P5 🔴 誠實申報(不是檢查,是必須讓 Sean 知道的三條)

1. **併發證據 = deferred**。項19 barrier 整格標 `inconclusive`:出貨 writer RPC 今天不存在
   ⇒ 兩個 session 的 `UPDATE shipments` 是 **owner 直寫**。
   真併發證據 + **§9 交棒 10**(批次多列 UPDATE 的逐列發火鎖序面)**同在「出貨 writer RPC 片」一起證**
   (主視窗 `B-159-A` 裁定,不拆)。
2. **backfill 只在候選集為空時跑過** —— 非空候選的真值 backfill **未被觀察**。
3. **本機 PG17 非 Supabase**:所有 harness 跑在拋棄式 PG17,`auth.uid()` 是 shim、locale 是 C
   ⇒ 證的是「這個終態通得過所有約束」,**不等於**正式站行為。

### P6 codex 背書補跑(牆解除後)

🔴 **這一節第一版寫錯了三件事**(fresh read-back 逐顆查 commit body 抓到),更正如下:

- **不是「每一片」** —— 24 顆裡**恰 15 顆**寫了「codex 背書待補」,9 顆沒有
  (核法:`for h in $(git log --format=%h origin/dev..HEAD); do git log -1 --format=%B $h | grep -c 背書待補; done`)。
- 🔴 **`665934ec` 不是待補,它的正牌背書<u>已經完成</u>** —— body 逐字:
  「`codex 關卡2 R1 FAIL 18 must-fix → 全折入`」「`codex 關卡2 R2 FAIL 7 must-fix + 1 nit → 全折入`」。
  我第一版把它列成「必補」= **把已完成的事寫成待辦**。同族 `931ef99a` / `26e4963e` / `cdf7e89f` 亦皆已跑過。
- 🔴 **真正漏掉的必補是 `ff366bff`** —— 它**也改了 migration**
  (`20260806180000_…_s2b_shipped_recompute_wire.sql`,**+9 / −6**;真相式四軸化 + `SHIPPED-TRUTH-BEGIN/END` 標記),
  而它的 body 逐字寫「**本 diff 動到 migration 檔 ⇒ R2 獨立裁定「算鐵則 12③」**」+「**codex 正牌背書待補**」。
  ⇒ 連帶更正 §1 的「只有 #1 與 #9 產生 migration」與 §4 表的「出自 commit」,見那兩處。
- **牆的字面**:commit body 逐字記的是「**額度牆至 2026-09-05 18:33**」。
  我第一版寫了一段「實跑逐字」的英文訊息,**全 repo 查無該字串** ⇒ 那是我憑印象寫的,已刪。

```bash
cd /Users/sean_1/pcm-a4a-chain && codex exec -m gpt-5.5 -s read-only "<審查指令>" < /dev/null
```
- 🔴 `-m` 必顯式帶、`-s read-only`、背景跑必加 `< /dev/null`、cwd 必 repo 根;
  跑前後 `git status --porcelain` 比對零留痕。
- **必補範圍(動到 migration 的兩顆)**:**`4ef591b2`**(S2b-1 接線)與 **`ff366bff`**(四軸化 + 標記)。
  `665934ec`(S2a-1)**不在**待補之列 —— 它已經跑過正牌 codex 兩輪。
  其餘 harness/docs 顆是否要補,由主視窗判。

---

## §4 apply 序

🔴 **apply 是 Sean 的手動停點。本文件不含任何會執行 apply 的指令。**

正式站要套的**只有兩支**(其餘 22 顆 commit 不產生 migration):

| 序 | 檔案 | 內容 | 出自 commit |
|---|---|---|---|
| 1 | `supabase/migrations/20260806100000_m4b_e10_b2_s2a_summary_shipped_quantity.sql` | 摘要表加 `shipped_quantity` 欄 + C8 / C9 / C6′ + 七物件 COMMENT 覆寫 | `665934ec` |
| 2 | `supabase/migrations/20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql` | helper 四軸化 + `shipments_summary_recompute_ac` + 真值 backfill + 註解改寫 | `4ef591b2` **+ `ff366bff`**(後者改了真相式與標記)|

- **序不可倒**:S2b 的檔內有片序的**物理**保證(grep `片序不可倒` 找得到,逐字:
  「片序不可倒的**物理**保證。三段任一不符即 RAISE、整檔回滾。」)⇒ 倒著套會當場 RAISE。
- **與 dev 三支的相對序**:見 §0.1 + P0。

---

## §5 rollback

- **災難當天的完整流程** = `docs/runbooks/a4a-summary-rollback.md`
  (本線在 S2b-3b 已把它四軸化:步驟①(1b) 停用 `shipments_summary_recompute_ac`、步驟⑦ 對稱 ENABLE、
  步驟③ 的枚舉改成**五 trigger / 六函式**、步驟④ 的 DROP 序把出貨側排在前面)。
- 🔴 **步驟⑦ 的前置**逐字列著一格:「**S2b(`20260806180000`)已重放**(實查 helper 是**四軸**、
  `shipments_summary_recompute_ac` 在)」。**危險在哪要照原文讀,別憑印象**(我第一版就把它寫反了):
  - **漏重放 S2b** ⇒ trigger 不存在、helper 停在三軸 ⇒ 跑 ENABLE 會**直接紅在 `42704`**
    —— runbook 逐字說「**那是好事,它擋住你**」。
  - **真正危險的是「不跑 ENABLE 就收工」** ⇒ `shipped` 軸永遠不再更新,而**三軸對帳全綠、零告警**。
  - 四支都重放時,那句 ENABLE 是 **no-op**(驗證查詢回 `O`),留著是保險與可讀性。
  ⇒ 原文的結論逐字:「**這一格要實查的是「helper 是四軸 + trigger 在」,不是去猜 ENABLE 會不會報錯。**」
- **rehearsal**:`b2s2b-verify.sh` 的 `REH-PRODUCTS` 格會重放 runbook 的 Forward 清單並斷言產物,
  `TMUT-REH` / `TMUT-REH2` 兩發負測證明它有判別力。

---

## §6 這份文件**沒有**做到的事(誠實邊界)

- **沒有實際跑過 merge** —— §0.1 / §0.2 是靠比對 `origin/dev` 與讀 code 推出來的,
  `NEWEST_TS` 會 die 這件事**沒有實跑驗證**(要驗就得真的併,那超出「唯讀預備」)。
- **沒有正式站的任何可見度** —— P0 因此只能列成「要 Sean / 主視窗確認」。
- **§0.3 的無衝突只逐行驗了 `a9h_m` 那一支**;另兩支是靠 grep 0 命中,**沒有逐行讀**。
- **codex 背書一顆都還沒補**。

— a4a-chain 施工窗,2026-08-07
