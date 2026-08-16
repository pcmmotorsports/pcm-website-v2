# Q-AUDIT-1 A2 規格 · 五支出貨 RPC 補 `admin_audit_log`

> **狀態:規格完成、migration 未產出。** 本檔是接手的人的**唯一入口**。
> 真權威 plan = `2026-08-16-q-audit-1-shipping-audit-and-gate-plan.md`(**先讀它的檔頭**,§5 有前提被推翻)。
> 🔴 **A2 尚未開工**,原因不是沒空,是它含一個**跨窗相依**(§5)。

---

## §1 為什麼不能照 plan §5 做(一句)

plan §5 寫「參數型別不變 ⇒ ACL 保留」。**實查五支簽章,全部沒有 `p_actor` / `p_request_id`**,
而 `admin_audit_log` 兩欄都是 `NOT NULL` + `CHECK(<> '')` ⇒ **一定得改參數**。
實測細節在 plan §10,**不在這裡重複**。

---

## §2 已經排除的兩條路(**不要再花時間評估**)

| 路 | 為什麼排除 | 依據 |
|---|---|---|
| **只加一個 `DEFAULT` 參數,不 DROP** | 產生兩支多載 ⇒ 舊呼叫端**當場 `is not unique` 呼不動**(具名參數,PostgREST 就是這樣呼) | plan §10.2,拋棄式 PG 17.10 實測 |
| **應用層自己寫稽核列(不同交易)** | 本 repo **每一支有稽核的寫入都是 RPC 同交易寫**(`apps/admin/src/lib/supplier-repository.ts:101` 逐字「稽核由 RPC 同交易寫,本層不碰」);且 **Sean 已拍 `Q-AUDIT-1b` = 甲「與其他七條線一致」** | plan §8 |

⇒ **唯一的路 = `DROP` 舊簽章 + 建新簽章(新參數給 `DEFAULT`)+ 重跑 REVOKE/GRANT。**

---

## §3 五支的舊 → 新簽章

| 函式 | 舊簽章 | 新增參數 | 現行體積 |
|---|---|---|---|
| `admin_create_shipment` | `(text, uuid, jsonb, text, text)` | `p_actor text DEFAULT NULL`, `p_request_id text DEFAULT NULL` | 113 行 |
| `admin_add_shipment_items` | `(text, uuid, jsonb)` | 同上 | **23 行**(薄封裝,真邏輯在 `pcm_b2_add_items_impl`) |
| `admin_mark_shipment_shipped` | `(text, uuid, text)` | 同上 | 119 行 |
| `admin_void_shipment` | `(text, uuid, text)` | 同上 | 94 行 |
| `admin_unvoid_shipment` | `(text, uuid)` | 同上 | 136 行 |

**合計 485 行**(`bash scripts/a2-extract-rpc-bodies.sh /tmp/a2bodies` 當場可重量)。

🔴 **不要手抄那 485 行。** 抄錯的地方會落在 plpgsql 的某一行 ——
**typecheck 不會紅、靜態檢查不會紅,只會在正式站的某條分支上行為變了。**
⇒ 用 `scripts/a2-extract-rpc-bodies.sh` 抽取(它會自我驗「抽出來的內容能在來源檔逐字找回」)。

---

## §4 migration 必須含的五件(缺任一就不算做完)

1. `DROP FUNCTION public.<f>(<舊簽章>);` —— **明寫舊簽章**。靠 `CREATE OR REPLACE` 蓋不掉它。
2. 新簽章;**新參數一律給 `DEFAULT`** —— 實測舊的具名呼叫(少送兩個參數)**會正常走到新版**。
3. 函式體 = 抽取出來的原文 + 一段 `INSERT INTO public.admin_audit_log`,
   **放在成功回傳之前、同一個 `BEGIN…END` 內**(同交易 ⇒ 缺筆不可能)。
   欄位比照 `20260716210000_m4a_admin_adjust_wallet_rpc.sql:134-144`。
4. `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;` **再** `GRANT EXECUTE … TO service_role;`
   🔴 順序是 REVOKE 先 —— `DROP` 之後 `proacl` 變 `NULL`,**PUBLIC 預設就有 EXECUTE**。
5. **收尾斷言**(見 §6)。

---

## §5 🔴 跨窗相依 —— 這是 A2 沒開工的真正原因

新參數要有值 ⇒ `apps/admin/src/lib/shipping/shipment-repository.ts` 得把 `actorId` / `requestId` 傳下去。
**2026-08-16 當時那支檔屬於另一個窗。**

主視窗裁定 **乙案**:等該檔歸屬定案,由**一個窗**把 migration + 應用層**一片做完**。
🔴 理由(比「比較好管」硬):**§2 第一列說的「不能有先後」是個技術事實** ——
甲案把「同時」變成靠兩個 session 協調維持的性質,而**窗會消失**(2026-08-16 一夜兩次)。

⇒ **接手的人:先確認你手上有沒有 `shipment-repository.ts`。沒有就不要開工。**
⇒ 這條線在等的是**一個檔案的歸屬**,不是某個窗。

---

## §6 驗收斷言(**這一段是本檔最容易被做錯的地方**)

```sql
-- ① 多載恰好 1 支 —— 沒清乾淨會變成 §2 第一列那個 is not unique
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = '<f>';        -- 必須 = 1

-- ② 🔴 驗 anon【不能】執行,不要驗 service_role 能執行
SELECT has_function_privilege('anon', 'public.<f>(<新簽章>)', 'EXECUTE');   -- 必須 = false
```

🔴 **為什麼第 ② 條要這樣寫**:
`has_function_privilege('service_role', …)` 在**收好權**與**權限全開**兩種世界**回同一個 `t`** ——
```
DROP 前（收好權）: proacl={postgres=X/postgres,service_role=X/postgres}   anon=f
DROP 後（沒補權）: proacl=(NULL)  service_role=t（看起來沒事）  🔴 anon=t
```
⇒ 拿 `service_role=t` 當驗收是**假綠**。
📎 命中 `~/.claude/rules/00-work-rules.md` §6-b 第 1 條:
**「這個檢查在【成立】與【不成立】兩個世界,會印不同的東西嗎?」**
📎 同一個陷阱的函式版寫在 `docs/patterns/revoking-function-execute-in-supabase.md` §3.6。

**還要有的**:每一支各跑一次成功路徑 ⇒ `admin_audit_log` **真的多一列**,且 `actor` 是傳進去的那個值
(不是 `NULL`、不是空字串 —— 兩個都會被 `CHECK` 擋,但**擋下來時整支 RPC 會失敗**,
⇒ **A1 的閘沒過就不該呼到這裡**,兩片的順序因此是硬的)。

---

## §7 rollback(plan §7 要求動手前寫好)

| 退什麼 | 怎麼退 |
|---|---|
| 函式 | 反向 migration:`DROP` 新簽章 → **用 `scripts/a2-extract-rpc-bodies.sh` 從【退版前的那顆 commit】抽舊定義**重建 → **重跑 REVOKE/GRANT** |
| 應用層 | `git revert` |
| 🔴 順序 | **不能只退一邊**(理由同 §2 第一列) |
| 已寫進去的稽核列 | **不刪**。表是 append-only(`service_role` 只有 INSERT),退版後那些列仍然有效 |

⚠️ 抽舊定義時要用 `git show <退版前 commit>:<檔>` 取當時內容 ——
**不要對現在的樹跑**,那會抽到已經改過的版本。

---

## §8 誠實揭露

- **本檔沒有產出任何 migration SQL。** 只有規格、抽取工具、驗收斷言與 rollback 計畫。
- 五支的**稽核 INSERT 該插在哪一行**(每支的「成功回傳」位置不同)**尚未逐支決定** ——
  那需要逐支讀完 body,是下一步的工作,不是已完成的。
- §6 的斷言**未在拋棄式 PG 上跑過**(沒有 migration 可跑);
  但它依據的兩個事實(多載會 `is not unique`、`DROP` 後 `anon=t`)**已實測**,見 plan §10。
