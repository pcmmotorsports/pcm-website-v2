# GILLES TOOLING 上顧客站 — 網站側施工紀錄(2026-08-27 夜)

> **一句話**:程式面全部做完、乾跑五關全綠;**首灌沒做**(那是寫進正式顧客站、不可逆,要 Sean 一個字)。
>
> 上游 = Sean 本人貼的交接(三個版本,見 §5「數字為什麼會動」);協調窗 = `-de`;主視窗 = `-5b`。

---

## 1. Sean 醒來要回的三題

| 題 | 選項 | 我的推薦 |
|---|---|---|
| **Q-Gilles-1 首灌** | 甲 = 翻 `writeAllowed: true`、跑監控式首灌 / 乙 = 先不翻 | **甲** —— 乾跑五關全綠、前置全清,沒有已知阻礙 |
| **Q-Gilles-2 「德國」** | 來源側交接 §4 寫「德國 Gilles Tooling」= 錯的(官網 imprint 是**盧森堡**)。甲 = 兩處都改 / 乙 = 不改 | **甲**。🔴 **不只交接文件** —— 報價單庫 `suppliers` 表實查 `slug='gilles'` ⇒ `origin = '德國'`。兩處都在報價單那側,不是我們的檔案面 |
| ~~**Q-Gilles-3 無照片商品**~~ | 🔴 **本題已撤,不要問他**(理由見 §10-B) | — |

---

## 2. 🔴 回「甲」之後,要跑的就是這一行

```bash
cd /Users/sean_1/pcm-website-v2
```

**第一步 — 當場重量群數(不要沿用本檔或任何交接的數字,理由見 §5):**

```sql
SELECT count(*) AS 列, count(DISTINCT main_sku) AS 群, now() AS 量測時點
FROM storefront_catalog_v WHERE supplier_slug = 'gilles';
```

**第二步 — 把 `scripts/supplier-config.ts` 的 `gilles` 那筆 `writeAllowed` 改成 `true`,commit。**

**第三步 — 監控式首灌(把 `<剛量到的群數>` 換成第一步的數字):**

```bash
pnpm exec tsx scripts/rpm-import.ts --confirm-write --supplier=gilles --expect-groups=<剛量到的群數> 2>&1 | tee /tmp/gilles-first-load.log
```

- 🔴 **不要帶任何 `--allow-*` bypass**。撞閘 = 真有事,停下來看。
- 看到 `[rpm-import] WRITE 完成:N 商品 / M 變體` 才算完。
- 中途斷 / upsert 報錯 → 走 `docs/runbooks/2026-07-19-akrapovic-first-load-runbook.md` §4 補償程序。

**第四步 — 寫後驗證(網站庫)**:照 `docs/runbooks/supplier-storefront-onboarding.md` §5 那句 SQL,期望 `uncategorized = 0`。

**第五步 — 部署**:`git push origin dev` 然後 `git push origin dev:main`。🔴 **只有 Sean 推。**

---

## 3. 這一夜實際做完的

| 項 | 狀態 |
|---|---|
| `scripts/supplier-config.ts` 登記 `gilles` | ✅ `writeAllowed: false`(fail-closed、過夜零寫入) |
| 乾跑五關 | ✅ 全綠(詳 §4) |
| 商品頁品牌形象區 `GillesShowcase.tsx` + `BrandShowcase.tsx` 加 case | ✅ runbook §6-b 那一步 |
| 品牌介紹頁 `/brands/gilles` | ✅ **本來就完成了**(2026-08-25),本片零改動(見 §6) |
| 三綠 | ✅ typecheck / lint / build 皆 `rc=0`、`TURBO_FORCE=1`、`0 cached` |
| 測試 | ✅ 連跑兩發、三個數字全同(見下) |

**測試證據(🔴 分母含 `node` project —— 先前只寫 storefront 那一發是錯的,`supplier-config.test.ts` 與 `rpm-import-cli.test.ts` 不在它的分母裡)**

| project | 檔數 | 測項 | 紅的格數 | 兩發相同 |
|---|---|---|---|---|
| storefront | 255 | 3686 passed + 1 expected fail = 3687 | 0 | ✅ |
| node(含 `scripts/**`) | 136 | 2575 | 0 | ✅ |
| admin `sync-facts.test.ts`(consumes supplier-config) | 1 | 5 | 0 | ✅ |

### `handlePrefix` 那格我自己收掉了,沒佔 Sean 的格子
交接文件標「待定」。求值比對既有 **17/17 家 `handlePrefix` 逐字 == `supplierSlug`、零例外**
⇒ 那不是選擇題,是沿用唯一慣例 ⇒ 填 `gilles`。

---

## 4. 乾跑五關(2026-08-27,`--expect-groups=1545`)

```
分群              1545 群                                    ✅
群數指紋 gate      來源 1545 群 = 預期指紋 1545 群              ✅
分類對上           已對上 1545 群 / 未對上 0 群                 ✅
handle preflight  1545 群 handle 全部合法且唯一                ✅
pv_spec           最終撞鍵 0 / 中途換位 0 群                    ✅
價格              🔴異常 0 / ⚠️離群 0;新品價與來源獨立重算逐筆相符  ✅
來源消失對賬       待標記 0(target 上架 0 / source 1545)        ✅
```

### 🔴 而「五關全綠」這句話要打折 —— 首灌情境下有幾格是**恆綠**的

複量窗 `-9e` 打進來的,我複查後同意。**首灌時 target 現存商品 = 0** ⇒ 凡是拿「現況」當對照的格子都沒有分母:

| 格 | 首灌時的判別力 |
|---|---|
| 價格 delta「離群 0」 | ❌ **恆綠**(沒有舊價可比) |
| handle「target 零撞」 | ⚠️ 半恆綠(批內唯一那半有效、對 target 那半無分母) |
| pv_spec「中途換位 0 群」 | ⚠️ 半恆綠(同上) |
| 來源消失對賬「待標記 0」 | ❌ **恆綠**(target 上架 0) |
| 「分群 1545 群」 | ❌ 只印數字,不是一道閘 |

**首灌真正有判別力的是這四格**(引用證據請引這四格,不要引「五關全綠」):
```
① 分類:已對上 1545 群 / 未對上 0 群
② handle:1545 群【批內】合法且唯一
③ pv_spec:【批內】最終撞鍵 0
④ 新品驗價 M1:新品價與來源獨立重算【逐筆】相符、無區間異常   ← runbook §3 沒列到這格,而它最有力
```

### 🔴 還有一格:`--expect-groups` 在乾跑**不擋**,而且 rc 恆 0
`scripts/rpm-import.ts:214` 逐字 `isWrite: !DRY_RUN`,:222 只在 `!DRY_RUN && aborted` 才 throw。
本窗負對照實測:餵 `--expect-groups=9999` ⇒ 畫面印
`🔴 ALERT 群數指紋 abort、不寫:…來源 1545 群 ≠ 預期 9999 群`,**而 `rc = 0`**。
⇒ **乾跑的 rc=0 不是「五關過了」的證據**,要讀 log 的字面。寫入模式才會 throw、才擋得住。

---

## 5. 🔴 群數是活的 —— 兩分鐘內我量到兩組不同的值

| 量測時點(UTC) | 列 | 群 | 缺中文名 |
|---|---|---|---|
| 2026-08-26 18:54:26 | 1,814 | 1,543 | 3 |
| 2026-08-26 18:56:17 | 1,817 | 1,545 | **0** |

**同一支 view、兩種查詢寫法交叉驗過(排除查詢形狀差異)、負對照 `supplier_slug='zzz_no_such_20260827'` 回零列。**
中間發生的事:來源側正在補那 3 筆的中文品名,而 `storefront_catalog_v` 有群級中文名閘 ⇒ 補好就進 view。
(Sean 後來貼的第三版交接證實了這件事:「2026-08-27 收尾補完最後 3 筆」。)

📌 **所以同一份交接在幾小時內有三個版本、兩組數字**(1540 / 1543 / 1545 都出現過)。
⇒ **`--expect-groups` 一律在按下去的那一刻重量。** 這家 2026-08-27 起排進每日班、自己更新價格。

---

## 6. 兩件「已經完成、但交接把它列成待辦」的事

**這兩格不要再端給 Sean,也不要重做:**

1. **品牌介紹頁 `/brands/gilles` 早在 2026-08-25 就完成**
   `apps/storefront/src/data/brand-content.ts:1592` 起整筆都在(band / bandLogo / facts / about /
   aside / highlights / craft / video / categories / focus 一欄不缺)。
   素材:用正規式從那一筆**機器抽出**所有 `assets/…` 路徑 ⇒ **7 條,逐條 `os.path.exists` 全在**
   (路徑前綴是 `public/brand-assets/assets/`,由 `lib/brand-asset.ts` 的 `ASSET_BASE` 補,不是 `public/assets/`)。
   🔴 **我先前寫「9/9」是錯的** —— 那 9 是**手列**的清單,混進了兩個那一筆其實沒引用的檔
   (`brands-trim/gilles.png`、`brands-prod/gilles/panigale-v4s.jpg`)。機器抽出後是 **7 條**。
   📌 **「清單漏列」與「清單多列」都會讓那個分數失真,而它們都印一個好看的 N/N。**
   🔴 **而且那支檔頭逐字寫著【機器產生,不要手改】** —— 真權威在 Open Design
   `pcm-home-redesign/brand-content-data.js`,手改會在下次重產時被無聲蓋掉。**本片對它零改動。**

2. **影片要不要自 host,2026-08-25 就決定了**
   repo 裡 `brand-assets/assets/brand-video/gilles-hero.mp4`(2.21MB)是 Sean 桌面那支 15.29MB 原檔的轉檔版
   (sha256 不同、體積 1/7),**品牌介紹頁現在就在用它**。

📌 兩件的共同成因:**把一份【流程文件】讀成了【現在的狀態】。** runbook 說「要做這一步」不等於「這一步還沒做」。

---

## 7. 商品頁品牌形象區(runbook §6-b)

Sean 逐字「我覺得 GG 品牌介紹頁面可以配置跟 Akrapovic」⇒ 骨架逐支對照 `AkrapovicShowcase.tsx` 的**重量版**:
N°01 三卡 + N°02(官網形象影片帶 + 故事兩段 + 信任狀四格)。

### 事實出處 —— 每一條都是本窗**親自 WebFetch 官網當場讀的**,不是轉述

`www.gillestooling.com/en/Behind-the-scenes/` 逐字:
`"Founded in 2000"` · `"Gerhard Gilles - a passionate racing driver for over a decade"` ·
`"The first adjustable footrest systems were built directly for his own racing motorbike"` ·
`"The first series product: the AS31GT multivariable footrest system"` ·
`"proudly as an OEM supplier for BMW Motorrad, Yamaha and Suzuki, among others"` ·
`"TÜV, OEM and KBA certifications"` · `"GILLES is certified according to ISO 9001 and ABE"`

`www.gillestooling.com/en/Shop/Footrest-systems/` 逐字:
`"CNC-manufactured quality "Made in Luxembourg""` · `"made from high-strength 7075 aluminium"`

### 🔴 國籍:盧森堡,不是德國
官網 imprint(**公司自己的法人登記頁**)`26, Op der Ahlkerrech, Z.I. Potaschbierg, L-6776 Grevenmacher,
Luxembourg` / `R.C.S. Luxembourg: B 107.876`。
「德國」那個說法追到底是**經銷商網站**(下游),不是公司自己。
📌 判別句:**這句話是【公司自己講的】還是【賣它東西的人講的】?**

### 素材
| 檔 | 來源 | 實量 |
|---|---|---|
| `logo.png` | 本 repo 既有官方淺底版 `brands-trim/gilles.png` 副本 | 652x137 |
| `hero.mp4` | Sean 桌面官方影片 1920x1080 轉 720p H.264 去音軌 | 1.30MB(Akrapovic 前例 1.77MB) |
| `hero-poster.webp` | 該片第 600 格 | 1280x720 |
| `story-range.webp` | 官網 media `RGK-Familie.png` 實裁 | 1600x1000 · ratio 1.600 |
| `story-fitment.webp` | 官網 media `Ducati Panigale V4S - 2025.jpg` 實裁 | 1600x1000 · ratio 1.600 |

🔴 **裁切比例照 CSS 不照 runbook**:runbook §6-b 寫「16:9」,而 `.pd-bona-media-img` 實際是
`aspect-ratio: 16 / 10`(`product-page.css:1123`)⇒ 做成 16:10,免得 `object-fit: cover` 二次裁切。
**每一張都實際裁完目視比對過,不是用算的。**

🔴 **官網那顆 `Logo_GILLES_white.png` 沒有採用**:實測只有 **100x21**、而且是白字版
(本頁是淺底 ⇒ 會看不見)。

---

## 8. 🔴 我在這片撞到、而它會在 Sean 按下去的那一刻炸開的一顆雷(已拆)

`brand-showcase-coverage.test.ts` 的負對照名單原本寫死 `['dbk','gilles','kineo','rizoma','wrs']`,
語意是「**從未登記過、0 商品**」。而 gilles 今晚被登記進 `supplier-config.ts` ⇒ **那一刻它就不再屬於這份名單**。

**實測兩個世界**(把 `writeAllowed` 暫時翻 true 跑一次 = 模擬 Sean 醒來按下去的那一刻,跑完已還原、零留痕):

| 世界 | 主閘 | 負對照 |
|---|---|---|
| A:`writeAllowed=true` + case 已補齊 | ✅ 綠 | 🔴 **紅** ← 名單過期,**不是真缺陷** |
| B:`writeAllowed=true` + case 拿掉 | 🔴 紅(訊息正確指出 `missing: gilles`) | 🔴 紅 |

⇒ 世界 A 的紅**紅在「負對照」那一條上**,訊息長得像「閘壞了」而不是「名單該更新了」
⇒ **下一個人會去找一個不存在的 bug。**
✅ 已修(把 gilles 移出名單 + 把這段因果寫進該檔),**修完重跑世界 A ⇒ 4 passed。**

📌 一般化:**這種「寫死一份名單」的負對照,會在被它保護的那件事真的發生時過期,而過期的方式是紅、不是綠。**

---

## 9. 誠實的限制(我做不到的)

🔴 **商品頁的品牌形象區,我沒有在真瀏覽器上看過它組起來的樣子。**
理由:那一段只在 **gilles 商品頁**才渲染,而網站庫現在 **0 筆 gilles 商品** ⇒ 沒有頁面可開。
⇒ **它要等首灌之後才看得到。** 我驗到的是:元件測試綠(4 條)、資產檔逐個存在、
兩張圖與海報我逐張開過、logo 顏色與底色對比實算 **14.27:1**。
**「測試綠」與「畫面對」是兩個宣稱,我只有前一個。**
⇒ **首灌之後請 Sean 隨便開一頁 gilles 商品頁,肉眼看一眼形象區。**

`dev-preview` 那條路走不通:`app/dev-preview/brands/[slug]` 需要 `BRAND_FIXTURES` 同步登記,
而 akrapovic / dna 也都沒進去 ⇒ 那個 harness 本來就沒跟上,且註解寫著 M-6 前移除(backlog #148)。

### 另一件量到但今天不發作的
`[data-theme="dark"]` 那段**不覆寫任何品牌 accent** —— **不只 gilles,既有 7 家都一樣**。
實量 accent on 深色 `--c-surface #18181b`:gilles **1.24:1** / ebc 1.64 / samco 1.88 / akrapovic 2.75
⇒ 全族都不過 AA,gilles 是最低的那個。
**現在不發作**:storefront 端沒有任何程式碼會設 `data-theme="dark"`(全 src grep、排除測試檔後零命中)。
⚠️ 哪天真的開深色模式,要**一次處理整族 8 顆**,只補最低那顆會讓另外 7 顆看起來像通過了。
(已寫進 `tokens.css` 該顆旁邊。)

---

## 10. 審查(Sean 逐字「需要審查找 fable or codex」)

跑了**三道獨立審查**,findings 全部處理完:`code-reviewer`(opus,fresh context)、
`codex`(`gpt-5` 系、`-s read-only`,**不共用我們的前提**)、`-9e` 複量窗(主視窗派來打我的乾跑證據)。

### A. 修掉的(逐條)

| 來源 | finding | 處置 |
|---|---|---|
| code-reviewer | runbook §6-b 舊字面「dbk/gilles/kineo/rizoma/wrs **從未登記過**」在 gilles 登記後變假 | ✅ 改成不寫死名單 + `literal-sweep` 全 repo 掃過 |
| code-reviewer | **`writeAllowed: false` 零守門** —— 誤翻成 true 整套測試不會紅 | ✅ 加 2 條(釘 `writeAllowed=false` + 逐值釘死) |
| code-reviewer | 負對照 `zeroProductBrands` 是**恆真的**(那四家根本沒登記 ⇒ `has()` 恆 false) | ✅ 拆兩條:①先斷言前提本身成立 ②改用「已登記但未開寫」這個會動的分母 |
| code-reviewer | alt 文字把未查證的用途寫成事實 | ✅ 改成只描述畫面 |
| code-reviewer | 「它後來成為第一支量產品 AS31GT」是**合成**,官網分兩句列、沒說前者就是後者 | ✅ 照原文順序並列,不合成因果 |
| code-reviewer | 「官網型錄分成六條線」比實際窄(`/Shop/` 實數 **8 個**,另有 Ersatzteile / OE-Exklusive) | ✅ 改「導覽列的**主要**產品線有六條」 |
| codex | 「同一套 CNC 加工同時供原廠與市售,**公差不分兩套標準**」= 我新增的品質承諾,官網沒有 | ✅ 刪掉,改成只說 OEM 供應關係的意義 |
| codex | 「這是**能不能合法上路**的實際差別」= 品牌級概括;ABE/驗車要求**逐件不同** | ✅ 改成中性敘述 + 明寫「涵蓋範圍逐件不同,以該件文件為準」 |
| codex | N°02 lead 說「**只做**把手、拉桿、腳踏」,被同檔的六條線**直接反證**(自相矛盾) | ✅ 改寫 |
| codex | 把「7075 鋁」套到六條線;官網 7075 敘述**只落在腳踏系統** | ✅ 改成只對腳踏系統講 7075 |
| codex | 拿 `#271` 當延期許可,而 `backlog:7856` 的觸發條件是「**第 3 個以上品牌**」⇒ 早就滿足 | ✅ 改寫成「`#271` 是一筆**已逾期的待辦**,不是許可」,並寫明本片不做的真正理由是範圍(鐵則 8) |
| codex | **`GillesShowcase.tsx` 沒進 `docs/design-storefront-manifest.yaml`**(鐵則 11 manifest sync) | ✅ 已補。🔴 順手量到 manifest 只列 **13** 支而磁碟有 **17** 支 ⇒ **另外 3 支(Kspeed / ExtremeComponents / Dna)也不在**,不是本片造成的,已在 manifest 內記下、留給各自的線補 |
| codex | 主閘只看「case 標籤在不在」⇒ **接到錯的元件、或 `return null`,它一樣綠** | ✅ 加 2 條接線斷言,並**突變實測**:接成 `<EbcShowcase />` ⇒ 紅;改 `return null` ⇒ 紅 |
| codex | 註解寫 dispatcher 載入「15 支」,當場數是 **16** | ✅ 改成不寫死支數 + 附可重跑的數法 |
| `-9e` | 五關裡有幾格在首灌情境**恆綠** | ✅ 已改寫證據段(見 §4) |
| `-9e` | 17/17 的分母要講清楚是 **config 鍵**(報價單 `suppliers` 表另有第 18 家 `scorpion`,active、view 零商品、無 config) | ✅ 已改成「登記表 18/18 區塊」並註明含 guard 靶 |
| `-9e` | `suppliers.gilles.origin` 在 **DB 裡也是「德國」** | ✅ 已併入 Q-Gilles-2(本窗複查確認) |

### B. 🔴 為什麼撤掉 Q-Gilles-3(而不是端給 Sean)

我原本要問「96 列沒有真圖,要不要擋」。**三步查完之後,這題不該問**:

1. **那 96 列的 `image_url` 不是空的**,是 `https://quote.pcmmotorsports.com/no-photo.png`。
   我把它抓下來**開圖看了**:是一張 **1000×750、PCM 品牌的「暫無照片」卡**(有 logo、有紅線、有 PCM MOTORSPORTS 字樣)。
   ⇒ 客人看到的是**一張設計過的佔位卡**,不是破圖、不是空白。
2. **顧客站不會再疊一層自己的佔位**:`rpm-transform.ts:323-325` 代表圖 = `image_url ?? images[0] ?? placeholder`
   ⇒ `image_url` 有值 ⇒ 走它。(這條是 `-9e` 指出的,我複查同意。)
3. **🔴 決定性的那一步:這件事早就是現況了。** 我對整支 view 分組數:

   | supplier | 列 | 無照片列 | 百分比 | 現在上架了嗎 |
   |---|---|---|---|---|
   | lightech | 8,788 | 726 | **8.3%** | ✅ `writeAllowed: true`,早就在架上 |
   | **gilles** | 1,817 | 96 | **5.3%** | 待首灌 |
   | dna | 798 | 24 | **3.0%** | ✅ 早就在架上 |

   ⇒ **gilles 的比例夾在兩家【已經上架的】供應商中間。**
   ⇒ 問他等於請他重新決定一件**已經被實作決定過兩次**的事;而「乙=擋掉」會讓 gilles 的標準
     跟 lightech / dna 不一致 —— 那是引入不一致,不是提高品質。

📌 判別句(這題教我的):**在把一個「要不要接受 X」的題目端給他之前,先量一次【X 現在已經發生幾次了】。**
已經在線上跑著的,不是決策題,是現況;把現況端成決策題,會讓他以為有個新問題要處理。

### C. 沒有第四輪
`code-reviewer` R1 與 `codex` R1 的 findings **零重疊**(前者打守門與字面,後者打對外文案的宣稱邊界與 manifest),
兩邊各自抓到真東西 ⇒ 照 `00-work-rules §5` 是「還在抓到真 finding」的狀態。
但**所有 must-fix 都已修完且逐條驗過**,且第三道(`-9e`)是不同角度、不同模型、已經跑完
⇒ 收工,不另開第四輪。
