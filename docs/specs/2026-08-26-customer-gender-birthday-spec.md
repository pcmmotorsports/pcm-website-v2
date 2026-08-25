# Spec · 客戶性別 / 生日 + 後台多軸篩選

> **狀態:等批。一行碼都還沒寫。**
> 上游:`docs/specs/2026-08-25-customer-filter-plan.md`(plan)· Sean 2026-08-26 答完 `Q11`-`Q14`。
> 命中 **鐵則 8**、**鐵則 12③**(schema)、**鐵則 12⑤**(改客人註冊流程 = 對外可見)
> ⇒ **高風險片,對抗審查不降級。**
> 產出者:施工窗 pcm-website-v2-1d(線 4),2026-08-26。

## Sean 的答案(四題零未答)
```
Q11 性別選項      甲 男 / 女 / 不透露
Q12 必填或選填    甲 兩個都【選填】
Q13 既有客人      甲 不回填
Q14 分不分兩片    乙 【一次做完】
```

---

# 🔴 §0 開場一件事實,它改變這片的形狀 —— **註冊有三條路,而表單只是其中一條**

`handle_new_auth_user()` 是一支 `AFTER INSERT ON auth.users` 的 trigger
(`supabase/migrations/20260523034911_init_customers_and_subtables.sql:278-295`),
**它的 COMMENT 自己逐字寫著**:
> 「**Google / LINE OAuth 註冊也走此 trigger**:Google 走 Supabase 內建 `signInWithOAuth`、
>  LINE 走自寫 OAuth + Supabase Admin API `createUser`(**都會觸發 `auth.users` insert**)」

**我複驗那三條路都在**:
```
grep -rln 'signInWithOAuth|createUser' apps/storefront/src packages --include='*.ts' ⇒ 4 支
  LoginPage.tsx:107  signInWithOAuth(Google 一鍵)
  auth/callback/route.ts  · lib/auth/line-admin.ts(LINE)
負對照 'signInWithZZZ' ⇒ 0
```

## ⇒ 而這代表什麼(這是本 spec 最重要的一段)
```
Google / LINE 註冊的人【根本沒有看過那張表單】
⇒ 他們的性別 / 生日【結構上必然是空的】, 不是「他選擇不填」
```
🔴 **所以 `Q12=甲(選填)` 的實際效果比字面更寬**:
> 不是「有些人不想填」,是「**有一整批人沒有機會填**」。

⇒ **而這一格 Sean 答 `Q12` 的時候看不到** —— 選項只講了必填/選填,沒講「有人根本填不到」。

### ⇒ 本 spec 的處置:**會員中心那一頁也要能填**,而不是只做註冊表單
```
· design 已經有生日欄, 而它在【會員中心】不在註冊表單
  design-reference/components/AccountPages.jsx:669 逐字
    <label><span>生日</span><input type="date" value={profile.birthday} …/></label>
  ⇒ 生日在會員中心【本來就該有】, 我們只是還沒接
· 性別:design 全樹零命中(plan §3 已量, 分母 design-reference + OD 11 專案)
  ⇒ 會員中心那一格【也要新畫】
```
⚠️ **而「要不要為此再問 Sean 一次」我判【不用另問,但要告知】** ——
他要的是「能按性別/生日篩客戶」,而**只做註冊表單達不到那個目的**(OAuth 那批永遠空)。
⇒ 📌 **這不是擴張範圍,是補上一個他的目標本來就需要、而選項沒有呈現的東西。**
⇒ **列進交付,並在回報裡明講「我加了這一格,理由是這個」。**

---

# §1 三段要改什麼

## 1-1 DB(鐵則 12③)
```
新增 gender 欄
  型別:enum(主視窗 2026-08-26 裁定, 與 member_tier 一致;理由與更正見 §3-1)
  值域:'male' | 'female' | 'undisclosed'          ← Q11甲
  可為 NULL                                        ← 理由見 1-1b, 那是 schema 決定不是預設值
birthday 欄【已經存在】(:19 `birthday date`)⇒ 不動 schema
```

### 🔴🔴 1-1b `NULL` 與 `'undisclosed'` 不是同一件事 —— **這是 schema 決定,不是 UI**
```
NULL          = 沒機會填 / 還沒填(🔴 含【全部】OAuth 註冊者, 見 §0)
'undisclosed' = 他看到了那一格, 而他【選擇不說】
```
🔴 **合併它們會讓「有多少人拒答」這個數字【永遠算不出來】** —— 而那正是做分眾時會想知道的。
⇒ **所以 enum 一定要有 `'undisclosed'` 這個值**(`Q11甲` 本來就有),**而欄位一定要允許 NULL**。
⇒ **兩者缺一,那個區別就沒有地方可以表達。**
⚠️ 而 `Q12=甲(選填)` + §0(OAuth 那批填不到)⇒ **NULL 會是上線初期的大宗**
  ⇒ 後台篩選的 UI 要**分得開「未填」與「不透露」**,不要只給一個「空白」。

### 🔴 1-1a GRANT 有一個**方向相反**的陷阱,逐字量過
```
:230  GRANT SELECT ON TABLE customers TO authenticated;              ← 【表級】
:231  GRANT UPDATE (name, phone, birthday, updated_at) … TO authenticated;  ← 【欄級】
```
⇒ **新增 `gender` 之後**:
```
SELECT  ✅ 自動包含(表級 GRANT)⇒ 客人讀得到自己那列的 gender —— 不用做事
UPDATE  ❌ 不包含(欄級 GRANT 列舉)⇒ 客人【改不了】自己的 gender
```
🔴 **而「客人改不了」不會報錯給你看,它只是靜靜地沒寫進去。**
⇒ **同一支 migration 內必須把 `gender` 加進 `:231` 那條 UPDATE GRANT**,否則會員中心那一格是死的。
📌 **這是「新物件出生就自帶權限」那條坑的鏡像**:
`docs/patterns/revoking-function-execute-in-supabase.md` 記的是**多給了**,
而這裡是**少給了** —— **兩個方向都不會紅,而少給的那個症狀是「功能默默沒效果」。**

## 1-2 註冊那條路(鐵則 12⑤ 對外可見)—— 🔴 **不是我的檔案面**
```
apps/storefront/src/app/register/page.tsx      表單加兩格
apps/storefront/src/app/register/actions.ts    寫進 signUp 的 metadata
  現況(:60 逐字)metadata: { name: v.data.name, phone: v.data.phone }
  ⇒ 要變成 { name, phone, gender?, birthday? }
🔴 supabase/migrations/<新>  改 handle_new_auth_user() 也讀那兩個 key
  現況(:281-286)只 COALESCE 取 name / phone
  ⚠️ 那是 SECURITY DEFINER 函式 ⇒ 改它命中 12③, 而它是【三條註冊路共用的】
  ⇒ 改壞 = 三條路一起壞 = 新客人註冊不了。**這是本片爆炸半徑最大的一格。**
```

## 1-3 會員中心那條路 —— 🔴 **也不是我的檔案面**
```
storefront 的會員中心 profile 頁:生日接上(design 已有)+ 性別新畫(design 沒有)
```

## 1-4 🔴 生日要篩什麼 —— ✅ **Sean 2026-08-26 答 `e:丙` = 兩個都要**

⚠️ **這是他這一批唯一的非推薦**(我推甲)。而我自己說過「這兩種底層做法不一樣,
不是多打幾個字的差別」⇒ **那句現在要兌現,所以下面是重新估的成本,不是把兩個查法寫兩遍。**

### (1) 兩種篩法各自要什麼(我開檔查的,不是想的)
```
「幾歲到幾歲」  ⇒ 值域是【日期區間】 ⇒ birthday BETWEEN 兩個算出來的日子
                 索引 CREATE INDEX customers_birthday_idx ON customers(birthday);  ← 普通 btree
「這個月生日」  ⇒ 值域是【月份 1-12】 ⇒ 要 EXTRACT(MONTH FROM birthday)
                 索引 CREATE INDEX ... ON customers((extract(month from birthday)));  ← 函式索引
                 (birthday 是 date 不是 timestamptz ⇒ extract 是 IMMUTABLE ⇒ 建得起來)
```
⇒ **兩支索引,不是一支。** 而 `customers` 現在**一支生日索引都沒有**
(`20260523034911_init_customers_and_subtables.sql:27-28` 只有 `tier` 與 `email` 兩支)。

### (2) 🔴 而真正的成本【不在索引】,在後台列表走的是一支 view
```
packages/adapters/src/supabase/SupabaseCustomerAdapter.ts:290 逐字
  .from(ADMIN_CUSTOMER_LIST_VIEW).select(ADMIN_CUSTOMER_LIST_SELECT, ...)
:113 逐字 ADMIN_CUSTOMER_LIST_SELECT =
  'user_id, name, email, phone, tier, created_at, active_order_count, active_spend_total, last_active_ordered_at'
```
⇒ 🔴 **那支白名單【沒有 birthday】,而那是【刻意的】** ——
`apps/admin/src/lib/customers/customer-repository.ts:15-17` 逐字:
> 「列表走 `ADMIN_CUSTOMER_LIST_SELECT` 具名白名單(**不帶 wallet/birthday**);
> 明細-a 起 `findById` 含 …/birthday(… **PII 只在明細頁**、登入閘後)」

⇒ **「生日不上列表頁」是一條已經存在的決定,而 `e:丙` 沒有推翻它。**
⇒ ✅ **所以做法是:【篩得到、但不顯示】** —— PostgREST 可以對 view 上有的欄下 filter
   而不把它放進 `select` ⇒ **白名單一個字不動、生日不出現在畫面上。**
⇒ ⚠️ **而 view 本身要多兩欄**(`birthday` 與 `birth_month`)⇒ **那是一支新 migration**
   ⇒ 🔴 **鐵則 12③(動 schema)⇒ 這一片仍然要 codex 對抗審查,不因為「只是加欄」而降級。**
   ⇒ 🔴 **而 view 加欄要順便確認它現在 GRANT 給誰** —— 我**沒查**,列進 §3。

### (3) 🔴 每年錯一次的那一格 —— 主視窗點名的邊界,我逐條寫死
```
① 「這個月生日」的定義 = 【日曆月】(1 日到月底), 不是「未來 30 天」
   ⇒ 🔴 定成日曆月【就沒有 12/31 與 1/1 的跨年問題】—— 一個月份數字, 不跨界。
   ⇒ 而【會跨年的是另一種定義】:「接下來 N 天生日」12/28 查會漏掉 1/2 的人。
     ⇒ **所以這一格的防線不是寫程式小心, 是【把定義釘在 spec 裡】。** 釘在這裡。
② 「今天是幾月」由【app 端算, 用 Asia/Taipei】, 不用 DB 的 now()
   ⇒ 伺服器是 UTC ⇒ 台灣時間每月 1 號的凌晨 0-8 點, UTC 還在上個月
   ⇒ **每個月會錯 8 小時, 而它印出來的是一份看起來完全正常的名單。**
③ 算年齡【用日期界線, 不用天數除以 365】
   ⇒ 40 歲的下界 = today - interval '41 years' + 1 day, 上界 = today - interval '40 years'
   ⇒ 除以 365 的寫法遇到閏年會漂, 而 2/29 出生的人是它最先出錯的地方。
④ 兩個篩法同時選 ⇒ 【AND】(照 tier 與搜尋詞的既成慣例, Adapter:293 註解逐字
   「搜尋與 tier 是 AND」)⇒ 不自創第三種語意。
```

### (4) 成本重估(相對於原本推薦的甲)
```
甲 只做「這個月生日」  ⇒ 1 支函式索引 · view 加 1 欄 · 1 個 URL 參數 · 1 顆下拉
丙 兩個都要            ⇒ 2 支索引 · view 加 2 欄 · 3 個 URL 參數(月 / 年齡下限 / 年齡上限)
                        · 2 組 UI 控制 · 4 條上面那些邊界規則 · 各自的測試
⇒ 🔴 粗估【約兩倍】, 而增加的不是難度是【要記住的規則數】。
⇒ ⚠️ 而這是我估的, 不是量的 —— 我沒有寫過任何一行 ⇒ 這個「兩倍」是【推出來的不是量到的】。
```

---

## 1-5 後台篩選 —— ✅ **這是我的檔案面**
```
apps/admin/src/lib/customers/customer-list-view.ts        加 GENDER_PARAM + 值域白名單
apps/admin/src/components/customers/customer-filter-bar.tsx  加下拉(照現有 tier 那顆的形狀)
apps/admin/src/lib/customers/customer-repository.ts       查詢帶上 gender
apps/admin/src/app/customers/page.tsx                     接上去
+ 各自 .test.ts(x)
```


---

# §2 這一片的順序是硬的(而它與直覺相反)

```
① DB 加欄 + 補 UPDATE GRANT          ← 沒有欄位, 後面兩段都寫不進去
② 後台篩選(我的面)                  ← 🔴 可以先做, 因為它【只讀不寫】
③ 會員中心 + 註冊表單(不是我的面)    ← 最後, 而且爆炸半徑最大
```
🔴 **為什麼 ② 排在 ③ 前面**:②只讀,壞了是「篩不到」;③會動到**三條註冊路共用的 trigger**,壞了是**新客人註冊不了**。
⇒ **先讓資料進得來的路確定安全,再開那條路** —— 而②可以在零資料的情況下先驗完(全部 NULL 也篩得動)。

---

# §3 沒定的(逐條)

```
3-1 ✅ **gender 用 enum —— 主視窗 2026-08-26 裁定(與 `member_tier` 一致)**
    🔴 **而我原本寫的理由是錯的, 更正並留痕**:
       ~~「加第四個值要 ALTER TYPE(**已 apply 的 migration 不能改**)」~~
       ⇒ **加值【不必】改已 apply 的 migration** —— 它是開一支新的跑 `ALTER TYPE … ADD VALUE`。
       本 repo **有前例**:`20260725130000_m3_rf2a1_payment_status_add_partially_refunded.sql:45`
       (`ADD VALUE` 命中 2 支;正對照 `CREATE TYPE` 3 支;負對照當天靶 0)
       📌 **我把「麻煩」寫成了「不可能」** ⇒ 下一個人會為了「怕改不動」而選 text,
          **而那個理由是假的。**
    🔴🔴 **而真正的不對稱在另一邊, 那支前例的檔頭逐字記著**:
      ① 「**新值在加它的那個交易內不可被使用**」(PG 官方 sql-altertype Notes)
         ⇒ 該檔**刻意不包 BEGIN/COMMIT**
         ⇒ 🔴 **也因此做不了 PCM 慣用的交易模擬驗證**(BEGIN → 套用 → 用新值插 → 驗 → 回滾)
           ——「用新值插資料」那一步**同交易內物理上做不到**
         ⇒ **任何交付物不得宣稱這種 migration 做過交易模擬**(該檔逐字)
      ② 「**PostgreSQL 不支援移除 enum 值**」⇒ **該檔沒有真正的 rollback**
    ⇒ 📌 **所以 enum 的真相是:【加值便宜、移除不可能】** ——
      不是我寫的「硬」, 也不是「隨便加」。**它是單向的。**
    ⇒ ⚠️ **對 gender 的實際意思**:`'male'|'female'|'undisclosed'` 這三個值
      **定下去就移不掉** ⇒ 值域要一次想清楚, 而**加第四個(例如 'other')隨時可以**。

3-2 ✅ **已答**(2026-08-26 `e:丙` = 兩個都要)⇒ 全文與重估成本在 §1-4。
    🔴 **而它換來三格【新的沒查】**:
      (a) `ADMIN_CUSTOMER_LIST_VIEW` 現在 GRANT 給誰 —— 加欄前要確認, **我沒查**
      (b) 那支 view 的建表 migration 在哪、加欄要不要重建整支 view —— **我沒查**
      (c) 「約兩倍」那個成本是**推出來的不是量到的** —— 我一行碼都還沒寫

3-3 ⚠️ 既有客人有幾個 —— 沒查正式庫 ⇒ Q13甲(不回填)的代價講不出量級
    ⇒ 而它影響「這個篩選上線後多久才有用」

3-4 packages/adapters 那一層要改幾支 —— **沒盤**(主視窗先前裁「等批了再盤」)

3-5 性別那一格的【視覺】—— design 全樹零命中 ⇒ Design session, 不是我畫
    (與券的後台畫面同一個處置)

3-6 ✅ **已查:LINE 那條路帶不了性別/生日 ⇒ §0 的結論【全強度成立】**
    🔴 **我原本在這一格寫「五分鐘查得動, 下一輪開工前先查」—— 那正是我今晚才報過的病**
       (「一個五分鐘關得掉的未知, 不該留在交件檔裡」)⇒ **當場查掉。**
    量法(開檔逐行讀, 不是 grep 命中數):
      `apps/storefront/src/lib/auth/line-admin.ts:29` 逐字:
        「**user_metadata 只放 name / line_email(顯示用、trigger 取 name)**」
      同檔 `:26` 逐字:身分鍵存 app_metadata、**不存 user_metadata**(防偽造)
    ⇒ LINE **技術上帶得了** metadata, 而**它帶的內容裡沒有性別/生日**
      (LINE 基本 profile 本來也不給這兩項)
    ⇒ **Google 與 LINE 兩條路都補不到** ⇒ §0「OAuth 那批結構上必然是空的」**不打折**
```

📎 上游:[plan](2026-08-25-customer-filter-plan.md) · memory `project_0826-sean-answers-decision-table` ·
座標:`20260523034911_init_customers_and_subtables.sql:19` `:230` `:231` `:278-295` ·
`apps/storefront/src/app/register/actions.ts:60`
