# `473b-1` plan v1 —— 更正表 + 更正 RPC(**等 Sean 批**)

> **鐵則 8 + 鐵則 12③**(新開表 = 動 schema)。**本檔只是 plan,不含 migration。**
> 依據拍板:`Q-473-1 = A`(最新一筆說了算)、`Q-473-2 = A`(新開小表),2026-08-14 Sean 拍。
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

⚠️ 五條全部要在 **apply 當天**跑;先前量的數字不算數。

## §6 誠實缺口

**真的構造不出來的:目前一格都沒有。** 這是刻意的答案 —— 並發 CAS、ACL 正負、「最新一筆」的序、舊列零改動,四樣全部可構造 ⇒ **不得拿本節豁免任何一樣**。寫不出負測的守門,要先懷疑它是 no-op。

**以下兩條是「刻意不做」,不是「做不到」—— 分開列,不混進上面那句:**

1. 🔴🔴 **「錢其實有動」的更正,不會讓那筆退款變成 `confirmed`。** 狀態機(`20260803150000:211-215`)三終態轉出一律 RAISE,本片不碰它。⇒ 更正的**實際效果**只有兩個:畫面看得出判錯過、`#445b` 的佔額度判準認得它。**帳上的金額不會因為這個更正而改變。**
   ⚠️ **Sean 很可能以為「更正」= 帳也跟著對了。** 這句要當面講清楚,不能只寫在 plan 裡。
2. ⚠️ **actor 閘沿用 regex、沒有升級成查 `staff` 表**(§3 G2)。`public.staff` 確實存在(`20260726120000:12`)⇒ **升級做得到,不是構造不出來**。不做的理由是同線一致;**要不要升級是 Sean 的取捨**,不是我可以吞掉的。

## §7 片界與估時

| 片 | 內容 | 估 |
|---|---|---|
| `473b-1` | migration(表 + view + RPC + ACL)+ `scripts/473b1-down.sql` + 負測 | 90-140 分 |
| `473c` | 後台「修改判定」UI(**apply 之後**才排) | 60-90 分 |

**驗收**沿用上位 plan `§5` 八條,並補一條:
9. ☐ 同一列連續更正兩次 ⇒ view 只回**最後那筆**,且前一筆**仍查得到**(A 案的整個賣點)。

---

— R 窗十六代 · `473b-1` plan v1 · **未批准、未實作**
