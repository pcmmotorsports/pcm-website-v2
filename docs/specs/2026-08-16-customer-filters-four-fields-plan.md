# 客戶篩選四欄 plan(年齡 / 性別 / 居住地區 / 登入方式)—— 鐵則 8 + 鐵則 9,**等 Sean 批**

> **狀態**:未動手,零程式改動。本檔是 plan。
> **提出**:A 窗,2026-08-16。worktree `/Users/sean_1/pcm-bmw-m`,分支 `bmw-m-headline`。
> **來源**:Sean 早先拍「能做的話都做」;性別選項已拍板(`Q2=甲`:男 / 女 / 不願透露)。
>
> 🔴🔴 **這份 plan 的結論是:四欄【不是同一件事】,成本差一到兩個數量級。**
> **請不要當成一片批准。** 逐欄的批准與否可以分開。

---

## 0. 🔴 為什麼「現在做」比較便宜 —— 而這個窗口會關

```
客戶總數 11、全部是自己測試用、有填生日 2 ⇒ 真實客戶 0
```
⚠️ **這三個數字我沒有當場量**(admin 需登入態、我沒有)——
**來源是主視窗轉述的先前盤點,標【未確認】。**
🔴 **開工前第一件事就是重量一次** —— 若真實客戶已經進來,整份 plan 的成本評估要重算。

**若那三個數字成立**:加欄位、改註冊流程的**回填成本現在是 0**,而每多一個真實客戶就多一次回填。

---

## 1. 逐欄的**資料在不在** —— 四欄逐欄實查,不是推測

**四條數法先列,結論在下表**(落筆當下實跑):
```
gender          grep -rn 'gender' supabase/migrations/ --include='*.sql' | wc -l        => 0
birthday        同上換 birthday                                                          => 3（建表 1 + GRANT 2）
地址結構化欄    sed -n '/CREATE TABLE customer_addresses/,/^);/p' <init 檔>              => 只有一個自由文字 `line`
登入方式        grep -rn 'raw_app_meta_data\|auth\.identities' supabase/migrations apps/admin/src packages
                (排除 payment provider 誤命中)                                            => 0
```

| 欄 | 資料現在在哪 | 判定 |
|---|---|---|
| **年齡** | ✅ `customers.birthday` **date,已存在** | **最便宜**,只差算式與 UI |
| **性別** | ❌ **不存在** —— **全 `supabase/migrations/` 搜 `gender` 共 0 命中**(不只建表) | 要 migration **+ 改註冊流程** |
| **居住地區** | ⚠️ `customer_addresses` 建表 13 欄裡,地址**只有一個** `line text NOT NULL`,註解逐字「對齊 design L716 placeholder『縣市 / 區 / 路 / 號 / 樓』」 | **零結構化縣市欄** |
| **登入方式** | ⚠️ **部分可推導**,見 §1.4 | 比預期便宜,但只分得出一半 |

**數法(可重跑)**:
```
customers 建表   sed -n '/CREATE TABLE customers/,/^);/p' \
                 supabase/migrations/20260523034911_init_customers_and_subtables.sql
addresses 建表   同檔搜 CREATE TABLE customer_addresses
讀模型           packages/domain 搜 AdminCustomer（現有欄:id/name/email/phone/tier/createdAt/
                 activeOrderCount/activeSpendTotal/lastActiveOrderedAt …）
                 🔴 birthday【不在讀模型裡】—— 欄在 DB、但沒有投影出來
```

### 1.4 🔴 「登入方式」—— **我找到一條不用碰 auth schema 的路**

主視窗把這欄標成「資料在 Supabase auth schema,admin 讀不讀得到**未確認**」。
**實查之後,至少一半不需要碰它**:

LINE 登入時我方**自己造帳號**:`line_{sub}@line.pcmmotorsports.local`
(`apps/storefront/src/lib/auth/line-admin.ts` 的 `lineSyntheticEmail`),
而 trigger 把它**原樣**寫進 `customers.email`
(`20260523034911_init_customers_and_subtables.sql` 搜 `VALUES (NEW.id, NEW.email`)。
⇒ **`customers.email` 的網域就是「是不是 LINE 註冊」的判別式**,
而**判別函式已經存在**:`@pcm/schemas` 的 `isSyntheticEmailDomain`
(`packages/schemas/src/notification-email.ts` 搜 `LINE_SYNTHETIC_EMAIL_DOMAIN`)。

**⇒ 可以分出的**:`LINE` vs `非 LINE`(零 migration、零 auth 存取、共用既有函式)。
**⇒ 分不出的**:非 LINE 裡面的 **Google OAuth vs Email 密碼註冊** ——
那兩個的 email 都是真信箱,`customers` 這側**沒有任何欄位區分**。
🔴 **要分出那兩個,才需要碰 `auth.identities` / `auth.users.raw_app_meta_data`,而那件【仍未確認】**:
```
數法（已跑）grep -rn 'raw_app_meta_data\|auth\.identities' supabase/migrations apps/admin/src packages
⇒ 零命中（排除 payment provider 的誤命中）
⇒ 全 repo 目前【沒有任何一處】讀 auth schema 的登入方式
```
⚠️ **「零命中」只證明「現在沒人讀」,不證明「讀不到」** —— 兩者不同。
**要證讀不讀得到,得實際用 service_role 對 `auth.identities` 下一次查詢**,而我沒有那個環境。
⇒ **列為本片開工前的第一道驗證,不是實作項目。**

---

## 2. 四欄的成本與建議,**逐欄分開**

### 甲 · 年齡 —— **建議先做,可獨立成一片**
```
資料      customers.birthday 已存在
要做      ① 投影進讀模型（AdminCustomer 加 birthday 或直接加 ageBucket）
          ② 篩選 UI（既有 multi-check-filter 可用）
          ③ 年齡分組要 Sean 定（20 以下 / 20-29 / 30-39 …？還是自訂區間？）
零 migration、零註冊流程改動
```
🔴 **兩個要他拍的**:①**分組怎麼切** ②**沒填生日的人**歸哪一堆
(「未填」要當成一個可篩的值,**不能靜靜地從結果裡消失** —— 那是本 repo 反覆記過的「不知道 ≠ 是 0」)。
⚠️ **有填生日 2 / 共 11**(未確認)⇒ **做出來之後多數人會落在「未填」** —— 他要知道這件事再決定值不值得。

### 乙 · 登入方式(只分 LINE / 非 LINE)—— **次便宜**
```
零 migration、零 auth 存取、共用既有 isSyntheticEmailDomain
```
⚠️ **要他知道的限制**:**分不出 Google 與 Email 註冊**。
若他要的是三分類,**先做 §1.4 那道驗證**,結果出來再評估。

### 丙 · 性別 —— **要 migration + 改註冊流程,而且碰個資**

**數法**:`grep -rn 'gender' supabase/migrations/ --include='*.sql' | wc -l` ⇒ **0**
(範圍 = 全 migrations,不只建表 ⇒ 不是「建表沒有但後來加了」)。
```
① migration：customers 加 gender 欄（enum 男/女/不願透露，Q2=甲 已拍）
② 註冊流程要不要問？→ 【這是他要拍的,不是技術問題】
   不問 ⇒ 永遠全是 NULL，篩選器篩不到東西
   要問 ⇒ 改 storefront 註冊表單 + 個人資料頁 + 隱私政策可能要提
③ 既有 11 位客戶回填 ⇒ 現在是 0 成本，之後不是
```
🔴🔴 **鐵則 9 內容分級**:性別是**個資**。
**收集個資要有目的與告知** ⇒ 隱私政策(`#291`,目前唯一 blocker 是內容來源未定)可能要動。
⇒ **本欄不建議與其他三欄綁在同一片。**

### 丁 · 居住地區 —— **最貴,而且我建議先不要做**
```
現況     customer_addresses.line 是自由文字「縣市 / 區 / 路 / 號 / 樓」
選項 A   解析自由文字取縣市  ⇒ 🔴 不可靠（打字順序/簡稱/錯字），且【解析結果沒有真相可對】
選項 B   加結構化縣市欄     ⇒ 要 migration + 改地址表單 + 回填既有地址
選項 C   訂單的 shipping_address_snapshot ⇒ 🔴🔴【不可行】
         那個欄在鐵則 12 的 forbidden 清單裡：PII 只在 SQL 內比對、不進讀模型
         （`20260810120000_m4b_347_3a_admin_search_orders_date_range.sql` 的 COMMENT 逐字：
           「擴投影等於拆守門」）
```
🔴 **選項 A 是本 repo 明文反對的形狀** —— 自由文字解析在 `§0-C` 被 Sean 當面推翻過一次
(`docs/specs/2026-08-12-admin-order-ui-design-brief.md` 搜 `原句是資料、結構是衍生`)。
⇒ **建議:要做就走 B,而 B 的體積接近「性別」那一欄。先不做。**

---

## 3. 我建議的切法(等他挑,不是我決定)

```
片一  年齡        零 migration，最快看到東西  ← 建議先做
片二  登入方式    零 migration，但要先接受「只分 LINE / 非 LINE」
片三  性別        migration + 註冊流程 + 個資告知  ← 要單獨批
片四  居住地區    migration + 地址表單 + 回填      ← 建議暫緩
```

## 4. 開工前必做的三道驗證(**不是實作**)

1. 🔴 **重量那三個數字**(客戶總數 / 有填生日數 / 真實客戶數)—— 現值是轉述、未確認。
2. 🔴 **service_role 讀不讀得到 `auth.identities`** —— 決定「登入方式」能不能做三分類。
3. **既有 11 位客戶的 `customer_addresses.line` 長什麼樣** —— 決定選項 A 到底有多不可靠
   (若他們填的格式其實很一致,B 的急迫性下降)。

## 5. 我需要的批准

- **逐欄分開批**,不要一次批四欄。
- **片一(年齡)** 我需要:①年齡分組怎麼切 ②「未填生日」歸哪一堆。
- **片三(性別)** 在他決定「註冊時要不要問」之前**不能開工** —— 不問就是做一個永遠篩不到東西的篩選器。

## 6. 誠實缺口

- **三個數字(11 / 2 / 0)是轉述,我沒有當場量** —— admin 要登入態,我沒有。
- **「service_role 讀不讀得到 auth schema」我沒驗** —— 只證了「全 repo 目前沒人讀」,
  而**「沒人讀」與「讀不到」是兩件事**。
- **我沒有看過那 11 位客戶的地址實際長什麼樣** ⇒ §2 丁 對選項 A 的「不可靠」是**一般性判斷**,
  不是對這份資料的觀察。
