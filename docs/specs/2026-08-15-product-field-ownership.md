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

| 他要親手設的 | 現在會不會被蓋掉 | 依據 |
|---|---|---|
| **特價** | ⚠️ **欄位還不存在** ⇒ 問題尚未發生。**但它的基準 `price_general` 是無條件覆寫** ⇒ **新欄若比照現行做法,明天就會被蓋** | §1 |
| **庫存數量** | ⚠️ **欄位還不存在**。**而現有 `availability` 是無條件覆寫** ⇒ 同上風險 | §1 |
| **草稿 / 上下架** | ✅ **不會被蓋** —— `delisted_at` 現在**沒有任何人在寫** | 片2b + §1 |

🔴 **三個裡有兩個的答案是「那個欄位還不存在,而它的鄰居每天被蓋」** ——
⇒ **Q-P-4 不只是「既有欄位歸誰」,更是「新欄位一出生就要決定歸誰」。**

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
