# backlog #306「選車後即時計數」交接(#306-a + #306-b)

> Updated: 2026-07-31 · Asia/Taipei
> Repo: `/Users/sean_1/pcm-website-v2-306`(**獨立 worktree**)· Branch: `catalog-facet-counts`
> 執行 agent: Claude(`claude-opus-5[1m]`)· 工作模式: 執行
> 🔴 **未 push、未合回 `dev`、零 DB 變更、零金流接觸面。**

---

## 1. 一句話現況

選了車之後,分類與品牌的數字**從「全站總數」改成「這台車的真實件數」,0 件的灰掉且點不下去**;
桌機側欄與手機抽屜同一套。**真瀏覽器實測通過**(面板顯示 39 → 點下去實際就是 39 件商品)。

---

## 2. 為什麼要開一條 worktree(接手第一件事看這裡)

Sean 2026-07-31 指示:另一個視窗同時在同一個 repo 工作、一直互撞。
🔴 **在同一個資料夾 `git checkout -b` 不會隔離** —— 兩個 session 共用工作目錄與 git index,
切分支等於把對方的 HEAD 一起帶走。真正的隔離是 **git worktree**(另一個資料夾 + 自己的分支),
這個 repo 本來就有兩條線在用(`pcm-3ds-yi-r1`、`pcm-website-v2-brand`)。

| | 路徑 | 分支 |
|---|---|---|
| E10/A7b 線(別人) | `/Users/sean_1/pcm-website-v2` | `dev` |
| 本線 | `/Users/sean_1/pcm-website-v2-306` | `catalog-facet-counts` |

**主工作樹全程未被本線改動**(建 worktree 前的三個未提交檔已搬走並 `git checkout --` 還原)。

🔴 **本分支刻意沒有動 `STATUS.md` 與 `docs/handoff/CURRENT.md`** —— 那兩個檔對方也在寫,
分支上改必衝突。**合回 `dev` 時才更新**,那是接手者的第一件事(內容用本檔 §5 §6)。
`docs/phase-1-backlog.md` 的 #306 條目同理:**#306-a 的內容已在 `dev` 上**(commit `3b490e1`),
**#306-b 的結果尚未寫進去**。

---

## 3. 兩片各做了什麼

### #306-a 取數層(已在 `dev` 上 = commit `3b490e1`)

- `apps/storefront/src/lib/vehicle-facet-counts.ts` — 用**既有** RPC `search_catalog_by_vehicle`
  fan-out(它本來就吃 `p_category` / `p_brand_slugs` 並回 `total`)⇒ **零 migration**。
  每個 facet 一次 `p_limit=1` 只讀 total;併發 16;包 900s `unstable_cache`(tag `catalog`)。
- `apps/storefront/src/app/api/catalog/facet-counts/route.ts` — 公開唯讀端點。
- `apps/storefront/src/lib/catalog-query.ts` — 抽出 `isSafeCategoryValue`(取數端與點擊端共用同一道白名單)。

### #306-b 接線層(本分支 = commit `5867546`)

- `lib/vehicle-facet-display.tsx`(新)— `useVehicleFacetCounts` hook + `makeFacetCountResolver`。
- `ProductsPage` → `FilterSide`(桌機)/ `ProductsMobileControls` → `FilterDrawer`(手機)。
- 鐵則 6 拆檔(**原樣搬移、零行為變更**):`FilterSideCategoryTree.tsx`(FilterSide 432→347)、
  `FilterDrawerCategoryTab.tsx`(FilterDrawer 417→361)。
- CSS:`.is-empty { opacity: .38; cursor: not-allowed }`(`filter-side.css` + `filter-drawer.css`)。

**三態**:未選車 = 全站數(server props、零額外查詢)/ 選了車還沒回來或算不出來 = **不顯示**
(fail-safe,**絕不用全站數頂替**)/ 已回來 = 真實件數,0 件灰掉 + `disabled`。

🔴 **取數輸入用 URL(`vehicleUrlParam`,短版與長版都認)而不是 cascade state**:商品列表的件數就是 server 依同一個
字串算出來的 ⇒「面板數字」與「點進去的件數」有**結構性**保證,不是靠兩套邏輯抄得一樣。

🔴 **「沒有這個 key」≠「0 件」**:key 可能是被 route 的分類白名單濾掉的(名稱含 LIKE 萬用字元),
那是「算不出來」不是「沒有商品」⇒ 顯示 null 而非灰掉。已配專屬測試。

---

## 4. Sean 拍板(接手不得重問)

| # | 題目 | 拍板 |
|---|---|---|
| Q1 | 是否授權動「正式資料查詢」(型錄 UX 交接檔的凍結邊界) | **A 授權**(唯讀、零 DB 結構變更) |
| Q2 | 0 件的分類/品牌怎麼呈現 | **A 灰掉且點不下去** |
| Q3 | 手機什麼時候算 | **A 選好車當下就算、桌機手機同一套機制**(不做裝置分支) |
| Q4 | 新 worktree 怎麼拿 Supabase 連線設定 | **A symlink**(Sean 自己跑;AI 不讀寫 `.env*`) |
| Q5 | 公開端點 108 條查詢的放大面要不要先加節流 | **A 先這樣上、觀察**(見 §7 殘餘風險) |

---

## 5. 驗證(實跑過的,不是宣稱)

```bash
pnpm --filter @pcm/storefront typecheck   # exit 0
pnpm --filter @pcm/storefront lint        # exit 0
pnpm --filter @pcm/storefront build       # Compiled successfully
pnpm test                                 # 279 檔 3458 passed + 1 todo
```

- **突變測試 19/19 各紅在指定斷言**(#306-a;還原經 shasum 逐檔驗)。
- **真瀏覽器實測**(production build、真 Supabase 資料、agent-browser 0.33.0):
  - 前提斷言:CSS chunk **200 / 103,652 bytes 且逐字含兩條新規則**;viewport 每次自帶斷言。
  - **桌機 1365**:15 個大類顯示 13/6/39/6/3/4/27/6/15/**0**/15/31/33/**0**/**0**,
    三個 0 件皆 `disabled=true` + `opacity=0.38`;**加總 198 = `pp-count` 198 件商品**。
  - **品牌 16 個**:lightech 84 / evotech 47 / gb-racing 19 …;
    CNC RACING、EXTREME、K-SPEED、PCM 四個 0 件皆 disabled + 0.38。
  - **端到端對帳**:點「拉桿與把手(39)」→ 頁面變 **39 件商品**;
    展開後子類 14/11/14/**0**/**0**,兩個 0 件 disabled。
  - **手機 390**:桌機側欄確認 `display:none`、`.pmc-sticky` 在,
    抽屜 15 列數字與桌機**逐格相同**;點 0 件列 → URL **完全沒變**(真的點不動)。
  - **未選車回歸**:仍是全站數 2130 / 1076 / 1824 / 739,`pp-count` 19037。
- **等待時間(全新未快取車款、真瀏覽器 `performance.getEntriesByType`)**:
  facet 請求 1958 / 1526 / 1241 / 167 ms;**從進頁面到數字出現 2948 / 2205 / 1666 / 998 ms**。
  命中 900s 快取後 ~0.19s。頁面與商品**不等它**,數字是後補上去的。

🔴 **誠實邊界**:本機打正式 Supabase,正式站(Vercel `sin1`)的延遲**從未量過**;
未跑 axe 無障礙掃描;`.env.local` 是 Sean 建的 symlink,AI 全程未讀取其內容。

---

## 6. 審查

- **#306-a**:code-reviewer(opus)R1 **FAIL、7 must-fix + 11 nit,全折入、駁回 0**。
  最重三條都是「上游失敗會變成**錯的答案**」:三支 taxonomy fetcher 自己 catch 回 `[]`
  ⇒ 瞬時 DB 錯會回 **200 分類全空**(而 Q2=A 會把整個分類面板灰掉且點不下去)/
  車輛字典失敗被誤報成 400 永久錯誤 / `p_offset` 零斷言。
- 🔴 **突變第一輪有 3 條是 harness 自己假綠**(sed 樣式因程式碼改寫失配 ⇒ 突變根本沒套用,
  卻被報成「全綠 = 沒抓到」)⇒ 已補「突變必須真的改到檔案(shasum before≠after)否則 FATAL」。
- 🔴 **更正一條我自己寫錯的註解**:原寫「用 `allSettled` 是為了避免 unhandled rejection」——
  **實測不成立**(`Promise.all` 本來就會對陣列裡每個 promise 掛處理器)。真正的理由是**收乾淨**
  (`Promise.all` 在第一個 reject 當下就往外拋、其餘查詢還在飛),斷言已改成測這件事。
- 🔴 **在沒有憑證的 worktree 實跑,抓到一條 #306-a 的守門漏洞**:
  `fetchCatalogBrandTaxonomy` / `fetchProductsByVehicle` 的 `createSupabaseAnonClient()`
  寫在 `try` **外面**(`products.ts`,既有寫法、非本片造成)⇒ 環境變數缺漏時是**未捕捉的 throw**、
  直接 500、繞過 route 的 503 守門(實跑訊息 `Error: NEXT_PUBLIC_SUPABASE_URL not set`)。
  修法 = route 自己再包一層 try;**`products.ts` 沒改**(那條路徑影響 `/products` 頁,屬既有行為)。
- **#306-b 尚未跑 code-reviewer**(#306-a 跑過;#306-b 是顯示層 + 兩個原樣搬移的拆檔)。
  🔴 這是知情缺口,接手者若要補審,對象 = `git show 5867546`。

---

## 7. 殘餘風險(Sean 已拍 Q5=A 先觀察,但**不得當成已解決**)

`/api/catalog/facet-counts` 是**公開端點**,一次冷請求 = **108 條** DB 查詢。
三道白名單(形狀 / 車輛字典 / 年份字典)擋的是「哪些車款算合法」= **key 空間**,
**擋不住速率** —— 車輛字典本來就整份送到瀏覽器(首頁 VehicleFinder),合法車款可被逐一枚舉。
已加 process 層閘 `MAX_CONCURRENT_FANOUTS=3`(滿了回 503 ⇒ 前台不顯示件數),
🔴 但它是 **per-process** ⇒ 實際上限 = 3 × instance 數,**不是全站硬上限**。
真正的速率限制要平台層(WAF / rate limit),**未做**。
升級路徑(不預先做):兩段式把 108 降到 31(先算 15 大類 + 16 品牌,展開大類時才算子類)。

---

## 8. 下一個最小動作

1. **合回 `dev`**(Sean 決定時機;本線未 push)。合回時**第一件事** = 用本檔 §5 §6 更新
   `STATUS.md` 七欄 + `docs/handoff/CURRENT.md` + `docs/phase-1-backlog.md` 的 #306
   (刻意留到那時才寫,理由見 §2)。
2. 合回後把 #306 標為完成;若要補 #306-b 的 code-reviewer,對象 = `git show 5867546`。
3. **不 push** —— 等 Sean 手動推。
4. worktree 用完可 `git worktree remove /Users/sean_1/pcm-website-v2-306`(Sean 決定;
   裡面的 `.env.local` 是 symlink、移除不影響主工作樹)。

---

## 9. 🔴 2026-07-31 追加:codex 關卡2(換模型)FAIL 8 must-fix、已全折入

Sean 拍板補跑 codex(`-m gpt-5.6-sol -s read-only`,跑前後 `git status --porcelain` 比對零留痕)。
**前兩輪 Claude code-reviewer(7+3 條)與這 8 條零重疊。** 修法 = `bce75b1`,合併 `2e2ce58`。

**兩條是我自己判斷錯、寫進本檔的字面也錯**:
1. 🔴 **長版書籤 `?brand=&model=` 會復發全站數**。本檔 §3 原寫「拿不到件數 ⇒ 退回不顯示(fail-safe)」
   —— **錯**。server 端 `products/page.tsx:60` 把長版**當車**,而取數只讀 `?vehicle=` ⇒ 判「沒車」
   ⇒ 顯示**全站數**。已改用既有 `vehicleUrlParam()`;長版合成出的字串會被 route 形狀白名單擋下
   ⇒ 400 ⇒ 不顯示,這才是要的 fail-safe(實測 `?vehicle=Yamaha:MT-09` → `400 invalid_vehicle`)。
2. 🔴 **`docs/design-storefront-manifest.yaml` 未同步**,違反 `docs/patterns/slice-checkpoint.md`
   的強制 gate(動 `components/` 或 `styles/` 必同步)。更嚴重的是**前一輪 Claude 審查者回報
   「本 repo 無 storefront manifest」,而我沒查證就接受** —— 該檔 297KB、就在 `docs/` 底下。
   已更 ProductsPage 條目(可達祖先 `3092396` + 日期段 + 6 個 related 檔);
   驗證器 `node scripts/design-mirror.mjs --validate`:broken **35 → 35**(全屬既有、非本片造成)、
   path token 252→258 全解析、commit 可達性 25/25。

**其餘六條**:hook 無 owner guard(`abort` 擋不住已進入完成序列的 promise ⇒ A 車數字可能永久掛 B 車上)/
`unstable_cache` **不是 single-flight**(同一冷 key 同時三個請求 ⇒ 瞬間 324 次 RPC)/
**品牌 taxonomy 根本沒包快取** ⇒ 熱請求每次都打全站聚合(**實測 ~190ms → 3.4ms**)/
車輛驗證前就並行讀分類與品牌 ⇒ 假車款也能觸發全站聚合 / fan-out slot 不保證歸還(加 8s 逾時)/
**ProductsPage 405 行破鐵則 6**(我 commit body 寫的 396 是上一版事實、加料後沒重數)。

**部分折入**:C4(fan-out 閘會擋掉 stale revalidation ⇒ 持續飽和下 facet 可能停在舊數字)——
single-flight 已大幅降低撞閘機率,剩下的是**刻意取捨**(相對於 DB 被打爆),已寫進註解;
另 repo 目前沒有任何 `revalidateTag('catalog')` 呼叫,屬既有缺口、不在本片。

**驗證**:三綠 + 合併後 `pnpm test` **281 檔 3486 passed + 1 todo**;突變 **5/5** 各紅在指定斷言
(🔴 第一輪長版 URL 那條**全綠** = 修法零覆蓋,補測試才轉紅);
SSR 第一幀三種 URL 逐一比對;真瀏覽器桌機加總 198 = `pp-count` 198、0 件三列 `disabled`+`0.38`;
延遲 熱 **3.4ms** / 冷(新車款)**1.54s**。

⚠️ **`docs/handoff/CURRENT.md` 尚未加入本節內容** —— 合併當下該檔正被 E10/A7b 線編輯(未提交),
`git add` 會把對方的內容一起吞進我的 commit。接手者請把本節摘要補進 CURRENT。
