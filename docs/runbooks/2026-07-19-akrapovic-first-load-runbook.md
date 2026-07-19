# akrapovic 首灌 Runbook(監控式手動執行 + 補償程序)— 2026-07-19

> 對應 Codex R1 must-fix **M3**:`rpm-import` 寫入非原子(products 分批 500 → 孤兒變體刪 → variants),
> 中途失敗會留「半套商品」上架(商品在、變體缺 → 顧客看得到卻選不到/下不了單)。
> 既然無交易可用,**補償就必須是預先寫好的程序,不是出事當下才想**。
> 計畫本體:`docs/handoff/2026-07-19-akrapovic-onboarding-plan.md`(§3-1 = 開寫前 must-fix 四項)。

## 0. 一句話

akrapovic 648 群第一次寫進顧客站。**人在旁邊看著跑、不交給排程**;跑壞了先把寫入來源關掉、再把商品藏起來,
最後才決定要不要硬刪。

---

## 1. 開跑前置(逐條打勾,缺一不跑)

- [ ] M1/M2/M4 三項已進 main 且測試綠(M1 新品驗價 / M2 群數指紋 / M4 writeAllowed 行為測試)
- [ ] 報價單側商品名已定案並寫入(648 筆短版、**不帶車款**;2026-07-19 Sean supersede)
- [ ] 乾跑最後一次、記下**當下的來源群數**(= 待會 `--expect-groups` 要帶的值;2026-07-19 實查=648)
- [ ] Sean 對「首灌」這次操作明確點頭(鐵則 4:寫入正式庫需當次批准)
- [ ] `supplier-config.ts` 的 `akrapovic.writeAllowed` 翻 `true`(改這行=面對本清單)
- [ ] **`.github/workflows/rpm-sync.yml` 的 matrix 先不要加 akrapovic** —— 首灌跑完、驗證過,才加進每日排程

> 為什麼 matrix 留到最後:首灌若中途失敗、而排程已經包含它,隔天 03:57 會在你還沒收拾完的狀態上再跑一次。

## 2. 乾跑(最後一次,讀取無寫入)

```bash
cd /Users/sean_1/pcm-website-v2
pnpm exec tsx scripts/rpm-import.ts --supplier=akrapovic --dry-run --expect-groups=648
```

看四件事,任一不對就停:

| 看什麼 | 期望 |
|---|---|
| 群數指紋 gate | `✅ 來源 648 群 = 預期指紋 648 群` |
| 新品驗價(M1) | `✅ 新品價與來源獨立重算逐筆相符`(首灌 enforceBand=開) |
| handle preflight | `0 撞` |
| v2 分類 | null-v2 0 群、跨大類衝突 0 群 |

## 3. 正式首灌(監控式:全程盯著、不離開)

```bash
cd /Users/sean_1/pcm-website-v2
pnpm exec tsx scripts/rpm-import.ts --supplier=akrapovic --confirm-write --expect-groups=648 2>&1 | tee /tmp/akrapovic-first-load.log
```

- 🔴 **不帶任何 `--allow-*` bypass 旗標**。首灌撞到閘門=真的有事,不是誤殺。
- 全程留在畫面前。看到 `[rpm-import] WRITE 完成:648 商品 / 648 變體` 才算寫完。
- log 留檔(`/tmp/akrapovic-first-load.log`),事後對帳與交接都靠它。

**判讀**:

| 情況 | 意義 | 動作 |
|---|---|---|
| 印出 `WRITE 完成` + 下架對賬完成 | 正常 | 進 §5 驗證 |
| 在任一 gate abort(尚未印 `WRITE 完成` 且未見 upsert 錯誤) | 閘門擋在寫入前、**DB 沒被動過** | 修來源問題後重跑,不需補償 |
| 印到一半中斷 / upsert 報錯 / 你按了 Ctrl-C | **可能已寫入部分商品** | 立刻進 §4 補償 |

## 4. 補償程序(半套商品上架時)

### 4-1 先止血:切斷還會再寫的來源(順序不能顛倒)

1. `supplier-config.ts` 的 `akrapovic.writeAllowed` 改回 `false`
2. 確認 `rpm-sync.yml` matrix **沒有** akrapovic(前置若照做本來就沒有)

> 先關來源再處理資料。否則你藏好的商品,會被下一次同步依來源狀態還原回來
> (`delisted_at` 是**鏡射報價單側**的、不是本站自己的判斷 —— 合約 §10)。

### 4-2 藏起來:軟下架(可逆,顧客立刻看不到)

```sql
-- 先看要動幾列
select count(*) from products where supplier_slug = 'akrapovic' and delisted_at is null;

-- 藏起來(RLS:delisted_at 非 null 即對顧客隱藏,變體連動)
update products set delisted_at = now()
where supplier_slug = 'akrapovic' and delisted_at is null;
```

反悔就把同一批改回 `null`(前提是 4-1 已做,否則同步會自己覆蓋)。
**多數情況做到這裡就夠**:資料留著、顧客看不到,把問題查清楚再重跑一次(upsert 冪等、會自己補齊缺的變體)。

### 4-3 最後手段:硬刪(不可逆,要 Sean 點頭)

只有在「這批資料本身是髒的、重跑也不會對」時才做。

```sql
-- 刪前先數(這幾張表會一起被帶走)
select
  (select count(*) from products where supplier_slug = 'akrapovic') as products,
  (select count(*) from product_variants where supplier_slug = 'akrapovic') as variants,
  (select count(*) from order_items oi join product_variants v on v.id = oi.variant_id
   where v.supplier_slug = 'akrapovic') as affected_order_items;

delete from products where supplier_slug = 'akrapovic';
```

**連帶效果(2026-07-19 對 `bmpnplmnldofgaohnaok` 實查 FK)**:
- `product_variants` / `product_fitments` / `product_fitments_effective(_staging)` → **CASCADE 一起刪**
- `order_items.variant_id` → **SET NULL**:訂單列還在、但和商品的連結斷掉(歷史金額不變、品項追不回)
- ⚠️ 所以 `affected_order_items` > 0 時**先停下問 Sean**。首灌當天理論上是 0,不是 0 就代表事情比你想的複雜。

## 5. 寫入後驗證(當天做完,不留到隔天)

```sql
-- 1) 數量:648 群、648 變體、零半套(商品沒有變體 = M3 要抓的殘骸)
select
  (select count(*) from products where supplier_slug = 'akrapovic') as products,
  (select count(*) from product_variants where supplier_slug = 'akrapovic') as variants,
  (select count(*) from products p where p.supplier_slug = 'akrapovic'
     and not exists (select 1 from product_variants v where v.product_id = p.id)) as products_without_variant;

-- 2) 價格抽驗:隨機 5 群,拿去跟報價單庫 storefront_catalog_v 的 price_retail 對
select external_id, name, price_general from products
where supplier_slug = 'akrapovic' order by random() limit 5;

-- 3) 分類/品牌沒有整批掉進未分類
select c.raw_path, count(*) from products p join categories c on c.id = p.category_id
where p.supplier_slug = 'akrapovic' group by 1 order by 2 desc;
```

- [ ] `products_without_variant` = 0
- [ ] 抽 5 群價格與報價單源一致(自己算一次,不看 log 說什麼)
- [ ] 未分類不是最大宗
- [ ] 顧客身分(anon)實際打開網站看得到 akrapovic 商品

全過 → 才把 akrapovic 加進 `rpm-sync.yml` matrix,交給每日排程。

## 6. 已知殘留風險(誠實標)

- 寫入仍**非原子**:本 runbook 是「人在旁邊 + 預先寫好補償」,不是真交易。根治要 RPC 包交易或 staging 表切換,屬 backlog。
- `delisted_at` 是鏡射欄:任何手動改動,在來源同步恢復後都會被覆蓋 —— 補償一定要先做 4-1。
- 首灌絕對價區間(floor 100 / ceiling 500,000)只在首灌硬擋;日常新品僅「對源比對」恆驗
  (實查 gbracing 45 筆真實低於 100 元,拿它當日常硬閘會天天誤殺)。
