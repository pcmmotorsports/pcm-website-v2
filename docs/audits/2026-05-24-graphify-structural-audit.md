# graphify 結構稽核報告(乾淨稽核 / 去雜訊 / 分真假)

> **產出:** 2026-05-24 / Claude Code(唯讀稽核、未改 code、未 commit)
> **資料來源:** `graphify-out/graph.json`,本次稽核前先跑 `/graphify --update` 補入 M-1-14e-2a/2b use-cases(更新後:**1520 節點 / 2310 邊 / 184 社群**,built_at_commit = `732d9fb`)。
> **方法:** 讀 graph.json 用 python 反推 4 個維度,**每條候選對照 `packages/` 檔案實況 + STATUS.md + roadmap 判「真缺漏 vs 計畫內未做」**。誠實鐵則:graphify 是「線索產生器」非「驗算機」,寧可保守不灌水。

---

## 一、白話總結(給 Sean)

知識圖譜掃完,**結論是一張乾淨的健康證明**:沒有真正的結構缺漏、沒有該合併的重複程式、沒有指向不存在東西的壞連結。

圖譜看起來像「缺東西」或「重複」的地方,逐一查證後**全部都有合理解釋**:

| 維度 | 圖譜原始訊號 | 查證後真相 |
|---|---|---|
| 介面沒對應實作 | 9 個 port、3 個沒有 adapter | 那 3 個(訂單 / 金流 TapPay / Google Sheets 同步)是 **M-3 / M-5 的未來功能、刻意先定義介面**,不是 bug |
| 重複 / 多餘 | 41 條「語意相似」邊 | 逐條看完、**0 條是該合併的真重複**;全是「刻意做成一組平行結構」(兄弟 use-case、鏡像 port、3 種篩選器變體、設計 mock↔API 合約) |
| 孤立節點 | 58 個 degree-0 節點 | 全是設定檔 / git hook / 測試 / 文件抽取沒接到的邊 = **雜訊、非死碼** |
| 壞連結 | — | **0 條**懸空引用(指向不存在節點) |

**唯一值得你知道的「事件」**:這次 `--update` 時 graphify 的去重機制把整張圖從 1633 節點縮到 1520(graph_diff:新增 114 / 移除 227 / 淨 −113,詳見 §七.1)。這是工具的正常行為、等於它順手「自我清理」了一批舊的重複節點,**不是 repo 出問題**。

→ **本稽核沒有需要你拍板修 bug 的項目。** 下面是技術佐證 + 1 個正向發現(下一步 e-3 結構上已就位)。

---

## 二、維度 1:Port ↔ Adapter 覆蓋(hexagonal 邊界)

以 `packages/ports/src/` + `packages/adapters/src/` 檔案實況為準(圖譜的 `implements` 邊在這裡偏方法級、不夠乾淨,故用 grep 實況校正):

| Port 介面 | Adapter 實作 | 狀態 |
|---|---|---|
| `IProductRepository` | `SupabaseProductAdapter` + `InMemoryProductRepository`(測試替身) | ✅ 2 實作 |
| `ICustomerRepository` | `SupabaseCustomerAdapter` | ✅ |
| `IAddressRepository` | `SupabaseAddressAdapter` | ✅ |
| `IVehicleRepository` | `SupabaseVehicleAdapter` | ✅ |
| `IWalletRepository` | `SupabaseWalletAdapter` | ✅ |
| `IAuthService` | `SupabaseAuthAdapter` | ✅ |
| `IOrderRepository` | **(無)** | 🔵 計畫內未做 — **M-3 訂單**(STATUS:`related_order_id` M-3 FK) |
| `ITapPayAdapter` | **(無)** | 🔵 計畫內未做 — **M-3 金流**(STATUS:#3 TapPay sandbox、deposit Phase 1 為 mock) |
| `ISheetsAdapter` | **(無)** | 🔵 計畫內未做 — **M-5 sync engine**(STATUS:M-5-03 sync engine) |

**判讀:6/9 port 有 adapter;缺的 3 個正是 brief 點名的「未來功能、非 bug」。** 這反而是**好訊號** —— 採「port 先定義、adapter 後補」的六角架構,介面先卡位、Phase 1 不做 9 大藍圖(對齊鐵則)。**不需任何動作。**

> use-case 消費 port 統計(grep):IVehicleRepository ×34、IAddressRepository ×33、IAuthService ×22、ICustomerRepository ×9。

---

## 三、維度 2:孤立 / 弱連結節點(degree 0-1)

- **degree 0(孤立):58 個** — 分布:code 21 / document 28 / concept 8 / rationale 1。
- **degree 1(葉):696 個**(占 ~46%) — code 525 / document 72 / concept 93 / rationale 6。

**逐類判讀(保守、不當缺漏報):**

| 類別 | 例 | 判定 |
|---|---|---|
| 設定檔 | `vitest.config.ts`、`next-env.d.ts`、`tsconfig.json` | 雜訊(本就不被 import) |
| git hook | `.husky/_/*`(post-rewrite / commit-msg / pre-push…) | 雜訊(git 基礎設施) |
| 元件 smoke test | `ProductCard.test.tsx`、`HomeHero.test.tsx`… | **抽取限制**:test→元件的邊沒被抓到、**測試實際存在**(非缺測試) |
| 設計參考文件概念 | HANDOFF-*、PRODUCTS-README 的設計規格概念 | 雜訊(文件抽取出的概念節點、天生葉/孤立) |
| 設計 mock 資料 | `design-reference/data/products.js` | 抽取限制(storefront 透過 submodule 鏡像、非 import、邊沒抓到);**非死碼** |
| 頂層文件 / ADR | `PROGRESS.md`、`README`、decisions 0001/0002 | 雜訊(概念節點) |

**結論:0 個是真死碼 / 真缺漏。** 692 葉 + 58 孤立全屬「抽取沒接到的邊 / 設定 / 測試 / 文件概念」。**不需動作。** degree 0-1 在程式碼圖譜本就大量存在(多數 symbol 只被引用一次),屬正常分布。

---

## 四、維度 3:`semantically_similar_to` 重複 / 多餘候選(41 條,全 AI 推斷)

**逐條人工確認結果:0 條是「真重複可合併」。** 全數歸三類「刻意保留的平行結構」:

**(a) 兄弟 / 鏡像結構(設計上就該分開、合併反而錯):**
- `registerCustomer ~ loginCustomer ~ logoutCustomer`(auth use-case 兄弟)
- `IAddressRepository ~ IVehicleRepository`、`IWalletRepository ~ IAddressRepository`(鏡像 port — e-2b 刻意鏡像 e-2a)
- `SupabaseAddressAdapter.create ~ mapVehicleToInsertRow`、`mapSupabaseAuthError ~ mapSupabaseAddressToDomain`(mapper 兄弟)
- `addAddress 設預設兩步 ~ depositWallet`(use-case pattern 相似、語意不同)

**(b) 刻意雙層 / 雙表徵(brief 明確說別報):**
- `AGENTS.md ~ CLAUDE.md`(Codex vs Claude 規則、刻意雙份)
- `Three-Green Checkpoint ~ GitHub Actions CI`(本地 vs CI 雙層守門、刻意)
- `Brands/Products Mock Schema ~ API Response Schema`(design mock = 合約 vs REST 實作、鐵則 2 的「design 即合約」)
- `customers RLS ~ products RLS`、`products GRANT ~ customers RLS`(安全 pattern 一致性、刻意對齊慣例)

**(c) 一介面雙實作 / 同指令多處:**
- `SupabaseProductAdapter.save ~ InMemoryProductRepository`(同 port 真實 + 測試替身)
- `ITapPayAdapter ~ ISheetsAdapter`(兩個未實作的未來 port、shape 相似)
- `dynamic=force-dynamic(products)~(home)`(同 Next.js 指令、兩頁都需要)

**唯一「若未來動到再瞄一眼」的低優先觀察(非 bug、非現在要做):**
- **篩選器家族**是相似邊最密的一叢:`FilterTop ~ FilterSide ~ FilterDrawer`、`FilterTopData ~ FilterDrawerData`、`FilterTopPreviewPage ~ FilterSidePreviewPage` 等。目前是**設計刻意的 3 種版面變體**(對齊 design 三種篩選 UI),不是重複。**只有當你哪天決定收斂篩選器 UI 時**,這叢是該回頭看的地方。現在**不動**。

> (`conceptually_related_to` 98 條、`shares_data_with` 29 條也掃過:如 `Order/CustomerAddress/CustomerVehicle/WalletLedgerEntry ~ Customer`〔都掛 customer_user_id、正確的資料關聯〕、`6 Zod Schemas ~ 8 Customer Use Cases`〔驗證層↔use-case 層、正確〕,全是正確的領域關聯、無多餘。)

---

## 五、維度 4:懸空引用(邊指向不存在節點)

**0 條。** 上次建圖是 0、本次複查仍 0。圖譜內部一致、無壞連結。

---

## 六、正向發現:e-3(下一步)結構上已就位

圖譜佐證下一段 **e-3 deposit-wallet** 的接線點正確:
- `IWalletRepository`(port)✅ 已定義、`SupabaseWalletAdapter`(雙 client)✅ 已實作。
- 但**目前沒有任何 use-case 消費 `IWalletRepository`** —— 這正是 e-3 要補的那一格(`depositWallet` use-case)。

→ 圖譜顯示「adapter 已在、use-case 待補」的缺口 = e-3 的工作範圍,**與 handoff 一致**。非 bug、是進度驗證。

---

## 七、方法學備註(誠實交代)

1. **節點數 1633 → 1520(淨減 113)**:以 graphify 的 `graph_diff`(新舊圖實際比對、可自洽核對)為準:**新增 114 節點、移除 227 節點 → 淨 1633 + 114 − 227 = 1520**(完全對得上)。這是 `--update` 每次增量 merge 內建去重的設計行為,屬「自我清理」、非 repo 變動。
   > 誠實更正:本節初稿曾寫「合併 239 個(89 精確 + 141 模糊)」並與上面的 114/227 混用,造成數字打架。澄清:`build_merge` 步驟另印過一行內部計數「Deduplicated 239 (89 exact, 141 fuzzy)」,該行**自身就不自洽(89+141=230 ≠ 239)**、且與 `graph_diff` 的「移除 227」是不同量度(merge 過程計數 vs 新舊圖最終差集),**不可直接相提並論**。故本報告一律以可自洽的 `graph_diff` 數字(114 新 / 227 移除 / 淨 −113)為準,239/230 僅為工具 merge-step 內部計數、不採信為節點變動量。
2. **`implements` 邊偏方法級**:圖譜的 implements 關係在本 repo 多連到方法節點,不適合直接算 port 覆蓋;故維度 1 改以 `grep "implements I"` 檔案實況為準(圖譜當線索、檔案當裁判)。
3. **本報告自身已進圖**:`--update` 把本次同時產的 Task C 對帳報告 + 本報告的 docs 一併抽進圖(故出現「Backlog #172」「Column-Level GRANT」等新節點),屬正常 corpus 增長。

---

## 八、待 Sean 拍板清單

**本稽核無「需修的 bug」。** 僅 1 個方向性的可選決定:

1. **篩選器家族相似叢(§四低優先觀察)**:維持現狀(3 變體刻意保留)/ 排一個未來 slice 評估收斂。**建議維持現狀**(對齊 design、非債) —— Sean 未要求變更、依建議維持。

(本報告 2026-05-24 收尾、與 Supabase DB 對帳報告同 commit 入版控。`graphify-out/` 為本機 gitignored、不入 git。)
