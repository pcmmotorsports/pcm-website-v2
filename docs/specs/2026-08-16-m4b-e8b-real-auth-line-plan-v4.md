# M-4b E8-B「真登入線」slice plan v4(2026-08-16)

> ## 🔴 2026-08-18 更正 —— 原檔頭寫「等 Sean 批」,而他早就批了
>
> ~~**狀態:等 Sean 批(鐵則 8)。**~~ ⇒ **原句保留劃掉,不刪。批准早於本次更正。**
>
> ✅ **Sean 已批,逐字就是「批准」**(**我當場開檔核過,不是轉來的**):
> ```
> memory project_m4b-real-auth-line-decisions.md:98
> 「逐字：`批准`。對象＝docs/specs/2026-08-16-m4b-e8b-real-auth-line-plan-v4.md
>   （commit 7b08001b，256 行 7 片）」
> ```
> 🔴 那條 memory **指名了本檔、附了 commit 與行數** ⇒ 沒有「是不是在講這一份」的模糊空間。
>
> ✅ **而原句的後半【仍然有效,不要跟著劃掉】**:
> **「批准後第一個動作是 B0,不是寫 code。」**
> ⇒ 這是**做法上的約束**,與「批准與否」是兩件事;批准下來之後它才開始生效。
> 📎 這正是本輪的母題:**一句話裡可以同時有「已過期的狀態」與「仍成立的規則」,
> 劃掉整句會把規則一起殺掉。**(同族:`max-rows` plan 那句「零餘裕」——**規則沒過期,例子過期了**。)
> **本檔取代 `2026-07-27-m4b-e8b-real-auth-line-plan.md` v3 的 §2-§8;v3 的 §9(codex 17 條對帳)與 §0(拍板史)仍有效、不重抄。**
> **寫於 2026-08-16。§1.2 的數字量法在「量法附錄 A」、§1.3 的逐條附 `檔案:行號`。**
> **⚠️ 而 §1.3 那一批量在一棵落後 16 顆的樹上,見 §1.3 檔頭與 §7-1 —— 不是「當下」。**

---

## §0 這份 plan 為什麼現在存在

2026-07-27 晚 Sean 自己拍 `Q1'=A`「先做 E10 訂單閉環、E8-B 真認證線押後」,且是在聽完
「已有 2 人共用密碼、預計 3-5 人」的資安顧慮後**二次確認**的。

2026-08-16 早上,主視窗把「沒選身分 ⇒ 寫入靜默失效」出成一題「要不要把擋板補好」。
Sean 的第一反應不是選項,是反問(逐字):

> 「我們這個不是要跟報價單登入帳號做再一起嗎?怎麼又回到要先選身份?這不是走回頭路嗎?」

**⇒ 重問後 Sean 拍【甲｜真登入現在做】**,明知代價(一條線、訂單線讓路)。

🔴 **可複用的判別句**:**我出的選項,是不是全都站在同一個【當初是拍板、現在可能過期】的前提上?**
**選項全在同一前提底下 ⇒ 那個前提永遠不會被問到。**

**本線一上線,`#534`(身分沒設⇒寫入靜默失效)與 `#536`(身分清不掉⇒稽核記錯人)自動消失,
兩條都不補擋板**(Sean 2026-08-16 拍板)。

📎 **同日 Sean 主動重申的威脅模型(定調,以後不再問「要不要對員工分權」)**
**—— 以下是 Sean 逐字,不是我方的盤點結論**(載體 `~/pcm-mailbox/主-SEAN-決策單-20260816.md:51`):
> 「所有員工都可以看到客戶資料**沒有分權限**,我唯一擔心就是**資料被駭客攻擊**而已。」

⇒ **內部不分權 = 刻意的。本線的目的不是「限制員工能做什麼」,是「知道是誰做的」。**
⇒ 任何「要不要加角色矩陣 / 權限分級」的設計衝動,在本線一律是範圍擴張,擋掉。

---

## §1 現況(2026-08-16 實查,逐條附量法)

### 1.1 進後台的真實路徑

```
員工 → 報價單站登入(全公司共用一組密碼) → SSO 跳 admin → 自己從下拉挑一個名字
```

### 1.2 admin 端(本 repo,主視窗親查,可複驗)

| 事實 | 證據 |
|---|---|
| admin 端**零登入機制** | `git grep -nE 'signIn\|signOut\|admin_users' -- apps/admin/src` ⇒ 只命中測試檔的 mock,零實作 |
| 身分是使用者自選的 cookie,**自陳非授權邊界** | `apps/admin/src/lib/session/actor.ts:5-7` 逐字「這**不是**登入 / 授權邊界」 |
| SSO session payload **不帶是誰** | `apps/admin/src/lib/session/session.ts:15-16` 逐字「SSO 只帶認證(amr/auth_time)、無 per-user 身分」 |
| 真 server action **模組**共 **19** 支,~~**17** 支~~ **⇒ 2026-08-17 重量 = 18 支模組【含】共用授權閘**<br>🔴 **是「模組含有字面」,不是「每一支 exported action 都先走閘」**(codex 2026-08-17 `must-fix`):`git grep -l` 是**檔級篩子**,一個模組裡五支 action 只有一支加閘也會被算進來。**函式級證明本表沒有,缺的那道 = 逐支 exported action 確認第一個授權動作** | 量法見下方「量法附錄 A」;**2026-08-17 B 窗當場重跑的那條(數字旁邊帶量法,表被抄走時它跟著走)**:<br>`git grep -lE "^[[:space:]]*['\"]use server['\"]" apps/admin \| grep -v '\.test\.' \| wc -l` ⇒ **19**(分母)<br>`comm -12 <(上式排序) <(git grep -l 'authorizeAdminMutation' apps/admin \| grep -v '\.test\.' \| sort) \| wc -l` ⇒ **18** |
| ~~沒走閘的 **2** 支~~ **⇒ 2026-08-17 重量 = 只剩 1 支** | ✅ **仍沒走閘**:`lib/session/actor-actions.ts`(選身分本人,本線上線後整支下架)<br>⛔ ~~`lib/shipping/shipment-actions.ts`(**真缺口**)~~ **已補上,不再是缺口**(2026-08-17 量到 `apps/admin/src/lib/shipping/shipment-actions.ts:23` `import { authorizeAdminMutation }` / `:113` `const auth = await authorizeAdminMutation();`) |
| SSO 收端很小 | `lib/sso/exchange.ts` 91 行 / `app/api/sso/callback/route.ts` 83 行 / `lib/session/session.ts` 161 行 / `actor.ts` 35 行 |

🔴 **v3 的 codex F1 已過期**:它指控 `apps/admin/src/lib/orders/status-option-actions.ts` 自拼三道檢查繞過共用閘。
**該檔 2026-08-16 實查【不存在】**(`find apps/admin/src -name '*status-option*'` 零命中),
`lib/staff-actions.ts` 也已改成走閘(`git grep -c authorizeAdminMutation` = 4)。
⛔ ~~**⇒ F1 的「兩條授權路徑」現在是【一條閘 + 一支漏網的 `shipment-actions.ts`】。**~~
🔴 **2026-08-17 重量後更正**:`shipment-actions.ts` **已經走閘了**(`:23` import / `:113` 呼叫)
⇒ **現在是【一條閘 + 一支仍未走閘的 `actor-actions.ts`】**,而那一支依 §1.2 表與 §4 `B6`
**本線上線後整支下架** ⇒ **它的狀態是「預定退場」,不是「待補的漏網」。**
⚠️ **本次只更新「現在是什麼」,不動任何決定。**
🔴 上一版我在這裡多寫了一句施工指令(「不要給它補閘」)—— **那是【應該做什麼】,超出本次授權,已移除**
(codex 2026-08-17 `must-fix`)。該指引寫在 B3 spec §7.1 涵蓋證明那節,**不在本 plan**。

### 1.3 報價單端(`~/API大量上架/PCM報價單-V2`)

⛔ ~~🔴🔴 **口徑硬約束:以下全部量於【本機 HEAD `3fc905f`】,而它落後 `origin/main` 16 顆。**
**⇒ 這些不是「報價單的現況」,是「16 顆之前的現況」。B0 第一件事是 pull 後逐條複量。**
**⇒ 任何人引用本節,必須連這一句一起引。**~~

> ## ✅ 2026-08-18T16:0x · **B0 那件「pull 後逐條複量」做完了**(G5)
>
> **Sean 已從 mac mini 推;報價單已 fast-forward pull。**
> **當場量(不是抄別人的)**:`HEAD = 1149e05`(2026-08-18 15:09)= `origin/main`,
> **落後 0 / 超前 0 / 工作樹 0 dirty**。(先前的 `3fc905f` 落後的其實是 **22 顆**,不是 16 —— 那期間他又推了。)
>
> **⇒ 下表 10 列【逐列複量,全部維持成立,零列需要改】。** 逐列量法與命中:
> | # | 複量結果(HEAD `1149e05`) |
> |---|---|
> | 共用密碼 | `login/route.ts:136` 逐字 `const expected = process.env.ADMIN_PASSWORD;` **字面與行號皆不變** |
> | body 零 per-user 欄 | `:146-151` 仍是 `password / code / recoveryCode / setupSecret` **四欄** |
> | 無 `admin_users` / 無密碼雜湊表 | 四種 pattern 各 **0 檔**(正向對照 `sso_codes` ⇒ **7 檔** ⇒ 尺是活的) |
> | SSO payload 兩欄 | `authorize/route.ts:58-64` 寫入 / `exchange/route.ts:71` 回傳,**皆不變** |
> | `totp_devices` 13 欄無 `user_id` | 當場數:**13 欄**(排除 CONSTRAINT 行)、`user_id` 命中 **0** |
> | `recovery_codes` 7 欄無 `user_id` | **7 欄**、`user_id` **0** |
> | `auth_state` `CHECK(id)` 單列 + `last_consumed_step` 全域單值 | 兩者都在(`CONSTRAINT auth_state_id_check CHECK ((id`…)、`last_consumed_step bigint DEFAULT 0 NOT NULL`) |
> | 零密碼雜湊函式庫 | `bcrypt/argon2/jose/iron-session/next-auth/jsonwebtoken` 各 **0**;正向對照 `otpauth` ⇒ `package.json:32` |
> | session 手刻 `crypto.subtle` HMAC | `lib/session.ts:7` 檔頭格式註解、`:46` `crypto.subtle.importKey` **皆在** |
> | 禁 `supabase db push` | `docs/ops/MULTI_WINDOW_WORKFLOW.md:165` 逐字「**絕不跑 `supabase db push`**:報價單庫的 migration ledger 已知與本地檔失同步」 |
>
> 🔴 **而那 22 顆為什麼一列都沒動到**:`git diff --name-only 482bec5..1149e05` ⇒ **9 個檔,全是
> `fetchers/` `lib/translators/` `scripts/` `tests/`** —— **零個 auth / session / migration 檔**
> (正向對照:同一條命令對 `tests/` ⇒ 3 檔)。
> ⚠️ **仍成立的限定**:這是 Sean 08-18 15:09 那一顆;**他再推,本段就過期** ⇒ 引用時帶時點。

| 事實 | 證據(本機 `3fc905f`) |
|---|---|
| 第一因子仍是**全站共用密碼** | `app/api/admin/login/route.ts:136` 逐字 `const expected = process.env.ADMIN_PASSWORD;` |
| 登入 body **零 per-user 欄位** | 同檔 `:146-151`,只有 `password / code / recoveryCode / setupSecret` |
| **沒有** `admin_users` 或任何存密碼雜湊的表 | 四種 pattern 全 repo 皆 0:`admin_users` / `password_hash` / `bcrypt\|argon` / `CREATE TABLE.*user` |
| SSO payload 逐字**兩欄** | `app/api/sso/authorize/route.ts:58-64` 寫入 `amr` + `auth_time`;`exchange/route.ts:71` 回傳同兩欄 |
| `totp_devices` **13 欄、無 `user_id`** | `supabase/migrations/20260730000000_baseline_schema.sql:5029-5044` |
| `recovery_codes` **7 欄、無 `user_id`** | 同檔 `:4674-4682` |
| `auth_state` 是 **`CHECK(id)` 鎖死的單列表**,`last_consumed_step` **全域單值** | 同檔 `:3281-3291` |
| **零密碼雜湊函式庫** | `package.json` 對 `bcrypt\|argon2\|jose\|iron-session\|next-auth\|jsonwebtoken` 全零命中;唯一相關是 `otpauth ^9.5.1`(`:32`) |
| session 簽章是**手刻** `crypto.subtle` HMAC | `lib/session.ts:7`(格式註解)、`:46`(subtle 呼叫) |
| 🔴 **migration 紀律:`supabase db push` 明文禁用** | `docs/ops/MULTI_WINDOW_WORKFLOW.md:165` 逐字;唯一合法管道 = MCP `apply_migration`(`CLAUDE.md:37-39`) |

### 1.4 已經在的地基(不要重新發明)

- admin 端 HMAC session 簽/驗(`session.ts`,runtime-neutral 硬規則已驗)
- SSO code 兌換全鏈(authorize / exchange / callback / state)
- A庫 `staff` 表 + `resolveStaff()` 白名單 + `admin_audit_log`
- 共用授權閘 `authorizeAdminMutation`,~~**17 支已接**~~ **⇒ 2026-08-17 重量 = 18 個模組已接**
  (量法與射程限定見 §1.2 那一列;🔴 **檔級篩子,非函式級證明**)
- 報價單端 `login_rate_buckets` 限速、`safeEqualHex` 常數時間比對

---

## §2 目標與非目標

**目標(全部三條,缺一不算完成)**
1. 每個員工有自己的帳號 + 密碼
2. 登入後系統**自己知道他是誰**,身分不再是使用者挑的
3. `admin_audit_log.actor` 從裝飾變成真證據 ⇒ `#534` / `#536` 一併關閉

**非目標(寫進來是為了擋範圍擴張)**
- ❌ 員工自助註冊(Q8=A:初始密碼 Sean 指定)
- ❌ 角色 / 權限矩陣(§0 威脅模型:內部不分權是刻意的)
- ❌ 2FA per-user 化(Q5=A:第一期完全不碰,另立 E8-C)
- ❌ 記住裝置子系統(隨 2FA 一起延後)
- ❌ 供應商主檔 E12

---

## §3 兩個要先定的決策(D0-a 給 Sean、D0-b 我自己拍)

### 🔴 D0-a 密碼這套東西「自己刻」還是「用平台內建」—— 要 Sean 拍

**v3 的做法是自己刻**:選一套慢速加密演算法、自己防「猜帳號」、自己做每個帳號的鎖定次數、
自己做忘記密碼。**而那正好是 codex 當初挑出 34 個問題的那一段。**

報價單站本來就架在 Supabase 上,而 **Supabase 內建就有整套帳號密碼系統**。
⇒ **這題會改變的不只是程式,是「誰來開員工帳號」與「員工忘記密碼怎麼辦」。所以問你。**

```
Q-AUTH-1：員工的帳號密碼，要用平台內建的，還是我們自己刻？

A: 甲｜用 Supabase 內建（推薦）
     你會看到：新員工來，你在 Supabase 網站上按一下就開好帳號、設好初始密碼。
              員工忘記密碼，系統寄信給他自己重設，不用來找你。
     代價：帳號資料住在平台那邊，不在我們自己的表裡。
          未來如果要搬家，帳號要重新匯。
     🔴 而它有一個【還沒查證】的前提：那個站的 Supabase 專案有沒有開啟這個功能。
        B0 第一件事就是查它。查出來是關的 ⇒ 這案作廢，自動退回乙。

   乙｜自己刻（七月那份 plan 的做法）
     你會看到：新員工來，要我們寫一支後台頁面給你開帳號（多一片工）。
              員工忘記密碼，只能來找你重設（我們不做寄信）。
     代價：密碼加密、防止有人一直猜帳號、鎖定次數——這三件全部要我們自己寫對。
          🔴 這正是七月被 codex 挑出 34 個問題的那一段。
```

**我推薦甲。理由一句話**:密碼安全這種事,寫錯了不會有任何東西紅,而平台那套已經被幾十萬個站驗過。
⚠️ **而我必須講清楚**:我**沒有**查證那個 Supabase 專案有沒有開啟這個功能 ——
**這是推薦,不是「已經確認可行」。** 這一查排在 B0 第一位,而它可以讓甲案整個作廢。

### D0-b 這條線怎麼「不上線」到最後(我自己拍,不佔你時間)

v3 §7.4 留了三個候選(長期分支 / 全部藏 flag / 混合)沒選。**我選第四個,比三個都省**:

```
報價單端  全部改成【加東西不改行為】：
          新表/新欄一律選填、登入頁多一個帳號欄但【留空就走原本的共用密碼】
          ⇒ 報價單可以照常推 main，全程零行為改變，不需要長期分支
admin 端  一個環境開關 ADMIN_REQUIRE_REAL_IDENTITY，預設關
          關 = 現在這樣（自選下拉）／開 = 只認 session 裡的身分
          ⇒ 最後一步就是把它打開，而打開之前所有片都可以正常推
```

🔴 **這解掉 v3 §6 標的「最危險中間態」**(admin 下拉沒了但身分還沒到 ⇒ 後台當場沒人能寫入):
**開關預設關 ⇒ 那個中間態在型別上構造不出來。**
🔴 **而開關本身是一條可被誤開的路徑** ⇒ B7 驗收必須含「開關開著、而 session 沒帶身分」這一格,
**且那一格要能紅**(不是「應該會擋」)。

---

## §4 拆片(7 片;v3 的 11 片扣掉 2FA 那 4 片)

| 片 | 內容 | 在哪 | 風險 | 前置 |
|---|---|---|---|---|
| **B0** | 規格凍結。**pull 報價單後複量 §1.3 全表** + 四項實查(見 §5)+ D0-a 落地 | docs | 低 | Sean 批 |
| **B1** | 帳號存放:`admin_users`(或 Supabase Auth + `staff_id` 映射表)+ ⛔ ~~seed 三人~~ **seed 兩人**(`sean`/`staff_2`;`staff_1` 刻意不綁)+ ACL deny-all | 報價單 DB | 🔴 | B0 |
| **B2** | 登入認人:登入頁加帳號欄(**留空走舊路**)、備援分支、**關掉 legacy fail-open**、首次登入強制改密碼 | 報價單 auth | 🔴 | B1 |
| **B3** | session payload 加 `sub` + 版本欄 `v:2` | 報價單 auth | 🔴 | B2 |
| **B4** | SSO 帶身分:`sso_codes` **expand 加選填欄** + authorize 寫入 + exchange 回傳 | 報價單 | 🔴 | B3 |
| **B5** | admin 吃身分:payload 型別 + callback + `actor.ts` 改讀 session + **`resolveStaff` 進讀取閘** | admin | 🔴 | B4 |
| **B6** | admin 收尾:下架自選下拉(開關控)、~~**`shipment-actions.ts` 補上共用閘**~~ **✅ 已完成(2026-08-17 量到 `shipment-actions.ts:23` / `:113` 已有共用閘)—— 本行保留不刪,以免「B6 曾經包含這件」消失**、備援唯讀橫幅 | admin | 🔴 | B5 |
| **B7** | 端到端負向驗收(§6)+ 打開開關 | 兩邊 | — | B6 |

🔴 **順序是硬的,不是建議**:帳號存在(B1)才認得了人(B2);先認人才改 payload(B3),
否則簽出一批「有版本欄但沒身分」的 session;SSO 兩端(B4/B5)必須 expand,admin 舊版收到新欄要能忽略。

🔴 **每片 15-45 分鐘(鐵則 4)** —— B1/B2 若做不完要當場拆,**不得把兩片併成一片交**。

---

## §5 B0 要查的四件(每件都可能改變後面的片)

| # | 查什麼 | 為什麼它是承重的 | 查不出來怎麼辦 |
|---|---|---|---|
| 1 | 報價單那個 Supabase 專案**有沒有開 Auth** | D0-a 甲案的全部前提 | 關的 ⇒ 甲案作廢、退乙,回報 Sean |
| 2 | `auth_state.require_2fa` 的**現值**、`totp_devices` / `recovery_codes` 的**實際列數** | 見下方 §7 的條件式缺口 | 查不到 ⇒ **當成非零處理**(保守邊) |
| 3 | 報價單 **production** schema 與 repo migration 是否一致 | 已知本地 158 檔 vs 雲端 176 筆**版本號零重疊**(`docs/ops/DB_BASELINE.md:5`)⇒ repo 不等於現實 | 不一致 ⇒ B1 的 migration 寫法要重定 |
| 4 | A庫 `staff` 三列與 `admin_audit_log` 筆數**複查** | v3 引的「三列 / 27 筆」是 E8-A1 當時的數,**本輪未複查** | 對不上 ⇒ 身分鍵映射要重定 |

⚠️ **①與②只有能連到那兩個平台的人查得到。** 我(施工窗)沒有 `.env*` 存取權、
**且報價單 repo 明文禁用 `supabase db push`** ⇒ **B1 起的每一支 migration 都要走 MCP `apply_migration`,
而那需要 Sean 在場。這是排程上的硬約束,不是我拖。**

---

## §6 驗收:負向清單(正向「三個帳號各登一次」不算驗收)

**每一項都要有一格【會紅】的測試,不是「應該會擋」:**

```
1  舊 cookie（本線之前簽的）⇒ 必須失效，不得靜默降級成無身分
2  legacy fail-open cookie ⇒ 必須發不出來
3  備援共用密碼登入 ⇒ 進得去、而【任何寫入都被擋】（admin 與報價單兩邊都要）
4  已停用的員工仍持有效 session ⇒ 讀取閘要擋，不能只擋寫入
5  SSO code 重放 ⇒ 擋
6  開關開著、而 session 沒帶身分 ⇒ 擋（D0-b 的自我約束）
7  混版部署：admin 新 / 報價單舊 ⇒ 不得當機、不得放行無身分
8  查無帳號 vs 密碼錯 ⇒ 訊息、HTTP 狀態、回應時間三者一致
9  首次登入沒改密碼 ⇒ 不得經由 SSO 繞過改密碼頁直接進 admin
```

🔴 **第 9 條是最容易漏的一條**:攔截點必須在**所有入口之前、包含 SSO `authorize`**,
否則員工可以跳過改密碼頁直接走 SSO 進 admin,「強制改密碼」形同虛設。

🔴 **第 8 條的驗法要小心**:「回應時間一致」不能用「跑一次覺得差不多」驗。
**沒有想好怎麼量之前,不要把這條寫成通過。**

---

## §7 誠實邊界(這一節不是免責聲明,是待辦)

1. 🔴🔴 **§1.3 全表量於落後 16 顆的本機 HEAD `3fc905f`** ⇒ **不是報價單的現況**。B0 未複量前不得引用成現況。
2. 🔴 **D0-a 甲案沒有查證** —— 我沒確認那個 Supabase 專案有開 Auth。**「推薦」不等於「可行」。**
3. 🔴 **2FA 是條件式缺口,不是沒問題**:第一期不碰 TOTP(Q5=A),而 TOTP 裝置池是**全公司共用**
   (`totp_devices` 無 `user_id`)⇒ **一旦有了個人帳號,任何人的 TOTP 可以搭配另一人的密碼**。
   **判別句:這個洞可不可觸發,取決於 `require_2fa` 的現值與 `totp_devices` 的列數。**
   STATUS.md 記著「已部署但休眠」(`require_2fa=false`、兩表 0 列),**而本輪沒有複查現值** ⇒ B0 第 2 項。
   **若複查非零 ⇒ 本線範圍必須當場擴張,不得照本 plan 往下做。**
4. 🔴 **`auth_state` 是 `CHECK(id)` 鎖死的單列表** ⇒ 未來 E8-C 要 per-user 時,那個 CHECK 要拆。
   **本線不動它,但寫進來免得下一個人以為那是可以直接加欄的表。**
5. **本 v4 尚未經 codex 對抗審查**(鐵則 12 ②權限 ⇒ 關卡1 不降級)。Sean 批准方向後才跑,
   現在跑會審到一份還帶著 D0-a 開放決策的東西。
6. **v3 §9 的 17 條對帳表沒有重跑** —— 我只複驗了 F1(已過期)。其餘 16 條照 v3 承接。

---

## §8 Rollback

- 🔴 **migration 不能靠 git revert 回復**(revert 檔案不會移除已套的 schema)⇒ 一律 expand/contract:
  新欄先加**選填**、舊寫入端照樣能跑,兩端都上線後才收緊。
- 🔴 **payload 加欄的 revert 陷阱**:報價單 `isPayload()` **容許額外欄** ⇒ revert 舊 validator 後,
  帶身分的新 cookie **仍然有效、只是身分被忽略** = 靜默退回無身分語意。
  **⇒ 靠版本欄 `v:2` 擋(舊 validator 見 v=2 直接 reject),不靠「舊 validator 會 reject」這個錯誤假設。**
- **最快的退路** = 把 `ADMIN_REQUIRE_REAL_IDENTITY` 關掉,後台立刻退回現在這樣。
- **`ADMIN_PASSWORD` 備援全程保留**(Q2=A)⇒ 整條線壞掉時 Sean 仍進得去(唯讀)。

---

## 量法附錄 A(可重跑,不要憑本檔數字)

```bash
git grep -ln "^'use server';" -- apps/admin/src | grep -v '\.test\.' > /tmp/us.txt
wc -l < /tmp/us.txt
while read f; do grep -q 'authorizeAdminMutation' "$f" || echo "  無閘: $f"; done < /tmp/us.txt
while read f; do grep -q 'authorizeAdminMutation' "$f" && echo x; done < /tmp/us.txt | wc -l
```
🔴 **`'use server'` 必須行首錨定** —— 不錨定會抓到**寫在註解裡討論它的檔**,
本檔第一次量就中了這個坑(得到 15 支假「無閘」,真值 2 支)。
📎 這是 house 教訓 `feedback_mentioned-versus-done` 的又一次:**用位置或結構判,不用「出現」判。**
