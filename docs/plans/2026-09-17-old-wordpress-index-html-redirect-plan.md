# Plan · 舊 WordPress 站的 `/index.html` 導到首頁

> 起因:Google Search Console 報「找不到網頁 (404)」31 筆,Sean 按過「已修正」而 Google 回報**失敗**。
> 🔴 鐵則 8:碰 `next.config` ⇒ **先 plan、等 Sean 批,不動碼。**
> 作者:後台窗 `pcm-website-v2-89` · worktree `/Users/sean_1/pcm-ops` · branch `agent/ops-17`
> 清單來源:`~/Downloads/pcmmotorsports.com-Coverage-Validation-2026-09-17/表格.csv`(Sean 09-17 匯出)
> 🔵 **我自己讀過那個 CSV,不是只聽轉述**:32 行 − 1 行表頭 = **31 筆**;`2 失敗 / 29 待處理`。

---

## 0. 🔴 先查它還活不活著

### ① `/index.html` 現在回什麼(實測,不是推的)
```bash
for u in "https://www.pcmmotorsports.com/index.html" "https://pcmmotorsports.com/index.html"; do
  printf '%-45s ' "$u"; curl -s -o /dev/null -w "%{http_code}  → %{redirect_url}\n" "$u"
done
curl -s -o /dev/null -w "/ ⇒ %{http_code}\n" "https://www.pcmmotorsports.com/"
```
| 網址 | 狀態 | 導去 |
|---|---:|---|
| `https://www.pcmmotorsports.com/index.html` | **404** | — |
| `https://pcmmotorsports.com/index.html` | **308** | `https://www.pcmmotorsports.com/index.html` ⇒ **接著 404** |
| 🔵 正對照 `https://www.pcmmotorsports.com/` | **200** | — |

⇒ **apex 那條已經在導了**(裸網域 → www),**而它導到的地方是 404** ⇒ 兩筆其實是同一個洞。

### ② 有沒有人已經加過這條 redirect
```bash
grep -n "redirects\|index.html\|permanent" apps/storefront/next.config.ts vercel.json
ls apps/storefront/src/middleware.ts
```
⇒ **`next.config.ts` 沒有 `redirects()`、`vercel.json` 沒有 `redirects`、storefront 沒有 `middleware.ts`。**
⇒ 🟢 **沒有人加過,也沒有既有規則會跟它打架。**

### ③ 🔴 除了 `index.html`,還有沒有別的舊網址有【真正的對應頁】—— **答案:沒有**

判準(主視窗 09-17 明示):**「同一個東西的新網址」才算,「大概是講類似的事」不算。**

| 舊網址 | 有對應頁嗎 | 為什麼 |
|---|---|---|
| `/hello-world/` · `/hello-world/feed/` · `/comments/feed/` | ❌ | WordPress 預設文章與 feed,**我們沒有部落格** |
| `/author/blueplustsai/` · `/author/index.html` | ❌ | 作者頁,**我們沒有作者這個概念** |
| `/category/brands/` · `/category/cases/` · `/category/index.html` | ❌ | WP 的 category 容器頁,不是我們的分類樹 |
| `/排氣管/` `/碳纖維/` `/懸吊系統/` `/改裝精品/` `/輪框/` `/耗材零件工具` `/車身改裝精品` `/原廠零件-pcm-…/` | ❌ | **實查:8 個名字在我們 115 個分類裡一個都不存在**(見下) |
| `/懸吊系統/懸吊系統/index.html` · `/改裝精品/輪框.html` · `/懸吊系統/輪框.html` | ❌ | 同上,而且路徑重複兩層 |

🔴 **更正**:主視窗轉述給我的清單是 **6 個分類名**,我第一版照抄了。
**自己去讀 CSV 才發現還有 `/車身改裝精品` 與 `/原廠零件-pcm-重機零件販售-pcm-motor/` 兩個**
⇒ 實際要查的是 **8 個**。兩個都補查過,**一樣 0 筆**(`車身防護與防摔` / `車身保護膜(犀牛皮)`
/ `車身防倒球與滑塊` 是「大概類似」,不是同一個東西)。
📌 **一份轉述過的清單少了兩筆,而少掉的那兩筆剛好也答案相同 —— 這次沒事,下次不一定。**
| **`/index.html`** | ✅ **有** | 舊站首頁 ⇒ **我們的首頁 `/`**,同一個東西換網址 |

```bash
printf '%s\n' "SELECT name, raw_path FROM public.categories WHERE name IN ('排氣管','碳纖維','懸吊系統','改裝精品','輪框','耗材零件工具','車身改裝精品','原廠零件') ORDER BY name;" > /tmp/q.sql
bash scripts/readonly-prod-sql.sh /tmp/q.sql
⇒ (0 筆資料)
```
🔵 **正對照(沒有它,「0 筆」跟「我查錯表」長得一樣)**:同一支查詢查得出
`分類總數 = 115`,模糊比對也撈得到 `排氣系統` / `碳纖維部品` / `懸吊與車架` / `全段排氣管` 等
⇒ **那張表是活的、查得動,「0 筆」是真的 0。**

🛑 **而 `排氣管` vs `排氣系統`、`碳纖維` vs `碳纖維部品`、`懸吊系統` vs `懸吊與車架`
正是「大概是講類似的事」** —— 名字不同、成員不同(舊站是 WP 文章分類,我們是商品分類樹)
⇒ **照判準:不算對應,讓它 404。**

---

## 1. 要改什麼 —— **只有一條規則**

`apps/storefront/next.config.ts` 加 `redirects()`:
```ts
async redirects() {
  return [
    // 舊 WordPress 站的首頁網址。Google 09-14/09-15 兩次驗證「失敗」的就是這兩筆
    // (apex 那筆會先被既有的 apex→www 規則導成 www/index.html,所以只需這一條)。
    // 🔴 射程刻意只有這一個【完全相等】的路徑:不用萬用字元、不吃 /index.html 以外任何東西。
    { source: '/index.html', destination: '/', permanent: true },
  ];
}
```

### 用 301 還是 308
**用 `permanent: true`,它發的是 308。**
- Google 對 301 與 308 **等價處理**(都當永久移轉、都傳遞權重)。
- 🔵 **而本站 apex→www 現在就是 308**(上面實測)⇒ **同一站兩種永久導向碼會不一致**,308 是既有慣例。
- `permanent: false`(307)**不行**:那是暫時,Google 會一直回來看,「已修正」仍然不會通過。

### 🔴 射程:**一個路徑,不是一族**
不寫 `/:path*.html`、不寫 `/(.*)/index.html`。
**理由**:那會把 `/懸吊系統/懸吊系統/index.html`、`/author/index.html`、`/category/index.html`
也一起導去首頁 ⇒ 那是**假的相關性** ⇒ Google 判 soft-404,而客人點進來會困惑。
📌 **那 29 筆的正確答案就是 404。**

---

## 2. 影響

| | |
|---|---|
| 客人 | **零**。沒有人從站內連到 `/index.html` |
| Google | 兩筆「失敗」會變成 308 → 200 ⇒ **「已修正」才通得過** |
| 其他路徑 | **零**,規則只吃完全相等的 `/index.html` |
| 後台 / DB | **零**,不碰 |

---

## 3. Rollback

把那條 `redirects()` 刪掉、重新部署即可。
- **可逆、無資料**:純路由規則,不寫任何東西。
- ⚠️ 退掉之後 `/index.html` 會**退回 404** —— 那是原狀,不是壞掉。

---

## 4. 🔴 事後閘 —— 怎麼證明「導對了」而且「沒有順手導錯別的」

```bash
# 🟢 正對照:這一個【要】被導走
curl -s -o /dev/null -w "/index.html ⇒ %{http_code} → %{redirect_url}\n" \
  https://www.pcmmotorsports.com/index.html
#   期望:308 → https://www.pcmmotorsports.com/

# 🔴 負對照:這些【不准】被這條規則吃到
for p in "/products/gbracing-ba-675-lhs-gbr" "/author/index.html" "/category/index.html" \
         "/懸吊系統/懸吊系統/index.html" "/zzz-nope-9999"; do
  printf '%-40s ' "$p"
  curl -s -o /dev/null -w "%{http_code} → %{redirect_url}\n" "https://www.pcmmotorsports.com$p"
done
#   期望:/products/… 維持 200(不被導走)
#         其餘四個維持 404(不被導去首頁)
```
🔴 **負對照那四個是這道閘的重點** —— 只驗正對照的話,一條寫太寬的規則會**全綠**。
⚠️ **部署後才量**,而且要確認量到的是新版本(`reference_fresh-response-is-not-new-deployment`)。

---

## 5. 🛑 這個 plan 沒有處理的(要跟 Sean 講的一句話)

**那 29 筆「待處理」的舊站網址 —— 什麼都不用做,404 是正確答案。**
🎯 **要 Sean 做的只有一件:不要再對那 29 筆按「已修正」。**
它們永遠不會變成 200,每按一次就再收一次「失敗」。
(只有 `/index.html` 那兩筆,本片做完之後才值得再按一次。)
