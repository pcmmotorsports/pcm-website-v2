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

## 9. finding：`resolveCartLines` —— **無認證、無節流，一個請求可觸發 400 次 DB 往返**

**嚴重度：中（可用性／成本，非資料外洩）。歸屬：storefront 施工線。我唯讀，只出 finding。**

### 9.1 事實（**每一個數字都標它是怎麼來的**）

| 值 | 出處 | 🔴 這是量到的還是讀出來的 |
|---|---|---|
| 上限 200 行 | `apps/storefront/src/app/cart/actions.ts:74` `const MAX_LINES = 200` | **讀出來的常數上界**，我沒實打 |
| 每行 **2 次** Supabase 往返 | `apps/storefront/src/lib/products.ts:760` `adapter.findByHandle` + `:773` `adapter.listInheritedFitments` | **讀出來的**，我沒量實際往返數 |
| ⇒ 單一請求最多 **400 次**往返 | 200 × 2 | 🔴 **推出來的上界，不是實測值。下游拿去估成本時要帶著這個限定。** |
| 無認證 | `cart/actions.ts` 全檔 `getUser()` 命中 0（盤點檔 §1.2 已記，本輪重讀確認） | 讀出來的，**且作者刻意如此並寫了理由** |
| **無節流** | `grep -rlEi 'rate.?limit|throttle|ratelimit' apps/storefront/src/app/cart/` ⇒ **0 檔**；storefront `middleware.ts` ⇒ `find … -name 'middleware.ts' \| wc -l` = **0** | 量到的 |

🔴 **那個 0 附了分母與正向對照**：同一支 grep 對 `apps/storefront/src` 全樹 ⇒ **20 個檔命中**
（`lib/cron/rate-limit.ts`、`checkout/charge-actions.ts` 的 `IN_FLIGHT_SETTLE_THROTTLE_SECONDS` 等）
⇒ **這個專案是有節流機制的，只是沒有套到這支上** —— 不是「全站都沒有」。

### 9.2 為什麼值得修（不是理論的）

- `cache()` 只在**同一請求內對同一個 handle** 去重（`products.ts:752-755` 檔內逐字）⇒ **200 個【相異】handle 不會被去重。**
- 迴圈是 `for … await`（`cart/actions.ts:101-205`）⇒ **序列執行** ⇒ 一個小小的 POST 會**佔住一個 function 實例跑完 400 次序列往返**。
- **攻擊成本不對稱**：攻擊者送一個幾 KB 的請求，我們付一個長命 function + 400 次 DB 查詢。
- ⚠️ **這條與 `/api/checkout/tappay-notify` 那條同族**（§4.1）：**節流被整個委派給 repo 外的 Vercel WAF，而 repo 裡沒有任何東西驗得到它設好了沒。**

### 9.3 我**沒有**做的

**沒有實際打過一發 200 行的請求。** 上面 400 是**上界推算**。
要變成實測值，缺的檢查是：起一個帶真 env 的 storefront + 可觀測的 DB，送一發 200 相異 handle，數實際往返。

---

## 6-b. finding：`/api/catalog/facet-counts` —— **每個作者都寫對了自己那一段，而沒有人把它們乘起來**

**嚴重度：中（可用性／成本）。歸屬：storefront 施工線。我唯讀，只出 finding。**
📌 這就是 `㊼` 那條的主角 —— **三輪稽核零覆蓋，因為它在排序準則下分數是 0。**

### 6-b.1 這支端點的守門其實寫得很好

無 auth、公開可打，但有**三道白名單**（形狀 → 車輛字典 → 年份字典），任一不過回 `400`；
上游字典讀不到一律 `503` **不回 200 半套**（`route.ts:14-22` 檔頭寫明理由：空字典 ≠ 沒有分類）。
**這些我不打折，寫得比大多數端點好。**

### 6-b.2 🔴 而風險是**三段各自誠實的話乘起來**的

| 段 | 出處 | 逐字 |
|---|---|---|
| **放大 108 倍** | `vehicle-facet-counts.ts` 檔頭 | 「**查詢數是 108**、不是 plan 寫的 31（2026-07-31 對正式資料實測）」 |
| **key 空間公開可枚舉** | `route.ts:18-20` | 「這三道擋的是 **key 空間、不是速率**…車輛字典本來就會整份送到瀏覽器 ⇒ **合法 key 全集是公開的、可被逐一枚舉**」 |
| **節流只在單一 process** | `route.ts:21-22` ＋ `vehicle-facet-counts.ts:69` | `MAX_CONCURRENT_FANOUTS = 3`，日誌逐字「併發已達上限 3（**本 process**）」；同檔頭另註「跨 process/instance 仍各一份（**誠實邊界，不宣稱全站唯一**）」 |

🔴 **三段都是作者自己寫的、都準確、都標了誠實邊界。**
**沒有人把它們放在同一句話裡** ——

> **一個外部的人可以枚舉公開的合法車款 key；每一個【沒被快取過的】key 觸發 108 次 RPC；
> 而唯一的節流是 per-process 的，在會自動擴實例的平台上等於沒有全域上限。**

⚠️ **快取幫不上忙**：`unstable_cache` 900s 是**依 key 快取**的 ⇒ **換一個 key 就是一個新的冷 key**。
同檔頭已記另一個相關事實：`unstable_cache` **不是 single-flight**，冷 key 同時三個 request ⇒ **瞬間 324 次 RPC**（已補 process 內 `inFlight`，**跨 instance 仍各一份**）。

### 6-b.3 我**沒有**量到的（照實標，不含糊）

| 沒量到 | 為什麼 | 缺哪一道檢查 |
|---|---|---|
| **合法 key 空間有多大** | 我的稽核帳號讀不到車輛字典 —— 實跑 `SELECT count(*) FROM public.vehicle_taxonomy_public` ⇒ **`ERROR: permission denied for view`**（**這是帳號被正確鎖住的證據，不是故障**） | 由有權限的人數一次「廠牌×車型×年份」的合法組合數 |
| **108 這個數字** | 🔴 **讀來的**（作者 2026-07-31 實測寫在註解裡），**不是我量的** | 實打一發合法請求並數 RPC 次數 |
| **實際會不會被打爆** | 沒做壓測，也不該在正式站做 | 由施工線在非正式環境評估 |

⇒ 🔴 **所以本條的份量在【結構】不在【數字】**：
**即使 108 是錯的、即使 key 空間比我想的小，「唯一的節流是 per-process 而平台會擴實例」這句仍然成立。**

### 6-b.4 建議（我不替施工線決定）

節流要放在**跨 instance 看得到的地方**（平台層 WAF／rate limit，或一個共用的計數器）。
📎 **與 §4.1 同一個結論**：`tappay-notify` 的限流也被委派給 **Vercel WAF**，
而 **repo 裡沒有任何東西驗得到那個委派有沒有落地** ⇒ **兩條應該一起處理，別分兩次。**

---

## 6-d. 軸二第一批（**帳號被盜視角**）：`account/*` 與 `payment-status` —— **沒有 finding，而這句話要附證據**

**新軸的定義**：不是「員工／會員彼此看得到什麼」（`E-695` §2 明列**刻意不報**），
而是**「一個被盜的帳號能做到什麼」**。

### 6-d.1 `/api/orders/[orderId]/payment-status` —— 守得比多數端點嚴

**雙軸 own-only**，兩軸都在檔內看得到本體（不是只有註解）：
① RLS `orders_select_own` ② 應用層 `.eq('customer_user_id', userId)`（`route.ts` 的 `readOwnPaymentStatus`）。
`getUser()` 向 auth server 驗 JWT；偽造他人 `orderId` ⇒ **404 且不呼 throttle／settle**；
錯誤一律 **null body + `no-store`**；回應**只有 `{status}`**、零金額零 PII。

**被盜帳號能做的**：查自己訂單的成立與否、對**自己**的未付款單觸發 `settleCharge`，
**而那有 per-order 10 秒 throttle**（`claim_order_poll_settle`）。⇒ **與正常使用者本來就能做的事相同。**

### 6-d.2 `account/{address,vehicle,profile}` 七支 action —— **ownership 在，但在下一層**

🔴 **我一開始判錯，記下來**：我 grep action 檔找 `.eq('customer_user_id'`，**零命中** ⇒ 我推測「只有 RLS 一軸」。
**錯了。** 應用層那一軸在 **use-case 層**：`updateAddress(repo, user.id, addressId, patch)`，
而 `packages/use-cases/src/update-address.ts:38-43` 本體逐字先跑
`verifyAddressOwned(addressRepo, currentUserId, addressId)` 才 `addressRepo.update(...)`。
📎 **這是「識別字 grep 會方向性漏掉」的又一次** —— 架構把那一軸放在別層，而我的 pattern 只掃了一層。

### 6-d.3 ⚠️ 一個**形狀**上的不一致（低嚴重度，**我沒有構造出攻擊**）

```
payment-status   scoped read ：.eq('id',…).eq('customer_user_id',…)   ← 歸屬條件【在同一句查詢裡】
account/address  check-then-act：先 verifyAddressOwned(讀) → 再 repo.update(addressId, patch)（不帶 userId）
```

**後者的寫入語句本身不帶歸屬條件** ⇒ **若 RLS 失效，擋住越權的就只剩前面那一次 verify 讀。**
⚠️ **仍然是兩軸（verify + RLS），我沒有找到可利用的路徑，也沒有構造出來** ——
**寫下來的理由是它與 `payment-status` 的做法不一致，而不一致本身會讓下一個人以為某一種就夠。**

📎 **為什麼這條值得留**：STATUS 現有一條活的 Blocker —— **客戶表的 RLS 面已知有一條缺的政策**
（Sean 已拍 `Q15`=甲要補）。⇒ **「RLS 一定在」這個前提，在這個 repo 裡不是免費的。**

---

## 6-c. 🔴 回頭套 `㊼` 到**我自己這一輪的準則** —— 我也讓三類東西的分數變成 0

**不只修 facet-counts 那一項。** 我這一輪的準則實際上是：

```
外部可達（不用登入就打得到）  ×  會不會洩漏資料  ×  前身標為「沒做」
```

**逐個因子問「什麼東西會被它乘成 0」**：

| 被歸零的一類 | 為什麼分數是 0 | 具體例子（**我這一輪確實沒碰**） |
|---|---|---|
| 🔴 **只有登入者才打得到的東西** | 第一個因子把它乘成 0 | `account/*` 的三支 action、`/api/orders/[orderId]/payment-status` 的 IDOR 面 |
| 🔴 **不回資料、只產生副作用的入口** | 第二個因子把它乘成 0（「沒東西可偷」） | `login/forgot`（**會寄信** ⇒ 可被當寄信放大器；而寄信是「對外不可回收」）、`register` |
| **不是「端點」形狀的東西** | 我盤的單位是 route／action／page | 排程、build 期產物、CI secrets、第三方 script／CSP／cookie 屬性（前身 §4 就標了「完全沒碰」） |

### 🔴 第一類是真的漏，而且我**讀過那句話還漏了**

前身交接檔 `E-695` §2 逐字寫著：

> ⚠️ **後來 Sean 擴充了一次**：後台正要開給員工用 ⇒ **「內部人員誤操作／帳號被盜」也算**。
> **但那是【擴充】，不是取代。**

**我開工時讀了那一段，然後用了一個只有「外部可達」的準則。**
⇒ 📎 這正是 `㊺`（**正在讀那條規則的當下，並不等於把它套進去**）＋ `㊼`（**準則歸零，整類消失**）**同時發生**。

### 下一輪的準則要改成兩軸，不是一軸

```
軸一  外部匿名可達    ← 本輪只用了這個
軸二  已登入者可達 × 帳號被盜/誤操作的後果   ← Sean 明文擴充過,而我這輪整條沒算
```

⚠️ **不要把軸二寫成「員工之間沒有分權限」** —— `E-695` §2 明列**那條刻意不報**，報了會被退回。
**要報的是「一個被盜的員工帳號能做到什麼」，不是「員工彼此看得到什麼」。**

---

## 7-b. 🔴 自我稽核：**本檔哪幾條的依據是【repo 內註解】而不是我量到的**

**為什麼加這一節**（2026-08-17，C 窗實例觸發）：
C 窗查官方文件推翻了一條「repo 內註解說 X」的既有定調（結論沒變，**理由整個換掉**）。
⇒ **註解是當時的人寫的，不是官方文件，也不是我的量測。**
⇒ **本檔逐條自查，把「讀來的」與「量到的」分開標。**

| 本檔哪一條 | 依據 | 強度 |
|---|---|---|
| §4.1 **限流委派給 Vercel WAF** | `apps/storefront/src/app/api/checkout/tappay-notify/[secret]/route.ts:19` **註解** | 🔴 **讀來的**。我沒有 Vercel 存取、沒看過 WAF 設定 ⇒ 已標未確認 |
| §4.2 **該端點還沒真的上線**（`backend_notify_url` 未設、`TAPPAY_3DS_ENABLED` 未開） | 同檔 `:18` **註解** | 🔴 **讀來的，而這條在替 §4.2 的嚴重度打折** ⇒ 🔴 **若那個註解過期，§4.2 的嚴重度要往上調** |
| §9 `cache()` **只在同一請求內對同一 handle 去重** | `apps/storefront/src/lib/products.ts:752-755` **註解** | ⚠️ **讀來的**（＋ React `cache()` 的一般行為）。**我沒有實測「200 個相異 handle 不會被去重」** |
| §9 **每行 2 次 Supabase 往返** | `products.ts:760` + `:773` **程式碼本體**（兩個 `await adapter.*` 呼叫） | ✅ 讀 code，不是註解 —— 但**仍不是實測往返數** |
| §1 誘餌 build（祕密 16/16 為 0） | **我自己跑的量測**＋4 個活的正向對照 | ✅ **量到的** |
| §2 fixtures 不在客戶端 bundle | **我自己跑的量測**（同 token：server 4 檔 / static 0 檔） | ✅ **量到的** |
| §5 `/brands/[slug]` 用 `Object.hasOwn` 擋原型污染 | **程式碼本體** `:61-62` | ✅ 讀 code |

🔴 **判別句（留給下一個人）**：
> **這條結論的依據，是【當時的人寫的字】，還是【我讓系統印出來的東西】？**

📎 對照：`docs/security/2026-08-17-quote-db-external-exposure-audit.md` **整份沒有這個問題** ——
那份每一條都是對 production 庫的實查（`pg_catalog` 述詞），**零條依賴 repo 註解**。
**兩份的證據強度不同，引用時要分開看。**

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
