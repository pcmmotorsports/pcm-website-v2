# A7b「退款工作表」交接 — 2026-07-31 下午(A7b-M 收工)

> 🔴 **讀法**:本檔把三種東西分開標,**不要混著信**。
> **【事實】** = 可當場用 grep / 實跑複驗的。
> **【判斷】** = 我的推論,**可能是錯的,請自己重新想一次**。
> **【未驗證】** = 還沒有人證明過。
>
> 🔴 **為什麼要這樣標**:本線今天有**三次**「我寫的話比它的實力大」被審查抓到(§6)。
> **交接檔的指示不是權威,可驗證的事實才是。**

---

## 1. 一句話現況(【事實】)

**A7b-M(建表片)已寫完並在本機 PG17.10 實跑通過;A7b-T(十支守門 trigger + 行為探針)還沒開始。**
零 apply 到正式站、零 push。

---

## 2. 今天做完了什麼(【事實】)

### 2.1 規格:plan v1 → **v7**,關卡1 **六輪全 FAIL、全部折入**

| 輪 | 模型 | 角度 | 結果 | 其中「修上一輪自捅」 |
|---|---|---|---|---|
| R1 | codex `gpt-5.6-sol` xhigh | 逐條條文稽核 | FAIL 35+5 | — |
| R2 | codex xhigh | 逐條條文稽核 | FAIL 18+4 | **8 / 18** |
| R3 | **Fable(換模型)** | 假設審查 / 災難日 / 修法回歸 / 測試假綠 | FAIL 11+3 | **4 / 11** |
| R4 | codex xhigh | v3→v4 diff 的靜態可達性 + 宣稱稽核 | FAIL 7 | **5 / 7** |
| R5 | **Fable** | D9 是不是第三層名過其實 / §7.5 是不是真機制 / §8 完整性 | FAIL 11+2 | **3 / 11** |
| R6 | codex xhigh | **實作者視角 + 跨片介面** | FAIL 11 | 1 / 11 |

合計 **93 must-fix + 14 nit**,折入 **91/93**、駁回 0、改採不同修法 1。
逐字 = `docs/reviews/2026-07-31-e10-a7b-k1{,r2,r3-fable,r4,r5-fable,r6-codex}.md`。

### 2.2 code:`supabase/migrations/20260731120000_m4b_e10_a7b_m_refund_jobs.sql`
兩表 + 36 條 CHECK + 五道唯一性 + 七支 FK + 6 個索引 + ACL/RLS + COMMENT 合約 + dormant gate
+ 檔內 fail-closed 結構驗收 DO block。**M 型:零 trigger、零 DB 函式。**

### 2.3 驗證:`scripts/a7bm-verify.sh` —— 本機 **24 PASS / 0 FAIL**(`all` 模式從零 provision)
- migration 疊在**全部既有 migration 之上**套用成功、檔內結構驗收全過
- **dormant gate 雙向已證**:gate 在 ⇒ 一筆「所有 CHECK 都合法」的 INSERT 紅在
  `order_refund_jobs_dormant_until_triggers`;gate 拿掉 ⇒ **同一筆通過全部 36 條 CHECK**、
  改紅在 `orj_cancellation_fk`(**同時證明複合 FK 真的接對了**)
- **11 條結構突變各自紅在指定斷言** + 兩組零突變對照組
  (含四條**專打關卡2 指名的假綠路徑**:`refund_amount` 改 bigint / **D9d 改成恆真但字面全留** /
   U1 欄組改成 `(order_id, generation)` / 刪掉一個排程索引)
- harness 自我測試(故意弄壞快照 SQL 必須當場中止)

### 2.4 Sean 今天的拍板(全文 = memory `project_m4b-a7b-refund-jobs-decisions`)
早上四題 + 下午五題:**Q1=A**(D1-D8 全採用)/ **Q2=B**(結案更正走 DB 內正式 RPC + 兩人簽核)/
**Q3=A**(generation 上限維持 20)/ **Q4=A**(修正版 D9)/ **Q5=A**(直接進實作,SQL 即規格)。

🔴 **Q4 這題答了兩次** —— 第一次是根據**我講錯的描述**答的,R5 抓到後我主動回頭更正並重問。

---

## 3. ✅ codex 關卡2 **已跑完、已折入**(【事實】)

**FAIL,12 must-fix + 3 nit,折入 15/15、駁回 0。**
逐字 = `docs/reviews/2026-07-31-e10-a7bm-k2-codex.md`。
🔴 **凍結紀律成立**:受審 migration 的 mtime `11:57:54` **早於** codex 起跑 `12:00:35`。

**最重的一組打在我自己的結構驗收上** —— 我整天在講「假綠」,自己的 DO block 就有多條:
欄位只數總數(`refund_amount` 改 bigint 全綠)/ CHECK 只驗「同名存在」(**D9d 改成 `CHECK(true OR …)` 全綠**)/
U1 只驗名稱(欄組改成 `(order_id, generation)` ⇒ 第二次退款防線消失而全綠)/ 七支 FK 只驗數量 /
子表約束與六個索引**完全沒有斷言** / **scalar subquery 回 NULL ⇒ `IF NOT(NULL)` 不進 RAISE**。
⇒ 改用 repo 既有的**指紋**手法封死欄位/約束/索引三組 + `aclexplode` 比對完整
grantee × privilege × grant-option 集合 + 欄級 ACL 必須為零。
**四條專打上述路徑的突變已加入 harness、全部轉紅**(見 `scripts/a7bm-verify.sh` 第 4 步)。

<details><summary>原「接手要跑 codex」的指令(已完成,保留備查)</summary>

prompt 在 `/tmp/codex-a7bm-k2.txt`,輸出在 `/tmp/codex-a7bm-k2-msg.txt`。

```bash
cd /Users/sean_1/pcm-website-v2 && test -f /tmp/codex-a7bm-k2-msg.txt \
  && cp /tmp/codex-a7bm-k2-msg.txt docs/reviews/2026-07-31-e10-a7bm-k2-codex.md \
  && wc -l docs/reviews/2026-07-31-e10-a7bm-k2-codex.md
```

🔴 **若該檔不存在(逾時 / 被砍)** ⇒ **重跑一次,不要跳過**:
```bash
codex exec -s read-only -m gpt-5.6-sol -c model_reasoning_effort="xhigh" \
  -o /tmp/codex-a7bm-k2-msg.txt "$(cat /tmp/codex-a7bm-k2.txt)" < /dev/null \
  > /tmp/codex-a7bm-k2-out.txt 2>&1
```
- **必須從 main session 跑**(subagent 會被 classifier 擋)
- **`-m gpt-5.6-sol` 要顯式帶**(預設是別的模型)
- 跑前後各取 `git status --porcelain` 比對零留痕
- 🔴 **會跑超過 10 分鐘** ⇒ 用 `run_in_background: true`

</details>

✅ **已 commit**(精準 add,工作樹另有別線的未追蹤資料夾 `dev-preview/mobile-catalog-ux/`、
`docs/superpowers/` —— **那兩個不要碰**)。

---

## 4. 下一步:A7b-T(【事實】= plan 已定死的交付內容)

規格全在 `docs/specs/2026-07-31-e10-a7b-refund-jobs-plan.md` **v7**。要交付:

1. **十支 trigger**(manifest = plan **§5.0**,逐支具名 + 預期 `tgtype`)
   —— parent 6 支 + child 4 支。🔴 **plan v6 全檔寫「六支」是我的字面錯誤,v7 已更正。**
2. **移除 dormant gate**:在所有守門安裝並通過結構驗收之後、**同一交易的最後一步** `DROP CONSTRAINT`
3. **16 條 edge 的守門**(plan §3.1)+ **exact-one classifier**(plan §5.2-1)
   —— 🔴 **禁用 `IF/ELSIF` 首條命中**:E2/E2b/E3 同為 `processing→processing`、
   E13/E14 同為 `dead→dead`,分支順序會直接改變結果
4. **全欄位 canonical manifest + allowed-delta 白名單 + deny-by-default**(plan §5.2-4)
   —— 🔴 **本片的 42 欄斷言就是給它用的**:新增欄卻沒進白名單必須轉紅
5. **§7.2 一對一矩陣**(約 90 格 truth table + 其餘約束)、**§7.4 的七條正向鏈 + 37 組負測**
6. **§7.5 靜態可達性矩陣的機器化**(rule 4:從 §3.1 + §4.4 產列形狀、逐 edge 實跑、跑不過當場中止)
7. **barrier lock probe**(plan §10):量 migration 持鎖期間 `create_order` INSERT 的交易總時長

**沿用**:`scripts/a7bm-verify.sh` 的骨架(provision / fail-closed snapshot / `mutate()` 的
「先 cmp 驗 sed 真的改到東西」/ 對照組必跑)。

---

## 5. 🔴🔴 A7b-M 已知**做不到**的事(【事實】,不是待辦,是能力邊界)

**接手時不得宣稱本片已證明下列任何一項:**

1. **狀態機行為完全沒被證明** —— 七態 16 條 edge 的守門全在 A7b-T。本片是 M 型、零 trigger。
2. **錢面四條(D7 / D9a / D9b / D9d)只被證明「定義沒被悄悄改掉」,沒被證明「承重」。**
   🔴 **關卡2 折入後已改善但沒有解決**:新增的**約束指紋**會抓到「恆真但字面仍留」
   (`CHECK (true OR …)`)—— 有突變證明它轉紅。**但指紋只說得出「有東西變了」,
   說不出「這條規則實際上還擋不擋得住錢」**。
   後者唯一的證明方式是**行為負測**(塞一筆該被它擋下的列),
   而 A7b-M 期間 **dormant gate 擋住所有 INSERT** ⇒ **本片物理上做不到**
   ⇒ 明文歸屬 A7b-T 的 §7.2。(同一段話寫在 `scripts/a7bm-verify.sh` 第 4 步的註解裡。)
3. **36 條 CHECK 只被證明「一筆合法 queued 列會通過全部」**(gate 雙向測的方向②),
   **沒有逐條負向證據**。
4. **本機 PG17.10 非 Supabase**;C locale ≠ 正式站 locale;`auth.uid()` 是 shim。
5. **鎖窗上限沒有量過**(barrier lock probe 在 A7b-T)。

---

## 6. 🔴 今天最貴的三個教訓(【事實】,皆為審查實錘;對 A7b-T 直接適用)

**同一個病連三層,每一層都是「為了修上一層而寫的話」** ——
memory `feedback_control-named-beyond-its-actual-power` 已擴充。

| 輪 | 我寫的話 | 實際 |
|---|---|---|
| R3 | plan v3 的形式證明「一代最多一個後繼」 | **成立,但問題選錯** —— 要保證的是「同一筆錢只退一次」。已被 TapPay 受理的退款進 dead 後若被結成「授權重試」,下一代帶**全新 `bank_refund_id`** ⇒ 冪等鍵不會擋 |
| R4 | v4「`retry_exhausted` 蘊含零金額移動」 | **把 worker 紀律講成 DB 證明** —— worker 逾時誤寫 E5 即破 |
| R5 | v5「D9 讓錢已入帳的情況必定被擋下」 | **當時沒有任何 CHECK 做那個比對**;真正的擋點是「人看到數字變大要自己起疑」 |

⇒ **v7 起的紀律(A7b-T 必須照做)**:
**每一句「⇒ 所以安全」都必須當場指得出「具名的 constraint 或 edge 條件」;
指不出來的一律改寫成「這是稽核」「這是人的責任」「這是 worker 紀律」並收進 §8 誠實邊界清單。
而那份清單本身也要被審**(R5 角度 D 就是專門查它,當場又補出四句漏標的)。

**另兩條可複用的**:
- **負測證明「壞的被擋住」,證明不了「好的走得通」**。v3 的 24 負測 + 2 正向對三處**靜態死鎖**全綠;
  v4 補兩條後另兩處死鎖**又全綠**。⇒ **正向鏈先寫、先跑**。
- **狀態不變式做不到的事,不要寫進狀態不變式**。v3 把「`tappay_refund_id` 在 submitted 必須非 NULL」
  寫進 truth table,但走 E3b 的 job 永遠沒有該值 ⇒ **合法路徑靜態死掉,而且測試抓不到**。

---

## 7. 收尾狀態(【事實】)

- ✅ `STATUS.md` 七欄、`docs/handoff/CURRENT.md` 已與 code 同一筆 commit 更新
- ✅ codex 關卡2 已跑、15 條全折入(§3)
- ⛔ **未 push**(等 Sean 手動推)、**未 apply 到正式站**

---

## 8. 施工時本機實跑推翻規格的兩處(【事實】,plan v7 已回寫)

1. 🔴 **`NOT VALID` 在 `CREATE TABLE` 的 table constraint 上不生效** ——
   PostgreSQL 只在 `ALTER TABLE … ADD CONSTRAINT` 認它;建出來的約束 `convalidated = true`,
   我原本那條「必須是 NOT VALID」的斷言**當場轉紅**(那正是它該做的事)。
   **修法 = 拿掉 `NOT VALID`,不是改成 `ALTER TABLE`**:表與約束同生 ⇒ 恆為空表
   ⇒ `NOT VALID` 唯一的作用在這裡**沒有任何行為差異**,留著等於宣稱一個不存在的效果。
2. 🔴 **「約束存在」不等於「它擋得住」** —— gate 改成 `CHECK (true)` 仍然存在。
   ⇒ 驗收改成**逐字比對 `pg_get_constraintdef` = `CHECK (false)`**,並有突變證明它會轉紅。

---

## 9. 起手指令

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --porcelain && git log --oneline -3
```
預期:branch=`dev`、HEAD 有 A7b-M 那筆;工作樹**只剩**別線的兩個未追蹤資料夾
(`apps/storefront/src/app/dev-preview/mobile-catalog-ux/`、`docs/superpowers/`)—— **那兩個不要碰**。

**重跑驗證**(需先確認 54329 埠沒有別的 cluster 佔用;有的話先 `pg_ctl -D <舊 pgdata> stop -m fast`):
```bash
scripts/a7bm-verify.sh all /tmp/a7bmv
```
預期:**PASS=24 FAIL=0**。
