# Q-AUDIT-1 plan · 出貨線補稽核 + 補授權閘

> ## ⛔⛔ 讀這份 plan 之前先讀這段(2026-08-16 開工前實查)
>
> **§5 的「參數型別不變 ⇒ ACL 保留」這個前提,已於 2026-08-16 A2 開工前被實查推翻。**
> **Sean 批准的是一份【前提錯誤】的 plan** —— 批准本身有效(要做的事沒變),
> 但 **A2 的做法必須照 §10,不能照 §5**。
>
> 三個發現(全文在 §10,**這裡只給結論**):
> 1. 五支 RPC **都沒有 `p_actor` / `p_request_id`**,而稽核表兩欄 `NOT NULL` ⇒ **一定得改參數**。
> 2. 只加一個 `DEFAULT` 參數 ⇒ 舊呼叫端 **當場 `is not unique` 呼不動**(不是靜默退化)
>    ⇒ **migration 與應用層不能有先後,只能同時**。
> 3. `DROP` + 重建會讓 `proacl` 變 `NULL` ⇒ **`anon` 拿到 EXECUTE**,
>    而 `has_function_privilege('service_role',…)` 在收好權與全開兩種世界**回同一個 `t`**
>    ⇒ **驗收要驗 `anon` 回 `f`**。
>
> 🔴 **A2 尚未開工。** 它含一個跨窗相依(`shipment-repository.ts`),主視窗 2026-08-16 裁定**乙案**
> (等該檔交回,由**一個窗**一片做完),理由=「不能有先後」的東西不該靠兩個 session 的協調維持。


> ## ✅ **Sean 2026-08-16 已批(鐵則 8 過)。逐字:**
> ```
> Q-AUDIT-1p  可以
> Q-AUDIT-1a  甲 可以，被擋是對的
> Q-AUDIT-1b  甲 跟其他七條線一樣就好
> ```
> 🔴 **批准逐字寫在這裡,不是只留在訊息裡** —— 2026-08-16 當日已有兩份 plan 犯過
> 「檔頭寫著『尚未批准』而 Sean 早就批了」。**訊息不是載體。**
>
> **`Q-AUDIT-1a`=甲 的落地含意(不要軟化)**:**沒選身分就被擋,連 Sean 自己測試也一樣。**
> ⚠️ **不得留任何 bypass。** 若實作時發現非留不可(某個既有流程會斷),
> **停下來回報,不要自己開一個口。**
>
> **狀態:plan 已批,實作未開始。零 code。**
> **鐵則 12 命中 ②權限 + ③DB 結構** ⇒ commit 前對抗審查不降級。
> 來源:E 窗 `docs/security/2026-08-16-security-audit-run1-phase2-hunt.md` §6.2(**讀原文,不用轉述**)。
> 寫於 2026-08-16 · B 窗。**每個數字都附量法。**

---

## §1 要改什麼(一句)

**出貨線是唯一一條【應用層沒有具名 actor 綁定、DB 層也沒有稽核列】的業務線。** 兩層一起補。

---

## §2 為什麼(缺口的實際長相,已實查)

### 2.1 應用層:15 / 28

```bash
git grep -ln "await authorizeAdminMutation" -- 'apps/admin/src/lib/**/*.ts' | grep -v test | wc -l   # 15
git grep -ln "'use server'"                 -- 'apps/admin/src/lib/**/*.ts'            | wc -l   # 28
```
`apps/admin/src/lib/shipping/shipment-actions.ts`(245 行)**不在那 15 支裡**。

### 2.2 DB 層:五支 RPC 零稽核列(E 窗量的,我照引不重量)

| RPC | 同交易寫 `admin_audit_log`? |
|---|---|
| `admin_create_shipment` / `admin_add_shipment_items` | **0** |
| `admin_mark_shipment_shipped` | **0** |
| `admin_void_shipment` / `admin_unvoid_shipment` | **0** |
| **控制組** `admin_adjust_wallet` | ✅ 同一量法命中 **5** ⇒ **量法是活的** |

### 2.3 🔴 這不是權限漏洞,不要抬高

- 存取控制**沒有失守**(`proxy.ts` 擋未登入;`admin_*` 對 anon/authenticated 皆 0)
- 它**不讓任何人做到原本做不到的事**

**它拿走的是【事後查得出來】這件事。**
⇒ 「**誰把那筆出貨作廢的**」——**今天沒有任何地方答得出來**,而隔壁七條線都答得出來。

### 2.4 而正反兩個方向都空著

`void` / `unvoid`、`create` / `add_items` 成對存在,**兩個方向都沒有稽核列**
⇒ **反向操作不會留下「曾經被反向過」的痕跡。**
📎 同族形狀:**擋住一個方向、另一個方向敞著**(我這條線今晚踩過三次)。
**差別是這裡不是權限敞著,是【紀錄兩邊都空著】。**

---

## §3 🔴 兩件必須一起做(這是本 plan 最重要的一句)

> **只補稽核列、不補閘 ⇒ 把稽核列寫進一個「沒有人」。**

`authorizeAdminMutation()` 回傳 `{ sid, actorId }`(`apps/admin/src/lib/session/authorize.ts:24-35`)
—— **`actorId` 正是稽核列要記的那個值。** 沒有閘就沒有那個值。

⇒ **拆片時不得把「補閘」與「補稽核」拆到不同片**,否則中間態是「有稽核列但記的是空的/假的」。

---

## §4 🔴 與真登入線的關係 —— 一個順序判斷,我判「現在做」

**現況**:`authorizeAdminMutation` 的 `actorId` 來自 `getSessionActor()`,
而**那是使用者自己從下拉挑的、系統不驗證**
(`apps/admin/src/lib/session/actor.ts` 自陳「這不是登入 / 授權邊界」)。

⇒ **現在補上去的稽核列,記的是一個【未經驗證的自選身分】。**

**兩案:**
| | 現在做 | 等真登入線上線後做 |
|---|---|---|
| 稽核列的可信度 | 與**其他七條線一樣**(它們也是自選身分) | 高 |
| 缺口持續時間 | 短 | 🔴 **長 —— 而真登入線還卡在 apply** |
| 上線後 | **自動升級**(閘與稽核列不變,只是 `actorId` 變成真的) | — |

**⇒ 我判「現在做」。理由一句話:**
**它讓出貨線與其他七條線【一致】,而不是讓它變好或變壞** ——
而真登入線一上線,**這片不用改一行,可信度自動跟著升。**

⚠️ **但驗收文案不得寫「現在可以查出是誰做的」** —— 只能寫
「**現在有紀錄了;那個紀錄記的是誰,取決於真登入線**」。

---

## §5 預期影響面

| 動到 | 什麼 | 風險 |
|---|---|---|
| `apps/admin/src/lib/shipping/shipment-actions.ts` | 4 支寫入 action 加閘 | 🔴 **加閘會讓「沒有身分」的呼叫變成失敗** —— 而後台目前**未啟用、只有 Sean 在測**,他測時若沒選身分就會被擋 |
| **5 支 RPC 的 migration** | 各補一段寫 `admin_audit_log` | 🔴 **鐵則 12 ③** —— 改既有函式。~~**參數型別不變 ⇒ ACL 保留**~~ **⛔ 這個前提 2026-08-16 實測被證偽,見 §10** |
| `shipment-actions.ts` 的測試 | 4 支各補「無閘 ⇒ 被擋」的負測 | — |

**不動**:`fetchShipmentCandidates`(**唯讀**,不需要閘也不需要稽核列)。
⇒ **五支 export 裡只有四支是寫入** —— 這個區分要寫進片的驗收,免得有人「順手」把讀取也加閘。

---

## §6 拆片(每片 15-45 分鐘,鐵則 4)

| 片 | 做什麼 | 為什麼是這個邊界 |
|---|---|---|
| **A1** | 4 支 action 加 `authorizeAdminMutation` + 4 支負測 | 純應用層,不動 DB ⇒ **可以先驗、先收** |
| **A2** | 5 支 RPC 各補稽核列(一支 migration) | 動 DB ⇒ 鐵則 12 ③,要對抗審查 + Sean 在場 apply |
| **A3** | 端對端:每一種操作各做一次,驗稽核列真的長出來 | **這片才是「做完了」的證據** —— A1/A2 各自綠不代表串起來對 |

🔴 **A1 → A2 順序是硬的**:先有閘才有 `actorId`,A2 的稽核列才有東西可寫。
⚠️ **而 A1 單獨上線是安全的**(只是多一道檢查);**A2 單獨上線不安全**(寫進沒有人)。

---

## §7 rollback

| 片 | 怎麼退 |
|---|---|
| A1 | `git revert` —— 純應用層,**完全可逆** |
| A2 | 🔴 **改既有函式 ⇒ 要一支反向 migration 把函式改回去**,`git revert` 不會動到已 apply 的 DB |
| A3 | 無產物,不需要退 |

⚠️ **A2 的 rollback 要在動手前寫好**,不是出事再寫 —— 那時人是急的。

---

## §8 ~~未決 / 待 Sean 拍~~ **✅ 兩題皆已拍(2026-08-16),原文保留供對照**

> **`Q-AUDIT-1a` = 甲(被擋是對的)、`Q-AUDIT-1b` = 甲(與其他七條線一致)。**
> ⇒ **兩題都採用我原本的推薦,規格不改。**
> 🔴 **`1a` 的落地含意**:**不得留任何 bypass**,連 Sean 自己測試也一樣被擋。
> 實作時若發現非留不可 ⇒ **停下回報,不自己開口。**

### 🔴 併記一條生效的驗收條款(主視窗轉給 Sean、他沒有反對)

> **文案不得寫「現在可以查出是誰做的」,只能寫
> 「現在有紀錄了;記的是誰,取決於真登入線」。**

⇒ **這條寫進 A1/A2/A3 三片的驗收清單**,不是只寫在這裡。
**它擋的是未來某個人拿這片當「已經查得到」的證據。**

---

### 原題(保留,因為選項與代價仍是後續引用的依據)

```
Q-AUDIT-1a：加閘之後，你自己測試時若沒選身分會被擋。可以嗎？
  甲｜可以，被擋是對的（推薦）
     那正是這道閘的目的。你測試時先在下拉選身分即可。
  乙｜先不要擋，只記錄
     🔴 代價：那就不是閘，是一行 log —— 而「有閘」這件事會被寫進報告。

Q-AUDIT-1b：稽核列要記多細？
  甲｜與其他七條線一致（actor / action / target / before / after / reason）（推薦）
  乙｜只記 actor + action
     🔴 代價：出事時查得到「有人動過」，查不到「動成什麼樣」。
```

**我推薦 甲 + 甲。** 理由:**這片的價值是「與其他線一致」,而不是「另外發明一套」。**

---

## §9 誠實揭露

1. **§2.2 那張表是 E 窗量的,我沒重量。** 我讀了它的原文與量法(`grep -c 'admin_audit_log' <定義檔>` + 控制組 5 次)
   ⇒ **量法看起來是對的,但我沒有自己跑一次。**
2. **§4 那個「自動升級」的宣稱未驗** —— 它假設真登入線不會改 `authorizeAdminMutation` 的回傳形狀。
   ⚠️ 我這條線的 `B3` 規格**確實會動 session payload** ⇒ **這條要在 B3 動手時回頭確認。**
3. **本 plan 尚未經對抗審查。**


---

## §10 ⛔ A2 開工前實測:本 plan §5 的一個前提是**錯的**(2026-08-16,拋棄式 PG 17.10)

> 寫在這裡而不是寫在信裡,因為**下一個做 A2 的人會讀這份 plan,不會讀那封信**。

### 10.1 前提錯在哪

§5 原本寫「**參數型別不變 ⇒ ACL 保留**」。實查五支 RPC 的簽章:

```
admin_create_shipment(p_idempotency_key text, p_customer_user_id uuid, p_recipient_snapshot jsonb, p_carrier_code text, p_carrier_note text DEFAULT NULL)
admin_add_shipment_items(p_idempotency_key text, p_shipment_id uuid, p_items jsonb)
admin_mark_shipment_shipped(p_idempotency_key text, p_shipment_id uuid, p_tracking_number text DEFAULT NULL)
admin_void_shipment(p_idempotency_key text, p_shipment_id uuid, p_void_reason text)
admin_unvoid_shipment(p_idempotency_key text, p_shipment_id uuid)
```

🔴 **五支都沒有 `p_actor`,也沒有 `p_request_id`。**
而 `admin_audit_log` 的 `actor` 與 `request_id` **兩欄都是 `NOT NULL` + `CHECK (<> '')`**
(`20260712210000_m4a_admin_audit_log.sql:45,51,55,57`)。

⇒ **要補稽核列就一定得改參數。「參數型別不變」這條路不存在。**

### 10.2 甲案(只加一個有 `DEFAULT` 的參數)= **正式站當場壞掉**,不是靜默退化

實測(具名參數呼叫,**PostgREST 就是這樣呼叫的**):

```
建了 f(p_key,p_id) 與 f(p_key,p_id,p_actor DEFAULT NULL) 之後
  多載數量                : 2
  舊呼叫端(2 個具名參數)  : ERROR: function public.f(p_key => unknown, p_id => uuid) is not unique
  新呼叫端(3 個具名參數)  : NEW-有稽核
```

🔴 **舊呼叫端不是走到舊版,是【整個呼不動】。**
⇒ 若 migration 先 apply 而應用層還沒改,**出貨線五支全部立刻失效**。
📎 這與 memory `feedback_app-layer-must-not-ship-before-migration-apply` 是**反方向**的同一件事:
那條講「應用層不得先於 migration」,**這裡是 migration 不得先於應用層**。⇒ **兩邊都不能先,只能同時。**

### 10.3 乙案(`DROP` 舊簽章 + 建新的)可行 —— **但它會把權限打開,而最直覺的檢查看不到**

```
DROP 前(收好權): proacl = {postgres=X/postgres,service_role=X/postgres}   anon 能執行 = f
DROP + 重建後  : proacl = (NULL)
                 service_role 能執行 = t     ← 看起來沒事
      🔴         anon 能執行         = t     ← 而 PUBLIC 拿到了 EXECUTE
                 PUBLIC 在預設 ACL 裡 = 1
```

🔴 **`has_function_privilege('service_role', …)` 回 `t` 在【收好權】與【全開】兩種世界裡長得一模一樣。**
拿它當驗收 = 假綠。這正是 `docs/patterns/revoking-function-execute-in-supabase.md` §3.6 記的
「`proacl` 是 `NULL` 時 PUBLIC 看不見」——**我寫過那條,然後在這裡差點照著踩。**

⇒ **A2 的 migration 必須含**:
1. `DROP FUNCTION public.<f>(<舊簽章>);` —— **明寫舊簽章**,不能靠 `CREATE OR REPLACE` 蓋過去
2. 建新簽章(新參數一律給 `DEFAULT`,舊呼叫端才接得住 —— 乙案實測舊 2 參數具名呼叫**正常走到新版**)
3. `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated;` 再 `GRANT EXECUTE … TO service_role;`
4. **驗收斷言要驗 `anon` 回 `f`,不是驗 `service_role` 回 `t`** —— 後者兩種世界都回 `t`
5. 收尾斷言:`select count(*) from pg_proc where proname='<f>'` **必須恰好 1**(多載沒清乾淨會 10.2 那樣壞)

### 10.4 🔴 一個跨窗相依,不是我能單方面決定的

新參數要有值,`shipment-repository.ts` 得把 `actorId` 傳下去 ——
**而那支檔是 C 窗的工作樹**(它正在補讀取層的截斷訊號)。
⇒ **A2 不是「一支 migration」,是「一支 migration + 一次跨窗協調」**,片的邊界要重畫。
⇒ **本窗不動 `shipment-repository.ts`**,已把這件升上去。

### 10.5 rollback(§7 要求動手前寫好)

| 退什麼 | 怎麼退 |
|---|---|
| 函式 | 反向 migration:`DROP` 新簽章 → 用**本 plan 附的舊定義原文**重建舊簽章 → **重跑 REVOKE/GRANT**(否則退回去的版本 PUBLIC 可執行) |
| 應用層 | `git revert` |
| 🔴 順序 | **退也不能只退一邊** —— 理由同 10.2,只退一邊就是 10.2 那個 `is not unique` 或參數對不上 |
| ⚠️ 已寫進去的稽核列 | **不刪**(append-only,表本身就沒開 DELETE)。退版之後那些列仍然有效、不是垃圾。 |
