# `473b-1` plan **v2** —— 更正表 + 更正 RPC(**等 Sean 批**)

> **鐵則 8 + 鐵則 12③**(新開表 = 動 schema)。**本檔只是 plan,不含 migration。**
> 依據拍板:`Q-473-1 = A`(最新一筆說了算)、`Q-473-2 = A`(新開小表),2026-08-14 Sean 拍。
> 🔴 **v2 新增**:Sean 同意 A 的**前提條件** —— 「**用機制證明沒有任何路能繞過更正拿到未更正的『還能退多少』**」。
> 兌現在 `§2a`(反向盤點)+ `§2b`(機制三件 + 刻意不做的第四件)。**文字條款不算數**,該形狀復發 9+ 次。
> 上位 plan = `docs/specs/2026-08-14-473b-manual-verdict-correction-plan.md`(§1-§3 的三條實查不在此重複)。
> **判停令**:本檔不開散文審查輪迴;高風險那輪挪到 **commit 前審 diff**(鐵則 12① 不降級)。

---

## §1 表結構 —— 每一欄對應員工的哪個動作

`public.order_refund_manual_corrections`(append-only,`order_refunds` **一個字都不動**)

| 欄 | 型別/約束 | 對應到員工的什麼 |
|---|---|---|
| `id` | `uuid PK default gen_random_uuid()` | 系統用,員工看不到 |
| `refund_id` | `uuid NOT NULL REFERENCES order_refunds(id)` | 他在**哪一列**按「修改判定」 |
| `seq` | `integer NOT NULL`,`UNIQUE (refund_id, seq)` | 「**最新一筆說了算**」的排序權威(見 §2) |
| `corrected_to` | `text NOT NULL CHECK (corrected_to IN ('money_moved','no_money_moved'))` | 他**改成什麼**:錢其實有動 / 錢確實沒動 |
| `reason` | `text NOT NULL CHECK (btrim(reason) <> '')` | 他**為什麼**改 —— 稽核第一個問的就是這個 |
| `actor` | `text NOT NULL CHECK (actor ~ '^[a-z0-9_]{1,64}$')` | **誰**改的 |
| `request_id` | `text NOT NULL`,`UNIQUE` | 他**手滑連按兩次**時的冪等鍵(對齊 `order_refunds.request_id` 既有慣例) |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | 時間軸,給人看 |

**為什麼是這些、不是更多**

- **沒有 `is_active` / `superseded_by` 欄** —— 「哪一筆有效」由 `seq` 最大值決定(§2)。多存一份布林 = 兩個真相來源,而它們會不同步。
- **`seq` 而不是靠 `created_at` 排序** —— 同一秒兩筆會平手,`now()` 在同交易內還是同一個值。`(refund_id, seq)` 唯一序是姊妹線已經在用的形狀(`20260812140000:682` 逐字 `SELECT pg_catalog.max(e.seq) INTO v_seq`)。
- 🔴 **`corrected_to` 的值域刻意不是 `failed_reason` 那三碼。** 那三碼答的是「系統為什麼失敗」;本欄答的是「**人判定錢有沒有動**」。共用值域會讓下游以為可以拿它去 `SET failed_reason` —— 那正是被 `Q-473-2` 否掉的 C 案。
  ⚠️ **值域權威的位置我開檔核過、與 code 註解的說法有一處出入**:三碼逐字列在 `20260803150000:181`,但那是 **`failed_detail` 欄的 COMMENT**(`…failed_reason 承 machine code:rejected_out_of_range / not_sent / manual_failed`),**不是 `failed_reason` 自己的欄 COMMENT**。`refund-ledger-view.ts:64-65` 寫的「該欄 COMMENT」讀起來像後者 ⇒ **行號對、歸屬敘述不精確**,引用時照本檔。

## §2 「最新一筆說了算」的判定式放哪層 —— **DB view,不是讀取端投影**

新增 `public.order_refund_effective_verdict`:
`SELECT DISTINCT ON (refund_id) refund_id, corrected_to, reason, actor, created_at, seq FROM … ORDER BY refund_id, seq DESC`

**三個理由(都可查證,不是偏好)**

1. **讀者已經有兩處**:異常清單(`refund-read.ts`)+ 訂單頁帳本區塊(`refund-ledger-section.tsx`)。`refund-ledger-view.ts:1-2` 檔頭逐字寫著「兩處各養一份 label 就是下一個漂移點」—— 判定式比 label 更不能養兩份。
2. 🔴 **`#445b` 的「佔額度」判準在 DB 層**(`pcm_order_refundable_remaining`)。TS 投影它吃不到 ⇒ 判定式只寫在 TS 的話,DB 側**一定**要再寫一份,那就是保證會漂的兩份。
3. **PostgREST 可直接 select view** ⇒ 讀取端零額外邏輯,`473c` 的 UI 也吃同一支。

⚠️ **RPC 內不做判定**:RPC 只負責 append 一列 + 守門;「哪一筆有效」全部交給 view。兩邊都判 = 又是兩份。

---

## §2a 反向盤點 —— **從 code 列出所有回答「已退 / 還能退」的地方**

方向是 Sean 硬驗收指定的:**從既有 code 往外列**,不是從新入口找誰用它(後者會漏掉沒改的舊路)。
**先寫載體清單再逐類報數**(memory `feedback_absence-read-as-verified`);分母 = `find` 實數。

| 載體 | 分母 | 命中 |
|---|---|---|
| `supabase/migrations/*.sql` | 169 檔 | R1 / R2 / R3 |
| `apps/**/*.ts` + `*.tsx` | 412 + 419 檔 | R4-R9 |
| `scripts/*.sql` + `*.sh` | 17 + 89 檔 | R10 |
| `packages/**/*.ts` | 206 檔 | R11 |
| `docs/probes/*` | 4 檔 | 0 命中 |

用的 pattern:`refundable_remaining` / `sum\(\s*(r\.)?refund_amount` / `partiallyRefunded` / `已退|可退|未登記額` / `refundedAmount|totalRefunded|remainingRefund`。

| # | 位置 | 它回答什麼 | 更正上線後走哪條路 |
|---|---|---|---|
| **R1** | `20260803150000:394-408` `pcm_order_refundable_remaining` 本體 | 「帳本未登記額」= `orders.total` − SUM(`processing`+`confirmed`) | 🔧 **本片唯一要改的地方**(§2b-1) |
| **R2** | `20260803150000:776-779` `admin_finalize_order_refund` 步 7 **自己 SUM** | 「已 confirmed 多少」⇒ 決定 `payment_status` 翻 `refunded`/`partiallyRefunded` | 🔴 **真的繞過 R1**,而且**本片不修**(§6-3) |
| **R3** | `20260801120000:450-464` 同函式舊版本體 | 同 R1(已被 R1 的 `CREATE OR REPLACE` 取代) | 歷史 migration,不再是執行中的定義 |
| **R4** | `refund-read.ts:103` | TS 側**唯一**呼叫 R1 之處 | ✅ **零改動**(§2b-1 的重點) |
| **R5** | `refund-ledger-section.tsx:94` | 畫面上的「帳本未登記額」 | ✅ 零改動 |
| **R6** | `refund-exception-resolve.tsx:114,117` 「發起前/現在累計已退」 | **TapPay Record 反查**(`refund-actions.ts:221` `checkRecordBaseline`) | ✅ **刻意不動** —— 那是外部權威,比我們的帳本更接近真相 |
| **R7** | `refund-section.tsx:110-111,203` 「TapPay 剩餘可退額」 | TapPay 端的數,非本帳本 | ✅ 刻意不動,同 R6 |
| **R8** | `order-display.ts:40-50`(**storefront,客人看得到**) | 把 `orders.payment_status` 五值翻成中文:`refunded`→「已退款」`:42` / `partiallyRefunded`→「已退部分」`:48` / **`paid`→「處理中」`:50`** | ⚠️ 吃 R2 ⇒ **繼承 R2 的缺口**(§6-3) |
| **R9** | `refund-entry-gate.ts` / `order-detail-route.tsx:175` / `order-detail.tsx:262` | 不回答金額,只 fail-closed 依賴 R1 **可用性** | ✅ 零改動 |
| **R10** | `scripts/a7c-rw1b-verify.sh:344` 斷言 `= 57` | 驗證腳本 | ⚠️ 若該筆訂單將來有更正,期望值要重算;**apply 當天回跑一次** |
| **R11** | `database.types.ts:3280` | 產生的型別(簽章不變 ⇒ 不需重產) | ✅ 零改動 |

## §2b 機制(**不是文字條款**)—— 三件,以及刻意不做的第四件

**1️⃣ 同簽章 `CREATE OR REPLACE`,讓「舊入口本身變正確」**

R1 內部改成:再扣掉「有更正說錢動過」的 `failed` 列(join `order_refund_effective_verdict`,`corrected_to='money_moved'`)。**簽章一個字不動。**

> 🔴 這就是機制的本體:**R4/R5/R9/R10/R11 全部零改動就拿到更正後的數,而且沒有第二支函式可以繞去。**
> 它不是「規定所有讀取都走新入口」——**根本沒有新入口**,舊的那支就是唯一那支。
> 對照 `#476` 片2 `findActiveProcurement` 判例:那支是把「挑哪一列」收斂成單一函式;本片是把「算多少」收斂在原地。

**2️⃣ 守門測試 + 定向突變:證明「第三處手寫 SUM」會紅**

一條測試掃 `supabase/migrations/*.sql`(**分母 169 檔**),pattern = `sum\(\s*(coalesce\(\s*)?(r\.)?refund_amount`。

🔴 **實測命中 = 3 處,不是 2 處**(我第一版寫「只有 R1 與 R2」是錯的,當場重數修正):

| 命中 | 是誰 |
|---|---|
| `20260803150000:402` | **R1** 現行本體 |
| `20260803150000:776` | **R2** 步 7 手寫 SUM(附 backlog 編號當豁免理由) |
| `20260801120000:458` | **R3** 同函式的**歷史版本** |

⚠️ **這道守門有一個先天上限,寫出來不藏**:migration 是 forward-only、歷史檔永不修改 ⇒ **每一次 `CREATE OR REPLACE` 都會在 allowlist 留下一筆永久命中**。所以它擋的是「**冒出第四個檔**」,不是「同一支函式改了幾版」。allowlist 要用 `檔名:行號 + 該行內容` 錨定,不能只記檔名。

**定向突變兩發**(缺一就是恆綠格):① 把 R2 從 allowlist 拿掉 ⇒ 測試**必須紅**(證明它真的掃得到)② 把 R1 裡的更正 join 拿掉 ⇒ 行為測試(`§5` 第 6 條)**必須紅**。

**3️⃣ apply 閘:R1 換過之後、應用層上線之前,實跑一發「有更正的訂單」**

見 `§5` 第 6 條。

**4️⃣ ❌ 刻意不做:TS 側的品牌型別(`correctionsApplied` brand)**

在 1️⃣ 之下,TS **從來沒有自己算過**這個數 —— 它只是把 DB 回的整數轉手。加一層型別只會讓人以為 TS 有責任,**多一層要維護、零多防到的錯**。
這一條是直接回應 Sean 那句「太多沒意義的事情」:**能省的儀式就省,省的理由寫出來。**

## §3 RPC:`admin_correct_order_refund_verdict(p_refund_id, p_expected_correction_id, p_actor, p_reason, p_corrected_to, p_request_id)`

守門**抄姊妹的形狀**(`20260812140000:572-724`,`CREATE FUNCTION` 到 `$prmr$;`),但**不是抄那支函式**——它動的是 `payment_refund_events`,與本線無關。

| 道 | 內容 | 與姊妹的差異 |
|---|---|---|
| G1 | 隔離閘:非 `read committed` ⇒ RAISE | 同 |
| G2 | `actor` 驗:**`^[a-z0-9_]{1,64}$` regex**,排在任何資料讀取之前 | 🔴 **刻意不同**。姊妹查 `public.staff`;本線 RW4(`20260803150000:454-455`)用 regex。**同一個員工不該在同一條線的兩支 RPC 一支過一支不過** ⇒ 沿用本線 |
| G3 | 輸入驗:`reason` 正規化後非空、`corrected_to` 不得 NULL、`request_id` 必填 | 同 |
| G4 | 鎖父列 `order_refunds` **`FOR NO KEY UPDATE`** | 🔴 **必須 NKU**:本表對 `order_refunds` 有 FK ⇒ INSERT 會取父列 KEY SHARE;`FOR UPDATE` + KEY SHARE 是 `A2b1` 已實測過的 40P01 死結形狀 |
| G5 | 鎖後**重讀**目標列:`status='failed' AND failed_reason='manual_failed'` 才准更正;**先數再取** | 語意換成本線的判準 |
| G6 | **CAS**:`p_expected_correction_id` vs view 現值。**可為 NULL** = 呼叫端看到的是「尚未更正過」 | 🔴 NULL 語意是本片新增的,姊妹沒有 |
| G7 | INSERT 一列(`seq = max+1`)+ `GET DIAGNOSTICS ROW_COUNT` 守 | 姊妹寫兩列,本片**寫一列**(舊列本來就不動,不需要沖銷列) |
| G8 | 同交易寫 `admin_audit_log`,`after` 取自 `RETURNING` 實際列值 | 對齊 RW4 步 8 |

**ACL**:`REVOKE ALL … FROM PUBLIC, anon, authenticated` + 只 `GRANT EXECUTE … TO service_role`;表本身同樣 `REVOKE ALL` + 只開 `service_role`。

## §4 rollback:`scripts/473b1-down.sql`

沿用 `R-116 §M4` 的形狀(`scripts/452a-down.sql` 是現成範本):**整檔可貼進 Supabase Dashboard → SQL Editor**、包在單一 `BEGIN…COMMIT`、可執行區間零 psql 變數。

內容 = `DROP FUNCTION` → `DROP VIEW` → `DROP TABLE`。**`order_refunds` 無任何改動 ⇒ 沒有資料要回填**(這是選 A 案的主要理由)。

🔴 **一個真代價,寫在腳本開頭**:`DROP TABLE` 會**連同已寫進去的更正紀錄一起消失**。腳本第一段放一句 `SELECT * FROM …`,要求執行者**先把結果存下來再往下貼**;**不自動備份**(自動備份要寫到哪張表 = 又一個 schema 決定)。

## §5 apply 前置閘(apply 當下要驗什麼才算安全)

| # | 驗什麼 | 怎麼算過 |
|---|---|---|
| 1 | 三個新名字不撞既有 | `information_schema` 查表/view + `pg_proc` 查函式,**三個都 0 列** |
| 2 | `order_refunds` 零改動 | apply 前後 `md5(定義)` 相同,且既有列 `to_jsonb` 逐欄 diff 為空 |
| 3 | **PostgREST 認得新 view** | `GET /rest/v1/order_refund_effective_verdict?limit=1` 回 **200**;回 `PGRST205` = schema cache 沒吃到 ⇒ **應用層不得上線**(memory `feedback_app-layer-must-not-ship-before-migration-apply`,08-07 正式站壞 8 小時的觀測點) |
| 4 | ACL **正負各一發** | `anon` / `authenticated` 呼叫 RPC ⇒ **拒**;`service_role` ⇒ **通**。只跑負的 = 恆綠格 |
| 5 | 既有 RW4 照跑 | 新表的 FK 不擋 `order_refunds` 既有寫入(交易模擬 `BEGIN → 跑 RW4 → 驗 → ROLLBACK`) |
| 6 | 🔴 **R1 換版後真的會扣** | 交易模擬:造一列 `manual_failed` → 讀 R1 記下值 → 寫一筆 `money_moved` 更正 → **R1 的值必須少掉那筆金額** → `ROLLBACK`。**同時跑反向**:寫 `no_money_moved` 更正 ⇒ R1 **不得改變**(只跑正向 = 半個對照) |
| 7 | R1 的 ACL 沒被 `CREATE OR REPLACE` 洗掉 | `has_function_privilege` 正負各一(`service_role` 可、`anon`/`authenticated` 不可)。`CREATE OR REPLACE` 會保留 ACL,但**這正是「以為會保留」該被量一次的地方** |
| 8 | `scripts/a7c-rw1b-verify.sh:344` 的 `= 57` | 回跑一次;若該訂單有更正,期望值要重算 |

⚠️ 八條全部要在 **apply 當天**跑;先前量的數字不算數。

## §6 誠實缺口

**真的構造不出來的:目前一格都沒有。** 這是刻意的答案 —— 並發 CAS、ACL 正負、「最新一筆」的序、舊列零改動,四樣全部可構造 ⇒ **不得拿本節豁免任何一樣**。寫不出負測的守門,要先懷疑它是 no-op。

**以下兩條是「刻意不做」,不是「做不到」—— 分開列,不混進上面那句:**

1. 🔴🔴 **「錢其實有動」的更正,不會讓那筆退款變成 `confirmed`。** 狀態機(`20260803150000:211-215`)三終態轉出一律 RAISE,本片不碰它。⇒ 更正的**實際效果**只有兩個:畫面看得出判錯過、`#445b` 的佔額度判準認得它。**帳上的金額不會因為這個更正而改變。**
   ⚠️ **Sean 很可能以為「更正」= 帳也跟著對了。** 這句要當面講清楚,不能只寫在 plan 裡。
2. ⚠️ **actor 閘沿用本線 RW4 regex `^[a-z0-9_]{1,64}$`(`20260803150000:454-455`),不抄姊妹線的 `public.staff` 查表**(`20260726120000:12`,該表確實存在)。理由:**同一個員工不該在同一條線的兩支 RPC 一支過一支不過** —— 本片與 RW4 是同一條退款線上前後腳的兩支。主視窗已裁定這是實作取捨、不送 Sean。
   🔁 **重估觸發點:E8-B 真認證線上線。** 那時 `actor` 的語意會從「自填字串」變成「登入身分」,本行的理由就失效,必須回訪本節。

3. 🔴🔴 **`R2`(`20260803150000:776-779`)本片不修 —— 這是明知而不做,不是沒看到。**
   它自己 SUM `status='confirmed'` 決定 `orders.payment_status`。一筆「錢其實有動」的更正**不會**讓該列變 `confirmed` ⇒ R2 算不到它 ⇒ **`payment_status` 可能停在 `paid`,而實際上錢已全退**。
   **這條會漏到客人眼前**:`order-display.ts`(storefront)吃的就是 `payment_status` ⇒ 客人看到的是 `:49-50` 的 **「處理中」**,而不是 `:42` 的「已退款」。
   ⚠️ **本行原本寫「已付款」= 假字面**(主視窗先發現、我開檔複驗確認:`order-display.ts:49-50` 逐字 `case 'paid': return '處理中';`,該檔 `:20-22` 註解說明 `paid` 自 A9f 起固定此字串、不再細分出貨軸)。**機制不受影響**(客人看到的仍是付款軸的字、不是退款軸的字),但字面必須對 —— Sean 能核的就是字面。
   不在本片修的理由:改 R2 = 改 `payment_status` 的翻轉語意 = **另一個方向題**(要不要讓人工更正去翻訂單狀態),不是 `473b-1` 的範圍。
   ⇒ **要開 backlog 條目,並在送 Sean 批本 plan 時一起講。** 不寫成「未來優化」,寫成「已知會對客人顯示錯」。

## §7 片界與估時

| 片 | 內容 | 估 |
|---|---|---|
| `473b-1` | migration(表 + view + RPC + ACL)+ `scripts/473b1-down.sql` + 負測 | 90-140 分 |
| `473c` | 後台「修改判定」UI(**apply 之後**才排) | 60-90 分 |

**驗收**沿用上位 plan `§5` 八條,並補一條:
9. ☐ 同一列連續更正兩次 ⇒ view 只回**最後那筆**,且前一筆**仍查得到**(A 案的整個賣點)。

## §8 對 Sean「邏輯太複雜、太多沒意義的事情」那句的回應(**不替既有設計圓場**)

**我沒有審過整條退款線的守門清單 ⇒ 我不能說「每一條都有意義」,也不能說「有一堆沒意義」。** 這句仍是懸而未決的懷疑。

我能誠實交代的只有**本片自己的取捨**,兩處都是往少的方向砍:

- `§2b-4` 砍掉 TS 側的品牌型別 —— 理由寫出來了(TS 從來沒自己算過那個數)。
- `§1` 砍掉 `is_active` / `superseded_by` 欄 —— 兩個真相來源會不同步。

**唯一一個我看得懂、且覺得需要被問一次的既有複雜度**:同一支 `pcm_order_refundable_remaining` 在 `20260803150000` 內被 `pg_get_functiondef` 指紋斷言了**兩次**(`:105` 與 `:984`)。
⚠️ **我沒有審它** —— 它有明寫的理由(擋 `DROP+CREATE` 洗掉 ACL)。我只是把它列出來當**下次有人真的要回答 Sean 那句時的第一個候選**,**不主張它沒意義**。

---

— R 窗十六代 · `473b-1` plan **v2** · **未批准、未實作**
