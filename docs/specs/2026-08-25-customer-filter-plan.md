# Plan · 客戶篩選多軸化(+ 註冊表單收性別 / 生日)

> **狀態:等批。一行碼都還沒寫。**
> 來源:Sean 2026-08-24 逐字「客戶篩選:**當然要做啊......... 性別、生日這個在客戶註冊時候也要有**」
> (memory `project_0824-sean-five-scope-rulings`)。
> 命中 **鐵則 8**(跨 3+ 檔 + 動 schema)、**鐵則 12③**(schema)、**鐵則 12⑤**(改客人註冊流程 = 對外可見)
> ⇒ **高風險片、對抗審查不降級。**
> 產出者:施工窗 pcm-website-v2-1d(線 4),2026-08-25。

---

## 1. 現在能篩什麼(逐檔開過,不是估)

| 軸 | 在哪 | 走 URL 嗎 |
|---|---|---|
| **會員等級 tier** | `apps/admin/src/lib/customers/customer-list-view.ts:63` `TIER_PARAM = 'tier'` | ✅ |
| 關鍵字 | 走 **cookie 不走 URL**(`customer-keyword-cookie.ts`;同檔 `:180`) | ❌ |
| 排序 spend / orders | 同檔 `:97-104` | ✅ |

⇒ **篩選軸只有 tier 一根。** 量法:`grep -n "_PARAM = '" apps/admin/src/lib/customers/customer-list-view.ts`
⚠️ 「關鍵字」是**搜尋不是篩選**,而它走 cookie ⇒ **任何「把目前篩選存起來 / 分享網址」的東西都帶不走它**
(與 `2026-08-25-saved-views-plan.md` §2 同一個天花板,不重複論證)。

---

## 2. 🔴 要篩的東西,現在有沒有欄位(**這張表就是 schema 改動的範圍**)

| 要篩的 | customers 表有欄位嗎 | 註冊表單在收嗎 | design 真權威怎麼說 |
|---|---|---|---|
| 會員等級 tier | ✅ `:21` `tier member_tier NOT NULL DEFAULT 'general'` | — (後台標記) | ✅ 有 |
| **生日 birthday** | ✅ **已經有**`:19` `birthday date` | ❌ **沒收** | ✅ 有 |
| **性別 gender** | ❌ **沒有** | ❌ 沒收 | 🔴 **查無**,見 §3 |
| 地區 region | ❌ 沒有 | ❌ 沒收 | 未查(Sean 沒點名,本 plan 不含) |

**量法**(2026-08-25 當場跑)。分母 = `ls supabase/migrations/*.sql | wc -l` ⇒ **216** 支(**全部**);
逐字命中數 `grep -rn "<字>" supabase/migrations/*.sql | wc -l`:
```
gender   ⇒   0      region ⇒ 0
birthday ⇒  11      tier   ⇒ 224      ← 正對照,尺會動
```

🔴 **這把尺我換過一次,而換的理由要留下來**:
我第一版只掃檔名含 `customers` 的 migration ⇒ 分母 **2** 支。
而 `grep -rln "customers" supabase/migrations/*.sql | wc -l` ⇒ **38** 支有動到 customers。
⇒ **我的第一把尺比風險面窄了 19 倍,而它印出來的 `gender ⇒ 0` 與現在這一發【長得一模一樣】。**
⇒ 兩把尺都回 0,所以結論沒變 —— **而那是運氣,不是那把尺對。**
**註冊表單收什麼**(`apps/storefront/src/app/register/actions.ts:43,60` 逐字):
`name / email / phone / password / agree`,寫進 metadata 的只有 `{ name, phone }`
⇒ **生日、性別兩個都沒收。**

### 🔴 於是三件事的成本完全不同,不要當成一包
```
生日  欄位【已經有】、GRANT 也【已經有】
      (`20260523034911_...:231` 逐字 `GRANT UPDATE (name, phone, birthday, updated_at) … TO authenticated;`)
      ⇒ 缺的只有:註冊表單收它 + 後台篩它。**零 schema 改動。**
性別  欄位沒有、GRANT 沒有、design 查無
      ⇒ 新欄 + enum 或 CHECK + 欄級 GRANT + 註冊表單 + 後台篩選。**這一半才是 12③。**
地區  Sean 沒點名 ⇒ **本 plan 不含。** 要加請他明講(不要我替他擴)。
```

---

## 3. 🔴 鐵則 1 真權威解析:性別在**我掃過的兩處設計稿**上查無

分母 = **design-reference 1 處 + Open Design 磁碟上 11 個專案**,合計 **12** 個掃描位置。
量法 `ls "$HOME/Library/Application Support/Open Design/namespaces/release-stable/data/projects/" | wc -l` ⇒ 11。
⚠️ **這兩處以外我沒掃**(例如 Figma、Sean 本機別處的檔、還沒同步進 OD 的稿)⇒ 是「我掃過的地方沒有」,不是「世界上沒有」。

```
① design-reference/(submodule)
   性別 ⇒ 0 檔   gender ⇒ 0 檔
   正對照(同一條指令換字)生日 ⇒ 1 檔 · birthday ⇒ 1 檔  ⇒ 尺會動
   而那一檔是 design-reference/components/AccountPages.jsx:669 逐字:
     <label><span>生日</span><input type="date" value={profile.birthday} …/></label>
   🔴 注意它在【會員中心的個人資料頁】,不是註冊表單。

② Open Design 全部 11 個專案(磁碟)
   性別 ⇒ 0 檔   gender ⇒ 0 檔
   正對照 訂單 ⇒ 379 檔 · order ⇒ 773 檔 · 生日 ⇒ 70 檔 · birthday ⇒ 13 檔  ⇒ 尺會動
   路徑 ~/Library/Application Support/Open Design/namespaces/release-stable/data/projects/
```

🔴🔴 **而查 OD 的過程本身撞到 CLAUDE.md 記過的那個坑,原樣記下來**:
```
mcp__open-design__list_projects  ⇒  {"projects": []}
ls <上面那個磁碟路徑> | wc -l    ⇒  11
```
⇒ **daemon 沒起來與「真的沒有設計稿」印同一句話**,而後者會讓人直接自己畫。
⇒ 本 plan 的 OD 那一格**走磁碟,不走 MCP**。

### ⇒ 這件事對 plan 的意思
```
生日  設計稿上有(會員中心那一格)⇒ 【把它搬到註冊表單】是延伸,不是照搬
      ⇒ 註冊表單上它長什麼樣 —— 稿上沒有 ⇒ 要 Sean 或 Design session 定
性別  設計稿上【什麼都沒有】⇒ 選項有幾個、怎麼問、可不可以不填
      ⇒ **全部是未定義的產品題,不是我能推的**
```
⚠️ **我只數了檔數,沒有逐檔開看 OD 那 70 個「生日」命中在講什麼。**
真要照搬註冊表單的視覺,**要先開那些檔**,本 plan 沒做到那一步。

---

## 4. 🔴 要 Sean 拍的 —— 四題,每題一個字

```
Q1 性別要幾個選項
   甲 男 / 女 / 不透露            ← 推薦
   乙 男 / 女
   丙 男 / 女 / 其他 / 不透露
   理由:甲讓不想答的人有地方去,而不會讓「沒填」與「不想講」混成同一個空值 ——
         那兩件在做行銷分眾時意思完全不同。
   🔴 設計稿上零依據(§3 分母)⇒ **這一格純粹是你的產品判斷,我沒有東西可以搬。**

Q2 註冊時性別 / 生日是必填還是選填
   甲 兩個都選填                  ← 推薦
   乙 兩個都必填
   丙 生日必填、性別選填
   理由:必填會讓一部分人在註冊那一步直接離開,而這兩欄是拿來分眾用的、不是交易必需。
   ⚠️ 而選填的代價要先知道:**選填 ⇒ 篩選結果永遠只涵蓋有填的那群**,
      報表上「男性佔 30%」實際意思是「有填的人裡面」。

Q3 🔴 既有客人怎麼辦(memory 記著這是【第六題,還沒問過你】)
   甲 不回填,新客人才有,舊客人那兩欄空著        ← 推薦
   乙 寄一封信請舊客人補
   丙 下次他登入時跳一次
   理由:甲今天就做得完、零對外動作;乙丙都是**對外可回收性差**的動作(鐵則 12⑤),
         而且在你還沒看到這功能長什麼樣之前就寄信給客人,順序是反的。
   ⚠️ 選甲的代價:**篩選在上線後很長一段時間都只涵蓋新客人。**

Q4 這一片要不要一次做完三段
   甲 分兩片:先做【生日】那一半(零 schema),性別另開一片   ← 推薦
   乙 一片做完性別 + 生日 + 後台篩選
   理由:生日欄位與 GRANT 都已經在(§2),它的一半**不動 schema、不命中 12③**;
         性別那一半要新欄 + 對外註冊流程 ⇒ 12③ + 12⑤,兩件綁一起會讓整片都變高風險。
   ⚠️ 分兩片的代價:註冊表單會被動兩次(對外的東西改兩次)。
```

---

## 5. 影響面(鐵則 8 要的四件)

**要改什麼**
```
【我的檔案面 —— 我可以動】
  apps/admin/src/lib/customers/customer-list-view.ts     加篩選軸的 PARAM / 值域白名單
  apps/admin/src/components/customers/customer-filter-bar.tsx  加下拉
  apps/admin/src/app/customers/page.tsx                   接上去
  + 各自的 .test.ts(x)

【🔴 不是我的檔案面 —— 列出來,不動,等主視窗協調】
  apps/storefront/src/app/register/page.tsx      註冊表單加欄位
  apps/storefront/src/app/register/actions.ts    寫進 metadata
  packages/adapters/…                            customers 讀寫映射(未逐檔盤,見 §6)

【schema —— 只有 Q4 選乙 或 性別那一片才動】
  supabase/migrations/<新>  ALTER TABLE customers ADD COLUMN gender …
                            + 欄級 GRANT + 索引
  🔴 照 docs/patterns/revoking-function-execute-in-supabase.md:
     **新物件出生就自帶 anon 權限、repo 內零 GRANT 字面可掃、三綠不紅。**
```

**為什麼**:客戶列表只有 tier 一根軸,而 Sean 要能按性別 / 生日分眾。

**預期影響面**
- 後台:`/customers` 列表頁的篩選列。零金額路徑、零訂單路徑。
- 🔴 **顧客站:註冊流程**(鐵則 12⑤ 對外可見)—— **這是本片風險最高的一格**,
  改壞了不是「後台難用」,是**新客人註冊不了**。
- DB:多一欄(僅性別那一半)。

**rollback**
```
後台那半     單一 commit revert 即完全復原
註冊表單那半 單一 commit revert，而**已經送出的註冊不會回來** ⇒ 上線後才發現要看資料
schema 那半  🔴 ADD COLUMN 可以 DROP，而【已寫進去的值會一起沒了】
             ⇒ rollback 前先把該欄倒出來。**不是純技術動作。**
```

---

## 6. 這份 plan 自己不確定的

```
· packages/adapters 那一層要改幾支 —— **沒盤**(不在我檔案面,且無 Sean 批准前不擴散閱讀)
· OD 那 70 個「生日」命中在講什麼 —— **只數了檔數,沒開檔**
· 地區 / 登入方式 兩軸 —— Sean 沒點名,本 plan 不含(memory 提過,不代表他要)
· 既有客人有幾個 —— **沒查正式庫**,Q3 的代價講不出量級
· 性別欄要用 enum 還是 text + CHECK —— 沒選,等 Q1 定了選項才有意義
· 註冊表單改動的視覺 —— 稿上沒有註冊表單的性別/生日格 ⇒ 要 Design session,不是我
```

📌 相關:memory `project_0824-sean-five-scope-rulings` ·
`supabase/migrations/20260523034911_init_customers_and_subtables.sql` ·
`apps/storefront/src/app/register/actions.ts` · `docs/runbooks/data-rights-sop.md`(新增 PII 欄要進那張落點表)
