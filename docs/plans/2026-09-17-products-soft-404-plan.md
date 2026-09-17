# Plan · `/products/<不存在>` 回 200 —— 把狀態碼改對(畫面一個字不動)

> 起因:量 Search Console 那批 404 時撞到的,**與那 31 筆無關**。
> 🔴 鐵則 8:碰路由結構(`app/` 目錄)⇒ **先 plan、等 Sean 批,不動碼。**
> 作者:後台窗 `pcm-website-v2-89` · worktree `/Users/sean_1/pcm-ops` · branch `agent/ops-17`

---

## 0. 🔴 先查它還活不活著 —— 而查完發現**碼是對的,是【被抵銷掉】**

### ① 那一頁怎麼來的
`apps/storefront/src/app/products/[slug]/page.tsx:99` —— **`notFound()` 早就寫在那裡。**
檔頭 `:5` 逐字:「不存在 → `notFound()` 預設 404 頁(**Q5=C 拍板**)」。
⇒ 🟢 **不是沒寫,也不是寫錯。**

### ② 有沒有【刻意】不回 404 的理由寫在碼裡 —— **沒有**
```bash
grep -rn "notFound\|商品不存在" apps/storefront/src/app/products/ | grep -v test
```
⇒ 只有 `:31` import、`:55` metadata 標題、`:99` 呼叫。
**沒有任何一行在說「這裡刻意不回 404」** ⇒ 🔴 **這是 bug,不是拍板。**

### ③ 🔴 那為什麼線上是 200 —— **`loading.tsx` 開了 Suspense 邊界,狀態碼在 `notFound()` 之前就送出去了**

```
app/products/[slug]/loading.tsx  存在
  ⇒ App Router 把該段包進 Suspense ⇒ 回應【邊算邊送】
  ⇒ 🔴 HTTP 狀態列是【第一個位元組】送出的, 那時 notFound() 還沒跑到
  ⇒ notFound() 之後只換得掉【畫面】, 換不掉【已經送出去的 200】
```

#### 🔵 而這不是推的 —— **同一份碼、同一支 `notFound()`,差別只有那一個檔**
```bash
curl -s -o /dev/null -w "/brands/zzz-nope-9999   ⇒ %{http_code}\n" https://www.pcmmotorsports.com/brands/zzz-nope-9999
curl -s -o /dev/null -w "/products/zzz-nope-9999 ⇒ %{http_code}\n" https://www.pcmmotorsports.com/products/zzz-nope-9999
```
| 路由 | `notFound()` 在哪 | 有 `loading.tsx` 嗎 | 實測狀態 |
|---|---|---|---:|
| `/brands/[slug]` | `page.tsx:159` | ❌ **沒有** | 🟢 **404** |
| `/products/[slug]` | `page.tsx:99` | ✅ **有** | 🔴 **200** |

```bash
find apps/storefront/src/app -name "loading.tsx"
⇒ /products/loading.tsx  與  /products/[slug]/loading.tsx  —— 全站只有這兩支
```
📌 **全站唯一有 `loading.tsx` 的那一段,正好是全站唯一回錯狀態碼的那一段。**

### ④ 現況全貌(實測)
| 網址 | 狀態 | 位元組 | `<title>` |
|---|---:|---:|---|
| `/products/motogadget-car1001`(**已下架**) | 200 | 35,622 | 商品不存在 |
| `/products/zzz-this-does-not-exist-9999`(**從沒存在**) | 200 | 35,642 | 商品不存在 |
| 🔵 `/products/gbracing-ba-675-lhs-gbr`(**上架中**,正對照) | 200 | 496,611 | 真商品 |
| 🔵 `/zzz-nope-9999`(非 products,對照) | **404** | — | — |

⇒ **問題只在 `/products/` 這一條路,不是全站設定錯。**

### ⑤ 下架 vs 從沒存在 —— **分不出來,所以兩者都 404**
`fetchProductByHandle()` 對這兩種**都回 `null`**(下架的商品不在前台那張 view 裡)。
要分出來得**每一次請求多打一次 DB**,只為了把 404 換成 410。
🛑 **不做。** 照主視窗判準:分不出來就兩者都 404,不為了漂亮去查資料庫。
⚠️ 410 的好處(Google 更快放棄)**真實但不值這個代價**;真要做是另一片。

---

## 1. 要改什麼

🔴 **畫面一個字都不動。** 客人看到「這個商品不存在 + 可以回去逛」是**對的**體驗,
錯的只有**伺服器沒說它是 404**。

### 甲(推薦):把型錄頁收進 route group,讓 `/products/[slug]` 脫離 Suspense 邊界
```
現在                                   改後
app/products/loading.tsx        ⇒ app/products/(catalog)/loading.tsx
app/products/page.tsx           ⇒ app/products/(catalog)/page.tsx
app/products/[slug]/loading.tsx ⇒ 🔴 刪除
app/products/[slug]/page.tsx    ⇒ 不動
```
- `(catalog)` 是 **route group**:括號目錄**不出現在網址裡** ⇒ `/products` 與 `/products/<handle>` **網址完全不變**。
- 型錄頁**保住它的骨架**(`loading.tsx` 跟著搬進同一層)。
- `/products/[slug]` **上下都沒有 `loading.tsx`** ⇒ 不串流 ⇒ `notFound()` 回**真的 404**,與 `/brands/[slug]` 同形狀。

🔵 **為什麼要動型錄頁那一支**:`[slug]/loading.tsx` 檔頭逐字說它「**存在的唯一理由是擋住上一層**」——
上一層 `products/loading.tsx` 的骨架帶著 `<h1>全部商品</h1>`,會套到詳情頁。
⇒ **只刪 `[slug]/loading.tsx` 不夠**,上一層會補位,問題原樣留著。

**代價(講明白,不粉飾)**:商品詳情頁**沒有載入骨架**了。
⇒ 導頁時停在舊畫面直到新頁好(= `/brands/[slug]` 現在的行為)。
🙋 **要不要接受這個代價,是 Sean 的題**(見 §4)。

### 乙:留住骨架,改用 `unstable_rethrow` / 提前檢查
把「這個 handle 存不存在」的判斷**搬到 Suspense 邊界之外**。
🛑 **不推薦**:那等於在 route 層再開一條「先查一次存不存在」的路 ⇒ **每頁多一次 DB 往返**,
而且要新寫一個只為狀態碼存在的機制。**甲是移動兩個檔、刪一個檔,乙是新增一條路。**

---

## 2. 影響

| | |
|---|---|
| 網址 | **零變化**(route group 不進網址) |
| 客人看到的畫面 | **零變化**(同一頁「商品不存在」) |
| 🔴 商品詳情頁載入骨架 | **沒了**(甲的代價) |
| Google | 1,089 件已下架商品 + 任何亂打的網址 ⇒ 從「200 有內容」變成「404 不存在」 |
| 後台 / DB | **零**,不碰 |

---

## 3. Rollback

把三個檔搬回原位、`[slug]/loading.tsx` 還原,重新部署。
- **可逆、無資料**:純檔案位置,不寫任何東西。
- ⚠️ 退回去之後 `/products/<不存在>` 會**退回 200** —— 那是原狀,不是壞掉。
- 🔵 `git revert` 就夠,不需要還原檔。

---

## 4. 🔴 事後閘 —— 三格,而【下架商品】那格是這一片真正要救的

```bash
# 🔵 正對照:真商品【仍然】200 且內容完整 —— 守「不要修出一個全部都 404」
curl -s -o /dev/null -w "上架中 ⇒ %{http_code}  %{size_download} 位元組\n" \
  https://www.pcmmotorsports.com/products/gbracing-ba-675-lhs-gbr
#   期望:200, 而且位元組數【與現在同量級(約 49 萬)】—— 只看 200 不夠, 一頁空的也是 200

# 🔴 這一格是重點:【已下架】的商品
curl -s -o /dev/null -w "已下架 ⇒ %{http_code}\n" \
  https://www.pcmmotorsports.com/products/motogadget-car1001
#   期望:404

# 負對照:從沒存在的 handle ⇒ 404,【而畫面上那句話還在】
curl -s -w "\n從沒存在 ⇒ %{http_code}\n" \
  https://www.pcmmotorsports.com/products/zzz-this-does-not-exist-9999 | grep -c "商品不存在"
#   期望:狀態 404, 而 grep 命中 ≥ 1 —— 🔴 兩個一起驗, 因為「改成 404」很容易順手把畫面也弄丟

# 🔵 沒有動到別的:型錄頁與品牌頁
curl -s -o /dev/null -w "/products ⇒ %{http_code}\n"  https://www.pcmmotorsports.com/products
curl -s -o /dev/null -w "/brands/zzz ⇒ %{http_code}\n" https://www.pcmmotorsports.com/brands/zzz-nope-9999
#   期望:200 / 404(兩者都與改之前一樣)
```
⚠️ **部署後才量**,而且要先確認量到的是新版本
(`reference_fresh-response-is-not-new-deployment`:`age:0` / cache MISS **不等於**新版本)。

🔴 **本機先驗得到嗎:可以,而且應該先在本機驗。**
`bash scripts/storefront-probe/up.sh` 起本機站 ⇒ 同樣四發 curl。
📌 **狀態碼這一格 curl 量得準**(伺服器給的),與
`reference_storefront-catalog-invisible-to-curl`(卡片是前端渲染)**不是同一格**。

---

## 5. 🛑 要 Sean 決定的

```
Q1:商品詳情頁的【載入骨架】可以拿掉嗎?(甲的唯一代價)
A: 甲 = 可以拿掉(推薦)。拿掉後導頁時停在舊畫面直到新頁好 ——
      那就是 /brands/ 現在的行為, 而沒有人回報過它有問題。
      換到的是 1,089 件下架商品不再被 Google 當成「存在的頁面」。
   乙 = 不能拿掉 ⇒ 走乙案, 每頁多一次 DB 往返, 而且要新寫一個只為狀態碼存在的機制。

Q2:已下架的商品要不要回 410(永久消失)而不是 404?
A: 甲 = 不要, 都回 404(推薦)。要分出來得每次請求多打一次 DB, 只為換一個碼。
   乙 = 要, 另開一片做。
```

---

## 6. 驗收(yes / no)

1. 本機 probe:四發 curl 全部符合 §4 的期望 ⇒ **yes**
2. `/products` 與 `/brands/zzz` 與改之前**完全一樣** ⇒ **yes**(沒有順手動到別的)
3. 🔴 已下架商品回 404,**而畫面上「商品不存在」那句話還在** ⇒ **yes**
4. 真商品仍然 200 **且位元組同量級** ⇒ **yes**
