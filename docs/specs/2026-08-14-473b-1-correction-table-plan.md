# `473b-1` plan **v3** —— 更正表 + 更正 RPC(**已實作、等審查收尾**)

> **鐵則 8 + 鐵則 12③**(新開表 = 動 schema)。
> 🔴 **狀態(2026-08-14 傍晚,codex R2 抓到檔頭與內文不一致後更正)**:plan v2 已批准(Sean 逐字「懶得看,你處理」把裁量權交回主視窗、主視窗據此批准) ⇒ **migration / 回退腳本 / 守門 / probe 都已實作並實跑**。
> **仍未 apply、未 push** —— apply 是 Sean 的停點,一個字都沒鬆。
> ⚠️ 本檔 v3 = 依實作與兩輪 codex 審查回填的**現況**;v2 的字面若與本檔衝突,以本檔為準。
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
| `reason` | `text NOT NULL CHECK (btrim(reason, E' \t\r\n') <> '') CHECK (char_length(reason) <= 500)` | 他**為什麼**改 —— 稽核第一個問的就是這個。🔴 `btrim` 單參數只剝一般空格 ⇒ 只送換行/Tab 會過(codex R1) |
| `actor` | `text NOT NULL CHECK (actor ~ '^[a-z0-9_]{1,64}$')` | **誰**改的 |
| `request_id` | `text NOT NULL UNIQUE CHECK (btrim(request_id, E' \t\r\n') <> '') CHECK (char_length(request_id) <= 64)` | 他**手滑連按兩次**時的冪等鍵(對齊 `order_refunds.request_id` 既有慣例) |
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
| `supabase/migrations/*.sql` | **170** 檔 | R1 / R2 / R3 |
| `apps/**/*.ts` + `*.tsx` | **413 + 419** 檔 | R4-R9、**R12 / R13** |
| `scripts/*.sql` + `*.sh` | **18 + 90** 檔 | R10 |
| `packages/**/*.ts` | **208** 檔 | R11 |
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
| **R12** 🔴 | `refund-recovery-read.ts:119` `ledgerConfirmedSum: confirmed.reduce((sum, row) => sum + row.refund_amount, 0)` | **在 TS 裡自己 SUM** 該訂單所有 `confirmed` 列 | 🔴 **完全繞過 R1**;本片不修(§6-4) |
| **R13** 🔴 | `refund-recovery-actions.ts:203` `row.ledgerConfirmedSum + row.refundAmount` | 「恢復結案之後的累計已退」推算,吃 R12 | 🔴 隨 R12 |

> 🔴🔴 **R12 / R13 是 v2 的反向盤點漏抓的,由 codex 關卡2 補上(v3 補登)。**
> **漏抓的原因可量**:我 v2 用的關鍵字是 `已退|可退|未登記額` 與 `refundedAmount|totalRefunded|remainingRefund`,
> 而它叫 **`ledgerConfirmedSum`** —— **一個都對不上**。
> ⇒ 教訓:反向盤點用「**概念的別名**」當關鍵字必然有漏;真正 fail-closed 的做法是
> **從資料本身出發**(掃 `refund_amount` 這個欄位被誰碰),那才是我改守門的方向(§2b-2)。
> 顯示位置 = `refund-exception-resolve.tsx:117,140`「現在累計已退」—— **值班決定要不要恢復結案的那一刻看的就是它**。

## §2b 機制(**不是文字條款**)—— 三件,以及刻意不做的第四件

**1️⃣ 同簽章 `CREATE OR REPLACE`,讓「舊入口本身變正確」**

R1 內部改成:再扣掉「有更正說錢動過」的 `failed` 列(join `order_refund_effective_verdict`,`corrected_to='money_moved'`)。**簽章一個字不動。**

> 🔴 這就是機制的本體:**R4/R5/R9/R10/R11 全部零改動就拿到更正後的數,而且沒有第二支函式可以繞去。**
> 它不是「規定所有讀取都走新入口」——**根本沒有新入口**,舊的那支就是唯一那支。
> 對照 `#476` 片2 `findActiveProcurement` 判例:那支是把「挑哪一列」收斂成單一函式;本片是把「算多少」收斂在原地。

**2️⃣ 守門測試 + 定向突變:證明「多一處自己算」會紅**

🔴 **v3 改法(v2 的描述已作廢,codex R2 抓到 plan 與 code 不同步)**:
v2 寫的是「掃 `sum\(…refund_amount` 的形狀、3 命中、行內容錨定」。**實作已經不是那樣了** ——
codex R1 指出 `SUM(r1.refund_amount)`(alias 帶數字)、`SUM(CASE … refund_amount …)`、quoted identifier 都能繞過。

**現行實作** = `packages/domain/src/order/refund-remaining-single-source.test.ts`,兩個載體:

| 載體 | 分母 | pattern | allowlist |
|---|---|---|---|
| `supabase/migrations/*.sql` | **170** 檔 | **裸欄位** `"?\brefund_amount\b"?`(剝註解後) | **6 檔**:`5 / 6 / 12 / 19 / 9 / 2` |
| `apps/` + `packages/` 的 `.ts`/`.tsx` | **413 + 419 + 208** 檔 | 聚合字樣鄰近 `refund_?[aA]mount` | **2 檔**:`1 / 1`(R12 / R13) |

改抓**裸欄位**的理由:寬 = fail-closed = **免疫「換個寫法」的規避**;代價是新 migration 用到該欄要補一行 allowlist,而那一步**正是要的停點**(migration append-only ⇒ 既有檔永不變、不會無謂 churn)。

⚠️ **三個先天上限,寫出來不藏**:
① migration forward-only ⇒ 每次 `CREATE OR REPLACE` 都留一筆永久命中,它擋的是「**冒出新的檔**」。
② **TS 側是啟發式**(抓聚合字樣鄰近欄名),比 SQL 側弱 —— **先把值存進變數再跨行迴圈聚合仍可繞過**(codex R2 指出,屬實)。不做成「凡提到 `refundAmount` 都列管」的理由:那是 35 個檔,churn 大到沒人會看 = 更糟的守門。
③ **allowlist 只鎖「檔名 → 命中數」,不鎖行內容** ⇒ 同一個 allowlist 檔內「刪一個無害命中、加一個危險聚合」總數不變仍會綠(codex R2)。**這是已知洞、不是沒想到**;鎖行內容的代價是每次改動都要更新指紋、實務上會被繞著走。

**定向突變(實跑過、不是計畫)**:① 把 R2 從 allowlist 拿掉 ⇒ **紅**(訊息指名正確的檔)② allowlist 數字改 2→1 ⇒ **紅** ③ 把 R1 本體的更正 join 整段刪掉 ⇒ **紅**。
🔴 突變 ③ 第一次跑時**照樣綠** —— 因為原本比對的是「整個檔有沒有提到那個 view 名字」,而 view 自己的 `CREATE VIEW` 與兩段 `COMMENT ON` 裡都有。**恆綠格是突變抓出來的,不是想出來的**;已改成只看函式本體。

**3️⃣ 🏁 實跑(不是 apply 才驗,是 commit 前就跑掉了)**

`scripts/473b1-concurrency-probe.sh` —— 對 `d1t2-rehearsal.sh provision` 起的拋棄式 PG(套全部 migration)實跑 **15 格全綠**:
繞路被擋 / remaining 10000→7000 / 改回來回升 / CAS 過期被拒 / 冪等 / token 撞別筆被拒 / RR 隔離閘 / **觀察到真重疊 + 雙連線恰一個成功 + 另一個被 CAS 擋 + 零 40P01 死結** / view 最新一筆說了算。

> 🔴🔴 **S9 第一版是假的併發,codex R2 抓到、屬實**:兩邊各 `pg_sleep(0.2)` 之後才呼叫 ——
> **完全序列執行也會得到「一成功一 CAS、零死結」**,那個結果對「有沒有真的重疊」**零判別力**。
> ⇒ 已改成真 barrier:A **先取住父列鎖並握著 4 秒**,B 在 A 還握著時進來,
> 並用 `pg_blocking_pids()` **實地觀察「擋住 B 的就是 A」**(a2b2 判例形狀);**觀察不到重疊就直接紅、後三格不採計**。

> 🔴 **這一輪抓到兩個「看程式碼看不出來」的真 bug,兩個都是本片原本會帶上正式站的**:
> ① `GRANT SELECT ON … TO service_role` **一點限制作用都沒有** —— Supabase 的 `pg_default_acl` 對 `public` 新表**預設就給 service_role 全套八項權限**(`aclexplode` 實測)。⇒ 必須先 `REVOKE ALL … FROM service_role`,否則 `2️⃣` 守的那條繞路**一直是開的**。
> ② `pg_catalog.coalesce(...)` **不存在**(COALESCE 是 SQL 構造)。plpgsql 本體在 `CREATE` 時不求值 ⇒ **migration 套用成功、apply 斷言全過,第一個按下去的員工才爆**。
> ⇒ 通則:**動 plpgsql 的片,apply 斷言之外必須有一次真的呼叫。**

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

**真的構造不出來的:一格都沒有,而且四樣全部已經實跑過了。**
並發 CAS / ACL 正負 / 「最新一筆」的序 / 舊列零改動 —— 見 `§2b-3` 的 probe 14 格。
🔴 **v2 曾經想把「雙連線併發」列成缺口,那是錯的** —— repo 內就有 `d1t2-rehearsal.sh` 這個拋棄式 PG harness,**構造得出來**。假的「構造不出來」比假的「已驗證」更毒(memory `feedback_false-unconstructible-claim-is-worse-than-false-verified`)。

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

4. 🔴 **`R12` / `R13`(TS 側自己聚合)本片不修 —— 這是 §6-3 的同一個病,不同位置。**
   - `refund-recovery-read.ts:119` 在 TS 裡 `reduce` 加總 `confirmed` 列 ⇒ **DB 側的更正扣減對它完全無效**。
   - 顯示位置 = `refund-exception-resolve.tsx:117,140`「現在累計已退」——**值班決定要不要恢復結案的那一刻看的就是它**。
   - **不在本片修的理由**:那個數字的語意是「TapPay Record 對帳用的累計」,要不要把「人工更正」算進去
     **是一個方向題**(算進去 = 拿我們自己的判定去對外部權威的帳),要 Sean 拍,不是實作取捨。
   - 🔴 **承接點**:與 `#497` 同一批,**送 Sean 批本片時一起講**;守門的 `TS_ALLOWLIST` 已經把這兩處列管,
     再多一處會紅。**這是「已知會讓值班看到偏低的已退額」,不是「未來優化」。**
   - ⚠️ `#497` 我開檔核過**確實存在**(主樹 `docs/phase-1-backlog.md:12865`,commit `dd56959a`)——
     codex R2 報「backlog 查無 #497」是因為它掃的是**我這個 worktree**,而 worktree 落後於主樹。**此條不採納。**

## §6-5 🔴 換模型審查(opus / fresh context)抓到的四件,逐條記在這裡

**1. 我把「shim 量到的」當成「正式庫事實」寫進 migration 註解。**
原句:「`pg_default_acl` 對 public 新表**預設給 service_role 全套八項**(實測)」。
那個「實測」量的是**我們自己手寫的** `scripts/d1-supabase-shim.sql:50`;本 repo 唯一一次**正式庫實查**
(`20260814140000:142`)逐字只有 `anon=arwdDxtm, authenticated=arwdDxtm`,**`service_role` 沒出現**。
🔴 後果不只引用錯:原本寫死三個角色名的 REVOKE + 「relacl 只准 service_role 的 SELECT」斷言,
**在正式庫多一個 defacl grantee 時會當場 RAISE、整支退回,而本機恆綠**(只有上線那天才發現)。
⇒ 修法不是改字面而已:REVOKE 改成**動態枚舉 relacl 逐一收**,結果不依賴我對 defacl 的任何假設。
⇒ **上位教訓:shim / 拋棄式環境量到的,不等於正式庫事實。**

**2. 我自己寫下的通則沒套回自己。** plan §2b-3 寫「動 plpgsql 的片,apply 斷言之外必須有一次真的呼叫」,
而我的 migration 斷言區 `SELECT public.` / `PERFORM public.` **全檔零命中**。已補兩發真呼叫
(`PERFORM pcm_order_refundable_remaining(NULL)` + 對不存在 refund 呼叫 RPC 期望 `P8C03`)。
🔴 **並且用突變證明它紅得起來**:把 `pg_catalog.coalesce` 種回去 ⇒ apply **exit=3、整支回滾、表不存在**。

**3. 新表沒開 RLS,而斷言只查 `relacl` 不查 `relrowsecurity` ⇒ 這一層缺席沒有任何一格會紅。**
同族金流表一律有(`order_refunds` `20260725130100:318` / `admin_audit_log` `20260712210000:82` /
`payment_refunds` `20260810140000:150`)。已補 `ENABLE ROW LEVEL SECURITY` + 斷言。

**4. 函式側 ACL 是抽樣、表側是全枚舉(不對稱)。** 已改成 `proacl` 全枚舉 + 連 `authenticator` 一起收 + 檢 `is_grantable`。

### 🔴 我在修這批時又犯一次「拿相鄰的東西當成要問的那個」
跑突變驗證時,我 `sed` 的 anchor 沒對上真正的程式碼行,而 `grep -c` 回 **1** ——
**那個 1 是我自己寫的註解**,不是突變。我差點據此宣告「apply 斷言抓不到這個 bug」。
⇒ 修法:**`grep -c` 的數字要能指出「第幾行、那一行長什麼樣」**,只看數字不看內容 = 沒量。

### ⚠️ consider 8 我判「記錄、不修」(換模型審查提的,理由成立)
更正的效力綁在 `r.status='failed' AND r.failed_reason='manual_failed'`,而 `20260803150000:759`
COMMENT 逐字寫著這兩欄「刻意留可變」⇒ 有人直連 UPDATE 改掉 `failed_reason`,該列會掉出第二段 SUM、
**未登記額無聲回升**,而更正列還在、view 還照顯示,**沒有一格會紅**。
**不修的理由**:要擋它得把那兩欄改成不可變,那是動 `order_refunds` 的既有契約 = 本片明確承諾不碰的東西。
⇒ **列為已知缺口**,承接點與 `#497` / R12 同一批送 Sean。

## §7-1 🔴 審查鏈的誠實缺口:**鐵則 12③ 的「換模型第二意見」那一輪還沒跑**

| 輪 | 誰 | 性質 |
|---|---|---|
| R1 | codex `gpt-5.6-sol` | 對抗審查,**FAIL(14 must-fix)** —— 全部處理完 |
| R2 | codex `gpt-5.6-sol`(**同一支模型**) | **驗證輪,不是模型多樣性第二意見** |
| R3 | **尚未跑** | 🔴 換模型那一輪 = 鐵則 12③ 要求的第二意見 |

**R2 的 prompt 與 R1 刻意不同**(否則同模型第二次只會在同一個框架裡找更細的問題):列出 R1 十四條的**折法**,要它專攻「①折壞了沒 ②折的過程引入什麼新錯 ③新增的 probe 與守門有沒有恆綠格 ④ allowlist 數字自己重數」,並**明文要求不要重報 R1 那些**。

🔴 **為什麼沒跑 R3(兩條路都關著,不是懶得跑)**:
- **subagent(opus / adversarial-reviewer)**:本 session 有明文限制 —— 未經 Sean 要求不得呼叫 Agent tool。**同儕窗的指示不算授權。**
- **codex 換模型**:`~/.codex/config.toml` 只宣告 `model = "gpt-5.6-sol"`;`codex --help`(v0.144.1)**沒有可用模型清單**,唯一出現的 `-c model="o3"` 是語法範例、不是存在性宣告。⇒ **給不出一個「確認存在」的 model id,不猜**(字面值三來源律)。主視窗獨立查證後同意此結論。

⇒ **這是誠實缺口,不是瑕疵。不要因為看到「跑過兩輪 codex」就以為鐵則 12③ 那一輪已經滿足。**

## §7-2 相鄰影響盤點:對 `#498`(採購作廢線)**零命中**

零命中要帶分母,不能只寫「沒事」:

| 方向 | 分母 | pattern | 命中 |
|---|---|---|---|
| 本片 → 採購線 | 本片 staged **7 個檔**的全部新增行 | `voided\|void_reason\|procurement\|order_item_procurement\|zeroInferable` | **0** |
| 採購線 → 本片 | `20260814100000`(**1187 行**)+ `20260813120000`(**696 行**) | `order_refunds\|refund_amount\|pcm_order_refundable` | **0 / 0** |
| 我改的 `remaining` 被採購線讀? | `supabase/migrations/2026081[34]*.sql` | `pcm_order_refundable_remaining` | **0** |

⚠️ 第二列第一次跑時**輸出是空白**、而我差點把空白當成「查過了」—— 空的 `grep` 接 `head` 會讓 `||` 那半永遠不執行。**改成逐檔印「總行數 + 命中數」才有分母。**

## §8 對 Sean「邏輯太複雜、太多沒意義的事情」那句的回應(**不替既有設計圓場**)

**我沒有審過整條退款線的守門清單 ⇒ 我不能說「每一條都有意義」,也不能說「有一堆沒意義」。** 這句仍是懸而未決的懷疑。

我能誠實交代的只有**本片自己的取捨**,兩處都是往少的方向砍:

- `§2b-4` 砍掉 TS 側的品牌型別 —— 理由寫出來了(TS 從來沒自己算過那個數)。
- `§1` 砍掉 `is_active` / `superseded_by` 欄 —— 兩個真相來源會不同步。

**唯一一個我看得懂、且覺得需要被問一次的既有複雜度**:同一支 `pcm_order_refundable_remaining` 在 `20260803150000` 內被 `pg_get_functiondef` 指紋斷言了**兩次**(`:105` 與 `:984`)。
⚠️ **我沒有審它** —— 它有明寫的理由(擋 `DROP+CREATE` 洗掉 ACL)。我只是把它列出來當**下次有人真的要回答 Sean 那句時的第一個候選**,**不主張它沒意義**。

---

— R 窗十六代 · `473b-1` plan **v2** · **未批准、未實作**
