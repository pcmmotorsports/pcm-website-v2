# 站台改版第1-4批 · 結構比對(cssdiff)方法論與殘差彙總

> 2026-08-06 · 視窗 D(worktree `pcm-site-redesign`,branch `site-redesign`)
> 對應 commit:`b94246e`(批1)/ `42406e9`(批2)/ `fa49372`(批3)/ `dc1c462`(批4)
> 交接單真權威 = OD `pcm-home-redesign/`(鐵則 1 的明文例外;submodule `design-reference` 是過期假稿)
>
> **這份檔在回答一件事**:為什麼「照交接單的 §三 清單做」四批下來一次都不夠,以及怎麼補。

---

## 一、結論先講

**四批的交接單都寫了「這批只有 N 筆改動」,四批的實際筆數都比 N 多。**
不是設計端偷懶 —— 三次查得出原因(交接單寫在後續盤點之前、理由引用的是設計稿而非真站、
交接單 §三 沒跟上 R1/R2 修訂),但**對施工端的結論一樣**:

> 交接單的「只有 N 筆」是**寫作當下的快照**,不是清單。
> 每一批動手前,自己對設計稿跑一次**逐規則的結構比對**。

---

## 二、方法:cssdiff

### 2-1 為什麼不能用 `diff` / 用眼睛看

設計稿與真站的 CSS 在**排版形式**上幾乎沒有一行相同:註解量、宣告順序、單行 vs 多行、
`@media` 的巢狀寫法、選擇器分組(`a, b { }` vs 兩條)全都不同。
文字 diff 的輸出是整檔紅綠、資訊量為零。

### 2-2 做法

1. 剝掉所有 `/* … */`(**這步是必要的**:第一版沒剝,結果命中一大堆自己寫的中文說明,
   例如註解裡引用的舊色字面被當成殘留)
2. 走訪 `@media` 區塊,把條件正規化後當成 key 的前綴(`@media (max-width: 900px) | .co-step`)
3. 選擇器分組拆成單條;宣告切成 `set`、空白正規化
4. 對稱 diff,輸出三類:`[僅設計稿]` / `[僅真站]` / `[值不同]`(逐宣告列出差在哪)

腳本 60 行、零相依,附在 §六。

### 2-3 🔴 它抓不到什麼(用之前先知道)

| 盲點 | 後果 | 怎麼補 |
|---|---|---|
| 只比 CSS,**不比 TSX** | 「class 名對了但 markup 結構不同」看不出來 | 逐字核交接單的功能元素表 |
| 宣告當成 set,**不管檔內順序** | 同 specificity 靠原始碼順序分勝負的情況(平板段 vs 手機段)完全隱形 | 另外比對 `@media` 區塊的出現順序(批4、批5 都踩到) |
| 不知道 class 住在哪支檔 | 跨檔的規則(`.pp-breadcrumb` 在 `products-page.css`)會被誤報成「真站沒有」 | 過濾器:那個 class 在真站全部 CSS 裡存不存在(§三) |
| 不懂 `var()` 解不解得出來 | `var(--font-mono)` 這種 typo 兩邊字面相同 ⇒ **diff 全綠** | 另外掃 token 別名是否在該 scope 內有定義(批3 的教訓) |
| 不知道規則有沒有真的生效 | 元件用 inline style 做同樣的事,會被報成缺漏(`.pcard-gallery-img`) | 命中後回頭讀元件 |

---

## 三、逐批:交接單說什麼 vs 結構比對找到什麼

### 批1 `/info/shipping` `/terms` `/privacy` 404 — 說 3 筆,實際 5 筆

比對:`pcm-content.css` vs `pages-shipping.css` + `error.css`

| # | 交接單 | 內容 |
|---|---|---|
| 1 | ✅ §三-1 | `.shipping-card-num` `var(--font-mono)` → `var(--f-mono)` |
| 2 | ✅ §三-3 | `.policy-block p` 段距 10px + 末段歸零 |
| 3 | ✅ §三-2 | 404 主鈕熔橘化(**做法不同**,見下) |
| 4 | ❌ **沒列** | `.policy-block strong { color: var(--c-text) }`(設計稿 `:144` 有、真站沒有) |
| 5 | ❌ **沒列** | 整段平板段 `@media (min-width:600px) and (max-width:1079px)` 三條 |

**為什麼漏**:交接單 §三 寫於平板盤點之前,而 `SITE-MAP.md`「平板斷點」那節逐字把
`pcm-content.css` 列為已補檔之一 ⇒ **§三 過期,不是設計端漏給**。

**另外兩處交接單的理由在真站不成立**:
- §三-2 只叫改框線,理由逐字是「`.btn-primary` 已在購物車那輪換成熔橘底」——
  那說的是**設計稿**的購物車;真站 `cart.css` 當時(與現在)仍是 `background: var(--c-text)` 墨黑。
  照字面只改框線 = 黑底配橘框,比兩端都糟。⇒ 底色與框線一起收進 `.err-btn-primary` scope。
- 版寬:設計稿的作法是 `:root { --content-max: var(--shell-bar-max) }` 整顆重定義。
  真站 `--content-max` 另有 `checkout.css` 與 `product-page.css` 兩個消費點 ⇒
  **動 token 會一併重繪 `/checkout`**(當時金流頁禁碰)⇒ 改成逐點換。

### 批2 `/coming-soon` `/stores` `/install` `/logout` — 說的**理由**有三個在真站不成立

這批是新開路由,沒有「N 筆」可比;比對的是交接單的**前提**。

| 交接單怎麼說 | 真站實況 | 怎麼做 |
|---|---|---|
| 「真站不用做天地 —— Next 的 `layout.tsx` 本來就會包 header/footer」 | 殼是**逐頁 import**(派工單 §3-2 點名 13 處),`app/` 底下無 nested layout | `/stores` `/install` 自己 import 兩顆殼 |
| (完全沒提 TabBar) | TabBar 掛在**根 layout**、頁面 import 不到 ⇒「整站版零站內導航」在手機上直接破功 | 改 `MobileTabBar.tsx` 的 hidden 判定 |
| 「白底殼搬到純黑頁上不能看」+「真站用自己的殼就好」 | 真站 `<Header>` 就是白底 ⇒ 兩句話在真站互斥 | 照現況、列成決策題 |

⇒ **後面每一批都要假設交接單的理由可能過期,自己回真站實查。**

### 批3 `/products` + `/cart` — typo 家族被低報,而且比想的嚴重

交接單與批1 的 R1 各點到 **1 處** `var(--font-*)`;實際 **3 條宣告 / 4 個選擇器**。

🔴 **嚴重度也被低估**:這幾條寫在 `font:` **簡寫**裡。CSS 的規則是
「`var()` 在 computed-value time 解不出來 ⇒ **整條宣告作廢**」——
不是只有字體回退,**字級與行高一起沒了**。

真瀏覽器合成探針實測:壞的 computed **16px / normal**,好的 **13px / 13px**
⇒ 分頁列的字一直比設計值大 3px,而且**四批的文字層測試全部看不到**(兩邊字面相同)。

**根因**:`--font-sans` / `--font-mono` 只定義在 `product-page.css` 的 **`.pd-page` scope 內**;
`products-page.css` 的選擇器作用在列表頁上、拿不到那兩顆。

**我自己在這批也漏了一次**:對 `/cart` **只做針對性 grep、沒跑結構比對** ⇒ 漏掉一處
`IBM Plex Mono`,批4 對 auth 跑比對時才連帶抓出來。⇒ **「這批很小」不是跳過比對的理由。**

### 批4 `/login` `/register` `/account` — 說「全在 auth.css,一支檔案」三節,實際 7 項

比對:`pcm-auth.css` vs `auth.css`、`pcm-account.css` vs `account.css`

| # | 交接單 | 內容 |
|---|---|---|
| 1-3 | ✅ | 交接單三節(主鈕熔橘 / 半像素整數化 / mono typo) |
| 4 | ❌ | `auth.css` 整段平板段 `@media (min-width:600px) and (max-width:1079px)` |
| 5 | ❌ | `.auth-submit:disabled`(真站完全沒有) |
| 6 | ❌ | `.auth-check a`(條款連結樣式,真站完全沒有) |
| 7 | ❌ | `account.css` 整段平板段 + `.acc-nav-icon` 三階色 + R1 9-3 的逐值表 |

🔴 **這批也是我犯最大錯誤的一批**:`.acc-nav button.is-active .acc-nav-icon` 我寫在**全域層**
(桌機黑底 ⇒ 半透明白),而 ≤1079px 的 active 是**透明底 + 白底頁面** ⇒ **白圖示直接隱形**。
設計稿逐字寫過「Sean 截圖裡『總覽』沒有圖示就是這個」—— **我搬了肇因、沒搬修法**,
而且**寫了一條測試把那個 bug 釘成正確答案**。是 code-reviewer 抓到的,不是我看出來的。

---

## 四、落地後殘差(2026-08-06 重跑,可複現)

對每批重跑一次 cssdiff,再過一次「這個 class 在真站全 26 支 CSS 裡存不存在」的過濾器。

| 比對對 | 真殘差 | 跨檔誤報 | 說明 |
|---|---|---|---|
| `pcm-content.css` vs `pages-shipping.css`+`error.css` | **2** | 9 | 見 4-1 |
| `pcm-auth.css` vs `auth.css` | **0** | 0 | ✅ 完全對齊 |
| `pcm-account.css` vs `account.css` | **2** | 12 | 見 4-2 |
| `od-cart.css` vs `cart.css`+`cart-vehicle.css` | **6** | 50 | 見 4-3 |
| `od-products.css` vs 商品列表五支 | **3** | 125 | 見 4-4 |
| `pcm-checkout.css` vs `checkout.css` | **25** | 35 | 第5批未施工,清單見 `scratchpad/checkout-recon.md` |

🔴 **過濾器的盲點**:它只問「class 存不存在」,不問「這條規則存不存在」。
所以**整段平板段**(第5批那 28 條)會被歸進「誤報」堆 —— 它們其實是真的缺。
看數字前先看這句。

### 4-1 內容頁的 2 條 = 刻意偏離,不是缺口

`@media (600–1079) | .faq-q { font-size: 16px }` / `.faq-a { font-size: 15px }`。
真站對應的是 `.shipping-content .faq-item summary` 與 `… p`(`[僅真站]` 那兩條)。
`.faq-q` / `.faq-a` 在真站是**死規則**(沒有元素掛那兩個 class),
Sean `D-116-A` Q1=A 拍板要「照節奏加大」⇒ 套在**活選擇器**上,不搬死規則。**已達成、不要回頭改。**

### 4-2 🔴 account 的 2 條 —— 其中一條是**批4 真的漏了**

| selector | 判定 |
|---|---|
| `.acc-tier-badge` | ❌ 非缺口。真站用的是 `TierBadge` **元件**、不是 CSS class(R1 9-3 已處理成 `size="lg"`) |
| **`.acc-address { display: flex; flex-direction: column; gap: 12px }`** | 🔴 **真的缺**。設計稿 `pcm-account.css:392` 有;真站 `account.css:432` 的註解逐字寫「`.acc-address` 容器 design 無規則(plain div block flow)、不發明」—— **那句話對當前的 OD 設計稿不成立** |

後果:`/account` 地址頁的地址卡之間**少了 12px 間距**,卡片會貼在一起。
影響面 = `AddressTab.tsx:71` 一個容器、一行 CSS。
**本輪唯讀偵察,沒有動手改** —— 留給下一批(或併進第5批的 commit)。

⚠️ 順帶的教訓:那句註解引用的是「design account.css L784-813」,行號對不上現在的 OD 檔
⇒ **它引的可能是更早的一份稿**。註解裡的「design 沒有」跟程式碼裡的「不可能」一樣,
**都是沒被測過的斷言**。

### 4-3 cart 的 6 條 = 已在問設計端的那題

全部是 `.cvf-sheet-head` / `.cvf-sheet-actions` / `.cvf-sheet-x` / `.cvf-done`
(設計稿的手機底部 sheet 版面)。真站全 repo 零 `.cvf-sheet-*`,交接單 §三「不要照抄的部分」也沒列到。
**待設計端回覆是待搬還是靜態稿替身**(D-216 §七-3)。

### 4-4 商品列表的 3 條 = 實作方式不同,非缺口

| selector | 判定 |
|---|---|
| `.pcard-gallery-img` / `.pcard:hover .pcard-gallery-img` | ❌ 非缺口。真站 `ProductCard.tsx:107-115` 用 **inline style** 做同一件事(`transform: scale(1.04)` / `transition: transform 1.4s cubic-bezier(0.2,0.7,0.1,1)` 逐字同值) |
| `.pcard-link { display: contents }` | 設計稿的卡片外層連結寫法,真站 markup 結構不同。無視覺差,低優先 |

---

## 五、交接單裡因為這四批而**過期**的句子(請設計端更新)

| 檔 | 句子 | 為什麼過期 |
|---|---|---|
| `content-pages-handoff.md` §五-5 | 「排版值除第 3 筆 p 的 margin 外一個未動」 | 批1 加了平板段與版寬 |
| `content-pages-handoff.md` §五-8 | 「900px 以下大標 24px」 | 600-899 現在是 30px |
| `cart-page-handoff.md` §1-4 | 「`.cart-checkout` 墨黑主鈕 … 照舊不動」 | 同檔 §五 已拍板改熔橘 ⇒ **同一份交接單自己前後矛盾** |
| `cart-page-handoff.md` §四-3 | 驗收「`.cart-checkout` 仍墨黑」 | 同上 |
| `checkout-page-handoff.md` §二 | 「全部只有這 8 筆」 | §九(R1)與 §十(R2)加了四族新東西,§二 沒跟上 |

另有一條**設計端內部**的矛盾(不是過期,是兩份稿對同一顆 class 給了相反結論):
`.btn-primary` —— `cart-page-handoff.md:87` 要它維持墨黑,`checkout-page-handoff.md` §二-8 要它全域熔橘。
詳見 `scratchpad/checkout-recon.md` §三。

---

## 六、腳本(可直接複製使用)

```python
import re, sys, pathlib

def parse(txt):
    txt = re.sub(r'/\*[\s\S]*?\*/', '', txt)          # 🔴 必須先剝註解
    out = {}
    def walk(s, prefix=''):
        i = 0
        while i < len(s):
            at = s.find('@media', i); br = s.find('{', i)
            if br == -1: break
            if at != -1 and at < br:                   # @media 區塊:大括號走訪、不用正規式
                mb = s.find('{', at); depth = 0; j = mb
                while j < len(s):
                    if s[j] == '{': depth += 1
                    elif s[j] == '}':
                        depth -= 1
                        if depth == 0: break
                    j += 1
                walk(s[mb+1:j], prefix + ' '.join(s[at:mb].split()) + ' | ')
                i = j + 1; continue
            sel = ' '.join(s[i:br].split()); close = s.find('}', br)
            decls = tuple(sorted(' '.join(d.split()) for d in s[br+1:close].split(';') if d.strip()))
            for one in [x.strip() for x in sel.split(',')]:
                out.setdefault(prefix + one, set()).update(decls)
            i = close + 1
    walk(txt)
    return out

design = parse(pathlib.Path(sys.argv[1]).read_text())
real = {}
for p in sys.argv[2:]:
    for k, v in parse(pathlib.Path(p).read_text()).items():
        real.setdefault(k, set()).update(v)

for sel in sorted(set(design) | set(real)):
    d, r = design.get(sel), real.get(sel)
    if d is None: print(f'[僅真站] {sel}')
    elif r is None: print(f'[僅設計稿] {sel} :: {"; ".join(sorted(d))}')
    elif d != r:
        print(f'[值不同] {sel}')
        for x in sorted(d - r): print(f'    設計稿+ {x}')
        for x in sorted(r - d): print(f'    真站 +  {x}')
```

用法:`python3 cssdiff.py <設計稿.css> <真站1.css> [真站2.css …]`
(真站端可給多支,會先聯集起來再比 —— 因為真站常把設計稿的一支拆成多支。)

**跨檔誤報過濾器**(第二道):把 `[僅設計稿]` 的每個 class 拿去 `styles/*.css` 全體找,
全部找得到 ⇒ 跨檔誤報;有一個找不到 ⇒ 真殘差。

---

## 七、下一個人該做的三件事

1. **每批動手前先跑一次**,把輸出貼進 slice plan 的「相關既有紀錄與連動面」那節。
2. **順序也要比**:同 specificity 的 `@media` 靠原始碼順序分勝負,cssdiff 看不到(§2-3)。
   批4 與批5 都踩到 —— 平板段擺錯位置,視覺會**靜默**倒退、三綠全綠。
3. **命中後回頭讀元件**,不要直接當缺漏補(§4-4 的 inline style、§4-2 的 `TierBadge` 元件)。

— 視窗 D,2026-08-06
