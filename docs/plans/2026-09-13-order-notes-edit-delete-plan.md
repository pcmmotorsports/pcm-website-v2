# Plan · 訂單備註要能「修改 / 刪除」(交辦 ④)

> **2026-09-13 A 窗寫。鐵則 8 的 plan,零實作** —— 本檔沒有任何 migration、沒有碰 `.sql`、沒有改一行碼。
> 需求來源:Sean 2026-09-14(交辦檔標的日期)追加,規格逐字在
> `~/pcm-mailbox/0912-後台UX/交辦-會員等級字面統一.md` **④**。
> 主視窗 `pcm-website-v2-4f` 2026-09-13 派工,明文「今晚只寫 plan、不要實作、不要端題給 Sean」。
> 基準 `f06dffbec`(= origin/dev)。

---

## 0. 一句話

備註今天**只能新增、不能改也不能刪**;要做「修改」與「刪除」,
**修改沿用既有的更正鏈**(放寬「一筆只能被更正一次」)、**刪除做軟刪除**(不真的刪列)。
兩件都要動 RPC 與資料表 ⇒ **命中鐵則 8,等 Sean 批才動手**。

---

## 1. 現況(我親自開檔核過,每條附檔:行)

### 1.1 寫入只有一支 RPC,而且它只會 INSERT

`supabase/migrations/20260802150000_m4b_e10_a6_admin_append_order_note.sql`

- 檔頭 `:13-14` 逐字:
  > 唯一動作 = 單列 INSERT(append-only 的 writer 面):
  > 不做 UPDATE / DELETE;更正 = 再 append 一筆帶 `p_corrects_note_id` 的新列(A3 更正鏈)。
- 函式 `:81` `CREATE FUNCTION public.admin_append_order_note(...)`,`SECURITY DEFINER`、
  `SET search_path = public, pg_temp`,回傳 **14 個固定碼**(`:16-20`)。
- 本體唯一一句寫 `order_notes` 是 `:180` 的單列 `INSERT`,緊接 `:198` 同交易寫 `admin_audit_log`
  (`action = 'order_note.append'`)。
- `:221-223` `REVOKE ALL` 後只 `GRANT EXECUTE` 給 `service_role`。
- **全 repo 只有這一支 note RPC** ——
  `grep -rln "admin_.*note" supabase/migrations/` 命中 7 檔,其中只有 `20260802150000` 那支是 note 的定義點;
  `bash scripts/latest-definition-of.sh admin_append_order_note` 回 **共 1 代 / 1 個定義點**,newest = live = `20260802150000`。
  ⚠️ 那支工具自己印的射程:`live` 欄讀的是帳本 `supabase/APPLIED.tsv`,**不是正式庫**。

### 1.2 表本身:`order_notes` 沒有任何刪除欄位

`supabase/migrations/20260729030000_m4b_e10_a3_order_notes.sql:41` 起。
正式庫實查(見 §2)現有 **9 欄**:
`id / order_id / note_type / body / channel / occurred_at / author / corrects_note_id / created_at`
⇒ **沒有 `deleted_at`、沒有 `deleted_by`、沒有 `updated_at`**。

該檔 `:22-25` 逐字寫著這張表的誠實邊界:
> 寫入唯一入口是 A6 這支 owner RPC(它只做 INSERT)。
> ⚠️ 誠實邊界:**table owner 與 superuser 仍可直接改** …
> ⇒ 本片不宣稱「物理不可改」,只宣稱「應用路徑改不到」。

`:65-66` 的 `corrects_note_id`:非 NULL = 這筆是用來更正它指到的那一筆,舊列保留。
`:79` 有複合 FK `order_notes_corrects_same_order_fk`,**擋掉跨單更正**。

### 1.3 「一筆最多被更正一次」擋在兩層

- **DB 層**:RPC `:177`
  `IF EXISTS (SELECT 1 FROM public.order_notes WHERE corrects_note_id = p_corrects_note_id) THEN RETURN 'ALREADY_CORRECTED';`
- **UI 層**:`apps/admin/src/components/orders/notes-timeline.tsx:72-90`
  已被更正的那列的「更正」鈕 `disabled`,`title='已被更正,一筆只能更正一次'`。
- 規則的**單一真相**在 lib:`apps/admin/src/lib/orders/note-timeline.ts:99`
  `export function canCorrectNote(note) { return !note.corrected; }`
  (`:96-98` 逐字說明為什麼不讓時間軸與表單各寫一份)。
- `corrected` 不是 DB 欄,是讀取端算的:
  `packages/adapters/src/supabase/mappers/order-notes.ts:90,106`
  —— `correctedIds = 所有出現在 corrects_note_id 的 id 集合`,`corrected: correctedIds.has(row.id)`。

### 1.4 已經存在、而交辦檔沒提到的東西 —— **更正鏈 walker 早就寫好了**

`apps/admin/src/lib/orders/note-timeline.ts:197-241` 有 `walkCorrectionChain()`,
回傳 `stop: 'end' | 'missing' | 'cycle' | 'depth'`,docstring `:205-211` 逐字:

> 🔴 環在**應用路徑構造不出來**(A6 RPC 單列 INSERT),但在 DB 層實測可達
> (owner 單一多列 INSERT 互指,建表檔 `:186-195`)⇒ 顯示層不得假設鏈會終止:
> visited 集合保證終止並把環**顯性回報**(cycle = 資料腐壞訊號,UI 要顯示異常、不是靜默截短)。

📌 **這一格直接關掉本 plan 的風險 ①(見 §6.1)**:放寬成可連續更正之後,
鏈會變長,而**能安全走訪任意長度鏈、還會把環顯性回報的函式已經在 repo 裡了**。

### 1.5 現有的不可撤回告知文案(要改字面必須先問 Sean)

`apps/admin/src/lib/orders/note-timeline.ts:48-50`,`CORRECTION_IRREVOCABLE_NOTICE`,
docstring `:44-47` 逐字:「字面已定稿(Sean 2026-08-03 拍 A 照現字面);**改字面前先問 Sean**,
語意三件事不可刪:①不可撤回 ②更正的更正不會讓最早那筆復活 ③誤更正有效告知的唯一還原路徑 = 重登一筆新的『已告知客人』紀錄」。

⇒ **②「更正的更正不會讓最早那筆復活」在放寬連續更正之後仍然為真**,那句話不必改。

---

## 2. 正式庫現況(唯讀實查,2026-09-13)

用 `bash scripts/readonly-prod-sql.sh`(唯讀、不印連線字串)跑的,rc=0:

| 量的東西 | 值 |
|---|---|
| `order_notes` 總列數 | **0** |
| 其中更正列(`corrects_note_id IS NOT NULL`) | 0 |
| 被更正的不同列數 | 0 |
| 涉及訂單數 | 0 |
| 同一列被更正兩次以上的 | 0 筆 |
| 最長更正鏈 | 0 節 |
| `note_type` 分布 | (無列) |
| 現有欄位 | 上面 §1.2 那 9 欄 |

### 🔴 這個 0 對本 plan 的意義,以及它**不是**什麼

- ✅ **意義**:本次不需要資料遷移、不需要回填、不需要為既有列決定 `deleted_at` 預設值。
  「加欄位會不會動到既有資料」這個問題在今天**沒有分母**。
- 🛑 **它不是**「這功能沒人用」的證據 —— 後台備註功能今天還沒有被員工用起來,
  而 Sean 要的正是把它做到可用。**0 列只說明改動風險低,不說明需求不存在。**
- 🛑 **它也不是**「未來也會是 0」—— plan 的設計不能建立在資料永遠很少上面。

### ⚠️ 一格我量不到、必須講清楚的

第 6 段我查 `information_schema.role_table_grants` 想核 service_role 對 `order_notes` 的權限,
**只回了一列 `pcm_readonly | SELECT`**。
那**不代表 service_role 沒有權限** —— `information_schema` 只顯示「與當前角色有關」的授權列,
`pcm_readonly` 看不到別的角色的 grant。
⇒ **「service_role 只有 SELECT / INSERT」這句我採信的是建表檔 `:19,22`,不是我親測的。**
真要核,得用 owner 身分查 `pg_class.relacl`,那不在本次唯讀授權範圍內。

---

## 3. 改什麼

### 3.1 修改 —— 放寬「一筆只能被更正一次」

**不加 UPDATE。** 沿用既有更正鏈,只拿掉那道「已被更正就不能再更正」的閘。

| 層 | 現在 | 改成 |
|---|---|---|
| RPC `20260802150000:177` | `ALREADY_CORRECTED` 擋住 | **移除該檢查**。⚠️ 固定碼從 14 碼變 13 碼 |
| lib `note-timeline.ts:99` | `canCorrectNote = !note.corrected` | `canCorrectNote = () => true`(或直接刪掉這個概念) |
| UI `notes-timeline.tsx:72-90` | 已更正那列的鈕 disabled + title | 鈕一律可按;「已更正(由 #n)」badge **保留**(它講的是事實,不是禁令) |

🔴 **`ALREADY_CORRECTED` 不能只是「不再回傳」就算數** —— 檔頭 `:16-20` 與
`COMMENT ON FUNCTION`(`:203` 起)都逐字列著 14 碼全集,而呼叫端
`A9d2-1` 的合約是「必須斷言回傳值 ∈ 全集,未知碼 = 呼叫端 bug」。

**我 grep 過了,那個碼住在這八處,移碼要一次改完:**

| 檔:行 | 是什麼 |
|---|---|
| `supabase/migrations/20260802150000_…:177` | 本體那個 `IF EXISTS … RETURN` |
| 同檔 `:19` | 檔頭 14 碼清單 |
| 同檔 `:207` 附近 | `COMMENT ON FUNCTION` 裡的 14 碼字串 |
| `apps/admin/src/lib/orders/note-repository.ts:32` | 呼叫端的**碼全集陣列**(未知碼 = bug 的那道斷言就靠它) |
| `apps/admin/src/lib/orders/note-action-state.ts:87,116` | 型別聯集 + 中文訊息「一筆只能更正一次」 |
| `apps/admin/src/lib/orders/note-actions.ts:72` | `switch` 的一個 `case` |
| `packages/adapters/src/supabase/database.types.ts:433` | 型別檔裡那份**註解**複本 |
| `apps/admin/src/components/orders/order-detail.tsx:79` | 註解:「RPC 端 `ALREADY_CORRECTED` 為第二道」 |

⚠️ **「改了一半而全綠」在這裡有兩個現成入口**:`COMMENT ON FUNCTION` 與
`database.types.ts:433` 那份**都是註解**,少改不會有任何測試紅,
而下一個人抄註解寫呼叫端 ⇒ 斷言一個永遠不會出現的碼。

### 3.2 刪除 —— 軟刪除,不真的 DELETE

**加三欄 + 一支新 RPC。**

```
order_notes 新增:
  deleted_at     timestamptz  NULL
  deleted_by     text         NULL    -- staff slug,鏡像 author 的 ^[a-z0-9_]{1,64}$
  deleted_reason text         NULL    -- 必填與否 = 待 Sean 裁,見 §6.4
  CONSTRAINT:三欄同生同滅(要嘛全 NULL、要嘛 deleted_at 與 deleted_by 都非 NULL)
```

新 RPC `admin_soft_delete_order_note(p_note_id, p_order_id, p_reason, p_actor, p_request_id)`:
- 形狀**抄 `admin_append_order_note`**,不自己發明一套:`SECURITY DEFINER` +
  `SET search_path = public, pg_temp` + 固定碼回傳 + 同交易寫 `admin_audit_log`
  (`action = 'order_note.soft_delete'`)+ `REVOKE ALL` 後只 `GRANT EXECUTE` 給 `service_role`。
- 鎖序照抄:先 `PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE`,再動 note 列
  (同向、無反向持有者 —— 這句在原 RPC 的 COMMENT 裡)。
- **冪等**:同 `request_id` 重送 ⇒ `DUPLICATE_REQUEST`;已經是刪除狀態再刪 ⇒ `ALREADY_DELETED`,
  **不覆寫** `deleted_at` / `deleted_by`(否則「誰刪的」會被第二個人蓋掉)。

讀取端:
- `SupabaseOrderAdapter.ts:557` 的 `ORDER_LIST_SELECT` 內嵌 `order_notes(...)` **要加這三欄**,
  否則 mapper 拿不到 ⇒ 畫面永遠當它沒被刪(而且不會有任何東西叫)。
- mapper `mappers/order-notes.ts` 加 `deleted: boolean` 等欄位到 `AdminOrderNote`。
- `note-timeline.ts` 的 `NoteTimelineEntry` 加對應欄;時間軸印
  **「這則已刪除(理由)」而不是整列消失**。

權限:刪除限 **manager**,走既有 `authorizeManagerMutation()`。

---

## 4. 為什麼是這兩條路(以及否決了什麼)

### 4.1 修改為什麼不加 UPDATE

- `order_notes` 建表檔 `:19,22` 把「service_role 沒有 UPDATE/DELETE 權、寫入唯一入口是 owner RPC」
  當成這張表的**設計前提**。加 UPDATE = 動那個前提,而它護的是**告知義務的證據鏈**
  (`:14` 逐字:「將來要回答『我們到底有沒有通知客人他的貨要等』」)。
- 沿用更正鏈 ⇒ **每一版原文都還在表上**,稽核天然完整,不需要另建版本表。
- 成本比較:放寬 = **刪一個 IF**;加 UPDATE = 新 RPC + 新稽核形狀 + 版本保存機制。
  ⇒ 更少的碼、更強的稽核,沒有理由選另一條。

### 4.2 刪除為什麼是軟刪除

- 交辦檔 ④ 的理由逐字:「備註是對客人的承諾紀錄,真刪掉之後對帳與客訴就查不到了」。
- 而**硬刪除還有一個交辦檔沒寫的技術後果**:`corrects_note_id` 指向被刪的列
  ⇒ `walkCorrectionChain` 會回 `stop: 'missing'`,而 `missing` 在現行語意裡是
  **「指向不在已載入範圍」= 資料截斷訊號**(`note-timeline.ts:201`)。
  ⇒ 硬刪會讓「正常的刪除」與「資料載入不全」印同一個狀態。
  **軟刪除不會製造這個歧義。**

### 4.3 為什麼刪除限 manager、修改不限

- 修改不會讓任何事實消失(舊列還在時間軸上)⇒ 任何員工都可以。
- 刪除會讓一則承諾紀錄從**日常視野**消失(即使資料還在)⇒ 提高門檻。
- 而這是**建議、不是拍板** —— Sean 沒說過刪除要限誰,交辦檔寫的是「建議限 manager」。
  📌 若 Sean 覺得太嚴,降成一般員工只要改 `authorizeManagerMutation()` → `authorizeAdminMutation()` 一行。

---

## 5. 影響

| 面 | 影響 |
|---|---|
| **既有資料** | **零**。正式庫 `order_notes` 0 列(§2 實查)⇒ 沒有回填、沒有遷移 |
| **客人** | **零**。`order_notes` 是內部資料,`SupabaseOrderAdapter.ts:405-406` 逐字「只走 service_role」「一個 byte 都不能放 orders」 |
| **員工** | 時間軸多一個刪除入口(manager 才看得到);已更正的列可以再更正 |
| **稽核** | 多一個 `action = 'order_note.soft_delete'`;稽核檢視器若有 action 白名單要加 |
| **錢 / 權限** | 不碰金額、不碰 RLS policy。**但碰 GRANT 與 SECURITY DEFINER** ⇒ 命中鐵則 12⑥ |
| **鐵則** | **8**(動 schema / RPC ⇒ 先寫 plan 等批,就是本檔)+ **12**(權限 / migration ⇒ commit 前 codex 唯讀審) |

### 🔴 兩個「改了一半而全綠」的形狀,實作時必踩

1. **`ORDER_LIST_SELECT` 沒加新欄** —— 那是一條寫死的字串(`SupabaseOrderAdapter.ts:557`),
   漏了它 ⇒ mapper 讀到 `undefined` ⇒ 畫面永遠當沒刪 ⇒ **typecheck / lint / 測試全綠**。
2. **`COMMENT ON FUNCTION` 沒跟著改** —— 碼表少一碼而註解還寫 14 碼,
   下一個人抄註解寫呼叫端 ⇒ 斷言全集時多一個永遠不會出現的碼。**沒有任何閘會叫。**

---

## 6. 主視窗點名的四格

### 6.1 連續更正會不會長出環 / 無限鏈?第 3 版以後怎麼呈現?

**環:應用路徑構造不出來,而 DB 層可達 —— 而這件事 repo 早就處理過了。**

- 構造不出來的理由:RPC 一次只 INSERT 一列,新列的 `corrects_note_id` 只能指**已存在**的列
  ⇒ 永遠是「新指舊」,方向單一 ⇒ 應用路徑上不可能成環。
  ⚠️ 放寬「只能被更正一次」**不改變這一點** —— 它放寬的是**入度**,不是方向。
- DB 層可達:建表檔 `:186-195` 記著 owner 用單一多列 INSERT 可以互指。
- ⇒ 顯示層已經有 `walkCorrectionChain()`(§1.4),`visited` 集合保證終止,
  撞環回 `stop: 'cycle'` **顯性回報**。**本 plan 不需要新增任何防環機制。**

**無限鏈:長度上限 = 該單的備註數,而備註數本來就有上限。**
`packages/adapters/src/supabase/mappers/order-notes.ts:35`
`export const ORDER_NOTES_EMBED_LIMIT = 200`(`SupabaseOrderAdapter.ts:1461` 顯式夾它)
⇒ 鏈長 < 載入的 notes 數 ≤ 200 ⇒ 有界。
⚠️ 而 `order-notes.ts:109` 的 `notesTruncated = rows.length >= 200` 表示**載滿就是截斷訊號** ——
連續更正會讓單張訂單的 note 列數變多,**逼近 200 的速度比現在快**。
📌 那不是本 plan 要修的,但要寫下來:**一張單的備註爆過 200 之後,時間軸看到的是截斷後的集合**,
而 `walkCorrectionChain` 對截斷的反應是 `stop: 'missing'`。

**第 3 版以後怎麼呈現 —— 這是本 plan 唯一需要新增的 UI 決定:**

現在的 badge 是 `已更正(由 #n)` 與 `更正 → #m`,兩兩成對。
連續更正之後同一則會有多版,建議:

- 時間軸**仍然一列一則**(不折疊),每一列照舊標「已更正(由 #n)」——
  n 是**直接**更正它的那一列,不是最新版。這與 `correctedBySeq` 現行語意一致
  (`note-timeline.ts:130`:`correctorSeqByTargetId` 記的是直接指向者)。
- 最新那一版**沒有**「已更正」badge ⇒ 它就是現行有效值。**這個規則不用改就已經成立。**
- 🔵 **建議加一格、但不是必要**:在最新版那列印「第 k 版(共 k 版)」,k 從 `walkCorrectionChain` 算。
  ⚠️ 這是新的 UI 元素 ⇒ 依鐵則 1 要先 grep `design-reference/` 有沒有稿,**本 plan 不預設做**。

### 6.2 軟刪除之後要不要在 UI 上告訴員工「刪了還查得到」?

**要,而且理由不是貼心,是防止他用錯工具。**

一個以為「刪除 = 消失」的員工,會把刪除當成「講錯話的橡皮擦」;
而實際上那句話**永遠留在稽核與資料表裡**。
⇒ 他在不知情下做了一個**留痕**的動作,而畫面讓他以為那是**不留痕**的。
📌 這與 `CORRECTION_IRREVOCABLE_NOTICE`(§1.5)是同一種東西:
**repo 已經為「更正」寫過一句這樣的話,刪除沒有理由不寫。**

建議文案方向(**字面待 Sean 定,不自己拍**,對照 §1.5 那句的拍板慣例):
> 刪除只會把它從時間軸的日常視野收起來,**內容與稽核紀錄仍然保留、事後查得到**。

⇒ 寫進 `note-timeline.ts` 當一個具名常數(與 `CORRECTION_IRREVOCABLE_NOTICE` 並列),
不要散在元件裡。

### 6.3 manager 限制怎麼驗 —— 🔴 交辦檔那句話已經過期

交辦檔 ④ 逐字寫 `authorizeManagerMutation` 現在「只用在員工管理與死信重排」。
**我 grep 了,那句話少算一處:**

| 檔:行 | 用途 |
|---|---|
| `apps/admin/src/lib/staff-actions.ts:120,175,240` | 員工管理(交辦檔有) |
| `apps/admin/src/lib/mail/dead-letter-actions.ts:46` | 死信重排(交辦檔有) |
| `apps/admin/src/lib/orders/manual-cancel-notice-actions.ts:70,211,356` | **人工取消通知 —— 交辦檔沒提** |

而 `manual-cancel-notice-actions.ts:69` 的註解逐字寫著它**就是照抄 `dead-letter-actions.ts:46`** 那條路
⇒ 本 plan 也照抄同一條,已經有兩個先例、不是新路。

**它現在長怎樣**(`apps/admin/src/lib/session/authorize.ts:99-107`,我開檔核過):

```ts
export async function authorizeManagerMutation(): Promise<{ sid: string; actorId: string } | null> {
  const base = await authorizeAdminMutation();
  if (!base) return null;
  if (!(await isActiveManager(base.actorId))) return null;
  return base;
}
```

🔴 **而那支檔自己記著一個天花板,本 plan 要原樣帶著、不放寬**
(`authorize.ts` 該函式上方 docstring 逐字):
> 📌 **有人把那顆 env 拿掉的那一天,這道閘會安靜地退化成裝飾,而三綠全綠。**

⇒ 講的是 `ADMIN_REQUIRE_REAL_IDENTITY`,而且該 env 在 Vercel 是 `Secret` 型、
**連 Sean 本人也讀不到它的值**,只查得到「存不存在」。
📌 **所以「刪除限 manager」這個宣稱的強度,上限就是那顆 env 的強度,不會更高。**
本 plan 不假裝它是硬閘。

**怎麼驗(三格,缺一不可):**
1. 正對照:manager 身分 ⇒ 刪得掉,`order_notes.deleted_at` 非 NULL 且 `admin_audit_log` 恰一列。
2. 負對照:非 manager 身分 ⇒ 被拒,且 **DB 零改動**(不是只看畫面有沒有紅字)。
3. 🔴 UI 負對照:非 manager **看不到刪除入口**,而且**看不到 ≠ 擋得住** ——
   兩件事都要驗,server 那道才是真的閘(`staff-edit-row.tsx:30` 逐字記過同一課)。

### 6.4 待 Sean 答的一格(**今晚不問**)

```
Q: 刪除備註要不要「理由必填」?
A: 甲｜必填 —— 對帳與客訴時看得到「為什麼刪」,而刪除本來就該是少見動作
   乙｜選填 —— 少一個攔路欄,員工比較會用
```
交辦檔 ④ 寫的是「軟刪除(`deleted_at` + `deleted_by` + 原因)」,**沒有說必填**。
⇒ 本 plan **不自己決定**;實作前要有他的答案,因為那決定 DB CHECK 要不要加
(必填 ⇒ `deleted_reason` 非空是約束,事後再加約束會撞到既有列)。

---

## 7. Rollback

分兩段,因為兩件事的可逆程度**不一樣**,不要混在一起講。

### 7.1 修改(放寬連續更正)—— 幾乎全可逆

| 動作 | 回退 |
|---|---|
| RPC 移除 `ALREADY_CORRECTED` 檢查 | `CREATE OR REPLACE` 貼回舊版本體。⚠️ 照 `docs/patterns/` 那條:**`CREATE OR REPLACE` 會把 `SET` 子句整組換掉** ⇒ rollback 腳本必須把 `SET search_path` 一起帶回,不能只貼本體 |
| lib / UI | `git revert` |
| **不可逆的殘留** | 放寬期間**已經產生的第 2 層以上更正列**。它們不會消失,而舊 RPC 也不會拒絕它們的存在(舊閘只擋**新增**,不擋既有) ⇒ 退版後那些鏈仍然顯示得出來,只是不能再往下接。**沒有資料損壞,只是有一批鏈比舊規則允許的長。** |

### 7.2 刪除(軟刪除)—— 欄位不回退

| 動作 | 回退 |
|---|---|
| 新 RPC `admin_soft_delete_order_note` | `DROP FUNCTION`(+ 對應 `REVOKE`)。乾淨 |
| 讀取端(SELECT 字串 / mapper / UI) | `git revert` |
| **三個新欄位** | 🔴 **不 DROP COLUMN**。理由:退版時若已經有列被軟刪過,DROP 會**真的刪掉「誰在何時刪了它、理由是什麼」這份紀錄** —— 那正是軟刪除當初要保住的東西。⇒ 退版 = 停用寫入路徑 + 讀取端當它不存在,欄位留著 |
| 已軟刪的列 | 退版後 `deleted_at` 仍非 NULL 而讀取端不再看它 ⇒ **那幾則會重新出現在時間軸上**。這是退版的已知後果,要寫進 runbook 讓執行的人先知道,不要當成 bug |

### 7.3 前置閘(貼 migration 之前要斷言的)

1. 現行 `admin_append_order_note` 的定義指紋與 `20260802150000` 相符
   (否則正式庫跑的不是我以為的那一版,`latest-definition-of.sh` 自己印過這條射程)。
2. `order_notes` 沒有 `deleted_at` / `deleted_by` / `deleted_reason` 三欄(避免重貼)。
3. 貼完:`prosecdef = true`、`proconfig` 有 `search_path=public, pg_temp`、
   ACL 只有 `service_role` 有 EXECUTE ——照 `docs/patterns/revoking-function-execute-in-supabase.md`。

---

## 8. 驗收(Sean 自己開瀏覽器走一遍才算做完)

1. 同一則備註**連續更正兩次以上**,時間軸上**每一版原文都看得到**,最新那版沒有「已更正」badge。
2. manager 刪掉一則 ⇒ 時間軸印「這則已刪除(理由)」,**整列不消失**。
3. 非 manager **看不到刪除入口**;就算繞過 UI 直送,**DB 零改動**。
4. 同一個 `request_id` 重送刪除 ⇒ 不新增稽核列、`deleted_by` 不被第二個人蓋掉。
5. 三綠 + 鐵則 12 codex 唯讀審(碰 GRANT / SECURITY DEFINER / migration)。

---

## 9. 本 plan 的射程 —— 沒做什麼、不宣稱什麼

- 🛑 **零實作**:沒有 migration 檔、沒碰任何 `.sql`、沒改一行 `.ts` / `.tsx`。
- 🛑 **`ALREADY_CORRECTED` 那八處我是 grep 出來的**(§3.1 的表),
  **沒有逐處開檔確認每一處的上下文** —— 實作時仍要一處一處看,尤其那兩份註解複本。
- 🛑 **service_role 對 `order_notes` 的實際 GRANT 我沒有親測**(§2 那格),
  採信的是建表檔的字面。
- 🛑 **`walkCorrectionChain` 我讀了碼、沒有跑過它**;「環會被顯性回報」是讀 docstring + 讀實作得到的,
  吻合而未實測。
- 🛑 **第 3 版以後的 UI 呈現是我的建議,不是 Sean 拍的**;若他要看實體版本,那要另外出稿(鐵則 1)。
- 🛑 **「刪除理由必填與否」沒有答案**(§6.4),那一格擋著實作。

— END —
