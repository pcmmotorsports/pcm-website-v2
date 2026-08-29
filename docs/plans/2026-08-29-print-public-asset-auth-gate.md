# Plan:列印單據的圖在【沒有 cookie 的請求】下拿不到 —— 而修法有一個會開權限缺口的自然解

> 線A `pcm-website-v2-11` · 2026-08-29 · **鐵則 12④(平台設定)⇒ 本片等 Sean 批, 零 code**
> 起因:下手窗 `-c8` 量到 `/print/logo-p2-bicolor.png` 在無 cookie 請求下被 303。

---

## 0. 先講【誰量的】—— 本檔每一格都標來源

| 事實 | 來源 | 我複量了嗎 |
|---|---|---|
| 無 cookie ⇒ `/print/logo-p2-bicolor.png` 回 303 | 下手窗 `-c8` | 🔴 **未複量, 見 §6** |
| `proxy.ts` 只有一支, 在 `apps/admin/src/`;storefront **沒有** | 我 `find` 實查 | ✅ |
| `apps/admin/public/` 底下**恰 2 支檔**, 兩支都在 `print/` | 我 `find -type f` 實查 | ✅ |
| matcher 排除清單 = `_next/static` `_next/image` `favicon.ico` **恰三項** | 我讀 `proxy.ts` `export const config` | ✅ |
| `SSO_OPEN_PATHS` = `/api/sso/start` `/api/sso/callback` **恰兩條** | 我讀 `proxy.ts` | ✅ |
| 那兩張圖的唯一引用處 | 我 grep(排除 `*.test.*`) | ✅ |

### 🔴 數法(每一條可當場重跑;守門要求, 而它擋得對)
```bash
# proxy.ts 有幾支(storefront 有沒有)
find apps -maxdepth 4 \( -name middleware.ts -o -name proxy.ts \) -not -path '*/node_modules/*'
#   ⇒ 1 支:apps/admin/src/proxy.ts

# admin public/ 底下有幾支檔
find apps/admin/public -type f | wc -l          #   ⇒ 2
find apps/admin/public -type f                  #   ⇒ 兩支都在 print/
find apps/storefront/public -type f | wc -l     # 對照:304(而 storefront 沒有 proxy)

# 排除清單恰三項 / SSO 白名單恰兩條 —— 讀字面, 不數
grep -n 'matcher:' apps/admin/src/proxy.ts
grep -n 'SSO_OPEN_PATHS' apps/admin/src/proxy.ts

# 那兩張圖的引用處(排除測試)
grep -rn 'logo-p2-bicolor\|line-qr' --include='*.tsx' --include='*.ts' --include='*.css' \
  apps/admin/src | grep -v '\.test\.'
#   ⇒ 2 處, 皆在 components/print/shipping-doc.tsx 的 <img>
# 負對照:把樣式換成一個現造字串 ⇒ 必須回 0
```
⚠️ **而這些命令答得出「有幾支/在哪」, 答不出【它們公開了會怎樣】** ——
那一格是判斷, 不是計數, 寫在 §2。

---

## 1. 要改什麼 / 現況

```
apps/admin/public/print/logo-p2-bicolor.png   ← 出貨明細單的 LOGO
apps/admin/public/print/line-qr.png           ← LINE 官方帳號 QR
   兩者唯一引用處 = components/print/shipping-doc.tsx 的兩顆 <img src='/print/…'>
```

`proxy.ts` 的登入閘:**預設擋**,只放行 `SSO_OPEN_PATHS` 那兩條;
matcher `'/((?!_next/static|_next/image|favicon.ico).*)'` ⇒ **`public/` 底下的檔在射程內**。
⇒ 沒有 cookie ⇒ `verifySessionDetailed` 不過 ⇒ `NextResponse.redirect(startUrl, 303)`。

**⇒ 員工用瀏覽器列印:帶 cookie ⇒ 圖看得到。** 今天不流血。
🔴 **⇒ 而 Sean 2026-08-23 拍的「伺服器渲染出圖」:那個請求【沒有任何人的 cookie】⇒ 必然拿不到。**

### ⚠️ 而症狀是【圖不見了, 不是錯誤】
```
<img> 拿到一個 303 ⇒ 瀏覽器/容器就是不畫那張圖
⇒ 不報錯、三綠全綠、零告警 ⇒ 只有人眼看 PDF 才發現
🔴 **「零告警」的數法(可重跑)**:`grep -rn 'onError' apps/admin/src/components/print/` ⇒ **0**;
負對照 `grep -rn 'className' apps/admin/src/components/print/ | wc -l` ⇒ 非 0(尺是活的)。
⇒ 那兩顆 `<img>` **沒有掛任何失敗處理** ⇒ 拿不到圖時不會有東西叫。
   (2026-08-29 當場實跑:onError ⇒ 0 · 負對照 className ⇒ 144 ⇒ 尺是活的)
```
📌 **⇒ 它與字型是【同一個母題】:瀏覽器有的東西, 容器沒有。**
**而兩者的失敗形狀相同 —— 少了東西, 而版面看起來仍然完整。**

---

## 2. 🔴 影響面 —— 這一節是本 plan 的重點, 不是修法

### 🔴🔴 那個最自然的修法, 會開一個權限缺口
```
自然解:在 matcher 排除清單加 `print/`
🛑 而【列印頁本身的網址也是 /print/…】:
     apps/admin/src/app/print/orders/[id]/picking/page.tsx          ⇒ /print/orders/<id>/picking
     apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/…   ⇒ /print/orders/<id>/shipping/<sid>
     apps/admin/public/print/logo-p2-bicolor.png                    ⇒ /print/logo-p2-bicolor.png
   ⇒ 靜態圖與【要登入才能看的訂單頁】共用同一個網址前綴
```
🔴 **⇒ 排除 `print/` = 把【客人姓名、地址、電話、品項、金額】那兩頁的登入閘一起關掉。**
**⇒ 那是鐵則 12② 的權限缺口, 而它在 diff 上只是【排除清單多一個字串】。**

### ✅ 而已經有一道守門盯著這件事, 它是活的
`apps/admin/src/proxy-matcher.test.ts`(44 行)逐字:
```
it('排除清單=恰三項靜態資源,一項都不能多(多一項=該路徑 auth 靜默消失)')
it('matcher 字面綁定:恰一條 pattern、逐字面相等(改 matcher 必先過本格)')
```
📌 **⇒ 任何加排除項的修法【一定會紅】** —— 那不是障礙, 那是這道守門在做它該做的事。
**⇒ 而「改測試讓它變綠」= 拆掉唯一擋住那個缺口的東西。這條線我不走(R4 換路訊號)。**

### 其餘影響面
```
· storefront 完全不受影響（它沒有 proxy.ts；public/ 底下 304 支檔走的是另一套）
· admin public/ 只有這 2 支 ⇒ 分母小、可逐一過目
· 兩支都是【對外不含機密】的素材（公司 LOGO / LINE 官方帳號 QR）
  ⇒ 公開它們本身沒有洩漏疑慮；有疑慮的是【怎麼公開】會不會連帶開到別的
```

---

## 3. 三個方案

### 🅰 把圖改成【靜態資源 import】,不動 matcher(**我推**)
```
現在  <img src='/print/logo-p2-bicolor.png' />           ← 走 public/，在 matcher 射程內
改成  import logo from './logo-p2-bicolor.png'
      <img src={logo.src} />                             ← 走 /_next/static/media/…
🔴 而 `_next/static` 【已經在排除清單裡】⇒ 零 matcher 改動、零新排除項
```
| 格 | 值 |
|---|---|
| 動 matcher | **否** ⇒ 那道 44 行守門一格都不用碰 |
| 權限缺口 | **零**(沒有新增任何公開路徑) |
| 影響檔 | `shipping-doc.tsx` 兩行 + 圖檔搬位置 |
| rollback | 改回 `src='/print/…'`、圖搬回 `public/` ⇒ 一顆 revert |
| ⚠️ 未確認 | Next 的靜態 image import 在**本專案的設定下**能不能吃 `.png`(我沒實跑, 見 §6) |

### 🅱 在排除清單加【兩條精確路徑】, 不加前綴
```
matcher 改成 '/((?!_next/static|_next/image|favicon.ico|print/logo-p2-bicolor\.png|print/line-qr\.png).*)'
```
| 格 | 值 |
|---|---|
| 動 matcher | **是** ⇒ 那道守門會紅, 要**同 commit 改它的期望值**(從「恰三項」改成「恰五項, 逐條列出」) |
| 權限缺口 | 低但**非零**:正則寫錯一個字元就可能比預期寬 |
| 🔴 真正的代價 | **它把「加排除項」這件事變成常規動作** ⇒ 下一個人加第六項時, 那道守門已經是「改期望值就好」的形狀 |
| rollback | 一顆 revert |

### 🅲 把圖搬出 `print/` 前綴, 再排除新前綴
```
public/print/*.png ⇒ public/print-assets/*.png,matcher 排除 print-assets/
```
| 格 | 值 |
|---|---|
| 權限缺口 | 低 —— 新前綴底下**沒有任何頁面**, 不會誤開 |
| 代價 | 仍然動 matcher + 仍然要改守門期望值;而它比 B 多一次搬檔 |

---

## 4. 我的建議與理由

**推 🅰。** 理由不是「比較優雅」,是**它不需要動那道守門**:
```
🔴 B 與 C 都要【改一道正在守著權限缺口的測試的期望值】
   而那個動作與「拆掉它」在 diff 上長得一樣
   ⇒ 下一次有人要加第六項時, 前一次的 commit 就是他的先例
✅ A 走的是【那道守門本來就已經放行的那條路】(_next/static)
   ⇒ 排除清單永遠是三項 ⇒ 守門的形狀不變
```
📌 **⇒ 判準是:哪個方案【不需要把守門的期望值調寬】。**

---

## 5. Rollback

三案都是單顆 revert。
🔴 **而 A 多一格要講**:圖檔位置變了 ⇒ revert 要**同時**還原檔案位置與 `<img>` 的兩行,
否則會變成「引用指向一個搬走的檔」⇒ **而那同樣是【圖不見了, 不報錯】。**
⇒ **所以 A 的圖檔搬移與程式改動必須在同一顆 commit。**

---

## 6. 🔴 我沒做到的兩格(明寫, 不藏)

```
① 303 那一格我【未複量】
   我起了 admin dev server(埠 3057, 無 ADMIN_DEV_BYPASS)⇒ 它【沒起來】,
   被 `src/lib/dev-db-guard-gate.ts:49` 的 assertDevDbGate 擋住(本機沒有 DB)。
   🔴 而那一發五個路徑【全印 HTTP 000】—— 連對照組(/api/sso/start · 不存在的檔 · favicon)也是
   ⇒ 若我只探那兩張圖, 我會回報「它們被擋住了」而理由是錯的。
   ✅ 抓到的是對照組。
   🛑 我【沒有】用 PCM_ALLOW_PROD_DB_DEV=1 繞過那道閘 —— 那是常設禁令。
   ⇒ 要複量走 `scripts/admin-probe/up.sh`(它自帶拋棄式 PG;REPO 從腳本自身位置推, 對 worktree 安全)。

② A 案的「Next 靜態 image import 吃不吃 .png」我【沒實跑】
   ⇒ 那是 A 的前置, 而它是【零 code 這一輪做不到的事】(要改檔才驗得到)
   ⇒ 批准之後第一步就是驗它, 驗不過就退 C。
```

---

## 7. 驗收(而本機驗收對這一格有天花板)

```
✅ 可在本機驗:改完後 /print/orders/<id>/shipping/<sid> 仍然【無 cookie ⇒ 303】
   ⇒ 那是「我沒有順手開掉登入閘」的證據, 而它兩個世界印不同的東西
✅ 可在本機驗:proxy-matcher.test.ts 一格都不用改就過(A 案專屬;B/C 過不了)
🔴 而【圖到底出不出得來】要在一個【沒有 cookie 的伺服器端請求】裡驗 ——
   員工瀏覽器帶著 cookie ⇒ 本機截圖對這一格【零判別力】, 與字型那件同一個天花板
```
