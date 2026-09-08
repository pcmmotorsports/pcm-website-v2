# `⟦b4-MGR0-RPC⟧`(板列 `docs/launch-todo.md:756`)· 管理者權限 TOCTOU · plan(鐵則 8 + 12②③;**只 plan, 零改動**)

> ⚠️ **座標訂正兩處(我自己開檔核的, 不是照收)**:
> · 主視窗給的 `:754` 那一列**態是 `done`** ⇒ 對象是 **`:756`**(`open`)。
> · tidy 給的路徑 `apps/admin/src/lib/customers/staff-actions.ts` **不存在** ⇒ 真的在 **`apps/admin/src/lib/staff-actions.ts`**(310 行)。
> 🔵 而 tidy 的**行號與計數全對** —— 只有路徑錯。**所以我把它當起點, 而不是當已驗證事實, 是對的做法而不是多疑。**

## 1. 病(板列 `:756` 逐字)
> 「稽核紀錄會說一句不真的話 —— 它記『**管理者 A 做的**』, 而事發當下 **A 已經不是管理者**」
> 機制:**查核與寫入分屬兩個交易** ⇒ 中間那個窗口沒有東西在看。

## 2. 🔴 三處窗口**不是同一種東西**(我逐窗量的)
| # | 查核 → 寫入 | 中間幾行 | 中間的 `await` |
|---|---|---|---|
| ① `:105 → :123` | `authorizeManagerMutation()` → `insertStaffRow()` | 17 | **1**:`:112 getRequestId()` |
| ② `:156 → :197` | → `updateStaffProfileRow()` | 40 | **2**:`:171 getRequestId()` · 🔴 **`:181 listStaffRows()`** |
| ③ `:230 → :284` | → `setStaffActiveRow()` | 53 | **2**:`:237 getRequestId()` · 🔴 **`:253 listStaffRows()`** |

⇒ 📌 **①的窗口長度由本機工作決定;②③的長度由【網路】決定**(中間夾一次真的 DB 往返)。
⇒ 🛑 **plan 不能把三處當同一件事處理** —— 它們的**曝險時間差一個數量級**, 而修法的急迫性也不同。

## 3. 沒有第二道網(量到的)
· 全檔 `.rpc(` = **0** · `transaction` = **0** · `BEGIN` = **0**(正對照:`await ` = **15** ⇒ 尺會叫)
· 寫入端走 `createSupabaseServiceClient()` ⇒ **繞 RLS** ⇒ **DB 側沒有任何東西在重新檢查權限**。
⇒ 這一格是本題真正的重量:**應用層是唯一的閘, 而那個閘與寫入之間有窗口。**

## 4. 修法方向(三個, 我推丙)
· **甲 · 把查核與寫入包進同一支 `SECURITY DEFINER` RPC** —— 板列寫的那個。**面最大**(三支各要一支 RPC), 而它把權限判斷搬進 DB ⇒ **最徹底**。
· **乙 · 寫入時附帶條件**(`UPDATE … WHERE 呼叫者仍是管理者`)—— 面小, 而**它只擋得住「寫入當下已不是管理者」**, 擋不住「查核到寫入之間換人」以外的東西;且要每支寫一次, **容易漏**。
· ✅ **丙 · 先把 ②③ 的 `listStaffRows()` 移出窗口**(移到查核之前或寫入之後)⇒ **窗口從「網路長度」縮回「本機長度」**, 與 ① 同級。
  ⇒ 📌 **它不是解, 是把三處變成同一種東西** —— 之後甲才有辦法一次處理三支而不是三種。
  🔵 **而它是純前端片、不動 DB** ⇒ **不受鐵則 12 阻擋, 可以先做**。

⇒ **建議順序:丙(縮窗口, 前端片)⇒ 甲(RPC, migration, 12②③ 不降級)**。乙不做 —— 它會留下三份各自為政的條件。

## 5. 🛑 這份 plan 證不到什麼
· 我**沒有構造並發** —— 「兩位員工同時」這件事我**一次都沒有重現過**。
· 我**沒有量往返毫秒** ⇒ 「②③ 的窗口大一個數量級」是**依「中間夾一次網路往返」推的**, 不是量的。
· 我**沒有查有沒有別的入口繞過這三支** —— 若有第四條路直接寫那張表, 上面整個分析的分母就錯了。
  (⚠️ 這三格**正是 tidy 自己列的三格答不出** —— 我沒有補上任何一格, **只是把它們原樣帶過來**。)
· 我**沒有讀** `authorizeManagerMutation()` 的實作 ⇒ 不知道它查的是什麼、以及它自己有沒有快取。

---

# 6. 我把自己標的兩格「證不到」填掉了(2026-09-07, 純唯讀 + 開檔)

## 6-1 「有沒有別的入口繞過這三支」⇒ **應用層【沒有】, 而 DB 側要分開講**
· **應用層**:全 repo 碰 `staff` 這張表的 **只有 `apps/admin/src/lib/staff-repository.ts`**(`:27 :56 :68 :90 :111` 五處),
  而它的三支寫入 helper **只被 `staff-actions.ts` 呼叫**(排除測試與 `.next`/`dist`/`node_modules`)。
  ⇒ 📌 **沒有第四條應用層路徑。**
· **DB 側**:`INSERT INTO public.staff` 的非註解行共 **3** 處, 全在 migration 裡
  (`20260726120000:32` 建表時的種子 · `20260810160000:329` · `20260811050000:75`)⇒ **沒有 runtime 的 DB 寫入路徑**。
  🟢 **正對照**:同一把尺換 `public.orders` ⇒ **81 處** ⇒ **那個 3 不是尺沒接上。**
🛑 **而這一格仍然沒有涵蓋**:Supabase dashboard / SQL Editor 手改 —— **repo 裡不會留下任何一個字**(同 `⟦b9-ACLDRIFT5⟧` 那條路)。

## 6-2 「`authorizeManagerMutation()` 到底查什麼」⇒ **它有兩段, 而 TOCTOU 只掛在第二段**
`apps/admin/src/lib/session/authorize.ts:99` 逐字:
```
const base = await authorizeAdminMutation();
if (!base) return null;
if (!(await isActiveManager(base.actorId))) return null;
return base;
```
⇒ 📌 **①是「是不是管理員(session 層)」, ②是「他【現在】還是不是在職的管理者」** ——
而板列講的「事發當下 A 已經不是管理者」**指的正是第二段**。
⇒ ✅ **修法(甲)要搬進 RPC 的是 `isActiveManager` 那一段**, 不是整個授權流程。
🔵 **而它讀的正是 `staff` 這張表** —— 與寫入同一張 ⇒ **一支 RPC 同時做「讀該表判斷 + 寫該表」在技術上是自然的**, 不需要跨表交易。

## 6-3 ⇒ 三格剩一格
· ✅ 別的入口 ⇒ 填掉(應用層無、DB 側 3 處全是 migration 種子;dashboard 那條路仍在外)
· ✅ `authorizeManagerMutation` 實作 ⇒ 讀了, 而它把修法範圍**縮小**了
· 🔴 **仍然沒做:構造並發 + 量往返毫秒** —— 「②③ 的窗口大一個數量級」**到現在還是推的**。
  ⇒ **那一格要嘛用鑽機重現, 要嘛在 plan 裡一直標著。我不把它寫成已知。**

---

# 7. 鑽機:**並發重現了, 而毫秒那半我量不到 —— 兩件分開講**(拋棄式 PG 17.10, 埠 58721, 已收攤)

## 7-1 ✅ **TOCTOU 重現成功, 而且長得跟板列寫的一模一樣**
模型:`staff` 表 + `is_active_manager()`(今天的形狀:查核與寫入是兩個獨立敘述)
+ `rpc_set_staff_active()`(修法甲的形狀:查核與寫入在同一支 RPC 裡, 查核帶 `FOR SHARE`)。
```
世界1 今天的形狀 ⇒ B被停用=true  稽核列數=1  而A當下還是管理者嗎=false
世界2 RPC 形狀   ⇒ B被停用=false 稽核列數=0  ERROR: 不是在職管理者, 拒絕
```
⇒ 🔴 **世界1 就是板列那句話**:「稽核紀錄會說一句不真的話 —— 它記『管理者 A 做的』, 而事發當下 A 已經不是管理者」。
  **稽核列寫進去了、寫的是 A、而 A 的 `is_manager` 已經是 `false`。**
⇒ ✅ **世界2 證明修法甲的形狀擋得住** —— 而且是**乾淨地擋**:B 沒被動、**稽核零列**(不是「擋住但留了一筆假紀錄」)。

## 7-2 🔴 **而毫秒那一半我【沒有】量到 —— 我第二把尺是壞的**
· 第一發:20 次 `psql -c 'SELECT 1'` 中位數 **18.0 ms** ⇒ 🛑 **那含 psql 行程啟動**, 不是網路往返 ⇒ **它是一種上限, 不是我要的數。**
· 第二發:我寫了一句 SQL 想量「同一條連線一次來回」⇒ 回 **0.000 ms**
  ⇒ 📌 **那把尺是壞的** —— 它量的是**查詢內部經過的時間**, 根本沒有離開伺服器。**我不拿它當數字。**
⇒ 🛑 **結論:真正的往返毫秒【要在部署環境對 Supabase 量】, 本機拋棄式庫量不到。**
  ⇒ **「②③ 的窗口比 ① 大一個數量級」到現在仍然是【推的】。**

## 7-3 ⇒ 這對修法排序的意思
· **並發真的會發生**(重現了)⇒ 甲(RPC)**不是理論上的需要**。
· **而「②③ 比 ① 急」仍未證實** ⇒ 🛑 **不要用那個未證實的分級去決定先修哪一支** ——
  📌 **三支都在同一個病上, 而我只證明了病是真的, 沒證明誰比較嚴重。**
· 丙(把 `listStaffRows()` 移出窗口)**仍然值得做**, 而它的理由要改成
  「**縮短一個【已被重現】的窗口**」, 不是「因為它大一個數量級」。

---

# 8. 關卡 1 · codex `VERDICT: FAIL` ⇒ 訂正與補格(2026-09-07)
> rc=0 / 3761 行 / 回聲 `MGRPLAN0907` 命中 4。**舊字面一句不刪, 加刪除線。**

## 8-1 🔴🔴 **我講錯而且已經轉述出去的一條:「丙是純前端片、不受鐵則 12 阻擋」**
⛔ ~~「🔵 **而它是純前端片、不動 DB** ⇒ **不受鐵則 12 阻擋, 可以先做**」~~(§4 丙)
✅ **錯。** `apps/admin/src/lib/staff-actions.ts` 是 **`'use server'`**, 改的是**權限相關的寫入流程**
⇒ **它照樣是鐵則 12② 的範圍。** 📌 **「不動 migration」不等於「不動權限」。**
🛑 **而這句我已經在訊息裡跟主視窗說過 ⇒ 已回報訂正。**

## 8-2 🔴 **丙本身有回歸風險, 而且不是甲的前置條件**
· **移到查核【前】**:只是移除中間一次往返 ⇒ **TOCTOU 仍在**, 而 `before` 快照**更早** ⇒ 稽核更不準。
· **移到寫入【後】**:`before` 失真;而 ③ 還會把**「最後一位啟用員工」的守門搬到事後**(`staff-actions.ts:251` 附近)。
⇒ ✅ **丙降級**:不是「先做的那一步」, 而是**甲之後才評估的整理**。**先做甲。**

## 8-3 §2 的分級要再收一次
✅ codex 同意「收回大一個數量級」是對的, **而結構分級仍成立**:①無額外 DB 查詢 / ②③多一次**串行** DB 往返。
🛑 兩處要改:⛔ ~~「曝險時間差一個數量級」~~ ⇒ **只能說「②③ 多一次串行往返」**;
且 **①不是純本機窗口** —— 它也包含**查核回程、寫入去程與 DB 排隊**。
📌 **三處違反的是【同一條授權保證】** —— 分級只影響先後, 不影響「都要修」。

## 8-4 §4 的分母**沒有封閉**(這一條我接受)
我只搜了 `INSERT INTO public.staff` ⇒ **漏掉 `UPDATE` / `DELETE`、未限定 schema 的寫法、動態 SQL、view/trigger 間接寫入**;
而 migration **也可能定義 runtime 函式**。🟢 `orders=81` **只證明搜尋有命中能力, 不證明完整率**。
⚠️ 另有測試寫入 `scripts/admin-probe/seed.sql:181` **我沒有明列排除**。
⇒ ✅ 正確說法:**「已盤點的應用路徑只有這三支」**, 而**不是**「沒有第四條入口」。
🔵 而 codex 也說:第四入口若存在, **影響修法覆蓋率, 不會推翻已找到的三處窗口。**

## 8-5 甲的規格要補四格(codex §2 §6)
1. **鎖**:同交易**鎖住 actor 列**並**持鎖到寫入完成**;`FOR SHARE` 是足夠且最弱的 —— ⚠️ **代價要揭露:它也擋該列改名。**
   (`FOR KEY SHARE` **不夠** —— 擋不住非鍵欄位降級。)
2. **可信 actor 邊界**:新 SECDEF RPC 若**可公開執行**又**接受任填 actor** ⇒ **可冒名**。
   ⇒ 驗收必須含:有效 `EXECUTE` 權限清單 · actor 從哪裡來(**不可由呼叫端任填**)· `search_path` 安全。
3. **死結**:A 鎖自己改 B、B 鎖自己改 A ⇒ **可能死結**。⇒ 要交代**取鎖順序、`lock_timeout`、整筆失敗語意**。
4. **稽核不是原子的**:真碼是**寫入成功後另寫稽核, 失敗不回滾**
   ⇒ 🛑 **只搬授權【不能】宣稱稽核原子性, 也不保證 `before` 正確。**
   📌 而 codex 另指出一句我要收:**「A 做的」≠「A 當時有管理權」** —— **身分歸屬與授權有效性是兩件事。**
5. **rollback**:本 plan **尚缺** ⇒ 補:forward-only, 而回退要能把 RPC 撤掉並回到應用層查核(**且要說明期間的曝險**)。

## 8-6 鑽機的射程再收一次(codex §5)
· 世界2 的結果**看不出**是「測到鎖等待 / 等待後重驗 / RPC 先持鎖阻擋降級」中的哪一種。
· 世界1 最後看到 A 已降級, **不足以單獨證明「寫入當下已降級」** ⇒ 要**交易順序或同步屏障**的證據。
⇒ ✅ 我維持結論「**病是真的**」, 而**把「機制是哪一種」降為未證實**。

---

# 9. 關卡 1 · R2 `FAIL` ⇒ **兩輪上限用完**;而它抓到的兩件新東西**都是我自己的**
> rc=0 / 8162 行 / 回聲 `MGRPLAN2R0907` 命中 4。

## 9-1 🔴🔴 **我提的 RPC 形狀有一個【三值邏輯】的洞 —— actor 不存在時它會【放行】**
鑽機裡我寫的是:
```
IF NOT (SELECT s.is_manager AND s.is_active FROM public.staff s WHERE s.id = p_actor FOR SHARE) THEN
  RAISE EXCEPTION '不是在職管理者, 拒絕';
END IF;
```
⇒ **`p_actor` 在 `staff` 裡不存在** ⇒ 子查詢回 **0 列** ⇒ 整個運算式是 **NULL** ⇒ `IF NOT NULL` **不成立**
⇒ 📌 **它不會 RAISE, 而是【往下走去寫入】。**
🛑 **這不是鑽機的瑕疵, 是我提的修法本身的洞** —— 而它的方向是**最壞的那一種**:**不存在的 actor 反而過關**。
✅ 施工時必須寫成 **fail-closed**:先 `SELECT … INTO` 且 `IF NOT FOUND THEN RAISE`, 再判兩個旗標
(或 `coalesce(…, false)`)。**⚠️ 而這一格是靜態判讀, codex 與我都【沒有實跑】。**

## 9-2 🔴 **我的世界1 腳本把查核+寫入+稽核包在【同一個交易】裡, 而真碼不是**
真碼是**兩個獨立交易**(查核一個、寫入一個)。我的鑽機用 `BEGIN … pg_sleep … COMMIT` 把它們綁在一起, 時序也靠 `sleep`。
⇒ ✅ **我收回「完整重現」這個說法** ——
正確措辭:**「我構造了一個【與真碼形狀不同】的時序, 而它顯示出同一種結果(稽核寫 A、而 A 已降級)」**。
🔵 **而結論的方向沒有被推翻**:真碼是**兩個交易**, 比我的模型**更**暴露, 不是更少。
🛑 **但「更暴露」也是推的** —— **要證「真流程」仍然需要一個與真碼同形狀的鑽機。**

## 9-3 R2 的其他判定(照抄)
· ①部分關閉(§7-2「本機量不到往返」仍未訂正 ⇒ ✅ **訂正**:本機**量得到本機往返**, 量不到的是**部署環境的代表值**)
· ③ 判斷已關閉, **而 §4 原位仍寫「丙⇒甲」** ⇒ ✅ **本節聲明:以本節為準, §4 那句作廢**
· 🔴 **丙應該從執行清單【刪除】, 不是降級** —— 甲完成後丙原本的理由**消失**, 而它**沒有獨立效益**
  ⇒ ✅ **收下:丙保留為【已否決方案】的歷史, 不是預定工作。**
· ④ 覆蓋盤點**未完成**(承認漏搜不等於查完)· ⑥ ACL/死結/rollback **仍是待辦**

## 9-4 ⇒ **兩輪用完而仍 FAIL ⇒ 依規矩停, 整理決策題**
R2 說「不夠讓人依規格動手」, 缺五格 —— **而那五格的共通點是:它們都是【規格】不是【調查】。**
```
Q:MGR0-RPC 接下來怎麼走?
A: 甲 = 我把那五格規格寫完, 再走一次審查(等於第 3 輪, 需換模型換角度)
   乙 = 這一片先不做, plan 停在這裡當「已調查、未施工」, 板列標清楚
```
🛑 **我不推薦** —— 那是排程判斷:甲要再花一輪以上, 而這一片**今天沒有人在踩**(病是真的, 而爆炸半徑要先過入口閘)。

---

# 10. 🛑 **本 plan 的狀態:【已調查、未施工】**(主視窗 A 2026-09-07 裁乙)

**理由(A 給的三個)**:R2 說缺的五格是**規格**不是調查(要做的時候再寫)· 今天沒有人在踩 · 手上還有別的。

## 🔴 交接給下一個做這件事的人 —— **兩件, 而第一件你會踩**

### ① **不要照抄我鑽機裡的那個 RPC 判斷 —— 它有一個三值邏輯的洞**
```sql
-- ⛔ 不要這樣寫
IF NOT (SELECT s.is_manager AND s.is_active FROM public.staff s WHERE s.id = p_actor FOR SHARE) THEN
  RAISE EXCEPTION '不是在職管理者, 拒絕';
END IF;
```
`p_actor` **在 `staff` 裡不存在** ⇒ 子查詢回 **0 列** ⇒ 運算式是 **NULL** ⇒ `IF NOT NULL` **不成立**
⇒ 📌 **它不會 RAISE, 而是往下【寫入】。** 🛑 **不存在的 actor 反而過關 —— 錯的方向是最壞的那一種。**
✅ **要 fail-closed**:
```sql
SELECT s.is_manager, s.is_active INTO v_mgr, v_act FROM public.staff s WHERE s.id = p_actor FOR SHARE;
IF NOT FOUND THEN RAISE EXCEPTION '找不到 actor'; END IF;
IF NOT coalesce(v_mgr AND v_act, false) THEN RAISE EXCEPTION '不是在職管理者'; END IF;
```
⚠️ **這一格是靜態判讀 —— codex 與我都【沒有實跑】。** 施工時請自己餵一發不存在的 actor。

### ② **修法丙(把 `listStaffRows()` 移出窗口)= 【已否決】, 不是降級**
甲完成後丙原本「縮短授權窗口」的理由**消失**, 而它**沒有獨立效益**;
移到查核前 ⇒ TOCTOU 仍在且 `before` 更早;移到寫入後 ⇒ `before` 失真、③ 的守門搬到事後。
⇒ **保留為歷史, 不是預定工作。**

### ③ 還沒寫的五格(R2 列的, **都是規格不是調查**)
三支 RPC 的介面與可改欄位 · actor 可信來源與 EXECUTE/owner/`search_path` · 取鎖與鎖後查核與失敗語意 ·
稽核與 `before` 的保證邊界與驗收案例 · migration/應用切換/舊路徑退場/rollback 的順序與曝險。

---

# 11. 兩格證不到補上了(2026-09-07 · 唯讀, 碼零改動)

> 主視窗 A 批「只做那兩格, 碼一個字不動」。本節只答那兩格, **不改任何修法**。

## 11-1 【格 A】分母 —— ✅ **沒有第四條路。分母站得住。**
本 plan 末尾原句逐字:**「沒查有沒有別的入口繞過這三支 —— 若有第四條路直接寫那張表, 上面整個分析的分母就錯了。」**

**① TS 側**(`apps` + `packages`, 排除 `node_modules` / `.next` / `dist` / `*.test.*`):
· 摸到 `staff` 那張表的檔 = **只有 `apps/admin/src/lib/staff-repository.ts` 一支**(五處:`:27` `:56` 讀 · `:68` insert · `:90` `:111` update)
· 那三支寫入函式的**外部呼叫端 = 只有 `apps/admin/src/lib/staff-actions.ts`**(`:123` / `:197` / `:284`)
· ⇒ 📌 **與本 plan 逐窗量過的那三處【完全相同】, 沒有第四處。**
· 🔵 負對照:現造表名 `zzq_staff_nope` ⇒ **0**;現造函式名 `insertStaffRowZzq` ⇒ **0**。

**② DB 側**(正式庫唯讀, `scripts/readonly-prod-sql.sh`):
· 掃**所有非系統 schema** 的函式 body(剝 `--` 註解後)找 `INSERT INTO / UPDATE / DELETE FROM (public.)staff` ⇒ **0 支**
· 🟢 **正對照**:同一把尺問 `orders` ⇒ **14 支** ⇒ **這把尺會叫**
· 🔵 **負對照**:現造表名 ⇒ **0**
· `staff` 上的 trigger 只有 **1 支** `staff_touch_updated_at`(`tgtype=19` = BEFORE UPDATE ROW · `tgenabled='O'` · `pcm_staff_touch_updated_at()`)⇒ **它碰的是 `updated_at`, 不碰 `is_manager` / `is_active`。**
⇒ ✅ **DB 側也沒有第四條路。**

## 11-2 🔴 **而查分母的路上撿到一件沒有人寫下來的事 —— 寫入權是【欄級】的**
`public.staff` 正式庫實測:
```
relacl  {postgres=arwdDxtm, service_role=ar, pcm_readonly=r}      ← service_role 整表【沒有 w】
逐欄 attacl   label / is_manager / is_active  ⇒ {service_role=w/postgres}
              id / created_at / updated_at    ⇒ NULL(無欄級授權)
```
· `service_role` 逐欄 UPDATE 有效權限:`label`=**t** · `is_manager`=**t** · `is_active`=**t** · `id`=**f** · `created_at`=**f** · `updated_at`=**f**
· 🔵 負對照:`anon` 六欄 UPDATE ⇒ **0 欄為 true**(分母 6)
⇒ 🎯 **那是一個設計得很好、而【沒有寫在任何地方】的收窄**:寫入端就算被打穿, 也改不動 `id` 與時戳。

### 🛑 而它同時是一個【量具坑】, 記下來
`has_table_privilege('service_role','public.staff','UPDATE')` ⇒ **`false`**
`has_column_privilege('service_role','public.staff','is_manager','UPDATE')` ⇒ **`true`**
⇒ 📌 **一道問「整表」的守門, 會印出「`service_role` 改不動 `staff`」—— 而那句話在效果上是【錯的】。**
⇒ 這與 `docs/patterns/revoking-function-execute-in-supabase.md` 檔頭那句「`has_*_privilege` 對欄級授權少報」是同一件事, **而這是它的一個活體實例。**

### ⚠️ 而我的正對照有一半沒成立, 照實寫
我原本假設「`orders` 的 UPDATE 對 `service_role` 一定是 true」當正對照 ⇒ **實測是 `false`**。
救回這一發的是**第二個**正對照 `products` ⇒ **true**。
⇒ 📌 **一個正對照失敗不代表尺壞了 —— 而如果我只放了 `orders` 那一個, 我會把「尺壞了」寫進報告。**

## 11-3 【格 B】`authorizeManagerMutation()` 的實作 —— 讀了, **它是一層薄殼**
`apps/admin/src/lib/session/authorize.ts:99-107` 逐字:
```
const base = await authorizeAdminMutation();
if (!base) return null;
if (!(await isActiveManager(base.actorId))) return null;
return base;
```
⇒ ✅ **本 plan 對窗口的描述成立**:它就是「讀一次 `staff` 判斷」, 之後的寫入是**另一個敘述**, 中間沒有交易包住。
⇒ 🔴 **而它的 docstring 已經記著另一條天花板**(不是本片的, 但引用時要一起帶):這道閘的效力**綁在 `ADMIN_REQUIRE_REAL_IDENTITY=1`**;旗標關掉 ⇒ `getSessionActor` 走到 picker cookie ⇒ **任何登入者自陳一個管理者 id 就會被放行, 而每一道檢查都正確運作了。**
· 🛑 那顆 env 在 Vercel 是 `Secret` ⇒ **連 Sean 本人也讀不到值**;`vercel env ls` 在 `=1` 與 `=0` 兩個世界**印同一個 `Encrypted`**。

## 11-4 🛑 仍然證不到什麼(這三格**一格都沒補上**)
1. **沒有構造過一次真的並發** —— 這個競態**至今一次都沒有被重現過**。
2. **沒有量往返毫秒** —— plan §「①的窗口由本機工作決定, ②③由網路決定, 差一個數量級」**仍然是推的**。
3. **`service_role` 的金鑰有沒有外流** / 有沒有人拿它直接打 PostgREST 寫 `staff` —— **量不到**(那條路不經過我們的碼)。
   🔵 而 11-2 那個欄級收窄**限縮了這條路的後果**:就算有人直接打, 也只動得了那三欄。

---

# 12. 五格規格(2026-09-09 `-sync` 補;**只寫規格, 零改碼、零新建 DB 物件**)

> 🔵 **為什麼現在寫**:主視窗 A 2026-09-07 裁乙的三個理由裡有兩個變了 —— ③「手上還有別的」已不成立;
> ①「缺的五格是規格不是調查」而 `~/.claude/rules/00-work-rules.md` R7 ② 逐字「量測/盤點/**寫 plan** 都不用」。
> 🛑 **而②「今天沒有人在踩」沒變** ⇒ **本節【不是】開工的理由**;它把 R2 說缺的東西補齊, 讓「要做的那天」不用重推一次。
> 🔴 **本節沒有做的**:沒新建任何 DB 物件 · 沒動 `staff-actions.ts` · 沒跑任何正式庫查詢 · 沒構造並發。
> 📌 **前面 §9-1 / §10-① 那兩件交接警告是本節的輸入, 我照它們寫, 沒有重新設計。**
>
> 🔴🔴 **本節的狀態, 寫死在這裡免得下一個人誤讀**:
> **規格已寫, 片【未開】。開片的前提仍是 Sean 的貼板授權 —— 本節不改變那個前提。**
> 🛑 讀到 §12 這 159 行規格【不代表這一片已經開了】;板列 `⟦b4-MGR0-RPC⟧` 的態仍是 `open`,
> 而主視窗 A 2026-09-07 的裁定(已調查、未施工)**沒有被推翻**。

## 12-1 【格一】三支 RPC 的介面與可改欄位

**受詞來源(開檔量的, 不是設計出來的)**:`apps/admin/src/lib/staff-repository.ts`
`:22` 逐字 `const STAFF_COLUMNS = 'id, label, is_manager, is_active'`;
`:11` `interface StaffInsert` · `:17` `interface StaffProfileUpdate`;
三支寫入 `:64 insertStaffRow` / `:85 updateStaffProfileRow` / `:106 setStaffActiveRow`。

```
RPC 一  admin_staff_create(p_actor uuid, p_label text, p_is_manager bool, p_is_active bool)
        寫入欄 = label / is_manager / is_active     取代 insertStaffRow
RPC 二  admin_staff_update_profile(p_actor uuid, p_id uuid, p_label text, p_is_manager bool)
        🔴 SET 只含 label / is_manager —— 逐字照 `:83-84` 那句註解
           「不得夾帶 is_active 造成 stale write 自行復活」
RPC 三  admin_staff_set_active(p_actor uuid, p_id uuid, p_is_active bool)
        🔴 SET 只含 is_active —— 逐字照 `:103-104`「不得用舊表單值覆蓋 label/is_manager」
```
🛑 **三支【各自】的 SET 欄位集合是規格的一部分, 不是實作細節** —— 把三支併成一支「萬用 update」
會把上面那兩句註解守的東西一起丟掉, 而**丟掉之後三綠不會紅**。
🔵 **回傳**:三支都回**整列**(`id, label, is_manager, is_active`)—— 呼叫端今天就是拿整列去寫稽核的 `after`。
⚠️ **`insertStaffRow` 的 `'DUPLICATE'`(PG `23505`)要保留成一個【可預期結果】**, 不可退化成 RAISE
(`staff-repository.ts:71-72` 今天把它轉成字串常數, 呼叫端靠它給使用者訊息)。

## 12-2 【格二】actor 的可信來源 · EXECUTE · owner · search_path

🔴🔴 **最承重的一句:`p_actor` 【不可由呼叫端任填】的保證, 今天不在 DB 這一側。**
```
後台走 createSupabaseServiceClient()（service_role, 繞 RLS）
⇒ DB 看到的呼叫者身分永遠是 service_role, 分不出「是誰在按」
⇒ 📌 所以 p_actor 只能由應用層傳, 而【傳什麼是應用層說了算】
```
⇒ **規格上要明寫**:這三支 RPC 解掉的是 **TOCTOU 那一半**(查核與寫入同一交易),
**解不掉「service_role 金鑰外流之後有人自填 p_actor」** —— 那是 §11-3 已經標成量不到的那條。
🛑 **不得把「包進 RPC」寫成「順便修好了冒名」。那是兩件事。**

**授權形狀(照本 repo 既有慣例, 不自創)**:
```
SECURITY DEFINER · owner = postgres
SET search_path = public, pg_temp   ← 照範本 20260828090000…:64 那支的字面
                                       ⚠️ 【不是】 '' —— 那支要讀 public.staff
三道 REVOKE  FROM PUBLIC / FROM anon, authenticated / (視需要) service_role
GRANT EXECUTE 只給【後台真正會用的那一個角色】
🔴 而那個角色是誰【未確認】:後台注的是 service_role, 若 GRANT 給它,
   邊界就回到「誰拿得到 service_role 金鑰」⇒ 與今天相同, 沒有變好也沒有變壞。
   ⇒ 缺的檢查 = 決定要不要為後台開一個【只能執行這三支】的專用角色。那要 Sean 拍(新角色 = 新的鑰匙)。
```
⚠️ **`REVOKE … FROM PUBLIC` 收不掉具名角色的直接授權** —— 這一句 2026-09-09 才訂正過
(板列 `⟦auth-HALFREVOKEDTRIGGERS⟧` 末格);寫這三支的人**三道 REVOKE 一道都不要省**。

## 12-3 【格三】取鎖 · 鎖後查核 · 失敗語意

**鎖**:照範本 `20260828090000…:89` 那三支的字面 ——
```sql
SELECT s.is_manager INTO v_is_manager
  FROM public.staff s WHERE s.id = p_actor AND s.is_active
   FOR SHARE;
IF NOT FOUND THEN RAISE EXCEPTION '無權執行此操作'; END IF;
```
🔴🔴 **形狀是規格的一部分, 不是風格** —— §9-1 那個洞就在這裡:
`IF NOT (SELECT …)` 在 **actor 不存在**時子查詢回 0 列 ⇒ 運算式 NULL ⇒ `IF NOT NULL` 不成立
⇒ 📌 **不 RAISE、直接往下寫入** ⇒ 🛑 **不存在的 actor 反而過關。**
⇒ ✅ **只准用 `SELECT … INTO` + `IF NOT FOUND THEN RAISE`, 或 `coalesce(…, false)`。**
⇒ **驗收要有一發【餵不存在的 actor】**(§10-① 逐字要求, 那一格至今只有靜態判讀、沒實跑)。

**`FOR SHARE` 的代價要揭露**(codex §8-5-1):它也**擋該列改名** —— 兩個管理者同時改對方的 label 會互等。
**`FOR KEY SHARE` 不夠** —— 擋不住非鍵欄位的降級, 而降級正是本列要擋的那件事。

**死結與逾時**:
```
情境  A 鎖自己改 B、B 鎖自己改 A ⇒ 可能死結
規格  ① 取鎖順序:先鎖 p_actor 那一列, 再鎖 p_id 那一列;p_actor = p_id 時只鎖一次
         (📌 順序寫死才有意義 —— 兩支各自「先鎖自己」就是死結的配方)
      ② 進 RPC 先 SET LOCAL lock_timeout = '3s'
      ③ 失敗語意 = 整筆失敗、不做部分寫入;逾時與死結都回同一個可預期結果
         ⇒ 呼叫端顯示「有人正在改同一筆, 請重試」, 不是把 DB 錯誤原文丟到瀏覽器
🔴 ①②③ 缺一都不是規格 —— 少了②它會等到連線層逾時, 而那時使用者看到的是白畫面
```

## 12-4 【格四】稽核與 `before` 的保證邊界 + 驗收案例

🛑🛑 **先講【不保證什麼】, 因為 codex §8-5-4 打的就是這裡**:
```
真碼今天 = 寫入成功後【另寫】稽核, 稽核失敗不回滾
⇒ 只把【授權】搬進 RPC, 不能宣稱稽核變成原子的, 也不保證 before 正確
```
**兩個選項, 而它們的保證強度不同 —— 要 Sean 或主視窗裁, 本節不替他選**:
```
甲  稽核也搬進 RPC(同一交易 INSERT INTO public.admin_audit_log)
    ⇒ 「寫得進去」與「留得下紀錄」變成同生共死
    ⚠️ 代價:RPC 要吃 request_id / sid 等欄位, 介面變寬;
       而 admin_audit_log.request_id 是 NOT NULL + CHECK (<> '')
       —— 20260828090000…:88-96 逐字記著「原樣塞 NULL ⇒ 23502 ⇒ 那筆根本沒存進去,
          而它躲過 codex 三輪 + 30 發突變 + 22 道碼錨」⇒ 這一格要有負對照
乙  稽核留在應用層(現況)
    ⇒ 本片只解 TOCTOU;稽核仍可能寫失敗而寫入已成功
```
🔴 **而不論甲乙, `before` 都要重講一次**:今天的 `before` 來自 `staff-actions.ts:191` / `:263` 的
`rows.find(...)`, 而那份 `rows` 是 **`listStaffRows()` 撈回來的** —— 📌 **它就是窗口裡那一次 DB 往返**。
⇒ **甲**:`before` 應由 RPC 在**持鎖之後**自己讀, 呼叫端傳進來的一律不採信。
⇒ **乙**:`before` 仍是窗口外讀的 ⇒ **稽核的 `before` 可能不是寫入當下的值**, 這句要寫進 runbook。

🔴 **codex 另指出而我照收**:**「A 做的」≠「A 當時有管理權」** —— 身分歸屬與授權有效性是兩件事
(memory `feedback_who-did-it-is-not-were-they-allowed`)。

**驗收案例(每一格都要能回答「哪一個世界會紅」)**:
```
① 正常路徑        有效管理者改一筆 ⇒ 成功, 且 after 真的變了(不是只回 200)
② 降級競態        鑽機模型量到的判準:currentShape 稽核說謊 200/200 ⇒ 修好後要掉到 0/200
                  (§7 那台鑽機的重建食譜在板列 ⟦b4-MGR0-RPC⟧ 末格, 不在本檔重抄)
③ 反向對照        降級落在【查核之前】⇒ 兩種形狀都 denied
                  🎯 少了它, 200→0 可以有另一個解釋:「新形狀只是比較嚴, 什麼都擋」
④ 不存在的 actor  RAISE, 不得放行 ← §9-1 那個洞的專屬案例
⑤ 非管理者 actor  RAISE
⑥ 停用的管理者    RAISE(WHERE 帶 s.is_active)
⑦ SET 欄位收窄    update_profile 不得動到 is_active;set_active 不得動到 label/is_manager
                  ⇒ 每支一發突變, 每發只退一處
⑧ 死結/逾時       兩個交易互鎖 ⇒ 其中一個在 lock_timeout 內回可預期結果, 不是掛住
```

## 12-5 【格五】migration / 應用切換 / 舊路徑退場 / rollback 的順序與曝險

```
第 1 步  貼 migration(建三支 RPC)—— 此時【沒有人呼叫它】
         曝險:零。舊路徑照跑。
🔴 順序是硬的:DB 先貼、碼後上。反過來 ⇒ 碼呼叫一支不存在的函式
   ⇒ memory `feedback_code-before-db-is-invisible-to-every-green` 逐字:
      手寫型別讓 typecheck 綠與函式存在分家, 每一把綠都看不見。
第 2 步  改 staff-actions.ts 三處改呼叫 RPC;staff-repository.ts 三支寫入函式退場
         🔴 曝險視窗 = 【第 1 步與第 2 步之間】—— 舊路徑仍在, TOCTOU 仍在。
            那段時間長短由 Sean 什麼時候推決定, 不由我們決定 ⇒ 要寫進端他的那句話裡。
第 3 步  舊路徑退場 = 把 insertStaffRow / updateStaffProfileRow / setStaffActiveRow 刪掉
         🛑 不要只是「不再呼叫」—— 一支還在的寫入函式, 下一個人會直接用
            (它繞過 RPC 而三綠不會紅)。
         ✅ 收工前 grep 那三個名字, 期望 0(而測試檔裡的命中要逐一開檔判, 不能只看數字)
```
**rollback**:
```
forward-only。回退 = 把 staff-actions.ts 改回呼叫三支 repository 函式(所以第 3 步要晚做)。
🔴 而 RPC 本身【不要急著 DROP】—— 留著沒有呼叫端是零風險, DROP 掉再建才是風險。
⚠️ 回退期間的曝險要明寫:TOCTOU 窗口原封回來, 而稽核不會有任何一列說「這段時間沒有保護」。
```

## 12-6 🛑 本節【沒有】補掉的(照 §11-4 原樣帶過來, 一格都沒動)
1. **沒有構造過一次真的並發** —— 這個競態至今一次都沒有被重現過(§7 那台鑽機是**模型**, 不是真碼)。
2. **沒有量往返毫秒** —— 「差一個數量級」仍是推的。
3. **`service_role` 金鑰有沒有外流** —— 量不到(不經過我們的碼)。
4. 🔴 **本節新增的兩個未確認**:
   · 三支 RPC 的 `EXECUTE` 要 GRANT 給哪個角色(見 12-2)—— **要 Sean 拍**, 因為選項之一是開新角色。
   · 稽核走甲還是乙(見 12-4)—— **要主視窗或 Sean 裁**, 兩者保證強度不同。
