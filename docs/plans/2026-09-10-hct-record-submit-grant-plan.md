# ⟦ship-HCTSUBMITNOGRANT⟧ 後台按「送新竹」被自己的權限擋住 —— 補一行 GRANT

> **狀態**:codex R1 = **3 must-fix,全折**(§8)· Sean 2026-09-10 拍甲(補,而走完整流程)· **待貼**。
> **來源**:2026-09-10 第一箱實按(`S9FC6P`),畫面逐字 `permission denied for function admin_record_hct_submit`。

---

## §0 一句話

**`admin_record_hct_submit` 少了它【整族都有】的那一行 `GRANT EXECUTE … TO service_role`
⇒ 後台按「送新竹」在【打電話給新竹之前】被我們自己擋住 ⇒ 第一箱送不出去。**

🟢 **而它 fail-closed** —— 擋在佔位列之前 ⇒ 零 HTTP、零託運單、那一箱仍是乾淨的 `draft`。

---

## §1 讀數(2026-09-10 唯讀正式庫)

### 1-a 簽章 —— **只有 1 支多載**(GRANT 是對簽章給的,這一格決定要寫幾行)

```
簽章      admin_record_hct_submit(text,text,text,jsonb)
參數      p_shipment_reference text, p_status text, p_request_id text, p_raw jsonb
回傳      void
secdef    t
proconfig search_path=""
proacl    postgres=X/postgres          ← 🔴 只有 owner
本體 md5   d88b332249d3a72ff4b3dd9306f0c2ce
```
⚪ 負對照:同一把尺問一個現造函式名 ⇒ **0 筆**。
🔵 那個 md5 與 `docs/reviews/2026-09-09-窗B-十列查證結果.md` §15 記的**逐字相同** ⇒ 這支從 09-09 到今天沒被動過。

### 1-b 全族對照 —— **它是唯一沒有的那一個**

```
admin_record_hct_submit                    postgres=X/postgres                          🔴
admin_hct_reset_unknown_to_draft           postgres=X/postgres,service_role=X/postgres  ✅
admin_record_hct_unknown_reason            postgres=X/postgres,service_role=X/postgres  ✅
🟢 正對照(後台按得動的兩支)
admin_cancel_order                         postgres=X/postgres,service_role=X/postgres  ✅
admin_record_manual_payment                postgres=X/postgres,service_role=X/postgres  ✅
⚪ pcm_b2_shipments_hct_request_id_write_once  postgres=X/postgres
   ← trigger 函式, **本來就不該有** ⇒ 🛑 本片不動它, 只記在這裡
```

### 1-c 行為證據(這一格答的是「它現在真的叫不動」,不是「它的 proacl 長怎樣」)

第一箱實按 ⇒ 畫面逐字 `permission denied for function admin_record_hct_submit`;
而那一箱三欄 `hct_status=draft` · `hct_request_id=null` · `hct_raw_response=null`
⇒ 📌 **連佔位列都沒寫進去** ⇒ 零 HTTP。

🔵 **順帶答出一件本來沒有人證得出來的事**:`shipment-submit-hct-action.ts` 的順序是
①閘 → ②截斷確認 → ③佔位列 → ④HTTP,而閘關著會在①逐字回「新竹未開通」並**在任何副作用之前 return**。
⇒ 我們拿到的是③的錯 ⇒ **它通過了①** ⇒ 🎯 **`HCT_SUBMIT_ENABLED` 現在是 `true`,而那是【行為】證的不是讀值。**

---

## §2 🔴 為什麼只有它漏了 —— 而答案不是「後來加的沒跟上」,是**相反**

```
20260904170000_m4b_hct_record_submit_result.sql:179   REVOKE ALL … FROM PUBLIC, anon, authenticated;
                                                       🔴 而【沒有】任何一行 GRANT
20260905320000_m4b_hct_reset_unknown_to_draft.sql:198  REVOKE ALL … FROM PUBLIC, anon, authenticated;
                                             :200      GRANT EXECUTE … TO service_role;   ✅
20260908020000_m4b_hct_record_unknown_reason.sql       同上形狀 ✅
```
⇒ 📌 **`admin_record_hct_submit` 是這一族【最早】那一支** —— 後面兩支才把形狀補齊。
⇒ 🎯 **不是「新的沒跟上舊的」,是「舊的沒有形狀可抄,而後來的人抄了彼此」。**
🛑 **⇒ 所以不必去掃全庫**:同一支 migration 只建了兩個可授權物件,另一個是 trigger 函式(本來就不該有 GRANT)。
⚠️ **而射程要收窄**(codex R1 nit ④ 訂正):這只支持「**那支檔沒有第二支需要補相同 EXECUTE 的一般 RPC**」,
**不能**從物件數量推出「那支檔沒有任何其他行為 / 權限 / 並發問題」,也**不能**推出別的 migration 沒有同型問題。
⇒ 📌 **本片不掃全庫的理由是【任務範圍】, 不是【已證明全庫不用查】。**

### 2-a 🔴🔴 而更值得記的是:**那支 migration 的收權斷言【跑了、綠了、而它問的是反方向】**

`20260904170000:220-236` 的後置閘③逐字三格:
```
③a  anon          叫得動 ⇒ RAISE     ← 問「誰【不該】有」
③b  authenticated 叫得動 ⇒ RAISE     ← 問「誰【不該】有」
③d  postgres      叫不動 ⇒ RAISE     ← 負對照(證明上面兩個 false 有判別力)
```
🎯 **三格全綠,而【沒有一格在問「該有的那個角色有沒有」】。**
📌 而 ③d 用的是 `postgres`(owner)—— **owner 對 SECDEF 函式恆為 true** ⇒ 那個負對照證明了
「這把尺會動」,**而它量的是另一個方向**。
⇒ 🛑 **「收權斷言」這個名字本身就說了它的射程:它防【多給】,不防【沒給】。**
⇒ ✅ **所以本片的驗收必須有一格【失敗方向】**(見 §4),否則會複製同一個形狀。

---

## §3 修法 —— 一行,而形狀從線上取不自己寫

```sql
GRANT EXECUTE ON FUNCTION public.admin_record_hct_submit(text,text,text,jsonb)
  TO service_role;
```
🔵 **形狀抄兄弟那支**(`20260905320000:200-201` 逐字),而簽章取自線上 `pg_get_function_arguments`(§1-a),
**不是憑記憶** —— 2026-09-09 我在 `admin_record_manual_refund` 上腦補過簽章、被 codex R1 抓到。

**不做的事(逐條寫出來,免得下一個人以為漏了)**:
- ⛔ **不動函式本體** —— 這一片零行為變更,`prosrc` 的 md5 貼前貼後必須相同。
- ⛔ **不補 `REVOKE`** —— 那一行 `20260904170000:179` 已經有了,而 `GRANT` 不會把它取消。
- ⛔ **不動 `pcm_b2_shipments_hct_request_id_write_once()`** —— trigger 函式沒有 GRANT 是對的。
- ⛔ **不去掃全庫找同型** —— §2 已經答出射程只有那一支檔,而掃全庫是另一件事。

---

## §4 驗收 —— **兩個方向都要有一格**

🛑 **只驗「GRANT 之後叫得動」是不夠的** —— 那一格在「`has_function_privilege` 對誰都回 true」
的世界裡也會綠。而昨晚全隊踩過同型:**`has_*_privilege` 印 true ≠ 它真的叫得動。**

拋棄式 PG 17.10,最小 fixture(`shipments` 六欄 + `service_role` 角色):
```
[1] GRANT 之前 · SET ROLE service_role · 呼叫  ⇒ 🔴 必須 permission denied(42501)
[2] 貼 migration
[3] GRANT 之後 · SET ROLE service_role · 呼叫  ⇒ 🟢 必須成功, 而且【那一列真的被改了】
    📌 不只看「沒有拋例外」—— 要 SELECT 回來確認 hct_status 真的變了
[4] ⚪ 負對照:anon / authenticated 在 GRANT 之後【仍然】叫不動 ⇒ 這一行沒有開錯門
[5] ⚪ 突變:再貼一次 ⇒ 防重貼閘必須紅
[6] rollback 實跑 + 空跑, 而【退回去之後行為上真的又擋住】
```
🔵 **[1] 是這份 plan 的重點** —— 它證明的是「這一行有在承重」,而不是「貼上去沒有壞掉」。

**貼後對帳(唯讀,一發)**:
```
proacl          postgres=X/postgres,service_role=X/postgres   ← 與兄弟逐字相同
prosrc md5      d88b332249d3a72ff4b3dd9306f0c2ce              ← 🔴 與貼前【相同】(零行為變更)
anon/authenticated has_function_privilege ⇒ f / f
```

### 4-a 🔬 **實跑結果(拋棄式 PG 17.10,2026-09-10;跑完已收攤)**

fixture = 真的那支函式(從 `20260904170000:113-177` 逐字抽出來貼)+ `shipments` 六欄
+ 三個角色 + 兄弟那支的最小同形 + 與正式庫同形的 REVOKE/GRANT。

```
🟢🟢 意外收穫:拋棄式上那支的 prosrc md5 = d88b332249d3a72ff4b3dd9306f0c2ce
   ← 與正式庫【逐字相同】⇒ 📌 這順便證明了正式庫那支【就是 20260904170000 那一代】
     (本檔 §7-2 原本把它列為「靠一致性推的」—— 這一格把它從【推】升成【量】。)

[1] 🔴 GRANT 之前 · SET ROLE service_role · 呼叫
    ⇒ ERROR: permission denied for function admin_record_hct_submit
    🎯 與正式後台畫面上那句【逐字相同】⇒ 這個 fixture 重現的是同一個世界
[1b] has_function_privilege(service_role) ⇒ f    (兩把尺同向)
[2] 貼 migration ⇒ GRANT · 後置閘全過 · NOTICE 印出
[3] 🟢 GRANT 之後 · SET ROLE service_role · 呼叫 ⇒ 成功
    而且那一列【真的被改了】(不只是沒拋例外):
      shipment_reference | hct_status | hct_request_id | hct_raw_response
      S9FC6P             | submitted  | 1234567890     | {"success": "Y"}
[4] ⚪ 負對照三格全 f:anon · authenticated · service_role 對那支 trigger 函式
[5] 突變:再貼一次 ⇒ 前置閘③ 紅(「已經叫得動了 ⇒ 拒重貼」)
[6] rollback 實跑 ⇒ NOTICE 印出;退後 service_role = f,而兄弟那支【仍是 t】(正對照,沒退過頭)
[7] rollback 空跑 ⇒ 回退前置閘② 紅(「本來就叫不動 ⇒ 拒空跑」)
[8] 🔴 退回去之後【行為上】再叫一次 ⇒ ERROR: permission denied
    📌 這一格買的是「回退真的回得去」, 而不只是 proacl 上少了一個字
```

🎯 **[1] 與 [8] 是這份 plan 的重點** —— 它們證明的是「這一行有在承重」,
而不是「貼上去沒有壞掉」。**只驗成功方向的話,一個 `has_*_privilege` 恆回 true 的世界也會全綠。**

### 4-b 🔴 **codex R1 三條 must-fix 的突變驗證(全部在拋棄式 PG 上真的跑出來)**

```
突變 A(MF1 · STRICT)
  ALTER FUNCTION … STRICT  ⇒ 前置閘⑥a 紅:
    「那支函式是 STRICT ⇒ requestId=NULL 那一發會【安靜地跳過本體】而不報錯 ⇒ 佔位保護失效, 拒貼」
  🔴 而我【把那個世界真的演出來】, 不是讀文件相信它:
    STRICT 之下 SET ROLE service_role 呼叫 (…, NULL, …)
      ⇒ 回 NULL、**零錯誤**;而那一列仍是 `draft / raw=(null)`
    ⇒ 📌 **佔位一個字都沒寫, 而呼叫端看起來完全成功** ⇒ TS 會照樣送 HTTP。
    🎯 **本體 md5 一模一樣, 而行為完全相反** —— 那正是 codex 說「只釘 prosrc 不夠」的意思。

突變 B(MF2 · 角色切換)
  GRANT service_role TO anon WITH INHERIT FALSE, SET TRUE
  ⇒ has_function_privilege('anon', …) **仍然是 f**(舊閘看不到)
  ⇒ 而後置閘⑤a 紅:「anon 是 service_role 的成員 ⇒ 它可以 SET ROLE 之後叫得動, 而②看不到」

突變 C(MF3 · rollback 不得被歷史本體擋住)
  貼好 GRANT ⇒ 合法改本體(補一行註解, md5 變成 5cca1159b74fb4814a3f02bb01533198)
  ⇒ 跑 rollback ⇒ NOTICE「⚠️ 提醒(不擋):md5 已不是那一版 …撤權照做了」
  ⇒ 🔴 **service_role = f** ⇒ **撤得掉。**
  📌 舊版在這一格會 RAISE ⇒ 整筆交易回滾 ⇒ **REVOKE 也被取消, 權限留著**
     ⇒ 🎯 **一道為了安全而寫的閘, 在災難當下擋住逃生門。**
```

---

## §5 rollback

```sql
REVOKE EXECUTE ON FUNCTION public.admin_record_hct_submit(text,text,text,jsonb)
  FROM service_role;
```
🔵 **退回去的後果是明確的**:後台那顆「送新竹」又會回到今天的樣子(按了印 permission denied、零 HTTP)。
⇒ 📌 **那不是資料壞掉,是回到一個【擋住】的狀態** —— 而擋住的方向是安全的那一側。
🛑 而 rollback 要有前置閘:**先確認現在真的有那個 GRANT**,否則是空跑而執行的人以為自己退了。

---

## §6 影響

- **客人**:今天 0(第一箱還沒送出去)。修好之後第一箱才送得出去。
- **Sean**:那顆「送新竹」從「按了印一句資料庫錯誤」變成「真的會送」。
  🛑 **而那正是要小心的地方** —— 修好之後那顆鈕是**真的**了。
- **其他線**:零。這一行只對一支函式、一個角色。

---

## §7 本檔證不到什麼

1. **我沒有量「`service_role` 就是後台用的那個角色」** —— 我是從
   「兄弟那兩支給的是它、而正對照 `admin_cancel_order` / `admin_record_manual_payment` 也是它」推的。
   ⇒ 📌 **那是【一致性】不是【證據】。** 而它會在貼完之後那一按上被證實或推翻。
2. **我沒讀 `getHctShipment` / `recordHctSubmit` 那一層用哪把鑰匙** —— 同上,靠一致性。
3. **§2 的射程只涵蓋那一支 migration** —— 全庫還有沒有別的「REVOKE 了而忘了 GRANT」,**本檔不答**。
4. **貼完之後那一按會不會成功,本檔答不出來** —— 它只移除【這一個】已知的擋路者;
   端點路徑那格(postman 用 `_test` 而我們不用)**仍然證不到**。
5. ⛔ ~~「正式庫那支是不是 `20260904170000` 那一代,靠一致性推的」~~
   ✅ **§4-a 把它升成量的了**:拋棄式上從那支 migration 逐字建出來的函式,
   `prosrc` md5 與正式庫**逐字相同**。
6. ⚠️ **「餵一個現造角色名給 `has_function_privilege`」那一格我【沒跑】** ——
   §4 原本列了它,而 §4-a 實跑的是另一組負對照(anon / authenticated / trigger 函式三格全 f)。
   ⇒ 📌 **兩者買的東西不同**:前者驗「這把尺對不存在的角色會不會安靜回 false」,
   後者驗「這一行沒有開錯門」。**我做了後者,前者是缺口。**
7. 🔴 **間接呼叫鏈沒有排除**(codex R1 nit ⑤):若存在一支**客人叫得動、而 owner 是 `service_role`
   的 SECDEF wrapper**,內部呼叫本函式 ⇒ **這次 GRANT 會讓原本失敗的間接呼叫成功**,
   而 `anon` / `authenticated` 對本函式的檢查**仍然全 false** ⇒ 📌 **後置閘②看不到那條路。**
   🔵 我讀到的應用層路徑是 `authorizeAdminMutation` → 後端 service client → RPC(有 session / Origin / actor 檢查),
   **沒找到讓一般客人繞過的路** —— 而那是**讀碼**,不是正式庫的 wrapper / 角色拓樸證據。
   ⚠️ 而 `search_path=''` 管的是**名稱解析安全**,它**不驗原始呼叫者的身分**。
8. **fixture 的 `shipments` 只有六欄**(函式體用得到的那幾欄)⇒ 它重現的是**權限那一層**,
   **不是**正式庫那張表的完整約束 ⇒ 📌 本檔證的是「這一行 GRANT 有沒有用」,
   不是「那支函式在正式庫的所有資料上都跑得對」。

---

## §8 codex R1(`gpt-6-astra`,唯讀)—— **3 must-fix / 7 nit,逐條交代**

🔬 它自陳:審查前後三檔 SHA-256 相同、未改檔、未連正式庫、未實跑。

### must-fix(3,全折,而每一條都補了一格會紅的突變)

| # | 它說的 | 我做的 |
| --- | --- | --- |
| ① 只釘 `prosrc`,放過 `proisstrict=true` 的世界 | **成立而且嚴重** —— STRICT 下 `requestId=NULL` 會**靜靜跳過本體**、不報錯 ⇒ 佔位保護失效而全綠 | 前置閘⑥ 加 `proisstrict / prosecdef / proconfig / owner` 四格;**突變 A 實跑演出那個世界**(§4-b) |
| ② 後置閘漏掉「不繼承但可切角色」 | **成立** —— `INHERIT FALSE, SET TRUE` 的 membership 讓 `has_function_privilege('anon')` 仍回 f | 後置閘⑤ 改用 `pg_has_role(…,'MEMBER')` 問 anon / authenticated;**突變 B 實跑** |
| ③ rollback 把撤權綁在歷史 md5 上 | **成立,而且方向最糟** —— 本體合法改過 ⇒ RAISE ⇒ 交易回滾 ⇒ **REVOKE 一起被取消** | md5 降成 `RAISE NOTICE` 不擋;**突變 C 實跑:本體改過之後仍然撤得掉** |

🔬 **今天正式庫的實量(這三條反例目前【都不成立】,而閘是為了「哪天成立」)**:
```
admin_record_hct_submit   strict=f · secdef=t · volatile=v · owner=postgres · search_path=""
anon / authenticated 對 service_role:pg_has_role MEMBER = f / f · USAGE = f / f
⚠️ 而 authenticator 【是】service_role 的成員(inherit_option=f · set_option=t)
   ⇒ 那是 PostgREST 的設計(它按請求切成 anon/authenticated/service_role)⇒ 本閘不擋它
🟢 正對照 pg_has_role('service_role','service_role','MEMBER') = t
```

### nit(7)—— **逐條,而其中三條我改了碼不只改字**

1. **前置閘③ 量的是有效權限不是貼過紀錄** ⇒ ✅ 收下,**保留現寫法**(它是保守拒絕、不會開錯門),
   而它的射程寫進註解。⚠️ 而它訂正我一句方向講反的話:
   「`GRANT service_role TO x`」是 **x 取得 service_role 的成員資格**,不是反過來 —— **它對,我記錯了。**
2. **後置閘④ 的 `LIKE '%service_role=X/%'` 有假陽性**(`_` 是單字元萬用字元 ⇒ `serviceZrole=…` 也命中)
   ⇒ ✅ **改碼**:換成 `aclexplode` 逐項比 grantee / privilege_type / grantor,恰好 1 項。
3. **forward 的固定 md5 會拒絕語意相同的版本** ⇒ ✅ 收下,**刻意保留**(那是本片要的:本體變了就該停下來看),
   而它的射程寫進 §7-5。
4. **§2「沒有第二個洞」超出證據** ⇒ ✅ **改字**:射程收窄成「沒有第二支需要補相同 EXECUTE 的一般 RPC」,
   不是「那支檔沒有任何其他問題」。
5. **§7 漏了間接呼叫鏈與角色拓樸** ⇒ ✅ **補進 §7**(見下)。
6. **rollback 的「零 HTTP / 不會卡住」不涵蓋在途請求** ⇒ ✅ **改字**:寫進 rollback 檔頭 ——
   已寫好 unknown 佔位、正在等新竹回應的請求,這一刻撤權 ⇒ **那一箱會留在 unknown** ⇒ 退之前要先停送、等一輪。
7. **兩句 PostgreSQL 語意不精確** ⇒ ✅ **改字 + 改碼**:
   ⛔ ~~「owner 對 SECDEF 恆為 true」~~ —— **錯的**,非 superuser 的 owner 撤得掉自己的
   ⇒ 後置閘③ 的負對照**從 owner 換成兄弟那支**;
   ⛔ ~~「餵現造角色名 ⇒ 安靜回 false」~~ —— 它會**報錯**,所以那格本來就當不了負對照(而我本來就沒跑)。

### 🟢 而它反駁掉我一個擔心

我問「rollback 之後會不會留下一個空的 ACL 條目、讓再貼閘誤判」⇒ **它答:不成立。**
PostgreSQL 會刪掉權限歸零的 ACL 項目,撤權後回到 `{postgres=X/postgres}`,不會留 `service_role=/postgres`。
📌 **我拿一個假設去問,而它拿原始碼回答我「那個假設不存在」** —— 這一格省掉一道我本來要加的閘。
