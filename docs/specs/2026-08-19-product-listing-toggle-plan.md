# 後台上下架按鈕 —— plan(鐵則 8 + 12③,等批)

> 2026-08-19 G2。**未批准、零 code 改動、未 apply。**
> 路線由主視窗裁定 **甲(走 RPC)**,理由不是慣例:
> **上下架會改變客人看得到什麼,而它是一個會被事後追問「誰把它上架的」的動作 —— 直接 UPDATE 沒有地方記那件事。**

---

## 0. 🔴 這一片不是「補一個元件」,是**在商品域開出第一條寫入路**

```
git grep -n "\.update(|\.upsert(|\.insert(|\.rpc(" -- apps/admin/src/{lib,components,app}/products
  (排除 .test.)⇒ **0 命中**
正向對照(證明尺會動):同一把尺對 apps/admin/src/lib/orders ⇒ **5 個檔有 .rpc(**
```
⇒ 商品域今天**只讀不寫**。本片要建立的是那一整條路,不只是一顆鈕。

### 0-a 為什麼現在做:**決定做完了、實作做完了、只差一顆鈕**

```
Sean 2026-08-15 拍板 Q-B-2=甲 / Q-關哪一條=乙 ⇒ 下架權威從供應商移到員工
  證據在同步管線自己的 code:scripts/rpm-transform.ts:200-206 逐字
    「delisted_at 已從本型別移除,同步管線不再輸出這個 key」
    「🔴 不要把這一欄加回來 —— 加回來等於把下架權威還給來源,直接推翻本片與 Sean 的拍板」
  業務理由逐字:「如果原廠停產,但是我有現貨庫存,那我需要維持上架狀態」
⇒ 同步已經不碰這一欄了(實作完成)、Sean 已經拍了(決定完成)
⇒ 🔴 而**後台沒有任何介面可以按** ⇒ 那個拍板今天【一次都沒有被使用過】
```

### 0-b 🔴 OD 設計稿**刻意沒有畫這顆鈕**,而它的理由今天還成立

`pcm-product-edit-screen/brief.md:429` 逐字:
> **不提供下架按鈕。目前 `delisted_at` 與 `listing_set_by` 沒有任何既有寫入流程,
> 後台也沒有真正可用的下架能力;不能先畫一個看似可用、實際無法完成的按鈕。**

⇒ **那不是漏畫,是紀律** —— 它拒絕畫一顆按不動的鈕(同 repo 既有教訓)。
⇒ **所以本片沒有現成的視覺可以照抄**,位置那一題要另外決定(見 §3)。

---

## 0-c 🔴🔴 應用層【卡在 apply】—— 而這是型別層的硬阻擋,不是偏好

```
生成型別裡有 admin_set_product_listing 嗎?
  /usr/bin/grep -c "admin_set_product_listing" packages/adapters/src/supabase/database.types.ts ⇒ **0**
正向對照(一支已 apply 的同族 RPC,證明這把尺會動)
  /usr/bin/grep -c "admin_set_customer_tier"    同一個檔                                    ⇒ **1**
```
⇒ `.rpc('admin_set_product_listing', {...})` **今天寫下去 typecheck 就紅**(函式名不在生成型別裡)。

**唯一的繞法是【窄 cast】,而本 repo 已經明文把它拆掉過**:
`apps/admin/src/lib/customers/customer-repository.ts:99-108` 逐字記著 ——
「~~窄 cast `TierRpcClient`~~ 🔴 **2026-08-11 已拆(backlog `#415`)**…
**cast 留著只會讓 typecheck 對這條路失效**」
⇒ **重新引入它是回歸,不是權宜。** 本片不做。

### ⇒ 順序是硬的,寫成可機械複驗的等待條件(不要寫「等 Sean apply」)

```
① 本片的 migration commit 完成          ✅ 05d3a10e
② Sean apply                            ⏳
   🔴 到了要怎麼看出來(可 grep,不用問人):
      grep -c '^20260819040000' supabase/APPLIED.tsv  ⇒ 期望 1
③ 重跑 supabase gen types
   🔴 到了要怎麼看出來:
      grep -c 'admin_set_product_listing' packages/adapters/src/supabase/database.types.ts ⇒ 期望 ≥1
④ 才寫應用層(repository / server action / 那顆鈕)
```
📎 **這一段的寫法是刻意的**:本檔自己在 `docs/patterns/guard-and-instrument-traps.md` 記過
「**一句『等 X』不會在 X 到了的時候變色**」——
⇒ 所以這裡**不寫「等 Sean apply」**,寫的是**兩條 grep**。任何人一秒鐘就能判斷現在能不能開工。

---

## 1. 要做什麼(五樣)

```
① migration:新增 RPC public.admin_set_product_listing(...)
   樣板 = supabase/migrations/20260717010000_m4a_admin_set_customer_tier_rpc.sql(249 行)
   照它的六件:SECURITY DEFINER + SET search_path=public,pg_temp
             + 鎖列讀 before → 同值回 NO_CHANGE 零寫入
             + UPDATE 只 SET 該動的欄 → 同交易寫 admin_audit_log
             + REVOKE ALL FROM PUBLIC/anon/authenticated → 只 GRANT service_role
             + fail-closed DO 斷言
② 🔴 UPDATE 要同時寫兩欄:delisted_at 與 listing_set_by='staff'
   不寫第二欄 ⇒ 同步下一輪確實不會碰 delisted_at(已拍板),
   但【誰決定的】這個資訊就丟了 —— 而它正是 Sean 那個拍板的載體
   ✅ **而「只寫一欄」那個壞世界【構造不出來】**(GR R1 ② 量的,我抄它的量法):
   ```
   全樹今天【零個】listing_set_by 的寫入者 —— 唯一的值來源是 DDL DEFAULT 'sync'
     (20260815030000:58 逐字 `ADD COLUMN listing_set_by text NOT NULL DEFAULT 'sync'`)
     而同步的輸出型別根本沒有這個 key
   ⇒ 本片的 RPC 是【第一個也是唯一的】寫入者,且它在【單一 UPDATE】裡兩欄一起寫(原子)
   ⇒ 「delisted_at 變了而 listing_set_by 沒變」這個世界,今天構造不出來
   ```
   ⚠️ **而突變那格仍然要做** —— 它守的是「**未來有人把那半拿掉**」,不是今天的可達性。
③ repository 寫路徑(商品域第一條)+ server action
④ 元件:那顆鈕(位置見 §3)
⑤ 測試:含突變 —— 拿掉 listing_set_by 那半 ⇒ 必須有一格紅
```

### 1-a 稽核照既有形狀,**不發明**
```
admin_audit_log 由【RPC 內同交易 INSERT】—— 這是本 repo 既有做法,不是我選的
  git grep -l "INSERT INTO public.admin_audit_log" -- supabase/migrations ⇒ 6+ 支
  最近同族:admin_set_customer_tier / admin_adjust_wallet / admin_append_order_note
action 代碼照既有命名(customer.tier.change 那個形狀)⇒ 建議 `product.listing.change`
before / after 建議 = {delisted_at, listing_set_by} 兩欄
⚠️ 而另一個窗正在寫 #435(出貨線補稽核)⇒ **落檔前去對它的 action 命名**,不要各發明一套
```

---

## 2. 🔴 apply 順序:**本片與佇列裡另外兩支無先後依賴**(現在就判,不留給以後)

```
佇列現況(主視窗轉述,我未逐支核對 apply 狀態)
  ① M-4a 佇列出口那支      動 payment_charge_attempts 相關
  ② #435 出貨稽核          動 shipments / 稽核
  ③ 本片                    新增一支函式 + GRANT,UPDATE products 兩欄
判斷依據(機械的):三支的 **DDL 物件零交集** —— 本片不改任何既有函式、不改任何既有表結構,只新增一支函式
🔴 **而「零交集」這個字面是錯的,已修**(GR R1 nit-③):**三支都會 INSERT `admin_audit_log`**
  ⇒ 那是**共用的 DML 目標**,而 **DML 目標共用不構成 apply 依賴**(誰先 apply 都不影響對方能不能建)。
⇒ **無先後依賴,三支可以任意順序 apply。**
⚠️ 而若寫 code 時發現需要【動到既有 RPC】而不只是新增一支 ⇒ 🔴 **停下回報主視窗**
   (它明文說那是另一個風險層)
```

---

## 3. 🔴 那顆鈕放哪 —— **兩個位置,要主視窗選,我不自己拍**

**判準用走查那條線的語言:員工要下架一件商品,從登入算起要點幾下?**

```
甲 商品【列表】每一列一顆
   登入 → 商品 → 搜尋 → 按 = **3 步**
   ✅ 最快;批次處理多筆時明顯省事
   🔴 而列表已經很擠 —— #519 記著訂單列表 14 欄放不下的同型問題,
      商品列表今天 8 欄(窄)/14 欄(寬),再加一欄要重估
   🔴 而「一列一顆」的誤按代價是【客人立刻看不到那件商品】

乙 商品【詳情頁】一顆
   登入 → 商品 → 搜尋 → 點進詳情 → 按 = **4 步**
   ✅ 誤按風險低(要先點進來,已經在看這一件)
   ✅ 與 OD 設計稿的結構一致 —— 它的商品識別列右側就是放操作的地方
      (brief.md §①-A 逐字:「右側只有兩個操作:批次改特價 / 查看變更紀錄」)
   🔴 一次只能處理一件
```
🔴 **我傾向乙**,理由是誤按代價不對稱:**下架一件商品 = 客人立刻看不到**,
而多點一下的成本是**一次**,誤按的成本是**一通客訴 + 一次找不到原因的排查**。

### 🏁 裁定:**乙(詳情頁)**(2026-08-19,主視窗代裁,Sean 可推翻)

理由照我提的那條,而主視窗把它講得更死:
```
列表每列一顆(3 步):員工在【掃視】的狀態下按到 —— 而下架會改變客人看得到什麼
詳情頁(4 步)      :員工已經【打開這一件商品】—— 他知道自己在對誰動手
🔴 多一步的成本是【一次點擊】,誤按的成本是【一件商品從店裡消失,而沒有人知道】
```
⚠️ **而若之後出現「一次下架 20 件」的需求 ⇒ 那是【批次】,是另一片。**
**不要拿它來反推這一片該放列表。**(這句寫在這裡,是因為它會被拿來反推。)

---

## 4. 不做 / 邊界

```
· 不動 scripts/rpm-*(同步管線)—— 它已經照拍板停寫 delisted_at 了
· 不碰價格(Q-B1 的價格那半【沒有拍板】,同步今天仍每輪覆寫 price_general)
· 不做「型錄可見度」四值(repo 零命中,那是走在實作前面的東西)
· 不 apply、不 push
· 🔴 發現要動既有 RPC ⇒ 停,回報
```

## 5. 驗收(逐條 yes/no)

```
□ 按下之後,products.delisted_at 有值(下架)或為 NULL(上架)
□ 🔴 同一次寫入,listing_set_by = 'staff'
   突變:拿掉這半 ⇒ 對應那格必須紅
□ 同值再按一次 ⇒ NO_CHANGE、零寫入、零 audit 列(照樣板的行為)
□ admin_audit_log 多一列,actor / action / target / before / after 都對得上
□ EXECUTE 權限:anon / authenticated 打不到(照樣板的 REVOKE→GRANT)
□ 🔴🔴 **NO_CHANGE 時,員工打的備註不能靜默蒸發**(GR R1 must-fix-lite,**這是真世界的路徑**)
   ```
   員工在一件【已下架】的商品上,附了備註再按一次「下架」
   ⇒ RPC 回 NO_CHANGE ⇒ 零寫入、零稽核列 ⇒ **那段備註哪裡都沒有**
   ⇒ 而 UI 若只顯示「沒有變更」,員工會以為【他留了紀錄】,而世界上沒有
   ```
   🔴 **修法不在 SQL** —— RPC 零寫入是對的(重複按不該蓋時間戳、不該灌稽核噪音)。
   ⇒ **server action 要對「NO_CHANGE 且 note 非空」這一格 surface 出來**:
     例:「這件商品已經是下架狀態,沒有變更。**你打的備註沒有被記錄。**」
   □ 突變:拿掉那個分支 ⇒ 對應那格必須紅

□ 四綠 TURBO_FORCE=1(動 .tsx ⇒ 含 build)

□ 🔴🔴 **apply 之前必跑拋棄式 Postgres**(`docs/runbooks/throwaway-postgres-for-migration-verification.md`)
   **這一發不是省掉,是移到正確的時點**(主視窗裁):先送審 ⇒ 簽章/權限面是審查最可能動的地方,
   **先驗再被改一次等於驗了一個作廢的版本**。⇒ 審查定稿後、apply 之前跑。
   🔴 而那份 runbook 自己的那句話原樣抄在這裡,不要因為語法閘綠了就跳過:
   ```
   **語法過 ≠ 斷言會過 ≠ 行為對**
   ```
   本片今天只跑到第一層:`npx tsx scripts/check-syntax-nonts.ts <該 migration>`
   ⇒「檢查 1 檔、0 個不過」—— **那只證明它 parse 得動。**
   要驗的三件:①前置閘在缺少依賴時真的 RAISE ②apply 期斷言在權限沒收好時真的 RAISE
   ③NO_CHANGE / NOT_FOUND / UPDATED 三條路各走一次且**寫入筆數符合預期**(NO_CHANGE 要 0 列稽核)

   ### 🏁 **已跑完(2026-08-19 G2,PostgreSQL 17.10 拋棄式叢集 `:55571`)—— 三件全過**
   ```
   ① 前置閘：兩條【各自】RAISE，訊息不同 ⇒ 分得出是哪一個前置缺
      缺 products.listing_set_by ⇒「前置閘失敗 — public.products.listing_set_by 不存在(#20 片2a 未套用)」
      缺 admin_audit_log        ⇒「前置閘失敗 — public.admin_audit_log 不存在(M-4a M0-S2 未套用)」
   ② apply 期斷言：兩發突變，各自紅在【對的那一句】
      拿掉 REVOKE ⇒「anon 仍可 EXECUTE;authenticated 仍可 EXECUTE;」
      拿掉 GRANT  ⇒「service_role 沒有 EXECUTE;」
      正向對照：正本 apply ⇒ rc=0，且 has_function_privilege 三問 = anon f / authenticated f / service_role t
   ③ 三條路（每一步都查了寫入筆數，不是只看回傳值）
      NOT_FOUND  ⇒ 回 'NOT_FOUND'，稽核 0 列          （零寫入成立）
      UPDATED    ⇒ delisted_at 有值 + listing_set_by='staff'，稽核 1 列、action=product.listing.change、reason 存進去了
      NO_CHANGE  ⇒ 回 'NO_CHANGE'，稽核仍 1 列（沒有新增）
      反向 UPDATED（下架→上架）⇒ delisted_at 回 NULL、set_by 仍 staff、稽核 2 列
   ```
   🔴 **而 GR 的 must-fix-lite,這一發把它從【預測】變成【量到的】**:
   ```
   在【已下架】的商品上再按一次下架、【而且帶備註】「第二次的備註會不會被吃掉」
   ⇒ 回 NO_CHANGE，而 admin_audit_log 裡提到那句備註的列數 = **0**
   ⇒ 那段字【真的】哪裡都沒有。⇒ §5:185 那條 server action 的驗收條件【必須做】，不是保險。
   ```
   ✅ 順帶驗了備註輸入守門的**兩側**(不是只驗該擋的那側):
   ```
   201 字 ⇒ 擋住（「變更原因非法」）      ← 該紅有紅
   200 字 ⇒ 通過                          ← 🔴 正向對照：它不是恆炸
   只打空白 ⇒ UPDATED，而稽核的 reason 存成 NULL（不是空字串）
   ```
   ⚠️ **本機效度限制(照 runbook §5,不放寬)**:
   ```
   · 這是本機 PG 17.10，不是 Supabase；平台層（RLS 預設、Supabase 的角色屬性）不在射程內
   · bootstrap 的表是【從 repo 逐字取】的（products / admin_audit_log），
     而 brands / categories 我建的是【只有 id 的樁】⇒ FK 形狀對，欄位不完整
   · 沒有起 PostgREST ⇒ 「呼叫端拿不拿得到 NOT_FOUND 這個字串」這一層【沒有驗】
   · 🔴 initdb 要 `-E UTF8`：第一次用 `--locale=C` 起的叢集是 SQL_ASCII，
     apply 會炸在 `U&'\0085'` 那行「conversion between UTF8 and SQL_ASCII is not supported」
     ⇒ **那是環境缺陷不是產品缺陷**（runbook §0-4 的實例）
   ```
   ✅ 收攤逐項驗死:`pgrep` 零行 / `lsof :55571` 零行 / 資料目錄已刪 / 工作樹零留痕。
□ 🔴🔴 apply 後對正式站跑一次 **零寫入 smoke**(GR R1 MF-A;**原本的寫法會誘導人真按一次**)
   ```
   ❌ 舊寫法「那支函式解析得到、具名參數對得上」——
      照字面做最省事的驗法就是【真按一次】,而那會真的下架一件正式站商品
   ✅ 新寫法:拿一個【不存在的 product_id】呼叫它,期望回 'NOT_FOUND'
      函式在 ✓  具名參數對得上 ✓  零寫入 ✓  而且兩個世界印不同的東西
      (函式不在 ⇒ PostgREST 404 / 參數名漂 ⇒ 42883,都不會是 'NOT_FOUND')
   ```
   ✅ **而這一條本片的 RPC 設計【已經滿足】**:`NOT_FOUND` 是 `RETURN` 的字串值不是例外
   ⇒ 呼叫端拿得到、零寫入、零稽核列。(照樣板 `admin_set_customer_tier` 的三回傳值形狀。)
   📎 08-07 那次壞 8 小時的教訓仍然適用:**應用層不得先於 migration apply 上線。**

□ 🔴 **OD 那份稿要跟著改**(GR R1 MF-B):`pcm-product-edit-screen/brief.md:429` 逐字
   「不提供下架按鈕。目前 `delisted_at` 與 `listing_set_by` 沒有任何既有寫入流程…」
   ⇒ **本片 ship 的那一刻,那個理由就變成假的**,而沒有人改它 ⇒ 下一個設計者照舊不畫。
   ⇒ 落點指名:**在 OD `pcm-product-edit-screen` 的 `brief.md` 該行加訃聞**
     (原句留著標作廢 + 指向本片的 migration 檔名)。
   📎 這正是本檔自己在 §0-a 講的那件事的反面:**一句「因為 X 所以不做」,不會在 X 消失時變色。**

□ 🔴 **apply 的當下,先量一個 legacy 基線數**(GR R1 nit-a,我收)——
   這是本片對「service key 旁路」那個【擋不掉的代價】唯一擋得住的一半:**擋不掉,但看得見**。
   ```
   -- apply 期,唯讀,一行
   SELECT count(*) FROM public.products
    WHERE delisted_at IS NOT NULL AND listing_set_by = 'sync';
   ```
   🔴 **這個數今天【不會是 0】,而那不是異常** —— `rpm-reconcile` 歷史上寫過 `delisted_at`,
   那批列的 `set_by` 就是 DDL DEFAULT 的 `'sync'`。⇒ **它是基線,不是缺陷。**
   ⇒ 把當天量到的數字**連同量測日期寫進 apply 紀錄**(數字要跟著它的量測時點走)。
   ⇒ 🔴 **之後這個數再增長 = 有人繞過了本 RPC 直接寫表** —— 那是這條旁路唯一的偵測訊號。
   ⚠️ 而它偵測不到「本來就下架、被旁路改成上架」那一格(那會讓數字**變小**)
     ⇒ 這道量具的射程要跟著寫,不要讓下一個人以為它蓋住了整條旁路。
```

## 6. 誠實揭示

```
· 佇列裡另外兩支的 apply 狀態是主視窗轉述的,我沒有逐支核對
· #435 的 action 命名我還沒去看(§1-a 標了「落檔前去對」)
· 商品列表今天幾欄我沒重量(引 #519 的訂單列表數字當同型參照,不是同一張表)
· 我沒有畫任何視覺 —— §3 兩案是【位置】不是【樣式】,樣式要照 admin-design-system
· 🔴 我沒有實跑過任何寫入(本片零 code)
```
