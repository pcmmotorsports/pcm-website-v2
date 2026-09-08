> 🛑🛑 **狀態:codex R2 = FAIL(64 must-fix / 4 nit)⇒ 本片【不實作】,等重開之後重新定範圍。**
> 🔴 **不要照本檔動手。**R2 逐條原文在檔尾 §14(未轉述、未摘要)。
> 🔵 而 64 > 19 不是退步 —— v1 191 行 / v2 347 行,**每一句具體的話都是一個可以被擊破的面**;
>    v1 那 19 條多半是「你沒寫」,v2 這 64 條多半是「你寫了,而那樣寫會錯」。

# Plan v2 · 後台「改客人信箱」—— **codex R1 = FAIL / 18 must-fix,本版是重寫不是修補**

> 線【身分】`-auth` 2026-09-08 17:0x。**零碼改動、零 apply。**
> 片型 = **高風險片**(鐵則 12①錢 ②權限 ③資料正確性)⇒ 對抗審查不降級。
> 🔴 **v1 的核心結論被推翻了**(§1)。v1 舊字面全部留刪除線,不刪 —— 讓照 v1 動手的人同一發撞到訂正。

---

## 🔴 §0 v1 錯在哪(先寫這個,因為它決定整片的大小)

```
⛔ v1 §1 逐字:「本片 = 純 TS,零 migration、零 GRANT、零 policy 改動。」
🛑 【錯】。而錯的成因可以指名:我查了 policy, 沒查【欄級 GRANT】。
```
🔬 **正式庫實查(2026-09-08 16:5x,`has_column_privilege` 逐欄問)**:
```
customers 的 11 欄裡 service_role 可 UPDATE 的 = 5 欄
  name / phone / birthday / gender / updated_at
🔴 email ⇒ can_update = f
🟢 正對照 同一把尺問 SELECT ⇒ 11/11(整張表)⇒ 尺不是恆回 5
```
⇒ 🎯 **照 v1 做的結果**:Auth 那半**成功**、`customers` 那半回 **42501** ⇒ **兩邊不一致,而且是每一次都發生。**
📌 **而證據早就寫在 repo 裡**:`20260905190000:82-88` 逐字「**恰 5 欄**」——
**我讀了那支 migration 的 policy 那一段,沒讀它自己寫的 GRANT 那一段。**
🛑 **⇒ 教訓釘在這裡**:`policy` 管**哪些列**,`GRANT` 管**哪些欄** —— 兩道閘都要過,而**我只查了一道**。

---

## 🔴 §1 而「那就補一個 email 欄級 GRANT」是**錯的修法**(codex must-fix ②)

```
補了之後 ⇒ 共用的 SupabaseCustomerAdapter 就能【裸改信箱】⇒ 繞過本功能要求的稽核
(對照 20260717010000_m4a_admin_set_customer_tier_rpc.sql:165-175 —— tier 就是這樣被保護的)
```
✅ **⇒ 正確形狀:一支 `SECURITY DEFINER` RPC 當【唯一寫入路】,而 `email` 欄級 GRANT 不給任何應用角色。**
```
admin_change_customer_email(p_user_id uuid, p_new_email text, p_expected_old_email text, p_actor …)
  · SECURITY DEFINER + SET search_path = ''
  · 只 GRANT EXECUTE 給 service_role;三道 REVOKE
  · 它自己寫 customers.email 【與】那一列稽核 —— 同一個交易 ⇒ 「改了而沒稽核」在 DB 層不可能發生
```
🎯 **⇒ 本片【要一支 migration】。而它換來的是:稽核不是靠呼叫端自律,是靠 DB。**

---

## 🔴 §2 可編資格:按 `app_metadata.pcm_provider`,**不是** `is_sso_user`(codex must-fix ③)

```
⛔ v1 §5①-補 拿「is_sso_user false 15 / true 0」當可編資格的判準 —— 【證不到】。
🔬 line-admin.ts:78-85 實查:LINE 帳號本身就是 Admin API 建的 ⇒ 它的 is_sso_user 也是 false。
✅ 而 repo 裡【有】正確的判別欄:同檔 :81 逐字
   app_metadata: { pcm_provider: 'line', pcm_line_user_id: identity.sub }
   註解逐字「身分鍵存 app_metadata(service_role-only、不可被公開 signUp 偽造)」
```

### 🛑 而 LINE 客人**根本不可以改**(codex must-fix ②-LINE)
```
line-admin.ts:76  const email = lineSyntheticEmail(identity.sub)
⇒ 那個信箱是【從 LINE 的 sub 算出來的】, 不是客人打的
⇒ 把它改成真信箱 ⇒ 下次 LINE 登入仍用【合成信箱】查找 ⇒ 查無 ⇒ 建【新 UUID / 新 customer】
⇒ 📌 舊訂單 · 儲值金 · 收藏 全部留在另一個帳號 ⇒ 帳號分裂, 而兩邊都不報錯
```
✅ **⇒ 資格閘(server 端,不是畫面上藏起來)**:`app_metadata.pcm_provider` 存在(line / google / …)⇒ **拒絕**,並明說「這是 LINE/Google 註冊的帳號,改信箱要走另一條路」。

---

## 🔴 §3 受詞是【三份持久資料】不是兩份(codex must-fix)

```
① auth.users.email        登入用
② customers.email          寄信的 fallback
🔴 ③ orders.notification_email   —— v1 整個漏掉, 而【它優先】
   enqueue-order-shipped-emails.ts:150 逐字
     firstNonEmpty(row.notificationEmail, row.customerEmail)
   ⇒ 舊訂單凍住的錯字【贏過】修好的 customers.email ⇒ 出貨/取消通知仍寄舊地址
④ email_outbox.recipient_email —— 已排入佇列的信, 改信箱不會改它 ⇒ 耗盡 attempts 也不改寄
```
**⇒ 要 Sean 拍的一題(而它是口徑不是實作)**
```
Q:客服改了客人的信箱之後, 他【既有訂單】的通知要寄到哪?
A: A) 一起改 —— 把該客人所有【未完成】訂單的 notification_email 也換掉(我推薦)
      🔵 理由:客服的意圖就是「以後寄對地方」, 而他不會知道有第三份
      🔴 代價:那是改歷史單據上的欄位 ⇒ 稽核要記「連帶改了幾張單」
   B) 不動 —— 只改以後的新單
      🛑 而那表示【改完之後客人仍然收不到現有訂單的出貨通知】⇒ 我認為它答不到 Sean 的題
```
### 🔴 §3-補 · ③ 與 ④ 是【兩種不同的東西】,修法不同(主視窗 2026-09-08 17:1x 指出,v2 原本把它們寫在同一段)

```
③ orders.notification_email   = 【凍住的舊值】—— 它靜靜躺著, 下一次寄信時才會被讀到
   ⇒ 時間壓力:低。可以等 Sean 答 A/B。
   ⇒ 受詞:該客人的【未完成】訂單(已完成的要不要動 = A/B 那題的一部分)
   ⇒ 🔴 它是【單據上的欄位】⇒ 改它要記「連帶改了哪幾張單」, 而那是稽核內容不是實作細節

🔴 ④ email_outbox.recipient_email = 【已經排隊、正要寄出去】—— 它隨時會被 sweeper 撈走
   ⇒ 時間壓力:高。**改信箱與 sweeper 撈信之間有一段賽跑。**
   ⇒ 🛑 而它有一個 ③ 沒有的失敗形狀:那封信可能【已經在 sending 狀態】
        ⇒ 改它的 recipient 可能改到一封正在送的信 ⇒ 要限定只改【還沒被撈】的那些
   ⇒ 📮 **而「已經寄出去到舊信箱的那幾封要不要重寄」是另一題** —— 本 plan 不猜, 標未決
```
🎯 **⇒ 兩者共同點只有「都存著舊信箱」;而【什麼時候會爆】與【改的時候要小心什麼】完全不同。**
⚠️ **本格我沒有量**:今天 `email_outbox` 裡有沒有那位客人未寄出的列、以及 sweeper 的撈取間隔
⇒ 那決定那段賽跑有多長。**動手前要量。**

---

## 🔴 §4 大小寫:必須定一個演算法(codex must-fix ×2)

```
🔬 兩個事實, 而它們指向相反的方向:
  users_email_partial_key   UNIQUE btree (email) WHERE (is_sso_user=false)   ← 比【原字串】
  而 Auth 的非 SSO 登入查找用 LOWER(email)                                    ← 比【小寫】
⇒ 🛑 Alice@x.com 已存在, 另一人改成 alice@x.com:
     唯一索引【放行】(兩個原字串不同), 而登入查找會把它們折成同一個 ⇒ 兩個帳號搶同一個登入識別
```
✅ **本片定死的演算法(送審這一版的提案)**:
```
撞號檢查用 lower(new_email) 比對, 【比唯一索引嚴】
⇒ 撞到 ⇒ 擋下 + 顯示那個既有帳號的建立日期(主視窗 16:2x 裁 A)
⇒ 🔵 而它排除【同一個 user_id 本人】(codex must-fix:重送時新信箱已屬於本人, 不可誤報成撞號)
```
🛑 **選這個方向的代價明寫**:有極少數「原字串不同、小寫相同」的合法情境會被擋 ——
**而擋下來是可見的,放行造成的登入分裂是不可見的。**

### 🔬 §4-補 · 「今天有沒有已經撞號的」量了(2026-09-08 17:2x 唯讀)

```
public.customers   列數 15 · 相異原字串 15 · 相異 lower(email) 15
⇒ 🎯 **今天 0 對 lower 撞號** —— 這功能不會在第一天就撞到既有資料
⚪ 負對照:把尺換成 user_id(一定不撞)⇒ 0 組
🟢 正對照:把尺換成 email 網域(一定會撞)⇒ 3 組  ⇒ 那個 GROUP BY/HAVING 的尺會動
```
🛑 **射程要帶走**:我量的是 **`public.customers`,不是 `auth.users`** —— 唯讀角色對 `auth` schema
的 USAGE = `f`(今天實查)⇒ **讀不到原件,只讀得到那份副本**。
⚠️ 而**若有 `auth.users` 列而 `customers` 沒有對應列**(trigger 曾經失敗過),那一列我看不到。
⇒ 📌 **所以這個 0 的正確讀法是「副本上今天 0 對」,不是「Auth 上今天 0 對」。**

---

## 🔴 §5 失敗與並發:v1 §5② 三處都不成立(codex must-fix ×5)

```
⛔ v1「第 1 步失敗 ⇒ 什麼都沒動」 【錯】:
   GoTrueAdminApi.ts:789-803 —— Auth 已提交、HTTP 回應途中斷線 ⇒ SDK 丟錯
   ⇒ 那個世界是【Auth 改了而我們以為沒改】⇒ 必須【回查】再決定, 不可以直接當沒事
⛔ v1「customers 失敗 ⇒ 寫一列 degraded 稽核」 【錯】:
   supabase-repository.ts:29-34 —— 稽核走【同一個 Supabase DB】
   ⇒ DB 掛掉那個世界裡, 稽核也寫不進去 ⇒ 零可追蹤紀錄
⛔ v1 沒定義:兩邊都成功而【稽核 INSERT 失敗】要回成功還是回錯
⛔ v1 沒有鎖 / 沒有 expected-old:兩位 manager 同時改 ⇒ Auth 最後是 C、customers 最後是 B, 兩邊各自回成功
```
✅ **本版的形狀**:
```
1. 先在 RPC 裡 SELECT … FOR UPDATE 鎖住那一列 + 比對 p_expected_old_email(不合 ⇒ 拒絕, 明說「資料已被別人改過」)
2. 改 Auth(admin.updateUserById)
   · 明確失敗 ⇒ 什麼都沒動, 回錯
   · 🔴 逾時 / 連線斷 ⇒ 【回查 getUserById】確認它到底改了沒 ⇒ 依結果走下一步
3. 呼叫 §1 那支 RPC:customers.email + 稽核【同一交易】⇒ 要嘛都有、要嘛都沒有
4. 🔴 若 3 失敗而 2 已成功 ⇒ 兩邊不一致 ⇒ **必須有一條不依賴同一個 DB 的出聲管道**
   ⇒ 📮 **本 plan 不猜那條管道是什麼** —— 現成候選:告警信(而它也走 DB 佇列)/ Vercel log
      ⇒ 這一格要主視窗裁, 而【在它裁之前本片不實作】
```

---

## 🔴 §6 其餘 must-fix 的處置(逐條,不併)

```
· 合成信箱網域:packages/schemas/src/notification-email.ts:68-92 會拒 x@line.pcmmotorsports.local
  ⇒ ✅ server 端用【同一支 schema】驗新信箱, 不自寫一份 ⇒ 拒的話畫面要說為什麼
· 客人既有 session:charge-actions 會從 stale user.email 寫回舊信箱
  ⇒ ✅ 改完呼叫 Auth 的 signOut(scope: others) 或使其 session 失效 ⇒ 📮 這一格要驗, 我沒實測過
· 客服再打錯一次:Admin API 直接套用、不走確認信
  ⇒ ✅ 畫面要明說「這個動作【不會】寄確認信給客人」, 並在稽核記下 actor
· PII:舊/新信箱明文進 audit 且無保存期限
  ⇒ 📮 要 Sean 的口徑(與 ⟦data-rights⟧ 那條線同一題)⇒ 本片先【標明】, 不自己定保存期
· manager 閘依賴 ADMIN_REQUIRE_REAL_IDENTITY(authorize.ts:82-97)
  ⇒ 🔴 那顆旗標關掉時 picker cookie 可自稱 manager ⇒ 本片的閘【不可只靠它】
  ⇒ ✅ RPC 那一層再驗一次 actor 是 active manager(server 端重新檢查, 對齊 CLAUDE.md Server 端鐵則)
· 四檔清單錯了:真正的表單在 apps/admin/src/components/customers/customer-detail.tsx:190-253
  ⇒ ✅ 檔案清單改成 6 支(含該元件與它的測試檔)
```

---

## §7 rollback(訂正 v1)

```
⛔ v1「回滾 = git revert」 【不完整】:本版有 migration, 且改的是資料。
✅ 碼 ⇒ git revert;RPC ⇒ DROP FUNCTION(裸 CREATE, 撞名當場紅)
🔴 而【資料回不去】:稽核那一列必須同時記 auth 側舊值【與】customers 側舊值兩個
   ⇒ 因為既存狀態可能已經是 Auth=A / customers=B(codex must-fix)⇒ 只記一個「舊信箱」描述不了
```

## §8 驗收(每條 yes/no;新增的用 🆕)

```
1  非 manager 呼叫 ⇒ 擋, 有一格會紅的測試
2  🆕 ADMIN_REQUIRE_REAL_IDENTITY 關掉的世界 ⇒ 仍然擋得住(RPC 那層)
3  🆕 app_metadata.pcm_provider = 'line' 的帳號 ⇒ 拒絕 + 明確訊息
4  改成沒人用的新信箱 ⇒ auth / customers 兩邊都變
5  🆕 §3 選 A 的話:該客人未完成訂單的 notification_email 也變了, 且稽核記了幾張
6  🆕 該客人 email_outbox 裡未寄出的列 recipient_email 也變了
7  撞號(含 lower 相同)⇒ 擋 + 顯示既有帳號建立日期;而【同一個 user_id 本人】不算撞號
8  🆕 Auth 成功而 customers 失敗 ⇒ 有出聲, 且【不是只寫同一個 DB】
9  🆕 兩位 manager 並發 ⇒ 後到的那個被 expected-old 擋下
10 稽核一列, 含 auth 舊值 + customers 舊值 + 新值
11 三綠:⛔ ~~只看 `Tasks:` 那行 total 是不是 9~~
   🔴 **那只擋得住「fail-fast 少跑幾包」,證不到鐵則 11 的四個數**
   ✅ 要 **連跑兩發, 比四個數**:`Test Files` 檔數 / `Tests` 測項總數 / 紅的格數 / **我餵幾條 vs 它跑幾支**
   (`total=9` 仍要看 —— 它是【另一道】, 不是同一道)
```

## 🛑 §9 本版證不到什麼

```
· 我【沒有實跑】任何一條 —— 本版全部是讀碼 + 唯讀查庫。
· §5 那條「不依賴同一個 DB 的出聲管道」我【沒有答案】⇒ 要主視窗裁, 而在它裁之前本片不實作。
· §3 A/B 要 Sean 拍。§6 的 PII 保存期要 Sean 的口徑。
· 「改完之後客人真的登得進去」仍然沒有人跑過一次真的登入。
· 🔴 **本片已經不是「一個欄位 + 一顆鈕」了** —— 它現在含一支 migration、一支 RPC、三份資料、一條告警管道。
  ⇒ 📮 **要不要拆成兩片(先做資格閘與撞號、後做三份資料同步)是範圍題** ⇒ 主視窗裁。
```


---

## 🔬 §10 逐條自核:codex R1 那 ⛔ ~~18~~ **19** 條,**每一條指得出 plan 的哪一句**(主視窗 2026-09-08 17:1x 指定)

> 🔴 **[2026-09-08 nit 訂正]** 本節原本寫 **18**,而表格與原文都是 **19** 條。
>    🛑 **拿 18/18 對帳會靜默漏掉第 19 條(manager 冒名 / `ADMIN_REQUIRE_REAL_IDENTITY`)** ——
>    📌 **一個對得起來的分母,不代表它是對的分母。**
>
> 🔴 **這一節的存在理由是主視窗那句**:「重寫的人最容易在【我覺得我處理了】與【我寫下了處理方式】之間有落差」。
> 自核判別句 = **指得出節與句嗎**。指不出來的,下面標 🔴 並當場補。

```
#  codex 那一條                                   本 plan 的落點            狀態
1  §1「零 migration/GRANT」錯 · 五欄 ACL           §0 全節 + 實測表          ✅ 已寫
2  補 email 欄級 GRANT ⇒ 共用 adapter 可裸改        §1 全節(RPC 唯一寫入路)  ✅ 已寫
3  四檔清單錯 · 表單在 customer-detail.tsx:190-253  §6 最後一條               ✅ 已寫
4  合成信箱網域會被寄信 schema 拒                    §6 第一條                 ✅ 已寫
5  LINE 合成信箱被改 ⇒ 帳號分裂                      §2「LINE 客人根本不可以改」✅ 已寫
6  is_sso_user 證不到帳號是密碼型                    §2 開頭 + ⛔ 刪除線        ✅ 已寫
7  raw unique 放行而 Auth 用 LOWER 查找              §4 那兩行對照             ✅ 已寫
8  plan 沒定最終演算法                              §4「本片定死的演算法」      ✅ 已寫
9  重送時新信箱已屬本人 ⇒ 誤報撞號                    §4 那句「排除同一 user_id 本人」✅ 已寫
10 Auth 提交後 HTTP 斷線 ⇒「什麼都沒動」是錯的        §5 步 2 的逾時回查         ✅ 已寫
11 degraded audit 走同一個 DB ⇒ 也會失敗            §5 步 4 + 📮 未決          ✅ 已寫(而答案未決)
🔴 12 兩邊成功而 audit INSERT 失敗 ⇒ 回成功/回錯?    ⇒ 見下方【補】             🔴 我以為 §1 解掉了, 而【沒有寫下來】
13 兩位 manager 並發 ⇒ 無鎖、無 expected-old        §5 步 1                    ✅ 已寫
14 orders.notification_email 是第三份且優先          §3 全節                    ✅ 已寫
15 outbox recipient_email stale ⇒ 耗盡 attempts     §3-補 ④                    ✅ 已寫(本輪才拆開)
16 客人既有 session 結帳寫回舊信箱                   §6 第二條                  ✅ 已寫
17 客服再打錯一次 · Admin API 不走確認信             §6 第三條                  ✅ 已寫
18 audit 明文 PII 無保存期限                        §6 第四條(標未決)          ✅ 已寫
19 ADMIN_REQUIRE_REAL_IDENTITY 關掉 ⇒ picker 冒充   §6 第五條                  ✅ 已寫
```

### 🔴 §10-補 · 第 12 條:我以為 §1 解掉了,而 plan 裡沒有一句話說它

```
我的想法是:§1 那支 RPC 把 customers.email 與稽核寫在【同一個交易】
⇒ 稽核 INSERT 失敗 ⇒ 整個交易回滾 ⇒ customers 沒改、稽核也沒有 ⇒ 一致。
🛑 而那【只解掉一半】—— 因為 Auth 那半【已經改了】(§5 步 2 在步 3 之前)
⇒ 📌 所以第 12 條【不是被 §1 解掉】, 它【塌進 §5 步 4 那個未決的洞裡】:
     「Auth 成功、我們這半整個沒成功」⇒ 兩邊不一致 ⇒ 要那條不依賴同一個 DB 的出聲管道。
```
✅ **⇒ 明確寫死**:第 12 條**與第 11 條是同一個未決**,而不是兩個。
　 回成功還是回錯 ⇒ **回錯**(因為 `customers` 那半真的沒成功),而**畫面要說「登入信箱已改、資料未同步」**
　 —— 🔴 **不可以只說「失敗」**,那會讓客服以為什麼都沒動而再按一次。

🎯 **⇒ 而這一條正是主視窗預測的那個落差**:我心裡有答案,而 plan 上找不到那句話。
📌 **自核找得到它,是因為判別句問的是「指得出哪一句」,不是「你處理了嗎」。**


---

# 📌 v2.1 · Sean 2026-09-08 17:4x 三題全答(逐字 `a,a,b,a`)

```
Q1 既有訂單的通知信 ⇒ 甲 **一起改**(該客人所有【未完成】訂單的 orders.notification_email)
Q2 改到一半     ⇒ 甲 **整個退回**, 當作沒改過, 畫面說「改不成, 請稍後再試」
Q3 要不要拆片    ⇒ 乙 **不拆**, 一片做完
```

## 🔴 §11 Q2=甲 讓那個洞【收斂】,而**不是**被填平

```
✅ 收斂:整個退回 ⇒ 沒有「半套狀態」留下來需要通知任何人
   ⇒ 「不依賴 DB 的告警管道」這題【暫時不用答】
🛑 而它沒有消失 —— 它變成【回滾本身失敗】那個世界:
   Auth 改了 · customers 失敗 · 而【把 Auth 改回去也失敗】
   ⇒ 那時仍然是兩邊不一致, 而仍然沒有人會知道
```
📌 **⇒ 本格的字面照舊寫「未解、已知」,不因為 Sean 答了甲就劃掉。**
🔵 **而 canonical 在哪**:就在這一節。**沒有別的地方寫著它**(常載 §6-b 第 4 條:寫「已解決」要答得出 canonical 在哪 ⇒ 這裡答的是「未解」,而位置寫死在這裡)。
✅ **實作上要做的**:回滾失敗那一格**必須與回滾成功走不同的畫面文案** ——
　 成功回滾 ⇒「改不成,請稍後再試」(Sean 的字面);
　 🔴 **回滾也失敗** ⇒ 不可以印同一句 —— 那會讓客服以為什麼都沒動。要印「**登入信箱已變更而資料未同步,請找工程**」。
　 📌 **兩個世界印同一句話 = 這一片最貴的那種錯。**

## 🔴 §12 Q1=甲 引進一個 R1 沒審過的東西:**批次寫入**(鐵則 12③)

### ① 「未完成」在資料上**沒有單一欄位可以問**(2026-09-08 17:4x 唯讀實查)

```
orders 上與完成有關的欄:payment_status(enum) · fulfillment_status(enum)
                        · cancelled_at(timestamptz) · workflow_status(**text**)
  payment_status      = unpaid / paid / partiallyPaid / refunded / partiallyRefunded
  fulfillment_status  = notOrdered / ordered / inStock / shipped
  🔴 workflow_status  = **今天全 4 張單都是 NULL** ⇒ 它今天沒有判別力, 而它是 text ⇒ 明天可以是任何東西
```
🛑 **⇒ 所以「未完成」是一個【要定義的口徑】,不是一個查得到的事實。**
✅ **本 plan 的提案(要 codex 審,而不是我拍)**:
```
未完成 := cancelled_at IS NULL
          AND fulfillment_status <> 'shipped'
🔵 理由:通知信的用途是「這張單之後還會發生事」⇒ 已出貨或已取消的單, 後面沒有信要寄
🛑 而它的代價明寫:已出貨的單【還會有】退款/發票類的信 ⇒ 那些仍會寄到舊地址
   ⇒ 📮 那一格我不自己決定, 列成 codex 要判的一題
```

### ② 批次的三件(鐵則 12③ 要求)
```
筆數上限   🔬 今天的分母:orders 全表 **4 張**(全站, 不是單一客人)⇒ 今天不可能超過個位數
           🛑 而【今天】不是【上線後】⇒ 仍要寫上限。提案:單次最多 200 筆, 超過 ⇒ 拒絕並要求工程介入
           📌 理由:一個客人有 200 張未完成單 = 那不是改信箱, 那是資料出問題
一筆失敗   ⇒ **整批回滾**(對齊 Q2=甲 的精神:要嘛都改、要嘛當作沒改過)
           ⇒ 而它與 auth/customers 那兩步【在同一個決策裡】:任一步失敗 ⇒ 全退回
稽核      ⇒ 必須記【連帶改了哪幾張單的 display_id】, 不是只記「改了 N 張」
           📌 理由:N 這個數字答不出「哪一張沒被改到」
```

### 🔬 ③ 而量的時候撞到一件事:**資料在我這一夜裡動過**
```
12:2x 我量 orders 的 payment_status ⇒ unpaid 2(1 取消)· refunded 1 · paid 1
17:4x 再量同一件事                  ⇒ unpaid 2(1 取消)· refunded 2 · paid 0
⇒ 📌 有一張單從 paid 變成 refunded。總數仍是 4。
```
🛑 **⇒ 這一片所有「今天 N 張」的讀數都要帶時刻** —— 而我先前寫過的那些(§4-補 的 15 列、上面的 4 張)
**都是那一刻的**。⚠️ **而它們不會自己標示過期。**

## §13 Q3=乙 ⇒ 不拆 ⇒ 一片含
```
① 一支 migration(RPC `admin_change_customer_email`)
② 資格閘(app_metadata.pcm_provider ⇒ LINE/Google 拒絕)
③ 撞號檢查(lower 比對、排除本人)
④ 四份資料:auth.users · customers · orders.notification_email(批次)· email_outbox.recipient_email
⑤ 全退回的失敗處置 + 回滾失敗的第二種文案
⑥ 稽核:auth 舊值 + customers 舊值 + 新值 + 連帶改的訂單 display_id 清單
```
🔴 **⇒ 這一片的驗收條數已經到 11+3 條** ——📮 **而 Sean 已經裁不拆, 所以本 plan 不再提拆。**


---

## 🛑 §14 · codex R2 逐條原文(2026-09-08,`gpt-5.6-sol`,read-only;**未轉述、未摘要**)

## ① R1 逐條關閉盤點

| # | R1 問題 | R2 判定 | 理由 |
|---:|---|---|---|
| 1 | 欄級 GRANT 形成裸寫旁路 | **CLOSED** | v2 改成不授 `email` UPDATE，並指定受保護 RPC 為唯一寫入路。RPC 本身的新漏洞另列下方。 |
| 2 | 四檔 manifest 錯誤 | **判不出來** | §6 只說「改成 6 支」，沒有列出六條完整路徑與責任；缺完整 manifest 才能確認 action、migration、元件與測試都沒漏。 |
| 3 | 合成信箱與 canonical 值 | **判不出來** | 已指定共用 schema，但沒寫清楚四個寫入面都使用 schema 的「回傳值」而非原始輸入；缺資料流與驗收。 |
| 4 | LINE 改信箱造成帳號分裂 | **CLOSED** | 應用層已明訂 LINE 拒絕，且不只把欄位藏起來。RPC 直接呼叫旁路另列新 finding。 |
| 5 | `is_sso_user` 不能判斷帳號類型 | **換了形狀但病還在** | 改看 `pcm_provider` 是對的方向，但 Google 沒有這個自訂欄位，manual／無 metadata 孤兒也沒有完整資格矩陣。 |
| 6 | raw unique 與 `LOWER(email)` 不一致 | **仍 OPEN** | lower 預查既不是 Auth 權威集合，也不是跨帳號原子約束；並發仍可建立大小寫撞號。 |
| 7 | 沒有最終大小寫演算法 | **換了形狀但病還在** | 比對規則寫出來了，但資料來源、交易邊界與並發保證仍不足，演算法不能兌現其承諾。 |
| 8 | 重送誤撞同一 UUID | **CLOSED** | 已明訂排除同一個 `user_id`。 |
| 9 | Auth 已提交但 HTTP 回錯 | **換了形狀但病還在** | 新增回查，但回查本身逾時、失敗、查到第三種值時沒有狀態表與處置。 |
| 10 | degraded audit 依賴同一 DB | **仍 OPEN** | 作者已承認未決；此處只列關閉狀態，不把「尚未選管道」重報成新 finding。 |
| 11 | Auth/customers 成功但 audit 失敗 | **仍 OPEN** | RPC 只讓 customers 與 audit 同退，但 Auth 已先提交；§10 自己也承認仍落入未決洞。 |
| 12 | 同客戶並發 A→B／C | **換了形狀但病還在** | 加了鎖與 expected-old，但鎖在 RPC 交易內，無法跨越前面的 Auth HTTP 寫入。 |
| 13 | 漏掉 `orders.notification_email` | **換了形狀但病還在** | 已找到第三份資料，但 A/B 尚未拍板，而且「全部未完成訂單」本身會改壞合法快照。 |
| 14 | outbox 舊收件人 | **換了形狀但病還在** | 改成原地換 `recipient_email`，卻衝突既有「退休舊 dedup key、重新排信」契約。 |
| 15 | 舊 session 寫回舊信箱 | **仍 OPEN** | `signOut(scope: others)` 不能憑 `user_id` 執行，而且 access-token JWT 在到期前仍有效。 |
| 16 | 客服再次輸入錯字 | **換了形狀但病還在** | 警告「不寄確認信」沒有防止打錯；錯字仍立即鎖掉登入與通知。 |
| 17 | Auth 與 customers 兩個舊值 | **判不出來** | 要求有寫，但 RPC 顯示的簽章只有一個 expected-old；缺完整簽章及兩份舊值的取得時點。 |
| 18 | audit 明文 PII 無保存期限 | **仍 OPEN** | 已標待 Sean 決定，但尚未成為實作前硬閘。 |
| 19 | 關閉 real-identity 時可冒名 | **換了形狀但病還在** | RPC 驗 `p_actor` 是 active manager，只證明這個 ID 有資格，沒有證明呼叫者就是該人。 |

## ② v2 新引入／新具體化的 findings

`plan §5:154-158；plan §8:206`
兩位 manager 同時把 A 改成 B／C → Auth 在鎖取得前已各自提交；後到 RPC 雖被 expected-old 擋下，終態仍會是 Auth=C、customers=B。— must-fix

`plan §1:37-40；apps/admin/src/lib/session/authorize.ts:82-97`
旗標關閉時登入者用 picker 選有效 manager ID，再把該 ID 傳成 `p_actor` → RPC 只驗「此 ID 是 manager」，冒名操作仍會通過。— must-fix

`plan §2:46-63；apps/storefront/src/components/LoginPage.tsx:189-198`
Google OAuth 流程沒有寫入自訂 `pcm_provider` →「欄位存在才拒絕」會把 Google 帳號誤判為可編。— must-fix

`plan §2:63；apps/admin/src/lib/customers/email-verification.ts:37-49`
manual 帳號有 `pcm_provider='manual'`、一般 email 與部分孤兒沒有值 → 單一「存在／不存在」規則會同時錯放 Google、錯擋 manual，且訊息誤稱 LINE／Google。— must-fix

`plan §1:35-40；plan §2:63`
任何持 service-role 的內部程式直接呼叫 RPC → 可跳過應用層 provider 資格閘，讓 LINE 的 Auth 合成信箱與 customers 真信箱分裂。— must-fix

`plan §1:37-40；plan §6:169-170`
service-role 直接把格式錯誤或合成信箱送進 RPC → 共用 Zod schema 沒有在 DB 唯一寫入路生效，仍可寫入不可投遞地址。— must-fix

`plan §4:118-120；plan §5:154-158`
兩個不同客戶同時改成 `Alice@x.com`／`alice@x.com` → 各自鎖不同 customers 列、預查都放行，Auth 的 raw unique 也可能放行兩個登入識別。— must-fix

`plan §4:133-136`
Auth 有 user 但 customers trigger 曾漏建該列 → 以 customers 做 lower 撞號來源會查無對手，之後 Auth 更新才撞錯或形成登入歧義。— must-fix

`plan §3:81-93；apps/admin/src/lib/orders/manual-order-repository.ts:308-309`
未完成手動訂單刻意指定另一個通知信箱 →「該客人全部未完成訂單一起改」會摧毀合法單據快照，並可能把訂單內容寄給錯的人。— must-fix

`plan §3:81-93；supabase/migrations/20260604120000_m3_s2a_orders_order_items.sql:99-100`
訂單已取消但仍是 `unpaid/notOrdered`，或已付款但只部分出貨 →「未完成」沒有可執行判準，會更新不該動的訂單或漏掉仍會寄信的訂單。— must-fix

`plan §1:40；plan §3:81-99`
customers 與 audit 先在 RPC 提交，之後 orders 或 outbox 更新失敗 → 畫面可能回成功，但部分通知來源仍留舊信箱。— must-fix

`plan §3:95-99；packages/use-cases/src/sweep-email-outbox.ts:2045-2065`
已嘗試過的 pending／failed outbox 原地換收件人但保留 dedup key → provider 收到同一冪等鍵、不同 `to`，可能拒絕或延遲且新址收不到。— must-fix

`plan §3:95-103；packages/ports/src/IEmailOutbox.ts:1009-1034`
v2 要修改既有 outbox 列 → 違反現行「舊列標終態、退休舊鍵、下一輪重新排信」契約，重排可能永久撞唯一鍵。— must-fix

`plan §3:95-103；packages/use-cases/src/sweep-email-outbox.ts:2081-2117`
sweeper 已通過現址檢查、但尚未送出時客服完成改信箱 → worker 仍持有舊地址並可能寄出私人訂單內容；只排除 `sending` 列沒有關掉這段競速。— must-fix

`plan §6:171-172；node_modules/.pnpm/@supabase+auth-js@2.105.3/node_modules/@supabase/auth-js/src/GoTrueAdminApi.ts:134-165`
後台只有目標 `user_id`、沒有該客戶的登入 JWT → `signOut(scope: others)` 無法代替該客戶撤銷 session。— must-fix

`plan §6:171-172；node_modules/.pnpm/@supabase+auth-js@2.105.3/node_modules/@supabase/auth-js/src/GoTrueClient.ts:3743-3766`
即使成功撤銷 refresh token，既有 access-token JWT 到期前仍有效 → 結帳仍可從 stale `user.email` 產生新的錯誤訂單快照。— must-fix

`plan §5:157`
Auth 更新回傳不確定結果，接著 `getUserById` 也逾時、回錯或讀到第三個值 → plan 沒有分支，系統無法判定應呼叫 RPC、停止或進入修復。— must-fix

`plan §1:37；plan §7:191-192`
既存狀態 Auth=A、customers=B，Auth 先改成 C → RPC 執行時已讀不到 A，而顯示簽章只有一個舊值，無法同時做 customers 的 CAS 並留下 A/B/C 稽核。— must-fix

`plan §1:37-40；supabase/migrations/20260712210000_m4a_admin_audit_log.sql:51-58`
稽核表要求非空 `request_id`，但 RPC 簽章把 `p_actor …` 留成省略號 → 目前無法證明合法呼叫不會整筆回滾，也無法證明重送可追蹤。— must-fix

`plan §1:38-39；docs/patterns/revoking-function-execute-in-supabase.md:232-283`
只寫三道 REVOKE 與 service-role GRANT → 沒驗 owner、`SET ROLE`、其他 grantee 與 wrapper 間接入口，SECURITY DEFINER 可能仍有非預期可執行路徑。— must-fix

`plan §5:159-161；plan §10:253-264`
Auth 已改而 DB 失敗 → 真正缺的是可冪等重試、可對帳的修復狀態；只裁「用 log 還是告警信出聲」即使成功通知，也不會修回分裂資料。— must-fix

`plan §7:190`
存在同名 overload 或未來簽章改動 → 未寫完整參數型別的 DROP 無法保證移除正確 RPC，回滾後高權限入口可能仍可呼叫。— must-fix

`plan §8:208`
只看 `Tasks: total=9` → 無法證明餵入的測試檔數、實跑檔數、測項與紅格相符，錯誤清單仍可能全綠。— nit

`plan §10:225-250`
標題宣稱 R1 有 18 條，但表格與使用者提供的原文實際都有 19 條 → 後續用「18/18」對帳會靜默漏掉 manager 冒名問題。— nit

沒有把「要不要拆片」當 finding。告警項也不是重報「尚未選管道」；finding 是它把應先決定的**修復與對帳協定**問成了次要的**通知媒介**。

本輪只讀現行程式、migration 與 plan；未修改檔案、未跑寫入或測試。plan 前後 SHA-256 均為 `2377d1720c9fe1367fc88b63ab8c1ff84b622b33f226f317b6f8ac05eacc6a78`。


rc=0
