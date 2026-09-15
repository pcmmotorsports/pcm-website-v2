# DBK 目錄裡的別家商品改掛製造商品牌(Q7 plan,待批)

> Sean 2026-09-15 22:4x 拍 **Q7 甲**:DBK 底下其實是 Termignoni / Brembo / Öhlins / Akrapovic 的商品,改掛製造商品牌。
> 本檔**只是 plan**:不改碼、不寫 migration、不通知報價單窗。批了之後主視窗分工。
> 鐵則 8(匯入規則 + 資料遷移)⇒ 批了才做。價格影響已先算過:`~/pcm-mailbox/資料來源追查-0915.md` 末段。

---

## 1. 白話

- 網站匯入 DBK 時,**整家供應商掛一個品牌「DBK」**。DBK 是義大利 Ducati 改裝經銷,它的目錄裡有別家的貨。
- 結果:客人點 Termignoni 品牌頁看到 0 件,那些排氣管只掛在 DBK 底下。
- 改法:匯入時**每一件看它是誰做的**,有認出製造商就掛製造商,認不出來照舊掛 DBK。

## 2. 現況數字(正式庫唯讀,2026-09-15)

| 英文名(`metadata.name_en`)含 | 件數(上架中) | 網站有沒有這個品牌 |
|---|---|---|
| TERMIGNONI | **174**(標題開頭就是 Termignoni 的 113;只在英文名出現的 61) | 有(`termignoni`,0 件商品) |
| BREMBO | 24 | 有(`brembo`) |
| OHLINS | 12 | 有(`ohlins`,另有 Öhlins 供應商匯入中,1,045 列) |
| AKRAPOVIC | 1 | 有(`akrapovic`,既有供應商,648 變體) |

**那 61 件「只在英文名」的長什麼樣**(把 174 件照英文名分群):

| 群 | 件數 | 例 |
|---|---|---|
| Termignoni 本體(全段 / 尾段 / 頭段 / 中段) | 164 | `D20009400TNT - TERMIGNONI FULL SYSTEM SBK TITANIUM DUCATI PANIGALE V4`(標題「鈦合金全段排氣管系統」,**沒寫 Termignoni**) |
| 配件字(轉接座 / 支架 / 牌照架 / 隔熱罩 / 消音塞) | 9 | `D155Y - TERMIGNONI ADAPTER FOR EXHAUST…`、`BW2408069X … Termignoni Carbon Heat Shield` |
| 「for Termignoni」 | 1 | `D170PT - LICENSE PLATE HOLDER FOR TERMIGNONI FULL SYSTEM…`(可能是 DBK 自己做的) |

⇒ **只看標題開頭會漏掉真的 Termignoni 全段**(例上面那件 25 萬的);只看英文名含字會把 10 件配件一起算進去。

## 3. 資料從哪來(報價單側,5e 窗)

- 報價單 `storefront_catalog_v` **沒有製造商欄**。它的 `brand` / `model` 是**車廠 / 車型**(選車用),不是零件製造商(報價單 `supabase/migrations/20260907014300_fitment_exit_gate.sql`)。
- 報價單 `products` 表也沒有製造商欄;`raw_jsonb` 是供應商原始資料,**裡面有沒有製造商欄位還沒查**。

**要報價單側新增一欄**:`storefront_catalog_v.manufacturer_brand`(每一列一個網站品牌 slug,或 NULL)。來源三選一,由 5e 窗先唯讀查再回報:

| 來源 | 做法 | 風險 |
|---|---|---|
| `raw_jsonb` 裡 DBK 原始資料就有製造商 | 直接取 | 最準;要先查有沒有、填了幾成 |
| `product_name`(英文名)開頭 / 含字 + 配件字排除 | 規則判 | 要一份排除字清單;新品會照規則自動分 |
| 報價單側人工表(sku → 製造商) | 逐件填 | 最準但要人維護;新品不會自動分 |

## 4. 網站側要改什麼

### 4.1 匯入規則
- `scripts/supplier-config.ts:395-397`(`dbk: { brandSlug: 'dbk' }`)維持當預設。
- `scripts/rpm-import.ts:468`(整家一個 `resolveId(brands, slug, config.brandSlug)`)改成:
  - 來源列有 `manufacturer_brand` 而且網站 `brands` 查得到 ⇒ 用它
  - 沒有 / 查不到 ⇒ 用 `config.brandSlug`,**並記一行**(查不到的 slug 不能靜默落回 DBK,那會把打錯字藏起來)
- 同一群(`main_sku`)裡的變體**必須同一個製造商**;不同 ⇒ 那一群照 DBK 並記一行(一件商品不能有兩個品牌)。
- 開關:`supplier-config` 加 `perRowBrand: true`,**只開 dbk**;其他家行為一個字都不變。

### 4.2 slug 對應
| 製造商 | 網站 slug | 已存在 |
|---|---|---|
| Termignoni | `termignoni` | ✅ |
| Brembo | `brembo` | ✅ |
| Öhlins | `ohlins` | ✅(注意:不是 `öhlins`;slug 錯字 showcase 會整區消失而不報錯) |
| Akrapovic | `akrapovic` | ✅ |

### 4.3 既有商品怎麼搬
- 不寫一次性 UPDATE。報價單欄上線後,**跑一次 DBK 同步**就會把 `brand_id` 改掉(匯入本來就會更新品牌欄 —— 實作時先乾跑確認差集只有這 211 件)。
- 乾跑五關照 `docs/runbooks/supplier-storefront-onboarding.md`。

## 5. 影響

| 範圍 | 會怎樣 | 要不要另外做 |
|---|---|---|
| 價格 | 只有 P價會員那格會變;正式站 P價會員 0 位 ⇒ **今天 0 件變價**;以後開 P價:187 件變便宜、0 件變貴、24 件不變(Brembo 3% = DBK 3%) | 不用 |
| 品牌頁 `/brands/[slug]` | `termignoni` / `brembo` **在 `BRAND_CONTENT` 沒有條目 ⇒ 頁面 notFound**(`apps/storefront/src/app/brands/[slug]/page.tsx:159`)⇒ 商品掛過去了,**品牌頁仍然打不開** | 🔴 要:補兩家品牌內容(或先接受「商品頁顯示品牌、品牌頁 404」) |
| 商品頁品牌區塊 N°01 / N°02 | `BrandShowcase.tsx` 沒有 `termignoni` / `brembo` 的 case ⇒ 走 default | 要不要補內容,跟上一列一起定 |
| Öhlins | 設計窗 / A 窗正在做 `ohlins` 品牌頁與 N°01 / N°02;Öhlins 供應商另外匯入中 | 🔴 **重複上架風險**:同一個 Öhlins 料號可能從 DBK 與 Öhlins 供應商各來一份 ⇒ 匯入前比對料號 |
| Akrapovic | 既有供應商 | 同上,1 件,比對料號 |
| 品牌篩選 / 件數 | `apps/storefront/src/app/api/catalog/facet-counts/route.ts` 依 `brand_id` 算 ⇒ 自動跟著變 | 不用 |
| 搜尋品牌膠囊 | `apps/storefront/src/lib/parse-search-facets.ts` 吃品牌清單 ⇒ 自動跟著變 | 不用 |
| sitemap | 吃 `BRAND_CONTENT`(`apps/storefront/src/app/sitemap.ts:64`)⇒ 沒補內容的品牌不會進地圖 | 跟品牌頁一起 |
| DBK 品牌頁 | 少 211 件 | 不用 |
| 後台 | 訂單快照存當時的商品資料,**舊訂單不變** | 不用 |

## 6. Rollback

- `supplier-config` 把 `perRowBrand` 關掉 ⇒ 下一次同步整家回到 DBK。
- 報價單那一欄留著無害(網站不讀)。
- 若同步已跑:關開關再同步一次即還原 `brand_id`(同 4.3,不寫手動 UPDATE)。

## 7. 要 Sean 拍的兩題

```
Q1:DBK 目錄裡哪些算「別家的商品」?
A: 甲 英文名含製造商名 = 那一家;配件字(轉接座 / 支架 / 牌照架 / 隔熱罩 / 消音塞)和「for XXX」的 10 件列逐件表給你看
   乙 只看中文標題開頭(Termignoni 只抓到 113 件,會漏掉 51 件真的全段 / 尾段)
   丙 全部 211 件逐件表,你一件一件勾
推薦:甲。規則抓得到 201 件本體,只有 10 件要人看;乙會把真的 Termignoni 排氣管留在 DBK。

Q2:Termignoni / Brembo 在網站上沒有品牌介紹,商品掛過去之後品牌頁會打不開。
A: 甲 先補兩家品牌內容(照 21 家既有做法、官網公開圖)再切換
   乙 先切換,品牌頁暫時打不開;商品頁上品牌名照常顯示
推薦:甲。不然客人點品牌名會看到找不到頁面。
```

## 8. 分工建議(批了之後)

1. 報價單 5e:唯讀查 `raw_jsonb` 有沒有製造商 → 決定來源 → 加 `manufacturer_brand` 欄。
2. 網站:`rpm-import` 逐列品牌 + `perRowBrand` 開關 + 測試(同群不同品牌、查不到 slug、開關關著行為不變)。
3. 內容:termignoni / brembo 品牌頁(若 Q2 甲)。
4. 匯入:DBK 乾跑五關 → 差集 = 211 件 → 寫入;Öhlins / Akrapovic 料號比對。
