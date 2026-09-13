# plan · 後台「設定 › 匯率」—— 新 schema(鐵則 8)

> 2026-09-13。**只寫這份 .md,零實作、零 commit、不改任何 .ts/.sql。** 等 Sean 批。
> 起因:稿(側欄新版)上「設定」項下掛一個「匯率」入口;真後台今天沒有任何匯率路由或資料表 ⇒ 這是新 schema ⇒ 鐵則 8 要 plan。

## 0 先講結論(三行)

1. 🔴 **稿(彈窗)與 Sean 09-13 的拍板(獨立一頁)兩個字面互相矛盾** —— 見 §3,列給 Sean 選,本 plan 不裁。
2. 🔴 **今天全 repo 零地方消費匯率**(`git grep 匯率|exchange_rate|fx_rate` 三個字都是 0 命中)⇒ 這張表現在是**純資料輸入,沒有下游**。
3. 🔴 **這是碰錢的新 schema ⇒ 鐵則 12 必審**(匯率會被拿去乘進成本與利潤,即使今天還沒有任何程式碼在做那個乘法)。

## 1 改什麼

新增一張表 `fx_rates`(名稱可議,以下先用這個),存「幣別 → 對台幣匯率」,給後台「設定 › 匯率」讀寫。**不改任何既有表、不動 `orders` / `order_items`,本輪零消費端。**

### 1-a 資料表長相

出處:稿 `#fx` dialog(`~/pcm-mailbox/0912-後台UX/generator/build-v10.py:469`)+ memory `project_0913-admin-order-ux-redesign-rulings.md`(「匯率頁 10 幣別帶中文…TWD 固定 1」)。

稿上實測 10 個幣別、逐一寫死一個匯率值,TWD 那一列 `disabled`(固定 1,不可改)。字面清單(稿實測值,**不是真匯率,只是稿上的假資料**):EUR / IDR / GBP / THB / AUD / USD / TWD(固定 1)/ JPY / CNY / SGD。

兩個候選形狀:

| | 甲:一列一幣別,直接 UPDATE 覆蓋 | 乙:一列一次變更,append-only 留痕 |
|---|---|---|
| 欄位 | `currency_code`(PK)· `rate_to_twd numeric` · `updated_by` · `updated_at` | `id` · `currency_code` · `rate_to_twd numeric` · `effective_from timestamptz` · `created_by` · `created_at` |
| 讀「現在匯率」 | 直接 `SELECT * FROM fx_rates` | `SELECT DISTINCT ON (currency_code) … ORDER BY effective_from DESC` |
| 留痕 | 沒有,改了就蓋掉舊值,誰改的只留最後一次 | 每次改都留一列,誰在哪個時間點把匯率從多少改成多少,查得回去 |
| 對應 memory 那句「改匯率不回頭重算存過的列」 | 需要另外查歷史才知道「那時候的匯率是多少」 | **本身就是歷史紀錄**,不用另外查 |

📌 **本 plan 推薦乙(append-only)**,理由一句:memory 已經拍過「改匯率不回頭重算存過的列」(`project_0913-admin-order-ux-redesign-rulings.md`)—— 這句話成立的前提是**系統知道「那一列存的時候用的是哪個匯率」**,而甲(直接覆蓋)做不到這件事,乙天然做得到。金額欄位一律 `numeric`,不用 `number`(CLAUDE.md 硬線)。

**這一格仍要 Sean 拍**:甲乙都能滿足「今天匯率自動帶、不可改」這個 UI 需求,差別只在**將來查歷史值方不方便**、以及**多寫一點 schema 值不值得**。

### 1-b 誰能改

**建議:`is_manager = true` 才能寫。** 出處:稿彈窗文案自己寫著「訂單只選幣值;改了只影響之後存的列;**只有老闆能進來**」(`build-v10.py:469`)。這與現有三個 settings 頁(`staff` / `mail` / `suppliers`)的權限模式一致 —— `apps/admin/src/app/settings/mail/page.tsx:50` 就是 `me.is_manager === true` 才給 `canManage='yes'`,`settings/staff` 同一套(`page.test.tsx` 檔頭注記 `is_manager` 已經是「有效力的權限」,見 `⟦b4-MGR0⟧`,`supabase/migrations/20260912050000_m4b_mgr0_staff_write_rpcs.sql`)。**匯率沿用同一套判斷式,不新發明權限模型。**

### 1-c 它被誰讀(今天)

實測:`git grep -n -iE "匯率|exchange_rate|fx_rate|currency" -- apps packages supabase` —— 「匯率」「exchange_rate」「fx_rate」三個字**零命中**;「currency」有 625 行命中,但**全部是 `Money` 型別上的字面值 `'TWD'` 或測試裡的 `'USD'`**(TapPay 退款/收款測試 fixture),**沒有任何一處在做「乘匯率」這件事**。

⇒ 📌 **照實寫:今天沒有消費端。** 這張表今天存在的唯一作用是「老闆可以在後台看/改一組數字」,不影響任何訂單金額計算 —— 那個計算(成本 × 匯率 = 台幣總計)是 memory 記的**下一步**(`project_0913-admin-order-ux-redesign-rulings.md`:「成本欄序與算式…幣值(帶匯率)…總計 TWD =(原價+運費+稅金×數量)×匯率」),**不在本 plan 範圍**,那是後台訂單 UX 改版另一條線(P-e,鐵則 8 + 12,已在 `規格-側欄與訂單明細容器-v1.md` §3-f-5 標記)。

## 2 為什麼

Sean 2026-09-13「側欄功能要與稿一模一樣」⇒ 稿上「設定 › 匯率」是稿的一部分 ⇒ 要做。而它是**新資料表**(CLAUDE.md 鐵則 8:動 schema 要先 plan),且**匯率直接影響老闆看到的成本與利潤**(CLAUDE.md 鐵則 12:碰錢的六類之一)⇒ 走 plan + 審兩道,不能當 UI 片做掉。

## 3 🔴 衝突:彈窗 vs 獨立一頁 —— 列給 Sean 選,不裁

| | 甲:彈窗(稿現況) | 乙:獨立一頁(Sean 09-13 拍板) |
|---|---|---|
| 出處 | `build-v10.py:246` 側欄「設定」`onclick="document.getElementById('fx').showModal()"`;`:469` 是那個 `<dialog id="fx">` 本體 | memory `project_0913-admin-order-ux-redesign-rulings.md`:「**匯率獨立一頁**(09-13 改,推翻「格子可改」)」 |
| 側欄項是否需要 href | 不需要,`onclick` 直接開 dialog,不是連結 | 需要,像 `staff` / `mail` / `suppliers` 一樣是一條 `href` 路由 |
| 與其餘 settings 頁一致性 | 不一致(其餘四頁 `staff` `suppliers` `mail` `audit` 全部是頁面,只有這個是彈窗) | 一致 |
| 需要新頁面 | 否 | 是,`/settings/fx-rates`(或同義路徑) |

⚠️ **這兩份都是「讀出來的」,不是本 plan 猜的** —— 稿的檔案字面就是 dialog,memory 記的字面就是「獨立一頁」。哪一個才是 Sean 現在真正要的,盤點文件(`盤點-側欄11頁-換新版.md`)與規格文件(`規格-側欄與訂單明細容器-v1.md`)都只寫「稿上是彈窗」「側欄多一個新去處」,**沒有一處去核對過這兩份字面互相矛盾**。

📌 **本 plan 推薦乙(獨立一頁)**,理由一句:與現有四個 settings 頁的形狀一致(側欄項一律連到一條路由,不特例一個 `onclick` 彈窗),而且 Sean 的拍板時間點(09-13)晚於稿的這版 dialog 寫法,較可能是他看完稿之後的修正。**但這是本 plan 的建議,不是決定** —— 请 Sean 選:

```
Q:匯率入口要做成彈窗(稿現況)還是獨立一頁(你 09-13 拍過的)?
A: 甲 彈窗,照稿原樣 | 乙 獨立一頁,跟其他 settings 頁一致(推薦)
```

## 4 影響

- **新增**:一張表(`fx_rates`,形狀待 §1-a 裁)、一支 RPC 或 server action 給「老闆存匯率」用(`is_manager` 檢查在 RPC 內做,不能只信 client)、一個後台入口(彈窗或頁面,待 §3 裁)。
- **不動**:`orders` / `order_items` / 任何既有金額欄位 / 任何既有 RPC。今天零消費端(§1-c),所以**這一動不會改變任何一張現有訂單的金額或利潤數字**。
- **風險**:表本身空的時候沒有風險;風險出現在**未來**接上「成本 × 匯率」那條消費端(memory 記的下一步)時 —— 那時才會真的影響老闆看到的利潤數字,**那是另一個 plan 的範圍**,本 plan 只負責把「存匯率」這個動作做出來。

## 5 rollback(照 `docs/runbooks/apply-paste-board.md` §0-b 五件寫)

1. **清資料一律 `DELETE`,不用 `TRUNCATE`**(`fx_rates` 若日後有稽核 trigger,`TRUNCATE` 不觸發它;本表目前不掛 trigger,但仍照規矩寫死)。
2. **沒有一鍵回退**——回退 SQL 要人現場寫(`DROP TABLE fx_rates` 或 `DROP COLUMN`),repo 不會自動生成可執行的反向腳本,migration 檔頭需人工寫清楚「回退就是砍掉這張表,今天沒有任何東西依賴它」。
3. **若貼的 migration 含 `GRANT`**(給 `is_manager` 角色或 RPC 的 `EXECUTE` 權):貼之前人工確認一次順序,部署時序閘對純 `GRANT` 是瞎的(`grep -c GRANT` 抓不到,見 runbook §0-b③)。
4. **若對 `fx_rates` 開 RLS**:貼完要用真的角色(`pcm_readonly` 或 `is_manager=false` 的一般帳號)實際去 SELECT 一次,不能只看 `has_table_privilege` 回 `t` 就當作對 —— 全綠不代表讀得到列(runbook §0-b④)。
5. **貼之前跑既有 migration 掃描守門**,不要自己另外寫第三個版本:
   ```bash
   bash scripts/run-migration-scan-tests.sh
   python3 scripts/definer-search-path-gate.py
   ```
   若 RPC 用 `SECURITY DEFINER`,新建物件先抄現有寫法用 `bash scripts/latest-definition-of.sh <名>` 找最近一支同類函式當範本,不要空手寫。

## 6 鐵則 12:碰錢 ⇒ 必審

匯率會被拿去算成本與利潤(即使本輪零消費端,寫這張表本身仍在鐵則 12「金融相關 schema」範圍內)⇒ **migration 寫完、commit 前,走 codex 唯讀審一輪**:
```bash
codex exec -s read-only --disable apps -m gpt-6-astra "$(cat <prompt檔>)" < /dev/null > <out> 2>&1
```
must-fix 修完才 commit。

## 7 migration 版本號

**實測(2026-09-13,橫跨全部 worktree 的 `supabase/migrations/` 目錄,不只 git ref)**:

| worktree | 今天已出現的版本號 |
|---|---|
| pcm-website-v2 / pcm-admin-ui / pcm-design | 010000 · 020000 · 030000 |
| pcm-ops | 040000(另有 `m4b_orders_invoice_issued_at`) |
| pcm-shop | 060000(`m4b_order_workflow_invoice_title_taxid`) |

⇒ 已占用:010000 / 020000 / 030000 / 040000 / 060000。050000 未見,但按分配慣例保留給別人。
📌 **建議本案用 `20260913070000`**。⚠️ **寫 migration 的當下要再查一次**(這份 plan 寫完到真的貼 migration 之間,其他窗可能又占用了號碼)——重跑上面同一段橫跨 worktree 的掃描,不要直接抄本節數字。

## 8 前置閘 + 事後閘

- **前置閘(貼當天重跑)**:`SELECT to_regclass('public.fx_rates')` 應回 `NULL`(還沒建過);`SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20260913070000'`(或當天實際選到的號碼)應回 0 列(還沒貼過,同 apply-paste-board.md 逐字)。
- **事後閘**:貼完 `SELECT * FROM public.fx_rates` 用 `is_manager=true` 與 `is_manager=false` 兩種角色**各讀一次**——manager 應該讀到 10 列(或 0,取決於是否預塞種子資料),非 manager 應該讀到 0 列或被擋在 RPC 外(視 §1-b 權限做在 RLS 還是 RPC 層而定,兩者選一都要貼完實測,不能只看「建表成功」就當作完工)。

## 9 未確認 / 沒查到的

- **甲乙(彈窗/獨立一頁)哪個是 Sean 現在真正要的** —— 兩份文件字面矛盾,§3 已列,未裁。
- **fx_rates 權限做在 RLS 還是 RPC 層** —— 本 plan 只確認「誰能改 = is_manager」,沒有決定實作在哪一層,那是寫 migration 時的技術選擇,建議照抄 `settings/staff` 現有 RPC 寫法(`20260912050000_m4b_mgr0_staff_write_rpcs.sql`),但**未逐行核對**該檔案內容是否直接適用。
- **今天占用 050000 的窗是誰** —— 只查到「未見」,不確定是否已被別的窗預留但還沒落地。
- **稿上「設定」side-nav 項底下除了匯率,是否還有別的子項** —— 本 plan 只處理匯率這一件,盤點文件裡「設定」只有一個「匯率」子項,沒查到第二個。
