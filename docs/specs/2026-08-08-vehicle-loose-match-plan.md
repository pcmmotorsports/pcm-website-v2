# 選車欄空格不敏感比對(RS6 → RS 660)· 簡式 plan(等回核)

> 派工=`D-228-A` ② / `D-235-A` ②。Sean:輸入「RS6」要能帶出「RS 660」(現況必須打「RS 6」)。
> 🔴 **派工單寫的方向照字面做會復活一條 codex 當初抓到的 must-fix**,見 §2。**這是本檔存在的理由。**

## §1 片型

| 項 | 判定 |
|---|---|
| 片型 | **標準片**,從嚴(動全站選車比對核心、貼車種鐵律紅線)|
| 內容分級 | L1 |
| 鐵則 8 | ✅ **命中**(動 `lib/vehicle-match.ts` = 全站選車的共用比對核心(**11 個掛載點**;每個 `VehicleSelect` 各渲染三欄,實際受影響欄位更多))⇒ 本檔即 plan |
| 鐵則 12 | ❌ 未命中(零錢/權限/schema/平台設定;純 client 比對邏輯)|

## §2 🔴 派工單的「把候選與輸入都正規化(去空格)再比」不能做在 `normalizeVehicleQuery`

`normalizeVehicleQuery`(`vehicle-match.ts:8`)**有四個消費者,其中兩個在資料層**:

| 用途 | 位置 | 去空格/連字號的後果 |
|---|---|---|
| 打字過濾 | `filterVehicleOptions` → VehicleSelect / FilterDrawerVehicleTab / garage-chip 建議清單 | ✅ **這正是我們要的** |
| 唯一精確命中(自動套用) | `uniqueExactMatch` → VehicleSelect blur 自動套用、車庫 chips | ⚠️ 門檻變鬆、會自動套上客人沒指名的車 |
| 🔴 **taxonomy 節點去重鍵** | `vehicle-taxonomy.ts:76-77` | **兩個不同車款被折成同一個節點** |
| 🔴 **PDP 適用性比對** | `fitment-match.ts:40-43` | **假的「✓ 適用」** |

`vehicle-taxonomy.ts:20-21` 的註解**逐字預先寫了警告**:「**空白與連字號不互折**,仍保留兩節點」。
`fitment-match.ts:6-10` 更明確,那是 **codex 當初的 MF-1**:

> 廢除 slugify 橋接——slugify 會把「MT 09」與「MT-09」壓成同一 slug…回 slug 比對會丟失序號
> → **選 A 車命中 B 車 fitment 的假 ✓**。名稱字面 NFKC 保留「**空白≠連字號**」的區分

而同檔 `:3` 逐字:「🔴 §7 正確性紅線:**錯誤的「✓ 適用」比空白更糟(買錯裝不上=信任毀)**」。

⇒ **`normalizeVehicleQuery` 一個字都不能動。** 照派工單字面改它,等於把那條已修的 Critical 原封復活。

## §3 要改什麼

**新增一支只給「打字過濾」用的寬鬆鍵**,放同檔:

```
/** 寬鬆比對鍵:在 normalizeVehicleQuery 之上再去掉分隔符(空白/連字號)。**只給打字過濾用。** */
export function looseVehicleKey(s: string): string {
  return normalizeVehicleQuery(s).replace(/[\s-]+/g, '');
}
```

**只有 `filterVehicleOptions` 改吃它**;`uniqueExactMatch` 與另外兩個資料層用途**逐字不動**。

### 3-1 為什麼「過濾寬鬆、套用嚴格」是對的(不是偷懶)

兩者猜錯的代價**不對稱**:
- **過濾**寬鬆最差 = 候選清單多幾筆,**客人自己挑** ⇒ 沒有錯誤結果落地。
- **自動套用**寬鬆 = 客人打「rs6」被系統直接套上「RS 660」,但他要的可能是「RS 660 R」
  ⇒ 他沒指名、系統替他決定了 ⇒ 違反 REQUIRED-2「唯一精確命中才自動套用」的零猜規格。

### 3-2 去哪些字元:`\s` + `-`,不多不少

- `-` 是必要的:派工單自己舉的第二例 **`gsx8` → `GSX-8S`** 沒有去連字號就命中不了。
- 不去 `.` `/` `+` 等:現行車款字面沒有靠它們區分的證據,**多去一個字元就多一分誤命中**,
  等有實例再加(而且過濾誤命中不會產生錯誤結果,不必預先擴大)。

## §4 驗收(每條配只紅自己的突變)

1. `RS6` → 命中 `RS 660`(Sean 原始需求;突變:`filterVehicleOptions` 改回吃嚴格鍵 ⇒ 只紅這條)
2. `gsx8` → 命中 `GSX-8S`(連字號那半)
3. 🔴 **`uniqueExactMatch` 不受影響**:~~`rs6` 不會自動套用 `RS 660`~~
   → 落地為 **`RS660`(只差一個空格)不會自動套用 `RS 660`**。
   🔴 **原本那個輸入殺不死突變**:`rs6` 在寬鬆化之後仍 ≠ `rs660`(exact 要求全等、不是 prefix)
   ⇒ 讓 `uniqueExactMatch` 吃寬鬆鍵之後它照樣回 null、測試照樣綠 = **零判別力**(突變矩陣當場抓到)。
   真正會被寬鬆化翻面的是「字面只差分隔符」那格。(突變:讓它也吃 `looseVehicleKey` ⇒ 只紅這條)
4. 🔴 **taxonomy 不折節點**:`MT 09` 與 `MT-09` 仍是兩個節點(突變:`vehicle-taxonomy` 改吃寬鬆鍵 ⇒ 只紅這條)
5. 🔴 **PDP 適用性不變寬**:選「MT 09」不得命中「MT-09」的 fitment(假 ✓ 回歸格;
   突變:`fitment-match` 改吃寬鬆鍵 ⇒ 只紅這條)
6. 既有「輸入即過濾」行為不回歸(prefix 優先於 substring 的排序、空查詢回全清單)
7. 大小寫/全形半形行為**逐字不變**(仍由 `normalizeVehicleQuery` 承擔)

⚠️ **真瀏覽器**:本片是純函式 + 一處接線,jsdom 足夠;但「打 RS6 看得到 RS 660」這格
值得 Sean 在真站點一次(worktree 無 DB、選車清單是空的,**我這邊構造不出真資料的端到端**)。

## §5 Rollback

單一新純函式 + 一行接線,`git revert` 即完整回退;零資料面、零 schema。

— site-redesign 窗,2026-08-08
