# storefront 獵洞 第一輪 —— **客戶端 bundle 的祕密外洩面** + notify 端點

- **窗**：E（資安稽核，唯讀）　**日期**：2026-08-17（`date` ⇒ `Mon Aug 17 00:16:30 CST 2026`，session `currentDate` ⇒ `2026-08-17`，**兩源一致、非抄自任何檔案的自述值**）
- **樹**：`/Users/sean_1/pcm-customers`　**分支**：`customers`
- **接的是**：`2026-08-16-storefront-external-surface-inventory.md` §5 打擊順序 + `2026-08-16-audit-open-gaps.md` §2 的 **2.1 / 2.2**
- **本輪關掉**：誠實缺口 **2.1**（fixtures 進不進 bundle）與 **2.2**（DB 憑證進不進瀏覽器）**的靜態產物那一半**

---

## 0. 🔴 先講我第一版的量測是壞的，而且壞在哪

**第一版做法**：在我的 worktree 跑 `turbo build`，然後 grep `.next/static` 找 `postgres://`、`service_role`、`CRON_SECRET`… ⇒ **全部 0**。

**它是壞的。抓到它的是一個同形狀的對照**：`eyJ`（JWT 前綴）也量到 **0** ——
而 `NEXT_PUBLIC_SUPABASE_ANON_KEY` **設計上就印在每一個訪客的瀏覽器裡**，它不可能是 0。

**病根**：

```
ls -la /Users/sean_1/pcm-customers/apps/storefront/.env*  ⇒ no matches found
```

**我這棵樹沒有 `.env.local` ⇒ build 當下沒有任何 env 值可以內嵌。**
bundle 裡只有**變數名**（`NEXT_PUBLIC_SUPABASE_ANON_KEY` 等 5 個字串），**沒有任何值**。

> 🔴 **判別句（`00-work-rules.md` §6-b）**：這個檢查在【外洩】與【沒外洩】兩個世界，會印不同的東西嗎？
> **對「env 來源的祕密」這一類 —— 不會。兩個世界都印 0。**

⚠️ **我當時用的三個正向對照（`supabase.co` / `unitPrice` / `NEXT_PUBLIC`）全部是活的，而它們救不了我** ——
因為它們是**原始碼字面**，而我要獵的是**建置期由 env 注入的值**。
📎 **通則**：對照要與獵物**同形狀**，不是「有東西命中就算量具活著」。

---

## 1. 修好的量具：**誘餌 build**（可重跑）

**harness**：`scratchpad/decoy-build.sh`（本檔 §6 附完整重跑步驟）

**做法**：把 `turbo.json` build 期 env 白名單的 **26 個變數全部給假值**，每個帶一個唯一 token，build 完 grep 客戶端產物。

| 組 | 個數 | 角色 |
|---|---|---|
| `NEXT_PUBLIC_*` | 6 | **正向對照** —— 刻意公開，**必須出現**，否則量具是死的 |
| 其餘 | 20（其中 16 個帶 token） | **真正在測的** —— 任何一個出現 = finding |

🔴 **用假值不是為了省事，是為了正確**：真值會讓「證據本身複製了那個危險」，而假值反而做得出**雙向**對照。

### 1.1 結果

```
build      : npx next build ⇒ BUILD_EXIT=0
分母       : .next/static 下 47 個檔（其中 .js 38）

正向對照（公開組，應該出現）
  zzp01  NEXT_PUBLIC_SUPABASE_URL        => 1 檔  ✅
  zzp02  NEXT_PUBLIC_SUPABASE_ANON_KEY   => 1 檔  ✅
  12345  NEXT_PUBLIC_TAPPAY_APP_ID       => 3 檔  ✅
  zzp05  NEXT_PUBLIC_TAPPAY_APP_KEY      => 1 檔  ✅
  zzp03  NEXT_PUBLIC_SITE_URL            => 0 檔  （未被 client 端使用，非量具問題）

祕密組（16 個，任何一個非 0 都是 finding）
  SUPABASE_SERVICE_ROLE_KEY / LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN /
  LINE_CHANNEL_ID / LINE_REDIRECT_URI / LINE_ALERT_TO / CRON_SECRET / RESEND_API_KEY /
  ALERT_EMAIL_FROM / ALERT_EMAIL_TO / PAYMENT_CONFIRMER_DB_URL / TAPPAY_PARTNER_KEY /
  TAPPAY_MERCHANT_ID / TAPPAY_FIELD_IDS / TAPPAY_NOTIFY_PATH_SECRET / PCM_DEV_TIER_OVERRIDE
                                        => 全部 0 檔
```

✅ **結論（可以寫成斷言，因為對照是活的同形狀對照）**：
**build 期的 20 個祕密 env，沒有任何一個被內嵌進客戶端靜態產物。**
⇒ **缺口 2.2 的「翻 bundle 直接證據」那一半，關掉。**

---

## 2. 🔴 更正一條繼承來的說法：`fixtures.ts` **不在客戶端 bundle**

**原說法**（`dev-preview/layout.tsx` 作者寫、上一輪盤點引用）逐字：

> 「那些字面仍在 **git 與 JS bundle** 裡；本閘只讓正式站的網址進不去，不等於內容沒外流。」

**實測（雙向對照，同一個 token、同一支 grep）**：

```
特徵字面 HDW004551（唯 fixtures.ts 有，原始碼命中 1）
  .next/server/ ⇒ 4 檔   ← 找得到，證明 grep 與這個 token 都是活的
  .next/static/ ⇒ 0 檔   ← 送到瀏覽器的那一份沒有它
另一個 PRN002188 ⇒ static 0 檔（分母 47）
```

⇒ **精確版**：那些字面在 **git ✅**、在 **server bundle ✅**、在**客戶端 bundle ❌**。
八支 `/dev-preview/*` 在建置表上全是 `ƒ`（server-rendered on demand），而 layout 的閘在正式站讓它們 404
⇒ **內容只有在那道閘被打開時才可能到達瀏覽器。**

📎 **這一條不推翻作者的警告，它縮小了警告的射程** ——
原句會讓人以為「已經公開了」；實際是「**一道 404 之後**」。⚠️ 而 backlog `#385` C 案（檔頭寫明視同公開）**仍應照做**：那是防未來有人往裡面塞真東西，與本輪的量測不衝突。
⇒ **缺口 2.1 關掉。**

---

## 3. ⚠️ 本輪**量不到**的那一面（不得寫成「沒有」）

**第二支掃描（RSC payload / prerender HTML）的正向對照也是 0 ⇒ 它沒有判別力，我不能用它下任何結論。**

```
分母：.next/server 底下 .html 2 / .rsc 4 / .body 4
正向對照 zzp01、zzp02（公開值） ⇒ 皆 0 檔   ← 對照沒亮 ⇒ 本掃描作廢
祕密組 8 個抽樣            ⇒ 皆 0 檔   ← 🔴 這 8 個 0 不算數
```

**原因**：storefront 幾乎每一頁都是 `ƒ`（請求時才算），靜態產物裡根本沒有幾份 HTML 可掃。

🔴 **所以我只能寫**：**「執行期把祕密序列化進 RSC payload」這條路，我的檢查沒有覆蓋到。**
**不能寫「不存在」。** 缺哪一道檢查：**起一個帶誘餌 env 的 server，實際 fetch 各頁，grep 回應本文**。

---

## 4. `/api/checkout/tappay-notify/[secret]` —— 三處觀察（**皆非 must-fix**）

這支寫得紮實（祕密段 + `timingSafeEqual` + 404 不揭存在 + hash-before-parse 零 PII 落地 + fail-closed 503）。三處記著：

| # | 觀察 | 判讀 |
|---|---|---|
| **4.1** | 🔴 **限流被委派到 repo 外**：`route.ts:19` 逐字「端點 hard 限流 = **Vercel WAF**（plan §14 prod 前置、Sean Q1=A）；本 route 不寫 code 限流」 | **不是疏漏，是委派** —— 但**委派對象在 repo 裡沒有任何東西驗得到它設好了沒**。⚠️ **我查不到**（無 Vercel 存取）⇒ **標未確認**。缺的檢查=在 Vercel 專案設定實看 WAF 規則。**建議掛進 `PHASE-1-NORTHSTAR.md` §5 上線清單**，與「`main` 納入保護」同一格 |
| **4.2** | 祕密在 **URL 路徑**裡 ⇒ 它會進入每一筆 access log / CDN log | 與放 header 相比，**輪換成本被綁到 log 保存期**。⚠️ **目前不是活的風險**：`route.ts:18` 明示 3DS-4 前不設 `backend_notify_url`、不開 `TAPPAY_3DS_ENABLED` ⇒ **端點還沒真的上線**。**上線前該決定要不要改成 header 簽章** |
| **4.3** | body 上限量錯順序：`content-length` 缺席時（chunked）`Number(null)` ⇒ `NaN` ⇒ 跳過 413；接著 `await request.text()` **先把整個 body 讀進記憶體**，才在 `:135` 量 byteLength | **上限保護的東西，在量它之前就已經發生了**。⚠️ 需先持有祕密段才打得到 ⇒ **嚴重度低**，列 nit |

---

## 5. page 層（前身標「完全沒驗」）—— 本輪抽驗兩支動態路由

| 路由 | 判讀 |
|---|---|
| `/brands/[slug]` | ✅ **乾淨且有理由**：`findBrand` 用 `Object.hasOwn`（`:61-62`），檔內逐字說明為何**不是** `in`、也不是 truthy 檢查 —— 擋 `?slug=constructor` / `__proto__` 原型污染 |
| `/products/[slug]` | slug 直接進 `fetchProductByHandle(slug)`（`:76`）。**無長度上限**。⚠️ 未量：超長 slug 會不會造成昂貴查詢 ⇒ 列進下一輪 |

⚠️ **6 個吃 `searchParams` 的 page 仍然沒逐一驗**（`?vehicle` 解碼那條最值得看）。

---

## 6. 重跑步驟（任何人可複製）

```bash
bash <scratchpad>/decoy-build.sh            # 26 個 env 全給誘餌值,build 完印 exit code
cd /Users/sean_1/pcm-customers/apps/storefront/.next
for t in zzp01 zzp02 ; do echo "CONTROL $t => $(grep -rl "$t" static | wc -l)"; done
for t in zzp07 zzp09 zzp10 zzp13 zzp15 zzp18 zzp20 zzp23 ; do echo "$t => $(grep -rl "$t" static | wc -l)"; done
```

🔴 **判停條件**：**CONTROL 那兩行任何一個是 0 ⇒ 整輪作廢，不要看下面的數字。**
（那正是我第一版踩的坑：祕密組全 0，而對照沒亮。）

---

## 7. 本輪**沒有**做的

| 沒做 | 出口 |
|---|---|
| **執行期 RSC payload** 的祕密序列化（§3） | 起帶誘餌 env 的 server + 實際 fetch 各頁 + grep 回應本文 |
| `resolveCartLines` 的**無認證放大面** | code 已讀完：`MAX_LINES=200`、逐欄型別與長度守門**都在**、fail-closed 完整。**未量**：200 個**相異** handle ⇒ 200 次商品查詢，而 `route.ts:19` 那類 code 層限流此處同樣沒有 ⇒ 要量「有沒有節流」 |
| 6 個 `searchParams` page 的值驗證 | 逐支讀，`?vehicle` 優先 |
| `/api/catalog/facet-counts`（唯一完全公開的資料端點） | 完全沒碰 |
| **報價單庫 `pcm-quote-v2`** | 🔴 整塊沒稽核過。**建帳號腳本已併成單一可貼版 `~/pcm-mailbox/E-674d`（見 §8），剩下的是 Sean 貼上去這個動作** |

---

## 8. 附帶產出：`E-674d` —— 併 `E-674b` + `E-674c` + 定案檔 §3 時**撞到兩處文件互相矛盾**

主視窗要一份「單一整段、貼上就跑」的建帳號腳本（原本要 Sean 自己做兩次剪貼手術）。
**併的過程不是機械拼接 —— 三份文件的斷言互相打架，照拼會交出一支【一定會失敗並回滾】的腳本。**

### 8.1 兩處矛盾（皆已實測證實，不是我推的）

| # | 矛盾 | 實測 |
|---|---|---|
| **8.1a** | `E-674b` 的驗收半一用**單層** `has_table_privilege` 判「零 SELECT」，而 `E-674c` §3 自己寫著「原版只查一層 ⇒ **多報**」，定案檔 §4 又列出 4 個**已接受可讀**的平台物件 ⇒ **照 674b 原文跑，那 4 個會被判違規、整段回滾** | 已用兩層版取代 |
| **8.1b** | `E-674c` §3 ① 斷言「不得對任何非系統 schema 有 USAGE」，而**同一封信的 §3.1** 說明 `REVOKE … FROM <角色>` 收不掉 `PUBLIC` 授權；定案檔 §4 也明列它對 `public`／`net` **有** USAGE ⇒ **① 必然觸發** | 🔴 **實跑印出** `ℹ️ 進得去的 schema(1 個):public` ⇒ 矛盾成立。已把 ① 降為**情報**（`RAISE NOTICE`），硬條件留在「表授權」那一層 |

📎 **兩處都是同一個形狀**：**一份文件裡的【摘要斷言】與【它自己的但書】不同步**，
而斷言那半會被下一個人直接拿去執行。

### 8.2 我另外換掉一個對照（**這是改設計，不是照併，所以特別標出來**）

定案檔 §3 的正向對照是「基準清單至少命中 1 個，否則判定式無判別力」。
🔴 **那個對照在報價單庫會誤爆** —— 基準清單來自**網站庫**，而報價單庫**我一次都沒查過**，
它可能根本沒有 `pg_net`／`pg_stat_statements` ⇒ **對照沒亮，而原因是庫不一樣，不是判定式壞了。**

**換成不依賴任何庫佈局的對照**：同一個兩層判定式對 `postgres` 這個角色跑一遍，**必須命中**。
⇒ 實跑印出 `正向對照 postgres 命中 2 張`。**它壞掉的時候會亮，而它不會因為換一個庫就誤亮。**

### 8.3 實跑證據（拋棄式 PostgreSQL 17.10，**綠→紅→綠三段都走過**）

```
harness : <scratchpad>/run-e674d.sh  +  <scratchpad>/E674d.sql
該綠     : rc=0、✅ 驗收通過、掃過 2 張表、正向對照 postgres 命中 2 張
真登入   : current_user / session_user = pcm_audit_ro / pcm_audit_ro（相同=真登入）
該擋     : 讀業務表 ⇒ ERROR permission denied for schema biz  ← 表裡先灌了一列真資料
該通     : pg_class 列數=423
突變     : 給它一張表讀取權 ⇒ rc=3、訊息指名 biz.quote_customers  ← 紅在對的地方
還原     : 收回權限 ⇒ rc=0  ← 綠得回去
```

⚠️ **只證明原廠 PG 17.10 的行為，不是 Supabase 上的行為。** 真證據來自 Sean 貼的那個庫（腳本自己會在那裡再驗一次）。

### 8.4 🔴 過程中我自己踩了一個「假紅」，記著

第一次實跑因為 **macOS unix socket 路徑上限 103 bytes**（scratchpad 全路徑超過）全程連不上，
而我腳本裡那行標籤逐字印著：

```
MUTANT_RC=2  (非 0 = 守門有叫 = 對)
```

**那個 `2` 是 psql 連不上，不是守門叫。** 標籤無條件印，於是**失敗被印成成功**。
📎 這正是 `CLAUDE.md` 終端機紀律那條「**輸出的標籤要由【結果】決定**」的第 N 次兌現 ——
**而這次是我在寫一支【專門用來驗別的東西有沒有壞】的腳本時踩的。**
（第二次失敗是 PG17 on macOS 要 `LC_ALL` 才起得來，那個會 FATAL、不會假裝成功。）
