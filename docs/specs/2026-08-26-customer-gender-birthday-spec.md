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
  🔴 型別:enum 還是 text + CHECK —— 見 §3-1, 我列成待決不自己拍
  值域:'male' | 'female' | 'undisclosed'          ← Q11甲
  NULL 允許 = 【還沒填】, 而 'undisclosed' = 【他選了不說】
  🔴🔴 這兩個【不是同一件事】, 不要合併:
     NULL          = 沒機會填 / 還沒填(含全部 OAuth 註冊者)
     'undisclosed' = 他看到了那一格, 而他選擇不說
     ⇒ 合併會讓「有多少人拒答」這個數字永遠算不出來
birthday 欄【已經存在】(:19 `birthday date`)⇒ 不動 schema
```

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

## 1-4 後台篩選 —— ✅ **這是我的檔案面**
```
apps/admin/src/lib/customers/customer-list-view.ts        加 GENDER_PARAM + 值域白名單
apps/admin/src/components/customers/customer-filter-bar.tsx  加下拉(照現有 tier 那顆的形狀)
apps/admin/src/lib/customers/customer-repository.ts       查詢帶上 gender
apps/admin/src/app/customers/page.tsx                     接上去
+ 各自 .test.ts(x)
```
⚠️ **生日要篩什麼**:`Q11`-`Q14` 沒有一題問這個。
```
· 「這個月生日的客人」(行銷用)⇒ 要的是【月/日】不是【年】
· 「幾歲到幾歲」⇒ 要的是【年】
🔴 兩種要的索引與查法不同 ⇒ 而 Sean 沒有被問過 ⇒ 見 §3-2
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
3-1 🔴 gender 用 enum 還是 text + CHECK
    · enum:值域硬、而【加第四個值要 ALTER TYPE】(已 apply 的 migration 不能改)
    · text + CHECK:改值域比較軟, 而少一層型別保護
    ⇒ 本 repo 兩種都有前例(member_tier 是 enum)⇒ **我傾向 enum**(與 tier 一致)
    ⇒ 而它是 schema 決定 ⇒ 列給主視窗 / codex 審查裁, 不自己拍

3-2 🔴 生日要篩什麼(月/日 vs 年齡)—— **Sean 沒有被問過這一題**
    ⇒ 建議併進下一批:「你想按生日篩什麼?甲 這個月生日的 乙 幾歲到幾歲 丙 兩個都要」
    ⚠️ 而【不問就做】會做出一個他不會用的篩選器

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
