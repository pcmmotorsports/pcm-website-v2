# plan · sitemap `<lastmod>` 用「內容真的變了」的時間(2026-09-15 · A 窗)

> Sean 0915 拍 Q4 甲:sitemap lastmod 要準 ⇒ 要一個「內容真的變了」的來源 = 動 schema ⇒ 鐵則 8 先寫 plan。
> 為什麼不能直接用 `updated_at`:`app/sitemap.ts:22-56`(2026-09-09 量):供應商同步把它整片翻新,一天 25,430 / 26,425 列。
> 本 plan 只寫、不動任何碼或 DB。

---

## 0. 一句話

`products` 加一欄 `content_changed_at`。由資料庫 trigger 在「客人看得到的欄位真的變了」時才更新它。sitemap 讀這一欄當 `<lastmod>`。

---

## 1. 要 Sean 拍的三題(答案會改做法,排最前)

```
Q1:「內容變了沒」怎麼判?
  甲 = trigger 直接比「改之前 vs 改之後」那幾欄(不存 hash)
  乙 = 另存一個 hash 欄,每次寫入重算、比對 hash
  A: 甲|乙   ← 推薦【甲】
  理由:兩條寫入路都是「有就更新」(不是先刪再插),trigger 本來就拿得到改之前的值
  (rpm-import.ts:980 products upsert;20260825120000:340-355 variants ON CONFLICT DO UPDATE)。
  甲少一欄、少一次重算;欄位清單只寫一處。0914 講「hash 欄」是手段,要的是「準」,甲一樣準。

Q2:舊的 26,425 件,一開始填什麼?
  甲 = 填 created_at(上架時間)⇒ 今天起每一件都有 lastmod
  乙 = 留空 ⇒ 等它下一次真的改了才有 lastmod,沒改過的永遠沒有
  A: 甲|乙   ← 推薦【甲】
  代價照實寫:上架後改過、而我們今天查不出來的那些,lastmod 會比真的舊。
  created_at 分佈是真的(逐月 3,637 / 2,606 / 18,774 / 1,408,sitemap.ts:43),沒被批次汙染。

Q3:只有價格變了,算不算「內容變了」?
  甲 = 算(商品頁上印著價格)
  乙 = 不算
  A: 甲|乙   ← 推薦【甲】
  ⚠️ 未確認:供應商每天同步時,一般價會不會因匯率小幅跳動。若會,每天會有一批頁面 lastmod 變今天
  (那是真的變了,但量可能大)。開工第一步先唯讀量一次同步前後 price_general 變了幾列。
```

---

## 2. 改什麼

### 2-1 資料庫(一支 migration + rollback + 事後檢查)

| 項目 | 內容 |
|---|---|
| 新欄 | `products.content_changed_at timestamptz`(可空) |
| 回填 | Q2 甲:`UPDATE products SET content_changed_at = created_at`(26,425 列,**先回填、再建 trigger**) |
| trigger ① | `products` **BEFORE INSERT OR UPDATE**。INSERT ⇒ 設 now()。UPDATE ⇒ 下面「算內容」的欄位任一 `IS DISTINCT FROM` ⇒ 設 now();沒變就不動它 |
| trigger ② | `product_variants` **AFTER INSERT OR UPDATE OR DELETE**(每列)。INSERT / DELETE,或 UPDATE 時變體內容欄任一變了 ⇒ `UPDATE products SET content_changed_at = now() WHERE id = 該變體的 product_id` |
| 讀權限 | `GRANT SELECT (content_changed_at) ON products TO anon, authenticated`(products 走欄位級授權,同 20260808000000:54) |
| view | `products_public` 末尾加一欄 `p.content_changed_at`(20 → 21 欄;照抄 20260808000000:61 那一代,其他 20 欄逐字不動)+ `NOTIFY pgrst, 'reload schema'` |

**算內容的欄位(客人在商品頁看得到的):**
- products:title、subtitle、description、highlights、images、price_general、availability、fitments、video_url、manuals、sound_clips、brand_id、category_id
- product_variants:sku、spec、price_general、availability、images、sort_order(= `product_variants_public` 公開的那幾欄,20260602135934:172)

**不算:** price_store / price_by_tier(經銷價,不在公開頁)、metadata、updated_at、listing_set_by、source_missing_at、external_id、supplier_slug、description_locked*。

**🔴 trigger 順序:** 既有 `trg_products_description_lock`(BEFORE UPDATE,20260902190000:215)被鎖時會把 description 改回舊值。PG 的同類 trigger 照名字字母序跑 ⇒ 新 trigger 取名 `trg_products_z_content_changed`,排在它後面,看到的是還原後的 description,被擋下的改動不會誤判成「變了」。

**誰寫 products / variants(全部會經過 trigger):**
- 供應商同步:`rpm-import.ts:980` products upsert;`rpm-load.ts:187` → `sync_product_variant_group`(20260825120000,變體 upsert + 刪孤兒 :303)
- 後台上下架:`admin_set_product_listing`(20260819040000:158-161)只改 delisted_at / updated_at ⇒ 不算內容,不會更新
- 手動 SQL:一樣會經過 trigger

### 2-2 顧客站(一顆 commit)

| 檔案 | 改 |
|---|---|
| `packages/ports/src/IProductRepository.ts:111` | `listAllHandles()` 回 `{ handle, contentChangedAt }[]`(或另開一支,開工時看呼叫端數量決定) |
| `packages/adapters/src/supabase/SupabaseProductAdapter.ts:395` | select `id, handle, content_changed_at` |
| `packages/adapters/src/in-memory/InMemoryProductRepository.ts:140` | 同步介面 |
| `apps/storefront/src/lib/products.ts:467` | `fetchCatalogHandles` 帶出時間 |
| `apps/storefront/src/lib/seo.ts:158` | `buildSitemapEntries` 商品那段:有時間就給 `lastModified`,空的就不給 |
| `apps/storefront/src/app/sitemap.ts` | 檔頭 09-09「決定不做」那段劃掉,寫新做法 |

效能:09-09 實量加一欄 `updated_at` 是 +2.9ms、執行計畫不變(sitemap.ts:32-35),這欄同寬度。

---

## 3. 上線順序

1. 貼 migration(Sean 點名)⇒ 跑事後檢查。
2. 唯讀抽查:手改一件商品標題 ⇒ 那一列時間變今天;只改 updated_at ⇒ 不變;改變體價格 ⇒ 母商品時間變今天。
3. 推顧客站。🔴 **順序不能反**:sitemap 在 build 時產生,碼先上而欄位還沒有 ⇒ 查詢失敗 ⇒ build 失敗(09-08 sitemap 讓部署失敗 33 小時的同一個位置)。
4. 等下一次供應商同步跑完,唯讀數「今天 content_changed_at 變了幾列」,跟 updated_at 變了幾列比。

---

## 4. 風險

- **同步變慢**:每列多比 13 欄(含 jsonb)。開工時在拋棄式 PG 灌 26,425 列、跑一次全量 upsert 比前後秒數。
- **變體 trigger 反覆更新同一個母商品**:一群變體真的變了幾列,母商品就被 UPDATE 幾次(同一交易、同一列)。每天同步值沒變 ⇒ 0 次。首次上架整群 ⇒ 每個變體 1 次,量級可接受,拋棄式 PG 一起量。
- **jsonb 比較**:用的是語意相等(key 順序不影響);陣列順序變了算「變了」(圖片換順序本來就是客人看得到的改動)。
- **碰 schema** ⇒ 鐵則 12,commit 前 codex 唯讀審一輪。

---

## 5. rollback

先退顧客站,再退 DB(反過來會讓 sitemap 查一個不存在的欄):
1. `git revert` 顧客站那顆。
2. 同一交易內:`DROP TRIGGER` 兩支 + `DROP FUNCTION` 兩支;`DROP VIEW products_public` 再照 20260808000000:61 重建 20 欄版,並重下 `GRANT SELECT` + 重跑寫權限 `REVOKE`(PG 不准 `CREATE OR REPLACE VIEW` 減欄,理由逐條見 20260808000000 檔尾 rollback 註解);`REVOKE SELECT (content_changed_at)`;`ALTER TABLE products DROP COLUMN content_changed_at`。
3. rollback SQL 寫進 `supabase/rollbacks/`,開工時在拋棄式 PG 來回跑一次(套用 → 回滾 → 再套用)。

---

## 6. 估時

- DB 片(migration + 事後檢查 + rollback + 拋棄式 PG 量同步耗時):約 45 分,送 codex。
- 顧客站片:約 30 分。
- Q3 的唯讀量測(價格每天跳多少):約 10 分,開工第一步。
