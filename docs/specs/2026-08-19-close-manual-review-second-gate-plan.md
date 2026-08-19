# 第二道閘 · plan(鐵則 8,等主視窗批)

> 2026-08-19 · W4 · 對象 = `supabase/migrations/20260819010000_m4a_close_manual_review_attempt.sql`
> 前一片(`d7ececdc`)解掉**第一道**閘(5c 述詞互斥)。**那支現在仍然 apply 不了。**
> 🔴 **本檔還沒開工。動 migration + 這個體積 ⇒ 鐵則 8,要主視窗點頭。**

---

## 0. 一句話

**那支 migration 現在炸在【角色拓樸】那道斷言,而它炸的原因不是我們有安全問題 —— 是那道斷言把「superuser 存在」讀成了「有人偷偷拿到權限」。**

---

## 1. 先把【意圖】寫清楚,再談實作

那道斷言(`:451-461`)在守的是這件事:

```
出口 RPC `admin_close_manual_review_attempt` 只應該由 service_role 執行得了。
而【ACL 乾淨】不等於【沒有別人執行得了】——
有人只要 `GRANT service_role TO 某個新角色`，那個角色就經由【成員資格】取得 EXECUTE，
而 proacl 一個字都不會變、所有點名式檢查全綠。
⇒ 所以它遍歷 pg_roles、用 pg_has_role(r,'service_role','USAGE') 問【有效權限】，不點名。
```

🔴 **那個意圖是對的,而且它是全樹少數真的做了成員閉包的地方**
(量法:`grep -rln "pg_has_role" supabase/migrations/*.sql | wc -l` ⇒ **7 支**)。
⚠️ **而我在 `#665` 原本寫「做這件事的有 0 支」—— 那句是錯的,當天已自行更正。**

## 2. 那它為什麼會炸

```
🔴 `pg_has_role` 對【任何 superuser】回 true —— superuser 天生是所有角色的傳遞成員。
⇒ 正式庫的 supabase_admin（SUPERUSER）被算進去 ⇒ v_cnt = 1 ⇒ RAISE。
```

**實測(2026-08-19,拋棄式 PG 17)**:
```
本機 CREATE ROLE supabase_admin SUPERUSER NOLOGIN ⇒ 再 apply 那支
  ⇒ ERROR: 角色拓樸異常 — 有 1 個角色是 service_role 的(轉遞)成員…
機制可重跑：pg_has_role('supabase_admin','service_role','MEMBER') ⇒ true
           （postgres 也是 true，但它是 current_user、已被排除）
✅ 對照組：沒有該角色的庫 ⇒ apply rc=0
```

🔴 **關鍵判斷:那是【誤紅】不是【真紅】。**
一個 superuser **本來就能做任何事**,它不需要 `service_role` 的成員資格。
把它算進「有人取得得了 EXECUTE」= 把一個**恆真**的事實報成一個**發現**。

---

## 3. ✅ 分岔點已解決 —— **Sean 跑了,分支甲成立**

**他貼回來的表(逐字轉錄,主視窗轉,我沒有重打)**:
```
| rolname        | rolsuper |
| -------------- | -------- |
| supabase_admin | true     |
```
⇒ 🔴 **`supabase_admin` 存在、`rolsuper=true`,而且是那一發回的唯一一列。**
⇒ **我先前標「正式庫到底有沒有,我查不到 ⇒ 未確認」那一格,現在升成【量到的】。**
   而升它的是 **Sean 本人跑的那一句**,不是 codex 說的、也不是「Supabase 慣例上有」——
   🔴 **那兩個當時都不是量測,而它們指向的結論剛好是對的。結論對不代表理由夠。**

**⚠️ 兩個限定跟著走,不要放大**:
```
· 這是【2026-08-19 這一刻、這個專案】的一列。Supabase 平台側的角色不是我們控的 ⇒ 它可能變。
· 🔴 那一發【只列 rolsuper=true 的】 ⇒ 它【沒有】回答
  「除了 superuser 以外，還有誰是 service_role 的傳遞成員」。
  ⇒ 那正是這道斷言真正要抓的東西 ⇒ **需要第二句**（見 §3.5）。
```
~~分支乙(正式庫沒有 superuser)~~ ⇒ **不成立,不寫。**

### 分支甲(**已確認成立**):正式庫有非 `current_user` 的 superuser
**改法(我建議這個)**:在那道斷言的 `WHERE` 加一行 `AND NOT r.rolsuper`。
```
理由：superuser 不受任何 ACL 約束 ⇒「它執行得了」是恆真，不是本斷言要抓的東西。
🔴 排除它【不會】削弱這道斷言真正的判別力：
   它要抓的是「有人 GRANT service_role 給一個【新的、非 superuser 的】角色」，
   而那種角色 rolsuper = false ⇒ 仍然會被抓到。
🔴 而 PG 不繼承 rolsuper（成為 superuser 角色的成員 ≠ 變成 superuser）
   ⇒ `NOT r.rolsuper` 是精確的，不會被「加入某個 superuser 角色」繞過。
```
**🔴 不接受的替代做法(寫下來,免得下一個人挑它)**:
- ❌ 把整道斷言刪掉 ⇒ 那一格從此沒守門,而它守的是一條「一句 GRANT 就開的門」。
- ❌ 把 `supabase_admin` 寫成白名單 ⇒ 換一個 superuser 名字就漏;而正式庫的 superuser 清單不歸我們管。
- ❌ 改成只點名 anon/authenticated ⇒ 那正是 R2 已經打掉過的舊寫法。

**驗收(兩個方向都要)**:
```
該綠：有 supabase_admin(SUPERUSER) 的庫 ⇒ apply rc=0
🔴 該紅：CREATE ROLE probe_reader NOLOGIN; GRANT service_role TO probe_reader;
        ⇒ apply 必須【炸】，且訊息指得出是哪一個角色
        （現行訊息只印個數，順手改成印出角色名 —— 印個數的話值班還要自己去查是誰）
```

## 3.5 🔴 而要開工還缺【第二句 SQL】—— 請主視窗跟 Sean 要

```sql
-- 除了 superuser 之外，還有誰是 service_role 的（傳遞）成員？
SELECT r.rolname, r.rolsuper
  FROM pg_roles r
 WHERE pg_has_role(r.rolname, 'service_role', 'USAGE')
   AND r.rolname NOT IN ('service_role', current_user)
   AND r.rolname NOT LIKE 'pg\_%';
```
**為什麼需要它(而不是「改完再說」)**:
```
· 回【只有 supabase_admin】 ⇒ 加 `AND NOT r.rolsuper` 之後 apply 會過。**改法就完備了。**
· 🔴 回【還有別人（非 superuser）】 ⇒ 那道斷言**現在就抓到了一個真的東西**
  ⇒ 那時它不是誤紅，是【正確地擋住】 ⇒ **本片的性質整個改變**：
     從「修一道誤紅的斷言」變成「先處理一個真的權限缺口」。
⇒ 🔴 **不先問這一句就動手，會把一個真紅當成假紅修掉。** 那正是這道斷言最不該有的失敗方式。
```
⚠️ **而我改法的正確性【不依賴】這句的答案**(`NOT r.rolsuper` 兩種情況下都是對的);
   **它決定的是「改完之後 apply 會不會過」,以及「有沒有另一件事要先做」。**

---

## 4. 🔴 a–i 分兩類 —— **兩類的風險完全不同,不要混在一起看**

來源 = `d7ececdc` 的 commit body(codex 關卡2 29 條裡不屬前一片的部分)。

### 甲類:**斷言**(會改變 apply 成不成功 / 守門有沒有判別力)
| 代號 | 位置 | 是什麼 | 風險 |
|---|---|---|---|
| a | `:451-461`(角色拓樸)、`:463-471` | superuser 造成**誤紅** | 🔴 **擋住 apply** —— 就是本片主題 |
| f | `:416-423` | 5c 可繞過:`(a.manual_reviewed_at) IS NULL` / `IS NOT DISTINCT FROM NULL` / 上游 CTE 預先過濾 | 守門**失去判別力**(假綠) |
| g | `:419-423` | regex 只剝 `--`,**不剝 block comment** ⇒ 有人寫 `/* … */` 會**誤紅** | 假紅 |

### 乙類:**敘述**(不影響執行,而它們會被人讀去做決定)
| 代號 | 位置 | 載體 | 🔴 逃不逃得出 repo |
|---|---|---|---|
| b | `:20-22, :100` | `--` 註解 | 否 |
| c | `:39-41, :56, :79, :222-223` | `--` 註解 | 否 |
| d | `:97`(COMMENT ON)、`:320-321`、`:352`(COMMENT ON) | **部分是 `COMMENT ON`** | 🔴 **是** ⇒ 進 `pg_description` |
| e | `:160-165` | `--` 註解 | 否 |
| h | `:102-106, :213` | `--` + COMMENT ON | 部分是 |
| i | `:352` | COMMENT ON | 🔴 是 |

🔴 **兩類要分開驗**:
- **甲類**只能靠**拋棄式 PG 實跑 + 雙向突變**(該綠有綠、該紅有紅)。
- **乙類**要靠 **apply 之後查 `pg_description` 本身**,不是 grep repo ——
  前一片已經證明過:repo 裡的樣子 ≠ 資料庫裡的樣子,而**只有後者是人在正式庫會讀到的**。

---

## 5. 建議的片界(要主視窗裁)

```
片一（本 plan 的主體）：甲類 a + f + g —— 讓那支【真的 apply 得起來】且守門不假綠/不假紅
片二：乙類 b–e、h、i —— 全檔敘述對齊；其中 COMMENT ON 那幾處優先（它們逃出 repo）
```
**理由**:甲類是「能不能按下去」,乙類是「按下去之後別人讀到什麼」。
**綁在一片會讓審查同時看兩個東西**(主視窗 2026-08-19 已用同一理由裁過一次)。

---

## 6. 驗收(逐條 yes/no)

```
□ 有 supabase_admin(SUPERUSER) 的庫 ⇒ apply rc=0
□ 🔴 GRANT service_role 給一個【非 superuser】的新角色 ⇒ apply 必炸，且訊息印得出角色名
□ f:三種繞過寫法各構造一次 ⇒ 5c 必須各自紅（若擋不住，要在該處明寫「這道尺擋不到什麼」）
□ g:在 COMMENT/函式體放一段 block comment 包住那個字面 ⇒ 不得誤紅
□ 乙類每一句改完，apply 到乾淨庫後【查 pg_description】確認新舊字面（不是 grep repo）
□ 四綠 TURBO_FORCE=1
□ 🔴 鐵則 12③ ⇒ commit 前 codex 對抗審查不降級
□ 🔴 不 apply、不 push
```

## 7. 誠實揭示

```
· ~~「正式庫有 supabase_admin」我查不到 ⇒ 甲/乙 誰成立是未確認~~
  ✅ **已升級成【量到的】**（§3：Sean 本人跑 SQL、逐字轉錄）⇒ **分支甲成立。**
  🔴 而這一行【我差點忘了改】—— 它與 §3 在同一份檔裡互相打架了幾分鐘。
     **同一份檔內的兩處,一處更新一處沒有** ⇒ 那正是今天被抓過兩次的形狀（W6 的 M1）。
· 我本機實測的是【造一個 superuser 會讓它炸】—— 那證**機制**;
  而【正式庫真的有那個角色】是 Sean 那一發證的。**兩件事、兩個來源,不要合併成一句。**
· 🔴 而**仍然未確認的是另一格**：除了 superuser 之外還有沒有別的 service_role 傳遞成員
  ⇒ 那要 §3.5 那第二句 SQL，**而它會決定本片是「修誤紅」還是「先處理一個真的缺口」**。
· f 的三種繞過寫法是 codex 提的，**我沒有逐一構造過** ⇒ 驗收那一格是要去做的，不是已知的。
· 本 plan 沒有處理 #665（成員閉包推廣到其他受控窗）—— 那是全樹的事，另立。
  ⚠️ 而它與本片有依賴：**推廣之前要先解掉 superuser 誤紅**，否則等於把一個會誤紅的斷言複製到更多支。
```
