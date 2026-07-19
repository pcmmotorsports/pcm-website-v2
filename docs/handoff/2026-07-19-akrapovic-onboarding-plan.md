# akrapovic 接顧客站 Plan(鐵則 8,待 Sean 批准後執行)— 2026-07-19

> 背景:akrapovic 從未接上網站端(2026-07-10「8+1 家品牌放量」清單漏列,查證=遺漏非刻意)。
> Sean 2026-07-19 拍板 Q1=A:三家上架順序 akrapovic → kspeed → lightech,akrapovic 先行。
> 審查:Sean 指定 Fable 或 Codex。

## 1. 為什麼 akrapovic 最適合先上(2026-07-19 MCP 實查)

| 項目 | 實查值 | 意義 |
|---|---|---|
| view 內列數 | 648 列 = 648 群(單變體) | 無 spec 軸 → 零 pv_spec 撞鍵風險 |
| 價格 | 648/648 有價 | 「僅 1/3 有 WRS 價」備註=fetcher 已濾無價款,DB 內全有價 |
| 車款字典 | 443 款 0 未對上 | 全庫最乾淨 |
| v2 分類 | 648/648 有值,10 個分類對 | null-v2 閘 0% |
| 圖片 | 100% https,518 群多圖 | 無 lightech 式 http 問題 |
| 原文/說明書 | description 642、PDF 635、video 0 | syncDescription/InstallResources 都開 |
| 中文名 | 54 列缺(→ Phase B 補) | 不擋乾跑,見 §4 |

## 2. 要改什麼(全部只有 2 檔,無 migration)

**已實查免做**:網站 brands 表已有 `akrapovic` 列(0 商品);10 個分類對 `categories.raw_path`
全部命中(逐對 SQL 驗過,含 車身防護與防摔·引擎護蓋與護桿 / 外觀與後視鏡·土除與外觀飾蓋)。

### 改動 1:`scripts/supplier-config.ts` 新增條目(writeAllowed:false 起手)
```ts
akrapovic: {
  supplierSlug: 'akrapovic',
  brandSlug: 'akrapovic',            // brands 表已有列(MCP 實查 2026-07-19)
  handlePrefix: 'akrapovic',
  syncDescription: true,             // 642/648
  syncInstallResources: true,        // PDF 說明書 635 群;video 0
  categoryStrategy: { kind: 'per-group' },  // 10 對,排氣系統為主
  variantImages: 'per-variant',      // 單變體群,直用該變體圖
  writeAllowed: false,               // 🔴 乾跑+審查+Sean 批後才翻 true
},
```
+ `scripts/supplier-config.test.ts` 同步補對照測試(比照 ebc/materya 條目)。

### 改動 2(開寫階段才做):`.github/workflows/rpm-sync.yml:42` matrix 加 `akrapovic`

## 3. 執行順序與關卡

1. ✅ 改動 1 → 三綠實跑(typecheck/lint/build)+ vitest 全套 2,468 綠 → **乾跑全綠**
   (648 群、分類 648/648、handle 0 撞、價格異常 0、無旗標 abort=防呆實證)
2. ✅ Codex 對抗審查 R1(gpt-5.6-sol high):**本 diff 可 commit;4 must-fix 全部擋在開寫前**(見 §3-1)
3. ✅ commit(不 push)
4. 報價單側商品名補車款(Phase B)落地
5. **開寫前置 §3-1 逐條清掉** → Sean 拍板 → writeAllowed→true + matrix 加列 → commit → **Sean push** → 首灌
6. 隔日驗證:648 群上站、抽 3 群比對報價單源、顧客身分 RLS 抽驗

### §3-1 開寫前 must-fix(Codex R1 2026-07-19,不清不開寫)

| # | 問題(首灌=target 0 時) | 處置 |
|---|---|---|
| M1 | 價格離群檢查只掃「變價」,首灌全是新品 → 價格錯 100 倍也放行(`rpm-delta.ts:96-117`) | 首灌前跑獨立驗價:新品價 vs 報價單源逐筆比對腳本,或 rpm-import 加新品絕對價檢查 |
| M2 | W1 縮水閘 target=0 恆過 → 來源殘缺(如只抓到 500/648)也放行(`rpm-preflight.ts:55-63`) | 首灌帶預期群數指紋(648)守門;不符即停 |
| M3 | 寫入非原子(products 分批 500 → variants),中途失敗留半套商品上架(`rpm-import.ts:406-437`) | 首灌採**受監控手動執行**(非交給排程),備妥立即下架補償程序;失敗即清 |
| M4 | writeAllowed 硬鎖只有值測試,guard 被改測試仍綠(`supplier-config.test.ts` vs `rpm-import.ts:110-118`) | 補 CLI 整合測試:akrapovic+--confirm-write 須在建線前 throw |

nit 已清:exact-keys 測試標題補「第三批」。nit 留檔:`categoryStrategy` 是死欄位(僅 config/測試消費,
實際分類走 v2 兩欄路徑)— 屬既有設計債,不在本 plan 範圍,記錄不動。

## 4. Phase B(報價單側,平行進行,另一份改動)

Q2=A 商品名補車款:223 個同名「Slip-On Line」+ 54 缺中文名,改 `lib/translators/akrapovic.py`
以 fitment 組名(比照 evotech「品名 - 車款」)。既有 594 列是機器鎖(translation_locked=true、_at=null),
翻譯器改好後**需一次性 include-locked 回填**(僅機器鎖列,Sean Q2 拍板即授權,仍出 .command 由 Sean 雙擊)。
**時序建議:Phase B 落地後再開寫(§3 步驟 5),讓顧客第一眼看到的就是帶車款的名稱。**

## 5. 風險與回滾

- writeAllowed:false 起手=改動 1 上線後**零寫入行為**,乾跑不動 prod。
- 開寫後要回滾:matrix 拔列 + writeAllowed→false;已寫入的 648 商品可留(來源消失會走 S4 對賬下架)或按需清。
- 首灌大量寫入的既有防護:W1/S4/null-v2/handle/價格異常 10 道閘全程在(見 rpm-import.ts)。
- 已知非風險:akrapovic 無 spec 軸(不撞翻譯線)、不同 repo(不撞報價單兩線)。

— 批准後開工;不批不動。
