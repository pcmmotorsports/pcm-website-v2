# `#657` · storefront 沒有 env↔DB 配對守門 —— **調查結果 + plan**

> 落檔 2026-08-19T01:09 CST(`date` 實跑) · 作者 G5 · **只查、只提 plan,一行 code 沒改**
> 片型:**高風險片**(鐵則 12① 錢:動 storefront 金流注入點)⇒ 關卡1 + 關卡2 都不降級
> 🔴 **本檔有兩格的答案與交辦時的框法不同** —— 見 §2 與 §4,那兩格會改變修法。

---

## §0 🔴🔴 順序被 Sean 的回答整個換掉了(2026-08-19,他答 Q9 追加)

**他的原話(逐字,主視窗轉貼原文)**:
```
Q9 追加：Vercel 上的 TAPPAY_ENV 跟 NEXT_PUBLIC_SUPABASE_URL 這兩個設定，
        是【按環境分別設定】的，還是【全環境共用一組】？

都是全環境共用，因為之前我設定的...
```

### ⇒ 本檔原本的順序【作廢】
```
⛔ 原本  加守門(storefront 抽共用 + 兩邊接上)
✅ 現在  ① env scoping ← 🔴 硬前置,而【我們做不動】,只有 Sean 在 Vercel 面板做得到
        ② 守門變【第二層】,而它的理由要改寫
```

🔴 **理由為什麼要改寫(這是本節的重點)**:
```
守門是攔【錯配對】的。而現在的狀況是【配對本來就是錯的】,只是還沒有人用 preview 刷卡。
⇒ 先加守門而不做 ① ⇒ 我們會擋住一個【本來就不該存在】的組合,
   而那個組合【每天都在成立】(preview 一直掛著、連著正式庫)
⇒ 那不是「守門發揮作用」,那是「守門天天在擋一個沒人修的錯設定」
   —— 而天天響的警報會被當成背景噪音(memory feedback_an-absent-dimension-cannot-fail 那條的近親)
```

### 🔴 這不是新風險,是**一直都這樣**
**不要讀成「最近才壞的」。** `TAPPAY_ENV` 與 `NEXT_PUBLIC_SUPABASE_URL` 全環境共用是**既有設定**,
而 `#657`(storefront 沒守門)只是**讓它沒有任何東西會叫**。
📎 **它剛好解釋了今晚另一件事**:本機刷沙盒卡而訂單躺進正式站後台 —— **同一個根源**
(「TapPay 那一側是沙盒,而帳本那一側是正式站」),不是兩件獨立的事。

---

## §0-b 一句話(技術面)

admin 有一道「TapPay 環境 × 帳本 DB 必須同一側」的 fail-closed 斷言,**storefront 沒有**。
而 **storefront 那一側不能照抄** —— 它的 fail-closed 會打到「錢已經動了、正在記帳」那條路。

---

## §1 現況(當場量,逐條 `檔案:行號`)

```
admin 有守門
  apps/admin/src/lib/payment/composition.ts:71   tapPayEnvPairingViolation(env, supabaseUrl)
  同檔 :142                                     requireEnv('NEXT_PUBLIC_SUPABASE_URL') 後呼叫,違規 ⇒ throw TapPayConfigError
         ⛔ 本檔曾寫 :143(90+53)—— 我拿 `sed -n '90,154p'` 的視窗相對位置去加,而【視窗起點自己也算一行】
            ⇒ 正解 90+53-1=142。落檔自檢當場抓到。這是本 session 第二次同款,兩次都是【推的當成量的】
  規則 :95-100                                  production × 非正式帳本 ⇒ 擋;sandbox × 正式帳本 ⇒ 擋
  常數 :48                                      PROD_SUPABASE_HOST = 'bmpnplmnldofgaohnaok.supabase.co'(刻意寫死不做成 env)

storefront 沒有
  git grep -c 'PROD_SUPABASE_HOST' -- apps packages
    ⇒ apps/admin/.../composition.test.ts:11 / composition.ts:5 / packages/.../database.types.ts:1
    ⇒ 🔴 apps/storefront 零命中
  apps/storefront/src/lib/payment/composition.ts:70-72
    ⇒ 它【有】驗 TAPPAY_ENV 的值合法(只接 sandbox|production),而【沒有】任何配對斷言
```

🔴 **兩種失敗形狀相反,引用時必須帶上是哪一個 app**:
```
admin(有守門)      你【會看到紅】,只是可能讀錯原因  → 代價 = 查錯方向
storefront(沒守門) 你【什麼都不會看到】              → 代價 = 安靜地寫進正式站
```

---

## §2 ✅ 格2:注入點【存在】—— **這不是架構改動**(與交辦時的假設不同)

交辦問「storefront 有沒有對應的 composition?沒有的話這是不是變成一片架構改動」。
**有。而且是 admin 自己的檔頭指出來的**:
```
apps/admin/src/lib/payment/composition.ts:4 逐字
  「composition.ts — 後台付款 composition root(M-3 RW2b;對照組 = apps/storefront/src/lib/payment/composition.ts)」
⇒ apps/storefront/src/lib/payment/composition.ts 存在,245 行
⇒ 唯一的 TapPay adapter factory = :69 getTapPayAdapter()
```
⇒ **注入點單一、受控** ⇒ **不是架構改動,是在既有單檔加一道斷言。**

---

## §3 🔴🔴 格4(fail-closed 取捨)—— **交辦把它框成「要不要一樣」,而真正的問題是【放在哪一層】**

### 量到的:那支 factory 被【五條性質完全不同】的路徑共用
```
git grep -n "payment/composition" -- apps/storefront   (排除 .test.)
  checkout/charge-actions.ts:69                    ← 客人按下「付款」
  checkout/callback/page.tsx:32                    ← 客人 3DS 返回頁
  api/checkout/tappay-notify/[secret]/route.ts:45  ← 🔴 TapPay 的 webhook(server-to-server)
  api/orders/[orderId]/payment-status/route.ts:36  ← 客人輪詢付款狀態
  api/cron/settle-sweep/route.ts:41                ← cron 掃補款
  api/cron/anomaly-alert/route.ts:42               ← cron 告警
而 composition.ts:123-127  getSettleChargeDeps() 內部逐字 `tappay: getTapPayAdapter()`
  ⇒ 上面【後四條】全部經由 getSettleChargeDeps 牽到同一支 factory
```

### 🔴 所以「照 admin 放在 factory 裡 throw」會打到相反代價的兩群
```
群 A:錢還沒動           charge-actions(客人按付款)
     fail-closed ⇒ 客人付不了錢。吵、看得見、而【沒有錢卡在中間】⇒ 這一群【該擋】
群 B:錢已經動了,正在記帳  tappay-notify webhook / callback / payment-status / settle-sweep
     fail-closed ⇒ 🔴🔴 TapPay 那邊【已經收到錢】,而我們拒絕記帳
     ⇒ 訂單永遠不會變成已付、客人的錢在 TapPay 那裡、我們的庫裡什麼都沒有
     ⇒ **這比「客人付不了錢」嚴重一個量級,而且它安靜**
```
📎 **判別句**:這條路徑上,**錢已經動了嗎?**
```
沒動 ⇒ 擋住是保護(擋掉一次誤配對的扣款)
動了 ⇒ 擋住是製造事故(把一筆真實款項變成無主)
```

### ⇒ 修法方向(要 Sean/主視窗裁,我不自己定)
```
甲 斷言放在【charge 發起路徑】,不放在 factory
   · 只有 charge-actions 那條在建 adapter 之前先跑配對斷言
   · 群 B 完全不受影響 ⇒ 已動的錢一定記得進來
   · 代價:誤配對的環境仍會【記帳】,而那正是守門要防的污染之一
        ⇒ 但污染的前提是「已經有人刷成功」,而 charge 那條已經被擋住了
        ⇒ 剩下的只有「擋門之前就在飛的那幾筆」,有界
乙 斷言放在 factory(照 admin),而群 B 改成【記警報不 throw】
   · 需要一個「會叫」的通道(anomaly-alert 已存在 ⇒ 可能可以複用)
   · 代價:多一個分支、而那個分支的判別力要另外證明
丙 兩者都做:charge 擋、群 B 告警
   ⇒ 🔴 我推薦丙,而它比甲貴。理由:甲留下的那個窗口(飛在路上的那幾筆)【是可以被關掉的】
      而關掉它的成本只是一個告警,不是一個 throw
```
⚠️ **admin 那邊不受這個取捨影響** —— admin 的守門在退款 action,那條路上**錢還沒動**(退款尚未送出)⇒ 它 fail-closed 是對的。**不要因為 storefront 這樣改就回頭去改 admin。**

---

## §4 格1:admin 那四條【誠實邊界】搬到 storefront 之後,**兩條成立、一條不成立、一條變糟**

admin 檔頭 `:61-69` 自己列了四條它擋不住的。逐條重問:

| # | admin 的邊界 | 搬到 storefront |
|---|---|---|
| ① partner key 是別的商戶(TapPay key 無 sandbox/production 形狀標記) | ✅ **原樣成立**,機械上仍判別不了 |
| ② 非正式 Supabase 專案裡裝的是正式資料複本 ⇒ 被當 sandbox 側放行 | ✅ **原樣成立** |
| ③ `TAPPAY_MERCHANT_ID` 與該筆交易的商戶不同 —— admin 說「由 adapter 的 recordQuery 恆帶 merchant_id + action 層擋」 | 🔴 **不成立,要另外查**:`git grep -n 'merchant_id' -- apps/storefront/src/app/checkout` ⇒ **零命中** ⇒ storefront 的 charge 路徑**沒有那一層對應的擋**(而 adapter 層可能有,我沒查到那麼深)⇒ **標未確認** |
| ④ 正式站日後改用自訂網域連 Supabase ⇒ 判定整個反過來(production 被誤擋、sandbox × 正式帳本被誤放,單向盲區) | 🔴 **搬過去會【變糟】**,見下 |

### 🔴 邊界④ 為什麼變糟:**它會產生第二份「正確值」,而那正是 admin 自己警告的事**
```
apps/admin/src/lib/payment/composition.ts:9-12 逐字警告
  「admin 複製第二份『正確值』正是『sandbox/production 對調也全綠』那類靜默失效的溫床」
```
⇒ 若 storefront 自己再寫一份 `PROD_SUPABASE_HOST = 'bmpnplmnldofgaohnaok.supabase.co'`,
**兩份會漂**:改網域那天有人改了一份、忘了另一份 ⇒ **一個 app 誤擋、另一個誤放**,而誤放那半不會炸。
⇒ **硬規定進本 plan**:那個常數與那支 `tapPayEnvPairingViolation` **必須只有一份**,
搬去共用位置(候選 `packages/adapters`,與 `tapPayUrlsFor` 同一種處理方式),**兩個 app 都 import**。
🔴 **這使本片從「storefront 加一道斷言」變成「把 admin 那道抽成共用 + 兩邊接上」** ⇒ **跨檔數變多,鐵則 8 命中更確定。**

---

## §5 格3:preview / staging ⇒ ✅ **已答,是嚴重那一半**(2026-08-19 Sean)

> 🔴🔴 **本節下面整段是【問出去之前】寫的,現在是訃聞 —— 答案在 §0,不要照本節讀。**
> Sean 逐字「**都是全環境共用,因為之前我設定的...**」
> ⇒ 本節末那句預測(「若是全環境共用,先要處理的不是加守門,是 env scoping」)**成立**,已提到 §0。
> ⇒ 他要按的步驟另開一份:`docs/runbooks/vercel-env-scoping-for-preview-safety.md`
> ⇒ 而**新的未確認三件**(哪些 preview 掛著 / 誰觸發 cron / 兩個 Vercel 專案的正式分支)在 §5-b。
> 📎 **本節留著不刪的理由**:它記錄了「為什麼會問這一題」與「當時我用哪些尺查」——
> 而那把尺(`vercel.json` 零命中 + 「查不到設定推不出不存在」)下一個人還會用到。

`#657` 條目自己列了這一格。**我查得到的**:
```
vercel.json                                        無 env / 無 branch / 無多環境設定(grep 零命中)
docs/reference/environment-values-and-what-stands-on-them.md  🔴 全檔零一處講「preview/staging 部署」
   (唯一 'staging' 命中在 :136,講的是 PostgREST 版本比對,與部署環境無關)
平台方案 = Vercel Hobby(memory reference_pcm-platform-plans-vercel-hobby-supabase-pro;
   docs/phase-1-backlog.md:17870 也記著)
```
🔴 **而「查不到設定」推不出「不存在」**:
**Vercel 的 per-branch preview deployment 在 Hobby 上是預設行為,不需要設定檔。**
⇒ 所以**機制上很可能有 preview 部署**,而它們拿到什麼 env **取決於 dashboard 的 environment scoping**。

**⇒ 標未確認,而缺的那一道檢查是**:
```
🔴 有 Vercel dashboard 權限的人回報:
   TAPPAY_ENV 與 NEXT_PUBLIC_SUPABASE_URL 這兩個 env,
   是【按 environment 分別設定】(Production / Preview / Development)還是【全環境共用一組】?
   · 分別設定 ⇒ preview 拿到的是非正式組 ⇒ 本守門不會誤擋 preview
   · 全環境共用 ⇒ 🔴 preview 會拿到 production TapPay + 正式 DB ⇒ 那不是誤擋問題,
     是【preview 部署可以動真錢】,那比 #657 本身嚴重
⇒ 我【不碰 dashboard、不碰 .env*】,這一格只能由他答。
```
📌 **而這一格的答案會改變修法**:若是「全環境共用」,那**先要處理的不是加守門,是 env scoping**。

---

## §6 格5:鐵則判定與體積

```
鐵則 12①(錢)  ✅ 命中 —— 動 storefront 金流注入點
鐵則 8         ✅ 命中 —— 因 §4 邊界④ 的結論(抽成共用),跨檔會是:
                 packages/adapters(新的共用守門 + 常數)
                 apps/admin/src/lib/payment/composition.ts(改成 import)
                 apps/admin/src/lib/payment/composition.test.ts(11 處 PROD_SUPABASE_HOST 引用要跟著改)
                 apps/storefront/src/lib/payment/composition.ts(接上)
                 apps/storefront 的 charge 路徑(依 §3 的裁示決定放哪)
                 + 新測試
              ⇒ 🔴 **≥5 檔,而且動到 admin 既有的已驗守門** ⇒ 回歸風險在 admin 那邊,不在 storefront
```

---

## §5-b 🔴 爆炸半徑:**量到的與量不到的分開**(主視窗要求「量,不要估」)

### ✅ 從 repo 量得到的
```
vercel.json 全文只有五個 key:$schema / framework / installCommand / regions
  ⇒ 🔴 【零】git 設定、【零】env 設定、【零】crons
  ⇒ 而 Vercel 在【沒有 git.deploymentEnabled 設定】時的預設行為是
     「每一個分支的 push 都產生一個 preview deployment」
  ⇒ ⚠️ 這句是【平台預設行為】,不是我從 repo 量到的 ⇒ 標「未在本環境實測」

部署拓樸(memory,非本次量測)
  storefront production = main   (project_deploy-topology-main-stale-dev-live)
  admin      production = dev    (project_pcm-admin-production-tracks-dev)
  ⇒ 🔴 若兩個 app 是同一個 repo 的兩個 Vercel 專案,那麼【推 dev】對 admin 是 production、
     對 storefront 就是【preview】⇒ 而那個 preview 現在拿的是【全環境共用的正式組 env】
  ⇒ ⚠️ 「兩個專案的 production branch 各自是什麼」是 dashboard 事實,memory 是轉述

TAPPAY_ENV 未設 / 空值 會怎樣(量到的)
  apps/storefront/src/lib/payment/composition.ts:51-55 requireEnv ⇒ 缺則 throw
    ⛔ 本檔曾寫 :50-52 —— 又是拿 `sed` 視窗相對位置去加(本 session 第三次同款)
       ⇒ 這一次我停止推算,直接 `grep -n` 拿真值。判別句:這個行號是 grep 印的還是我算的?
  同檔 :70-72                                        值不是 sandbox|production ⇒ throw
  ⇒ 🔴 所以「Preview 那格留空」【不是溫和的安全預設】,它會讓金流那條路【直接炸】
     ——(而對 preview 而言「不能刷卡」正是我們要的,見下方給 Sean 的步驟 甲)
```

### 🔴 原本列為「量不到」的三格 —— **兩格後來查到了,而其中最重要那格是【我停早了一步】**

⛔ **原文(訃聞,不要照它讀)**:
```
~~3. 那些 cron 路徑是誰在觸發?…而 vercel.json 零 crons ⇒ 觸發來源不在 repo 裡 ⇒ 我查不到
     ⇒ 可能是外部排程器…而【那是推測,不是查到的】~~
```

#### ✅ 格3(cron 觸發來源)⇒ **完整查到了,而 preview 的 cron 風險【關掉】**
```
git log --oneline -S'"crons"' -- vercel.json     ← 🔴 這一發就是我上一輪漏掉的
  a5d76192  2026-07-24  settle-sweep+anomaly-alert 搬 Supabase pg_cron、flag 留 S4   ← 移掉 vercel crons
  92d9e84c  2026-06-17  啟用 vercel.json settle-sweep cron                          ← 當初加的
  77812284 / 4e6bf6f0   2026-05-17  LINE 追單那組(更早的一輪)

⇒ 現況:cron 由 Supabase pg_cron 觸發,不是 Vercel
supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql:9-12 逐字
  「私有 schema pcm_cron + Vault-backed SECURITY DEFINER wrapper invoke_cron_route(path)
   → wrapper 執行期讀 vault.decrypted_secrets(cron_base_url + cron_secret)…net.http_get 打對應 Next route」
同檔 :12  cron.schedule 兩 job:pcm-settle-sweep(*/2 * * * *)、pcm-anomaly-alert(0 1 * * *)
```
🔴 **⇒ pg_cron 打的是【Vault 裡那一個固定 base URL】。preview 的網址是隨機 branch alias,pg_cron 不知道它。**
⇒ **preview 的 cron 不會被觸發** ⇒ 「preview 的排程正在對正式庫跑掃補款」**那個擔心不成立。**
⚠️ 而**那個 base URL 的值我沒看**(在 Vault 裡)⇒ 「它指的是正式站」是**強推論不是量測**:
   若它指錯地方,線上補款早就壞了而那會很明顯。

#### 🔴 而這一格的教訓比它本身值錢 —— **新的一種穿法**
```
我上一輪寫「vercel.json 零 crons ⇒ 觸發來源不在 repo 裡 ⇒ 我查不到」
⇒ 那句【每個字都是真的】,而結論錯:答案就在 repo 裡,只是不在【現在的檔案】裡
⇒ 🔴 判別句:**「現在的檔案裡沒有」≠「repo 裡查不到」**
   —— 設定可能被【搬走了】,而【搬走那一刻的 commit body 就是答案】
⇒ 機械修法:對「這個設定為什麼不見了」這類問題,先跑 `git log -S'<字面>' -- <檔>`
   而不是只看當前檔案。成本一行。
📎 這是既有那條「0 命中要附分母與 pattern」的**另一半**:
   我附了 pattern,而 pattern 掃的是【當前狀態】,問題問的是【歷史】。
```

#### ⚠️ 格1 / 格2:**部分查到,而剩下的縮小了**
```
memory project_deploy-topology-main-stale-dev-live 記著(2026-06-17 由 build-log 實證):
  · Vercel project `pcm-website-v2`(prj_4yNDP3XOt202tQIlYwF9auf5fLN7、team pcm-motorsports)
    production branch = main;**所有 dev push 都是 target=null(preview only)**,
    branchAlias 形如 `pcm-website-v2-git-dev-…`
  · Root Directory = repo 根 ⇒ 根 vercel.json 才是 Vercel 實際讀的檔
⇒ ✅ **「每一次推 dev 都會產生一個 preview」不再是推論,是有 build-log 背書的**
⇒ ⚠️ 而那份 memory 只記了【一個】專案。另一份 memory(project_pcm-admin-production-tracks-dev)
   說 admin 的 production 追 dev ⇒ **邏輯上必有第二個專案,而它沒有被記錄**
   🔴 兩份 memory 都是【當時的轉述】,不是我這次量的
⇒ **剩下要問 Sean 的縮小成**:admin 那個專案叫什麼 / 它的 production branch 是不是 dev
   + 現在實際掛著幾個 preview(這一格只有 dashboard 看得到)
```

---

## §7 我答不出來的(不假裝)

```
1. §5 那一格(env scoping)—— 只有有 dashboard 權限的人答得出來
2. 誠實邊界③ 在 storefront 有沒有對應的擋 —— 我只查到 checkout 目錄零命中,
   沒有往 adapter 層查完 ⇒ 標未確認
3. §3 那三個選項(甲/乙/丙)是取捨,不是技術題 ⇒ 我推薦丙,而【不自己定】
4. 「飛在路上的那幾筆」有多少 —— 我沒有量,也沒有量的方法(要看正式站流量)
```

## §8 不做的事

```
· 🔴 不修 #657(修法要另外提 plan 過鐵則 8+12)
· 不動任何 app code、不碰 .env*、不碰 Vercel dashboard
· 不回頭改 admin 那道守門的 fail-closed(它那條路上錢還沒動,它是對的)
· 不 push、不 apply
```

— G5
