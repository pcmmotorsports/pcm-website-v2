# 供應商商品上架顧客站 (storefront) — 通用 runbook + preflight 清單

> **為什麼有這份**:2026-07-24 一次上三家(K-SPEED / Extreme / Lightech)踩到一堆「上架單沒寫、
> 每次重新發現」的坑 —— pv_spec 撞鍵、v2 分類全落未分類、spec 空色選單、腳踏中文名翻錯、
> brand slug 拼法分岔。akrapovic 首灌 runbook 只顧「寫入那一步」,**上游前置**散落各 playbook。
> 這份把「把某供應商商品灌上 shop.pcmmotorsports.com」的**完整流程 + forget-proof preflight**收成單一入口。
>
> **邊界**:源頭資料清洗(fetcher / spec / 分類 / 圖 / 商品名)在**報價單庫 `dllwkkfanaebrsuyuedy` + 報價單 repo**;
> 匯入寫顧客站在**網站庫 `bmpnplmnldofgaohnaok` + pcm-website-v2 repo**。一次任務要講清楚誰跑最後匯入那步。
> 報價單側 19 個註冊點另見報價單 `docs/NEW_SUPPLIER_ONBOARDING.md`;本份專講「灌上顧客站」。
>
> 🔴 **本份不管品牌內容**:`/brands/[slug]` 品牌介紹頁本體(band/facts/about/highlights/craft 等)
> 是另一條線,見 `~/.claude/skills/pcm-brand-page/SKILL.md`。**兩份文件加起來也不保證涵蓋全部**——
> 商品頁「品牌形象區」(N°01/N°02,§6-b)2026-08-21 之前就同時掉在兩份文件的縫裡,兩邊都以為
> 是對方在管。新增品牌時,兩份都讀完仍建議對照一個做完整的品牌(如 AKRAPOVIČ)實際跑一次商品頁,
> 反查每一塊畫面是誰產出的,不要只信任文件把範圍講清楚(見 `~/pcm-mailbox/D-88-跨兩份文件總表-20260821.md`)。
>
> **維護**:每次上架新供應商、或發現新坑,回頭更新這份 + 底部「本批實例」。最近實查:2026-08-21。

---

## 🔴🔴 首灌【那一晚】要跑的兩行 —— 而它們在**另一個 repo**

> **放在這裡而不是檔尾,是刻意的**:它要在讀的人決定怎麼做**之前**就撞到。
> 一件寫得很好的東西,只要沒有一條路從「開工的第一件事」通到它,**它就等於不存在**。

```
路徑前綴（🔴 不在本 repo）  /Users/sean_1/API大量上架/PCM報價單-V2/
  docs/ops/新品牌上架SOP.md          ← Sean 首灌時照著跑的兩層流程檔
  scripts/onboarding_headcount.py    ← 首灌前後各跑一次，比對有沒有群／變體掉光

用法（零參數，貼兩行）：
  uv run python scripts/onboarding_headcount.py before      # 首灌【前】
  uv run python scripts/onboarding_headcount.py after       # 首灌【後】
```

**為什麼首灌那一晚特別危險 —— 兩道保護【同時】是空的**
```
· 文案鎖（manually_corrected / translation_locked）整批還沒有
  ⇒ 而源頭的 DELETE 正是靠這兩個欄位當保護欄
· 相對掉幅閘 prev = 0 ⇒ 天生不啟用
⇒ 曝險最大的那一晚，剛好是最沒有人熟悉的那一晚。
```

🔴🔴 **而它【防不住最該防的那一半】—— 這句寫在同一段,不要往下藏**
```
before 那一份裡【根本沒有正在進來的這一家】⇒ 它的群全部算新增
⇒ 掉了也比不出來。
⇒ ⇒ 這份保護的是【既有那 16 家】，不是【正在進來的那一家】。
```

⚠️ **上面每一句與下面的數字,來源都是【報價單線 `-b6`】,不是本 repo 量的。**

**三次首灌的實際數字(⛔ 2026-08-30 夜 `-b6` 自己推翻過一次,用下面這組)**
```
⛔ ~~extreme 4,984 列平均活 24.2 分 / gilles 3,638 列活 7.5 分 / dna 1,558 列活 54.5 分~~
   —— 那組把「刪除【次數】」讀成了「刪掉幾個商品」。
⛔ ~~實際是【同一批東西被反覆刪了又回來】:extreme 712 個×7 次 / gilles 1,817×2 / dna 781×2;
   而三家「刪了沒有回來的」都是 0~~
🔴🔴 **2026-08-30 夜 `-b6` 第二次更正:上面那一整組【也作廢】—— 它量在【已經被修掉的舊程式】上。**
```

🔴 **為什麼作廢**(`-b6` 自己開檔查的):
```
ba53294  2026-08-29  「硬刪改到 upsert 之後」
而那三個樣本 07-24 / 08-20 / 08-26 ⇒ **全部早於 08-29**
08-29 之前是 DELETE → UPSERT：每一輪先把整家未鎖列刪光再寫回去
⇒「每次都刪同樣那 712 個」不是【首灌】的特徵，那是舊順序對【每一家、每一晚】的行為
```
✅ **現行程式的實際觀察 = 零**:`product_hard_delete_audit` **11,646 筆全部 < 08-29,之後 0 筆**;
最後一次硬刪 **2026-08-28 20:22 UTC**。
⇒ 📌 **「首灌那晚會反覆硬刪」這個前提【現在沒有證據】—— 而反過來也沒有。它是【未知】。**
🛑 **⇒ 這一段不再是「已知的風險」,而是「一個【還沒有人看過現行程式】的空白」。**
⚠️ 而先前那句「刪除集中在 19:00–20:59 UTC」**也是舊碼的分佈** ⇒ **刪除量與頻率不得沿用**。

📌 **`-b6` 給的判別句,值得所有人帶走**:
> **我這個數字是在哪一顆 commit 上量的?**
> —— 稽核表**不會告訴你它記錄的是哪一版程式的行為**,而那兩版的行為差很多。
⛔ ~~📌 所以首灌那一晚的病不是「東西不見了」,是【它在同一晚被刪了又寫回來很多次】——
   淨效果 0,而過程中任何一個時間點去看,都可能看到一個少了東西的店。~~
🔴 **這個結論也一起作廢** —— 它整個建立在上面那組已作廢的數字上(那是舊順序對每一家每一晚的行為,
   不是首灌的特徵)。**原句留著不刪。**

✅ **而【前後各跑一次】這件事仍然要做,理由換一個、而且更單純**:
   `before` / `after` 兩份 headcount 是**目前唯一**能答出「這一晚有沒有東西掉光」的東西 ——
   🔴 而現行程式**還沒有任何人看過它在首灌那晚的行為**(硬刪稽核 08-29 之後 0 筆)
   ⇒ **那兩行現在的用途是【建立第一份觀察】,不是【驗證一個已知的風險】。**

---

## 0. 一句話流程

```
源頭資料就緒(§1 preflight 全綠)→ 網站 supplier-config 登記(§2)→ 乾跑五關全綠(§3)
→ Sean 批 → writeAllowed=true + 監控式首灌(§4)→ 寫後驗證(§5)
→ 商品頁品牌形象區(§6-b,🔴 這步不是填欄位,是新建一支檔案)→ 部署 main(§6)
```

**任一 preflight 沒過就別登記別乾跑** —— 乾跑會在該關 abort,白跑。先把源頭修好。

🔴 **這份清單的每一步都是「填某個欄位 / 跑某支腳本」的形狀 —— 唯一的例外是 §6-b。**
一個需要「新建一支檔案」的步驟,放進一份「填格子」的清單裡是隱形的:2026-08-21 DNA 空濾
首灌 787 件商品、以上每一步都做完了,商品頁卻缺「為什麼選 DNA」整段,因為 §6-b 當時根本
不存在於這份清單裡(見該節開頭的因果說明)。**下次盤點這份 runbook 還有沒有別的隱形缺格,
先問:哪一步的產出是「一支新檔案」,不是「一個填好的欄位」?那種步驟最容易被漏。**

🔴 **而 2026-09-03 找到【另一種】隱形缺格,形狀不同,要分開問**:
> **一道會過的檢查,而它問的不是我們以為的那個問題。**

§1 第 3 列原本問「有沒有不安全的 `http://`」,而**它答不出「有沒有圖」** —— `images IS NULL` 時 `NULL ILIKE` 回 NULL ⇒ 不進 `FILTER` ⇒ **那一列照樣印 0**。
⇒ 🎯 **抓到它的不是那道檢查, 是【總數對不上】**:60,299 列裡 `price` / `分類` / `中文名` 三項都是 60,299,
而含 `https://` 的只有 **59,288** ⇒ **差 1,011 列**。
⇒ 🛑 **而正對照在這一格【也印 0】**(全 20 家跑同一把尺 ⇒ 全 0)⇒ 它證不了任何事。
⇒ ✅ **解法是換一個軸:不問「有幾個壞的」, 問「該有值的有幾列」** —— 因為後者有一個**獨立算得出來的期望值(總列數)**, 而它會自己打自己的臉。
⇒ 🟢 而 §1 第 4 列(`COUNT(*) FILTER (… IS NOT NULL)` = 總數)**本來就是這個形狀** —— 📌 **正確的樣板就在同一張表的下一列。**
⇒ 🔵 逐列掃過的結果:**第 2 列安全**(它明寫 `IS NULL`)· **第 3 列有洞** · **第 4 列免疫**。
🔴 **而第 3 列我修了三次, 前兩次都沒修對 —— 那一格本身就是這一節在講的病**:
> 我把 `ILIKE` 換成 `coalesce(...)` 並補了 `images IS NULL`, **而它仍然只讀 `images` 一欄** ⇒ 那把尺答的是
> 「`images` 欄空不空」, 不是「這件商品有沒有圖」—— 🎯 **換了寫法, 沒換問題。**
> ⇒ 而它比原版更危險:原版靜靜印 0(漏報), 我那版會把 **1,011 列有圖的商品報成沒圖**(誤報),
> ⇒ ⇒ 🛑 **而誤報會讓人去關掉這道閘。**
> ⇒ 📌 **判別句(三訂後改寫)**:我這道檢查在問「**這個欄位有沒有被填**」, 還是「**裡面那個東西是不是真的**」?
> ⇒ 🎯 **三次我問的都是前者** —— ①`NULL ILIKE` 回 NULL(問有沒有壞值)②只讀 `images` 一欄(問這欄空不空)③`image_url` 非 NULL(問這欄有沒有值)。
> ⇒ 🛑 **每一次我都換了寫法、沒換問題, 而三次都自認為修好了。**
> ⇒ 🔵 **抓到第三次的不是任何一道閘, 是我手癢 `SELECT` 了十二列出來【看】** —— 而看到的第一眼就是 `no-photo.png`。
> ⇒ ✅ **⇒ 可機械化的替代品是 `COUNT(DISTINCT …)`**:它問的是「這些值彼此不同嗎」, 而**假資料最常見的形狀就是全部一樣**。

🔴🔴 **而 2026-09-03 夜(線【帳號】接 L4 時)量到【第三種】—— 它比前兩種都寬, 而第 4 列擋不住它**:
> **整份 preflight 掛在同一個 `WHERE supplier_slug='<slug>'` 上 —— slug 打錯 ⇒ 母體 0 列 ⇒ 每一列都印 0 ⇒ 全部過。**

```
🔬 兩個世界並排實測(同一發 SQL, UNION ALL):
   打錯的 slug  總列數 0 · 第2列 0 · 第3列 0 · 第3列補 0 · 第4列 0 · 第6列 0  ⇒ 逐格【全部符合期望】
   真的 wrs     總列數 1082 · 第2列 0 · 第3列 0 · 第3列補 37 · 第4列 1082 · 第6列 544
```
🛑 **⇒ 而第 4 列在這一種底下【也過】** —— 它的期望值是「`= 總數`」, 而空母體時 **0 = 0**。
🎯 **⇒ 所以「第 4 列是正確樣板」這句話只對【上一種】成立** —— 📌 **一個免疫於某種失效模式的檢查, 不會因此免疫於另一種;而它讀起來一樣安全。**
⇒ 🔵 **它與前兩種的差別**:前兩種是**一格**壞掉, 這一種是**整張表的分母**壞掉 ⇒ **沒有任何一列會不一致** ⇒ 🔴 **連「總數對不上」那個抓到上一種的訊號都消失了。**
⇒ ✅ **修法 = 上表新增的第 0 列**(先證明分母 > 0 且 slug 在名單裡)。
⇒ 📌 **而這個修法不是新發明的** —— 報價單 repo 的 `fetchers`…`scripts/variant_contract_scan.py` **2026-08-25 就寫過同一道閘**(`check_population`), 它的 docstring 逐字寫著:
> 「撈空/撈殘時 exit 1 且不印合計行, 否則『掃描壞掉』會跟『全站乾淨』印出同一句話」
🛑 **⇒ 正解在隔壁 repo 躺了 9 天, 而這份 runbook 沒有接到它。** 📌 **⇒ 下次發現一個坑, 先問「別人是不是已經修過同型的」, 再問「怎麼修」。**

---

## 1. ★ Preflight 清單(源頭資料就緒;每列漏掉 = 乾跑 abort 或上架後出包)

> 全部對**報價單庫 `dllwkkfanaebrsuyuedy` 的 `storefront_catalog_v`**(view 混多供應商、`WHERE supplier_slug='<slug>'`)。
> ⚠️ 來源 `supplier_slug`(如 `kspeed`)可能 ≠ 網站 `brands.slug`(如 `k-speed`),兩邊都要對。

| # | 檢查 | 怎麼查(MCP execute_sql,除非註明) | 期望 | 沒過怎麼修 |
|---|---|---|---|---|
| **0** | 🔴🔴 **分母不是 0**(先跑, 不然底下每一列都會過) | `SELECT count(*) FROM storefront_catalog_v WHERE supplier_slug='<slug>'` —— **再對一次** `SELECT DISTINCT supplier_slug FROM storefront_catalog_v` 確認拼法在名單裡 | **> 0**, 且與 §1-6 的指紋同一個數 | slug 拼錯 / 源頭還沒灌 → **停**。⚠️ 不要往下跑:下面每一列在空母體上**全部印 0 = 全部過** |
| 1 | **品牌列存在**(網站庫) | `SELECT slug FROM brands WHERE slug='<brandSlug>'` | 1 列 | 缺 → seed migration `INSERT INTO brands ... ON CONFLICT (slug) DO NOTHING`,MCP `apply_migration` 或 Sean db push。**先確定 brandSlug 拼法**(§2 註) |
| 2 | **價格四價齊**(源頭) | `COUNT(*) FILTER (WHERE price_retail IS NULL OR price_retail=0)` | 0 | 有 pricing_rules 的家跑完 fetcher 必接 報價單 repo:`uv run python scripts/recompute_supplier.py <slug>`(重跑 fetcher 會清空四價,見 [[feedback_fetcher_rerun_wipes_computed_prices]]) |
| 3 | **圖片協定 = https** | ⛔ ~~`COUNT(*) FILTER (WHERE images::text ILIKE '%http://%')`~~ ⇒ 🔴 **那一版在 `images IS NULL` 時靜靜放行**(`NULL ILIKE …` 回 **NULL** 不是 FALSE ⇒ 不進 FILTER)。✅ 改用 `COUNT(*) FILTER (WHERE coalesce(images::text,'') ILIKE '%http://%')` **再加一格** **兩格一起看**:`COUNT(*) FILTER (WHERE images IS NULL)` 與 `COUNT(DISTINCT image_url) FILTER (WHERE images IS NULL)`。🔴 **不設件數門檻** —— 理由見下方(N≥5 會漏掉 rizoma 3 件, 而那正是上架中的一家)。🔴 **2026-09-03 這一列我改了三次, 前兩次都錯 —— 而三次錯的是同一件事。**⛔ ~~二訂版:「那 40 列 image_url 都有值 ⇒ 它們有圖」~~ **也是錯的。**🔬 三訂實查:那 1,011 列**在 `FILTER (WHERE images IS NULL)` 這個子集裡**逐家 `COUNT(DISTINCT image_url)` = **1**(⚠️ 射程:不是「整家所有列共用一個網址」), 而網址逐字是 `no-photo.png` / `noimage.jpg` / `no-image-2048-….gif` ⇒ 🛑 **那是供應商站的「查無圖片」佔位圖, 不是商品圖。**⇒ 🎯 **⇒ 那 1,011 列【全部】沒有真圖(含 wrs 37/37 · rizoma 3/3), 而不是 10 列。**⇒ 🔴 **判準**:`COUNT(DISTINCT image_url)=1` —— **80 件不同商品不可能共用一張照片。**⇒ 🛑 **不要維護佔位圖檔名黑名單**(no-photo / noimage / no-image 已經三種寫法)—— 黑名單在跟下一家的下一種寫法賽跑;`DISTINCT=1` 不需要知道它叫什麼。⇒ 🔵 **怎麼讀這兩格**:`images IS NULL` 本身就是異常子集 ⇒ **只要 > 0 就停下來看**;`DISTINCT` 那格說是**哪一種** —— **= 1 ⇒ 整家共用一個網址 ⇒ 佔位圖**;> 1 ⇒ 另一種, 開檔看。

🔴 **而【不要】加件數門檻 —— 這是量出來的**:
> 主視窗提過 `DISTINCT=1 AND 列數 ≥ 5`(理由:2 件共用一張可能是真的、80 件不可能)。**理由成立, 而它在真實資料上漏接。**
> 🔬 實測該門檻對 **motogadget 4 件**與 🔴 **rizoma 3 件**不叫 —— 而 **rizoma 正是這次要上架的三家之一**。
> ⇒ 🎯 **一個理由完全成立的門檻, 剛好漏在我們最在意的那一家底下。**
> ⇒ 📌 它的前提是「小群共用一張圖可能是真的」—— **而我們已經先篩了 `images IS NULL`** ⇒ **前提在這個子集裡不適用。**

🔵 **兩把尺盲區互補, 所以都留**:
> · 黑名單(`no-photo`/`noimage`/`no-image`)⇒ 🟢 今天抓 **1,001 / 1,011**(🔴 **不是 1,011** —— 另外 10 列 `image_url` 是 NULL, 黑名單接不到, 靠 `image_url IS NULL` 那半接);🔴 **會被下一種寫法穿過**(已三種)
> · `DISTINCT = 1` ⇒ 🟢 **不需知道檔名、不會過期**;🔴 **家數少時訊號弱**(rizoma 3 / motogadget 4)
> ⇒ 🛑 **兩把都不完整, 而漏的東西不同 ⇒ 缺一不可。**

🛑 **這一片的判準一句話:空圖庫比假圖庫好** —— 「補回第一張圖」在這裡實際上是**製造一批假的圖**;故 `rpm-transform.ts` 的 `ownVariantImages` **刻意不做 image_url fallback**(檔頭有完整理由與量測, 並有一格測試釘住)。
🔵 **而 rpm 那 10 列(兩欄都空)是【另一件事】, 分開記**:連佔位圖都沒有, 由黑名單那格的 `image_url IS NULL` 接住(rpm 37 = 27 佔位 + 10 全空 ⇒ 兩格數字對得起來) | **三格各有各的期望, 不是「都 0」**:<br>①`http://` ⇒ **0**(硬性)<br>②`images IS NULL` 的**列數** ⇒ **記下來, 不是 0**(9 家現役全都不是 0)<br>③`COUNT(DISTINCT image_url)` ⇒ **不可能是 0**;**= 1 ⇒ 佔位圖**(去做④)· **> 1 ⇒ 開檔看** | **①http 外部網域** = mixed content 破圖 → 源頭轉存 Cloudflare R2、DB 存乾淨 https(Lightech 前例);新 host 另加網站 image-hosts 白名單 + middleware。<br>🔴 **②③ 命中(這家有一批沒有真照片)的出路 —— 沒有這一段的話這道閘會死於誤報**:<br>· **先分辨是哪一種卡**(2026-09-03 量, 1,011 列拆四種):`quote.pcmmotorsports.com/no-photo.png` = 🟢 **PCM 自己的卡**(882 列, 我們自己的網域, 卡面已有「暫無照片」)⇒ **可以上架, 不必擋**;供應商自己的 no-image(119 列)⇒ 🔴 **外連他家伺服器** ⇒ 要進 `SUPPLIER_PLACEHOLDERS`;`image_url` 也是 NULL(10 列)⇒ 連卡都沒有。<br>· **既有落點**(不要做第二份清單):`packages/domain/src/catalog/supplier-placeholder.ts` 的 `SUPPLIER_PLACEHOLDERS`(host + 檔名前綴);負對照測試 `apps/storefront/src/lib/catalog-page.test.ts:154-157`「PCM 自己的卡【不得】被濾掉」。<br>· **數量大到不像正常**(如 lightech 726)⇒ 🛑 **停下來問 Sean 要不要上這批**, 不要自己決定。 |
| 3 | **變體規格軸不撞鍵(pv_spec)** | 報價單 repo:`uv run python scripts/variant_contract_scan.py`(看該家 `違規=0`) | `違規=0`(incomplete_spec / mergeable_duplicate 皆 0) | ①同群多變體 spec 全空/含 null → 源頭 fetcher 補「區分變體的軸」進 `raw_jsonb["spec"]`(ebc 材質軸 / Extreme 打檔·版本·顏色·快排;`{"英文key":"中文值"}`,fail-loud 不靜默 null)。②只有一軸卻含 null 值(如 `{"color":null}`)→ fetcher 改**條件式**寫該鍵(值空就不寫)。**products.spec 是 `raw_jsonb->'spec'` 的 GENERATED 欄、view 直投,改完 raw_jsonb re-sync 即生效,免 refresh** |
| 4 | **v2 分類回填**(否則全落未分類) | `COUNT(*) FILTER (WHERE major_category_v2_zh IS NOT NULL)` = 總數 | = 總數 | 新供應商 v2 恆 NULL → ①先有 `category_taxonomy_map` seed(該家 `products.category` → v2 大類·子類 pair;akrapovic/extreme 前例)②報價單 repo 跑 `uv run python scripts/taxonomy_v2_recompute.py`(先 dry-run 看「搬動既有分類 0 列」確認只補空、不動別家)`--apply`。**這是純分類寫入、不碰價格** |
| 5 | **商品名定案** | 抽查 `product_name / product_name_zh` | 不帶車款(akrapovic 拍板);變體描述若入名須與英文原文一致 | 中文名翻錯(如英文 reverse 卻寫正打)→ 由官方英文重生、patch 源頭 fixture + DB。用 targeted SQL 改 `product_name_zh`(勿重跑 fetcher = 洗四價) |
| 6 | **群數/變體指紋** | `COUNT(DISTINCT main_sku)` 群、`COUNT(*)` 變體 | 記下數字 = §3/§4 的 `--expect-groups` | — |

> **改源頭資料的鐵律**:能 targeted SQL(只補 NULL / 移除 null 鍵)就別重跑整支 fetcher —— 重跑 = delete-then-upsert
> 會清空台幣四價 + 換 row id(見 [[feedback_fetcher_rerun_wipes_computed_prices]])。同時把修法寫回 fetcher code(耐下次排程重抓)。

---

## 2. 網站側登記 `scripts/supplier-config.ts`

在 `SUPPLIER_CONFIGS` 加一組(照 akrapovic / 本批三家的格式):

- `supplierSlug`:來源 view 的 `supplier_slug`(fetch scope)。
- `brandSlug`:**網站 `brands.slug`,🔴 可能 ≠ supplierSlug**(kspeed→`k-speed`、rpm→`rpm-carbon`、eazigrip→`eazi-grip`)。MCP 實查 brands 表、勿憑記憶。
- `handlePrefix`:handle = `${prefix}-${mainSku.toLowerCase()}`。
- `syncDescription`:來源有繁中描述就 true。
- `syncInstallResources`:⛔ ~~有 pdf/video 來源才 true(靜態無附件 = false)~~ ⇒ 🔴 **那句話與既有設定不符**
  (2026-09-03 線【帳號】拿它去預測既有 17 家:**對 12 · 錯 5**,`eazigrip` / `samco` / `motogadget` /
  `front3d` / `materya` 都是 **`true` 而附件 0 列**)。✅ **實際的規律是【不對稱】的**:
  **設 `false` 的 4 家(`rpm`/`extreme`/`dna`/`gilles`)附件【全部是 0】—— 這一側零例外。**
  🎯 **⇒ 因為兩種錯的代價不一樣**:`true` 而沒東西 = 同步 0 筆(無害);`false` 而有東西 = **真的漏掉那些 pdf**。
  ⇒ ✅ **填法:預設 `true`;只有在【實測附件 = 0】時才可以填 `false`(而填 `true` 也照樣對)。**
- `categoryStrategy`:多數 `{ kind: 'per-group' }`。
- `variantImages`:多變體家 = `'per-variant'`。
- `writeAllowed`:**先 `false`**(fail-closed、過夜零寫入),乾跑全綠 + Sean 批首灌後才翻 `true`。

---

## 3. 乾跑五關(讀取無寫入)

```bash
cd /Users/sean_1/pcm-website-v2
pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=<slug> --expect-groups=<§1-6 記下的群數>
```

🔴🔴 **`--expect-groups` 不是選配 —— 而在 2026-09-03 之前這一行【沒有它】**(線【帳號】接 L4 時量到):
```
§1-6 逐字:「記下數字 = §3/§4 的 --expect-groups」
§4 首灌指令:帶了 ✅
🔴 §3 乾跑指令:【沒帶】 ⇒ 那個被叫去記下來的數字, 只在最後一關才真的被用到
⇒ 🛑 而乾跑正是「在寫之前抓問題」的那一關 —— 它沒有帶那把尺
```
🎯 **⇒ 為什麼要緊:M2 群數指紋是這條線上【唯一】能抓「來源被截斷 / 來源是空的」的東西。**
`rpm-preflight.ts` 的 docstring 自己講得最清楚(逐字):
> 「W1 抓取完整性 gate 的結構性盲區:它比的是『target 現存上架 − 本次 source』的差集,
>  **首灌(target active=0)分母為 0 → shrinkRatio 恆 0 → 恆過**。此時來源只抓到 500/648 也照灌」

🔵 **而 §3 對【slug 打錯】這一種是【免疫】的 —— 而它免疫的理由不在乾跑裡**:
```
§1 的 slug = 手打進 SQL 的字串        ⇒ 打錯 = 空母體 = 每一格都印 0 = 全部過(§1 第 0 列在擋)
§3 的 slug 要先過 getSupplierConfig  ⇒ 打錯 = throw(逐字「未登記 → throw…寧可整條 abort,
                                       不讓錯 slug 靜默套到別家 scope」)⇒ 走不到任何一關
```
📌 **⇒ 同一個病, 兩種結局 —— 差別是【那個名字有沒有經過一份白名單】。**
🛑 **⇒ 所以 §3 剩下的曝險是「slug 對, 而來源真的空/殘」**(fetcher 沒跑完、來源被截斷)——
而那時 `分群 0 群` 之後每一關都會印 `0` / `✅`:分類 `0 群未對上` · handle `✅ 0 群全部合法且唯一` ·
`pv_spec 撞鍵 0` · `新品驗價 0 筆問題` ⇒ **一份全綠的乾跑報告。**
⇒ ✅ **帶了 `--expect-groups` 就會印 `🔴 ALERT 群數指紋…來源 0 群 ≠ 預期 N 群`**
　(⚠️ **乾跑只印不 throw** —— `rpm-import.ts:226` 是 `if (!DRY_RUN && …)` ⇒ **看畫面, 別看 `rc`**, 見 3-a)。

### 3-a 🔴 乾跑的 `rc=0` **不是**「關卡過了」的證據 —— 這一步只能看畫面,不能看退出碼

匯入腳本的 gate 帶 `isWrite: !DRY_RUN`(行號會漂,當場查:`grep -n "isWrite: !DRY_RUN" scripts/rpm-import.ts`)
⇒ **乾跑模式下 gate 只「報告」、不 throw。**

2026-08-27 gilles 上架線兩發實測(同一支指令、只改期望值):

| 餵什麼 | 畫面印 | `rc` |
|---|---|---|
| `--expect-groups=9999`(一定錯) | `🔴 ALERT 群數指紋 abort、不寫:…來源 1545 群 ≠ 預期 9999 群` | **0** |
| `--expect-groups=<當下真值>` | `✅` | **0** |

⇒ **兩個世界印同一個 `rc`** ⇒ `rc` 對這道閘**零判別力**(不是推的,是兩發比出來的)。
⇒ 🔴 **不要把乾跑串進 `&&` 鏈、也不要拿它當 CI 守門** —— 它在那裡恆綠。

重跑法(下一家上架時照跑):
```bash
pnpm exec tsx scripts/rpm-import.ts --dry-run --supplier=<slug> --expect-groups=9999 > /tmp/neg.log 2>&1 ; RC=$?
echo "rc=$RC" ; grep -n "ALERT" /tmp/neg.log | head -3
```

### 3-b 🔴 哪幾關**真的**在檢查東西 —— 首灌與日常**不一樣**

首灌時 target 現存商品 = 0 ⇒ **凡是拿「現況」當對照的格子都沒有分母**。

⚠️ 標題保留「五關」原字面(全 repo 多處引用,當場數:`bash scripts/literal-sweep.sh '乾跑五關'`),
而下表 **7 列** —— 末兩列是 2026-08-27 補的。🔴 **改標題會打斷那些引用,所以留字面、在這裡標差異。**

| 關 | 期望輸出 | 首灌(target = 0) | 日常(target 已有貨) |
|---|---|---|---|
| 群數 | `分群 N 群`(= §1-6 指紋) | ⚠️ **不是閘**、只印數字 | ⚠️ 同左 |
| 分類對上 | `已對上: N 群 / 未對上: 0 群` + `null-v2 0 群→未分類` | ✅ 有判別力 | ✅ |
| handle preflight | `✅ N 群 handle 全部合法且唯一` | ⚠️ **半有效** —— 批內那半有效,對 target 那半無分母 | ✅ |
| pv_spec preflight | `✅ pv_spec_unique preflight 撞鍵 0` | ⚠️ **半有效**(同上) | ✅ |
| 價格 delta | `🔴異常 0 / ⚠️離群 0` | ❌ **恆綠** —— 沒有舊價可比 | ✅ |
| 來源消失對賬 | `待標記 0` | ❌ **恆綠** —— target 上架 0 筆 | ✅ |
| **新品驗價 M1** | `新品驗價 0 筆問題` | ✅ **首灌最有力的一格** | ✅ |

⇒ **首灌時真正有判別力的是四格**:分類對上 / handle 批內唯一 / pv_spec 批內撞鍵 0 / 新品驗價 M1。

📌 **而 M1 那一格原本不在這張表上**,它是硬 gate(`grep -n "硬 gate:新品驗價" scripts/rpm-import.ts`),
存在理由逐字寫在碼裡:「**delta gate 只比得出「變價」,新品無舊價可比 → 首灌整批零檢查**」。
🔴 **寫這支碼的人早就知道首灌有個洞(`grep -n "首灌 target active=0 時 W1 恆過" scripts/rpm-import.ts`),
而這張表沒有把那件事傳下來** —— 表寫「五關全綠」,讀的人就當五關都量過了。

⚠️ **證據等級**:3-a 兩發都可重跑;**3-b 的「恆綠」欄對 gilles 已經重跑不出來了**
(灌完 target 有 1,545 件、那個世界消失了)⇒ 要再觀察一次只能拿**下一家 target = 0 的供應商**跑。
📌 一個只在某個狀態下成立的量測,那個狀態消失之後,它就從「可重跑」降級成「歷史紀錄」。

任一不對就停、回 §1 修源頭。

---

## 4. 監控式首灌(全程盯著、不交排程)

Sean 對「這次首灌」明確點頭後,`writeAllowed` 翻 `true`、commit,然後:

```bash
cd /Users/sean_1/pcm-website-v2
pnpm exec tsx scripts/rpm-import.ts --confirm-write --supplier=<slug> --expect-groups=N 2>&1 | tee /tmp/<slug>-first-load.log
```

- 🔴 不帶任何 `--allow-*` bypass;撞閘 = 真有事。
- 看到 `[rpm-import] WRITE 完成:N 商品 / M 變體` 才算完。
- 中途斷 / upsert 報錯 → 走 akrapovic runbook 的補償程序(`docs/runbooks/2026-07-19-akrapovic-first-load-runbook.md` §4:先關 writeAllowed → 軟下架 → 最後才硬刪)。

---

## 5. 寫後驗證(網站庫)

```sql
SELECT b.slug, COUNT(DISTINCT p.id) products, COUNT(v.id) variants,
  COUNT(DISTINCT p.id) FILTER (WHERE p.category_id=(SELECT id FROM categories WHERE raw_path='未分類')) uncategorized
FROM brands b JOIN products p ON p.brand_id=b.id
LEFT JOIN product_variants v ON v.product_id=p.id
WHERE b.slug='<brandSlug>' GROUP BY b.slug;
```

期望:products/variants = 指紋、**uncategorized = 0**。

---

## 6-b. 🔴 商品頁品牌形象區(這步不是填欄位,是新建一支檔案 —— 最容易被漏的一步)

**為什麼會漏(2026-08-21 DNA 空濾首灌後 Sean 親自發現、I 窗盤點因果)**:

```
apps/storefront/src/components/BrandShowcase.tsx 是商品頁「品牌形象區」dispatcher,
掛在規格分頁(Tabs)之下、相關商品之上。switch (product.brandSlug) 依品牌分派到
各家專屬的 <Brand>Showcase.tsx 元件;沒有對應 case 的品牌 → default: return null
→ 那整段(N°01「為什麼選 XX」+ N°02)完全不渲染,不是空白區塊、是整段不存在。

🔴 這塊【不是資料驅動的】:每家是一支獨立 .tsx 檔,文案寫死在元件裡,
   不吃 props、不讀 brand-content.ts(那是 /brands/[slug] 品牌介紹頁用的,完全是另一套系統)。
⇒ 它不是「一個要填的欄位」,是「一支要新建的檔案」,而本 runbook 之前每一步都是
  「填格子 / 跑腳本」的形狀 —— 一個需要新建檔案的步驟,在這種清單裡是隱形的。
```

**要填的欄位清單(給下一個上架的人,依 `EbcShowcase.tsx` 骨架的精簡版模板)**:

```
檔案:新建 apps/storefront/src/components/<Brand>Showcase.tsx,
     並在 BrandShowcase.tsx 的 switch 裡加一個 case(15 支既有元件可抄骨架)。
資料契約:純 presentational,不吃任何 props、不讀 brand-content.ts。

N°01 區塊(固定,15/15 現有品牌無例外,`grep -c 'pd-feature-card"' <檔>` 全部恰為 3):
  · eyebrow:編號 "01" + 品牌 logo 圖(需要 /brands/<slug>/logo.png|svg,深色場版本)
  · h2 標題:固定句式「為什麼選 <品牌名>」
  · lead:一句話,35–50 字
  · 三張卡(固定 3 張,不可多不可少):每張 title(10–15 字)+ desc(40–70 字)

N°02 區塊(精簡版最低配置,依品牌規模可加重,見既有 15 支分「重量版/精簡版」兩級):
  · eyebrow:編號 "02" + 短標籤(4 字內)
  · h2 自訂標題:15–20 字 / lead:一句話,35–50 字
  · 信任狀 4 格:各 n(短碼)/ l(4–6 字)/ s(8–12 字)
  · 1–2 段故事交錯:各配一張 16:9 圖 + step 標籤(英文·中文)+ h3(~8 字)+ p(40–70 字)
  · 可選:品牌影片 facade(YouTube ID,無則不做)
  · 產品線橫捲:2–4 卡,各配圖 + en 標題 + zh 標題 + desc(20–40 字)

圖片需求(最低配置):logo 1 + 故事段 1–2 張(16:9)+ 產品線卡 2–4 張 = 至少 4–7 張新圖。
🔴 不能沿用 /brands/[slug] 品牌介紹頁用的圖 —— 那些多半不是 16:9,直接裁會裁壞版面,
   要實際跑一次裁切預覽比對,不要用算的判斷夠不夠用。
```

**機制(不只是文字提醒;測試 `apps/storefront/src/components/brand-showcase-coverage.test.ts`,2026-08-21 D 窗建)**:

```
斷言:SUPPLIER_CONFIGS 裡每一家 writeAllowed=true(= 已開放寫入 prod、商品頁客人點得到)
     的 brandSlug,BrandShowcase.tsx 都要有對應的 case。缺一家就紅,訊息附品牌名 + 修法。

🔴 分母刻意不是「brand-content.ts 有這家品牌」——brand-content.ts 有 21 家,而其中數家
   從未在 supplier-config.ts 登記過、網站庫商品數 = 0,沒有商品頁可看,
   現在就要求它們有 showcase 是「一裝就紅」的假警報。
   ⚠️ ~~原字面列了「5 家(dbk/gilles/kineo/rizoma/wrs)」~~ **2026-08-27 作廢**:
   gilles 當天登記進 supplier-config.ts ⇒ 那句話從那一刻起是假的。
   🔴 **這裡刻意不再寫死名單** —— 名單會隨每次上架過期,而過期時零機械訊號;
   要現值就當場跑 `Object.values(SUPPLIER_CONFIGS).map(c => c.brandSlug)` 跟 brand-content.ts 比。
   閘綁在 writeAllowed(= 上架流程自己已有的開關)上,紅格數與「客人看得到的缺口」一一對應。

⇒ 這道閘同時解決兩件事:①下次任何一家 writeAllowed 翻 true 而沒補 showcase,
  三綠會直接紅、不必等 Sean 自己點開商品頁才發現;②它把「有沒有商品頁品牌形象區」
  這件事跟「有沒有開放寫入」綁在同一個訊號上,不再是兩條互相看不見對方的線。
```

⚠️ **當這份 runbook 寫下這句話時,這道閘本身還是紅的**:DNA 已 `writeAllowed: true`
但還沒有 `DnaShowcase.tsx`,測試會正確地報 `missing: ['dna']`。**這是預期行為,不是閘壞了**——
補上 DNA 的 showcase 元件(內容需要 Sean 拍板 eyebrow 短標題、產品線圖等,見
`~/pcm-mailbox/I-b9-DNA商品頁品牌形象區-盤點-20260821.md`)之後,這道閘會自己轉綠。

---

## 6. 部署(讓程式端變更生效)

商品是**資料寫入 → 即時 live**(客人立刻看得到商品/價/圖)。但若這次動了**網站程式**(如變體維標籤
`ProductInfo.tsx`、image-hosts 白名單),要**部署**才生效:

- 顧客站 = Vercel project `pcm-website-v2`,**production 從 `main` 部署**(domain `shop.pcmmotorsports.com`)。
- 開發在 `dev`;上線 = `git push origin dev` 後 `git push origin dev:main`(fast-forward)→ 觸發 production 部署。
- 🔴 push main = 直接上線(見 [[feedback_push_to_main_means_deploy]]);要 Sean 明確批。部署後 MCP `get_deployment` 確認 `readyState: READY`。
- **車種篩選下拉**有 1 小時 `unstable_cache`,新車款最多 1 小時才進下拉;商品頁/列表即時(見 [[reference_quote_filter_dropdown_1h_cache]])。

---

## 7. 本批實例(2026-07-24,三家各踩的坑)

| 家 | brandSlug | 量 | 這家卡在哪 |
|---|---|---|---|
| **K-SPEED** | `k-speed`(≠ `kspeed`) | 960 群/989 變體 | 只缺品牌列(db push);資料本乾淨、v2 齊、圖 GCS https。圖是 `[{"url":...}]` 物件陣列,匯入端自動正規化為字串陣列(非坑) |
| **Extreme** | `extreme` | 664 群/712 變體 | ①17 群腳踏變體 spec 全空 → 補打檔/版本/顏色/快排四軸(撞鍵 48→0)②v2 全 NULL → taxonomy_v2_recompute 回填 712(對照表本就在)③5 筆腳踏中文名英中錯置 → 由英文重生。靜態 fixture、無 pdf/video |
| **Lightech** | `lightech` | 4566 群/8788 變體 | ①12k 圖 http → 已轉 R2 ②spec 無條件寫 `{"color":null}` → 39 群 incomplete_spec + 空色選單 → fetcher 改條件式 + 清庫存 3054 筆 null color |

> 共通教訓:**「上架三家」= 三種不同的病**。每家先跑 §1 preflight 六關把病照出來,別假設「別家能上這家就能上」。
