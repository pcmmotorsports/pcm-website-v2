# 商品欄位歸屬盤點 —— 現在每一欄是誰在寫

> **這是盤點,不是設計。** 零 code 改動、零 migration、沒有建議「該歸誰」。
> **用途**:`Q-P-4`(哪些欄位歸人、哪些歸同步)掛在 Sean 桌上,而**沒有人給過他一張現況表**。
> 主視窗 2026-08-15 裁:先做完這張表,再拿去問他。**這張表就是那題的問題本體。**
> **快照日期 2026-08-15;`#20` 片2(a/b/c)已上線、`20260815030000` 已 apply 之後的狀態。**

---

## §0 量法(可重跑;先寫下來,免得下面的數字被當成憑印象)

```
同步寫哪些欄 = scripts/rpm-transform.ts 的 ProductRow / VariantRow 介面欄位
              （那兩個介面就是 upsert payload 的形狀 → rpm-import.ts:518 送出）
無條件 vs 條件式 = 介面上有沒有 `?`
              （`?` = optional = 可能「省 key」⇒ ON CONFLICT 不覆寫該欄 ⇒ 保留現值）
誰還在寫     = grep -rn "<欄名>:" --include='*.ts' --include='*.sql' .
              | grep -v node_modules | grep -v '\.test\.' | grep -v database.types.ts | grep -v '^\./docs'
              🔴 然後【逐筆開檔判讀寫】—— 命中數不等於寫入數
```

**🔴 「無條件」那 15 欄是怎麼判的(寫清楚,免得下一個人得回頭問)**:
**不是**「找不到條件式的 pattern」(那是零命中推論),**是**兩步觀測:
1. **型別層**:介面欄位**沒有 `?`** ⇒ TypeScript 強制 `transformGroup` 每次都得給值 ⇒ **必進 payload**。
   (這是編譯期保證,不是我掃出來的統計。)
2. **載入層**:transform 之後還有沒有人把 key 拿掉?**實查 `stripColumnIfMissing` 的呼叫點只有一處**
   —— `rpm-import.ts:515`,**且只剝 `sound_clips`**(而它本來就在條件式那組)。
   ⇒ **15 個無條件欄在載入層沒有任何一個會被剝掉。**

🔴 **第三條是重點**:`delisted_at` 那個 pattern 命中 2 筆,**逐筆開檔後兩筆都是「宣告型別」與「註解」,零筆是寫入**。
**只看數字會得到相反結論。**

> ### 🔴 「命中 ≠ 事實」有兩個方向,而第二個更容易鬆懈
> **方向一(常防的)**:**零命中被讀成「不存在」** —— 可能只是 pattern 沒對上、範圍掃錯。
> **方向二(這次踩到的)**:**有命中被讀成「存在」** —— 而命中的其實是型別宣告、註解、docs。
> ⚠️ **第二個方向更危險,因為有數字撐著,看起來像有證據** ——
> 「命中 2 筆」讀起來比「命中 0 筆」可信得多,而它可以完全是假的。
> **⇒ 兩個方向都要逐筆開檔。** 本表三個「沒人寫」的欄全部逐筆判過讀寫。
> (主視窗 2026-08-15 指出這是新方向,落檔於此。)

---

## §1 `products` 逐欄(25 欄)

**同步「無條件寫」= 每天每一列都覆寫,員工改了明天就沒了。**

### 🔴 「條件式」不是一格,裡面有三種強度(關卡 must-fix,2026-08-15)

**v1 我把五個條件式欄寫成「同上機制」** —— **那是錯的,它們是三種不同的機制**:

| 保護強度 | 欄位 | 機制 | 員工改了會不會被蓋 |
|---|---|---|---|
| **強(兩層)** | `manuals` / `video_url` / `sound_clips` | 供應商級 `syncInstallResources` **+** per-row 來源 null 防清空 | 兩層任一擋住就不會 |
| **強(兩層)** | `description` | 供應商級 `syncDescription` **+** per-row 來源空白省 key | 同上 |
| 🔴 **弱(只有一層)** | **`highlights`** | **只有供應商級 `syncDescription`,all-or-nothing** | 🔴 **該供應商開著 ⇒ 每天照蓋,沒有逐列保護** |

🔴 **`highlights` 看起來被保護,實際上只看一個供應商級開關。**
⚠️ **Sean 決定「新欄位歸誰」時,若照 v1 那張表會以為這三欄一樣安全。**
⚠️ **而 `rpm-transform.ts:184-185` 逐字寫著「原註『供應商級 all-or-nothing、天然 uniform』**已作廢**」——
**我 v1 抄到的正是被作廢那半的形狀。**(引用一個檔時,要看它有沒有自己標過「舊說法作廢」。)

| 欄位 | 現在誰在寫 | 證據 |
|---|---|---|
| `title` | 🔴 **同步(無條件)** | `rpm-transform.ts` `ProductRow.title`(無 `?`) |
| `subtitle` | 🔴 **同步(無條件)** | 同上 |
| `handle` | 🔴 **同步(無條件)** | 同上 |
| `external_id` | 🔴 **同步(無條件)** | 同上(複合唯一鍵之一) |
| `supplier_slug` | 🔴 **同步(無條件)** | 同上(複合唯一鍵之一) |
| **`price_general`** | 🔴🔴 **同步(無條件)** | 同上 —— **這是零售價,Sean 要親手設特價時的基準** |
| `price_store` | 🔴 **同步(無條件)** | 同上(現行恆寫 NULL) |
| `price_by_tier` | 🔴 **同步(無條件)** | 同上 |
| `fitments` | 🔴 **同步(無條件)** | 同上 |
| `images` | 🔴 **同步(無條件)** | 同上 |
| **`availability`** | 🔴🔴 **同步(無條件)** | 同上 —— **這是唯一的庫存欄(2 值)** |
| `brand_id` / `category_id` | 🔴 **同步(無條件)** | 同上 |
| `metadata` | 🔴 **同步(無條件)** | 同上(現行只寫 `name_en`) |
| `updated_at` | 🔴 **同步(無條件)** | 同上(顯式帶、無 trigger) |
| `description` | 🟡 **同步(條件式 · 兩層)** | **①供應商級** `syncDescription` **②per-row** 來源 null/空白 → 省 key(`rpm-transform.ts:168-177`) |
| **`highlights`** | 🔴🟡 **同步(條件式 · 只有一層)** | **只有供應商級** `syncDescription`,**all-or-nothing、無 per-row 保護**(`:178-183`) |
| `manuals` / `video_url` / `sound_clips` | 🟡 **同步(條件式 · 兩層)** | **①供應商級** `syncInstallResources` **②per-row** 來源 null 防清空(`:184-191`) |
| **`delisted_at`** | ✅🔴 **沒有人在寫** | 片2b 後同步不再輸出該 key;全樹 pattern 命中 2 筆,**逐筆開檔皆為型別宣告/註解,零寫入** |
| **`listing_set_by`** | ✅🔴 **沒有人在寫** | 命中 1 筆 = `product-repository.ts:46` **型別宣告**;寫 `'staff'` 的入口未做 ⇒ 全表恆為 DB DEFAULT `'sync'` |
| `source_missing_at` | ✅ **同步(rpm-reconcile,非 upsert)** | `rpm-reconcile.ts` 的 `markSourceMissing` / `clearSourceMissing`,2 處實際寫入 |
| `id` / `created_at` | DB 預設 | `gen_random_uuid()` / `now()` |

## §1a ✅ `highlights` 到底有沒有被保護 —— 查掉了

**量法(可重跑,兩份檔交叉)**:
```
供應商開關  grep -n "supplierSlug: '\|syncDescription:" scripts/supplier-config.ts
每日排程    sed -n '/matrix:/,/steps:/p' .github/workflows/rpm-sync.yml   （supplier: [...] 那行）
交集        兩份逐家比對（不是用眼睛掃，用腳本算，見下方數字）
```

| 分群 | 家數 | 名單 |
|---|---|---|
| 🔴 **每日排程 × `syncDescription:true`** ⇒ **`highlights` 每天被無條件覆寫** | **13** | gbracing / bonamici / cncracing / evotech / eazigrip / samco / motogadget / front3d / materya / ebc / akrapovic / lightech / kspeed |
| 每日排程 × `false` ⇒ 不覆寫 | 1 | `rpm` |
| `true` 但**不在**每日排程(靜態 fixture,不會每天被蓋) | 1 | `extreme` |
| 非排程測試靶 | 1 | `__gated_canary__`(`false`) |
| **`supplier-config.ts` 總家數 / 每日排程家數** | **16 / 14** | 對照:daily 名單無任何一家缺 config |

### 🔴 結論(兩種可能的結果我都先寫了,實際落在第二種)
**不是「設定剛好都關著」,而是「14 家每日排程裡有 13 家開著」** ——
⇒ **那 13 家的 `highlights`(賣點條列)每天被來源覆寫一次,而且沒有任何逐列保護。**

⚠️ **但時態要講準,不要說成現在進行式的資料損失**:
**現在後台沒有任何編輯入口**(`Q3=乙`,員工寫入那片還沒做)⇒ **今天沒有人能改 highlights ⇒ 今天沒有東西正在被蓋掉。**
🔴 **風險在「編輯後台上線的那一天」成立** —— **那天起,員工改的賣點條列會在隔天凌晨消失,而畫面不會有任何異常。**
⇒ **這正是 `Q-P-4`(新欄位一出生就要決定歸誰)必須在編輯後台之前答的具體理由之一。**

---

## §1b 🔴 `highlights` 的資料一路從哪來 —— 追到「不再是我們的 code 在算」那一層

**為什麼查這個**:Sean 2026-08-15 對 `Q-賣點` 沒選甲乙,丟了第三個方向,逐字:
> **「賣點?這個如果員工有改,就應該覆蓋回去報價單那邊吧?」「這個牽扯到資料來源校正問題。」**

**他的直覺是**:員工改了而來源沒改 ⇒ 來源每天蓋回去 ⇒ **修正永遠不會落地。**
⇒ **那不是「要不要保護那一欄」,是「修正該往哪裡去」。** 而回答它需要知道來源到底是誰。

**我查了哪幾種載體**(先列載體再報結論,照 `lessons §12-42`):
`rpm-transform.ts` / `rpm-fetch.ts` / `rpm-import.ts` / `supplier-config.ts` / `.github/workflows/rpm-sync.yml` —— **五種**。

### 資料流(逐段附座標)
```
products.highlights                      ← 我們的 DB
  ← rpm-transform.ts:303   normalizeHighlights(v.highlights_zh)   ← 我們的 code 在算（正規化）
  ← rpm-fetch.ts:43 / :94  來源欄 highlights_zh（jsonb 字串陣列）
  ← rpm-fetch.ts:112       .from('storefront_catalog_v')
  ← rpm-fetch.ts:4         🔴 報價單 B庫 dllwkkfanaebrsuyuedy 的公開 view
```
⇒ **「不再是我們的 code 在算」那一層 = 報價單的 `storefront_catalog_v`。**
🔴 **來源就是報價單系統,不是供應商原始檔** ⇒ **Sean 的方向在資料流上成立。**

### 13 家是 **1 種來源 × 13 個 scope**,不是 13 種來源
`rpm-fetch.ts:5` 逐字:「**WHERE `supplier_slug`=<呼叫端指定>(P0-A-2 起參數化、多供應商共用)**」。
**同一個 view、同一支 fetch、同一支 transform。** ⇒ **要回寫的話只要對一個地方。**

### 🔴 但我們這側是「結構性唯讀」,不只是「剛好沒寫過」
`rpm-fetch.ts:4` 檔頭**逐字**:「**來源(唯讀、絕不寫)**」——
⚠️ **那三個字是有人刻意寫下的紅線,不是預設值。**

**結構性證據**(量法即命令):
| 查什麼 | 結果 | 座標 |
|---|---|---|
| source client 拿什麼金鑰 | `QUOTE_SUPABASE_PUBLISHABLE_KEY`(**publishable,不是 secret**) | `rpm-import.ts:151` |
| `source` 變數的呼叫點 | **只有一處**,傳進 `fetchAllSupplierProducts` | `rpm-import.ts:162` |
| fetch 內對 source 的動作 | **只有 `.select(VIEW_COLS)`** | `rpm-fetch.ts:113` |
| `insert`/`update`/`upsert`/`delete`/`rpc` | **0 命中**(分母 = `scripts/*.ts` 共 51 支) | — |

### ⇒ 要走 Sean 那個方向,代價是三件
1. **跨 repo**:報價單那側要開一個接受寫入的入口
2. **跨機器**:報價單真身在 mac mini(memory `reference_quote-repo-truth-moved-to-mac-mini`)
3. 🔴 **我們這側要從 publishable 換成有寫權的金鑰** ⇒ **同步腳本從「絕對唯讀」變成「可寫來源」**
   ⚠️ **方向是「我們的 bug 會污染上游」** —— 現在反過來:上游錯了不會被我們弄糟。

### 查不到的那半(明說,不猜)
🔴 **報價單那側 `highlights_zh` 到底怎麼產**(供應商檔?人工?翻譯?)—— **查不到**。
**理由**:報價單真身在 mac mini,本機 clone 是舊的。**本檔只查得到「我們這邊怎麼取」,查不到「那邊怎麼產」。**
⚠️ **而那一半會決定 Sean 的方向到底救不救得了**:若報價單自己也是從供應商檔重算,**回寫報價單一樣會被它的上游蓋掉。**

---

## §2 `product_variants` 逐欄

**🔴 變體側「零條件式」—— 每一欄都是無條件覆寫。**

| 欄位 | 誰在寫 | 證據 |
|---|---|---|
| `sku` / `supplier_slug` / `spec` / `price_general` / `price_store` / `availability` / `images` / `sort_order` / `metadata` / `updated_at` | 🔴 **同步(全部無條件)** | `VariantRow` 介面**十欄全無 `?`** |
| `product_id` / `id` / `created_at` | 由寫入流程 / DB 預設 | — |

**`spec` jsonb 的頂層鍵能不能列舉?** 🔴 **不能。**
`rpm-transform.ts:389` 逐字 `spec: v.spec ?? {}` —— **原樣抄來源,不做正規化**;
註解舉例 `{weave, finish}` + optional `special`,但 `:402` 同時記載 bonamici 是 `{color, material}`,
且有 shape-generic fallback。⇒ **鍵集由各供應商決定、非固定,repo 內列舉不出來。**

---

## §3 🔴 對 Sean 那三個「甲」的直接回答

> ### 🔴 本節 2026-08-15 更正過 —— 原版把一個設計選擇講成了既定風險
> **原版寫**:「特價的基準 `price_general` 是無條件覆寫 ⇒ **新欄若比照現行做法,明天就會被蓋**」。
> **Sean 反問**(逐字):「**我們同步不會有特價跟數量庫存,那為何會有被覆蓋問題?**」——**他是對的。**
> **證據**:upsert = `INSERT … ON CONFLICT DO UPDATE SET`,**只更新 payload 裡有的欄**
> (`rpm-load.ts:126-135` 的 `upsertBatched`、`rpm-import.ts:504` 的複合鍵 `onConflict`;
> 這正是本 repo「省 key ⇒ 不覆寫 ⇒ 保留現值」機制的同一條性質)。
> ⇒ **同步的 transform 不產生某欄,那欄就永遠不會被同步碰到。**
> 🔴 **原版的錯是**:拿一個真的事實(15 欄無條件覆寫)去回答一個它不負責的問題(**新**欄位安不安全)——
> **正是本檔 §0 那條、以及 `lessons §12-42` 講的同一個形狀。**

| 他要親手設的 | 現在會不會被蓋掉 | 依據 |
|---|---|---|
| **特價** | ✅ **不會** —— 只要開新欄、且同步 transform 不產生它。**風險只存在於一種實作方式:把特價做成覆寫 `price_general`** | 見下方設計約束 |
| **庫存數量** | ✅ **不會** —— 同上;風險只存在於「做成覆寫 `availability`」 | 同上 |
| **草稿 / 上下架** | ✅ **不會** —— `delisted_at` 現在**沒有任何人在寫** | 片2b + §1 |

### 🔴 設計約束(工程紀律,不需 Sean 決定;主視窗 2026-08-15 裁)
> **新欄位一律開新欄。絕對不要用「改寫既有同步欄」的方式做特價或庫存。**
> 例:特價**不得**實作成覆寫 `price_general`,要另開特價欄 + 生效區間。

✅ **而這條已經有機制在守,不是只有一句話**:
`scripts/rpm-transform.test.ts:165` 逐字 `expect(Object.keys(product)).toEqual(RPM_PRODUCT_KEYS)`
—— **對同步 payload 的欄位集合做逐字比對**。
⇒ **任何人把新欄位加進同步 payload(含「順手也同步一下特價」),那一格就會紅。**
🔴 **判別力已實測**:片2b 的突變 M4(把 `delisted_at` 加回 payload)⇒ **8 格紅**,其中含這一格。
⚠️ **它守的是「同步不要碰新欄」,守不到「特價被實作成改寫 `price_general`」** ——
**後者是動既有欄的值,不是動欄位集合。** ⇒ **那一半目前仍只有文字約束,寫這片時要自己配負測。**

### ⇒ 所以 `Q-P-4` 縮小了
**原版**:「新欄位一出生就要決定歸誰」——**大部分已經由 upsert 的行為決定了,不需要問。**
**真正剩下的是一欄**:`highlights`(**已存在、同步在寫、而且員工會想改**)——見 §1a 的 13/14。
⚠️ **§1a 那個 13 家仍然為真,但它管的是 `highlights` 這一欄,不是七個新欄位。**

---

## §4 🔴 盤完才看得出來的三件

1. **`listing_set_by` 目前零寫入** ⇒ 後台「手動」chip **永遠是 0 筆**,直到員工入口那片做完。
   (片2c 的空狀態文案已經先講了這件,現在有欄位級證據。)
2. 🔴 **`delisted_at` 目前零寫入** ⇒ **系統裡沒有任何東西能改變任何商品的上下架狀態。**
   這是 `#510` 空窗在欄位層的樣子 —— **不是「同步不下架了」,是「連改都沒有人能改」。**
3. **條件式省 key 的機制已經存在且在用**(`description` / `highlights` / `manuals` / `video_url` / `sound_clips` 五欄)
   ⇒ **「讓某欄歸人」不需要發明新機制**,`supplier-config` 那個供應商級開關就是現成形狀。
   ⚠️ **但它現在是「供應商級」不是「單筆級」** —— Sean 要的是「**我改過的這一筆**不要被蓋」,
   **那是逐列狀態,現行機制給不了。** `listing_set_by` 那個「誰設的」形狀才是逐列的。

---

## §5 誠實缺口

1. **本表只涵蓋 repo 內的寫入路徑** —— 量法見 §0,範圍 = `.ts` + `.sql`,排除測試與 generated types。
   **正式庫裡不在 repo 的 trigger / RPC / 手動 SQL 未掃**(同 `#20` 片2 plan §2 的同一條限度)。
2. **`spec` 頂層鍵列舉不出來**(§2)—— 不是我沒查,是它按設計就不固定。
3. ✅ **`syncDescription` 各家開關已查掉**(2026-08-15,原本掛成誠實缺口;**十分鐘可查的東西不該送到 Sean 桌上當未知**)。
   **結果見 §1a。** ⚠️ **仍未查的是 `syncInstallResources` 各家開關**(影響 `manuals`/`video_url`/`sound_clips`)——
   **但那三欄有 per-row 第二層,所以開關值不像 `highlights` 那樣單獨決定有沒有保護。**
4. **本表沒有建議任何欄位該歸誰** —— 那是 `Q-P-4`,Sean 的生意判斷。
