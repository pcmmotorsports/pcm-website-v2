# `#528` slice plan · `OPENING_HOURS` / `STORE_ADDRESS` 顯示點改吃 SSoT

> 作者:G1 · 落檔 2026-08-18 23:4x CST(`date` 實跑)
> 🔴 **狀態:尚未批准。** 命中鐵則 8(跨 3+ 檔)⇒ 等 Sean 點頭才動手。
> 🔴 本檔的數字全部是 2026-08-18 23:3x 當場量的,**會過期,引用前重量**。

## ① 標籤
- **L 分級:L1**(營業日/地址,年 0-1 次)⇒ 依鐵則 9,hardcode 可、**不需要後台 CRUD**。
- **片型:標準片**(不碰 packages/ui、金流、schema、auth、平台設定)。
- **鐵則 8:命中**(5 檔)⇒ 本檔就是那份 plan。
- **鐵則 12:未命中**(六類逐字對過:錢/權限/DB 結構/平台設定/對外不可回收/共用元件行為,零命中)。

## ② 病灶(當場量,非引用)

```
git grep -nE '週一[-–]週六' -- apps/storefront/src        # ⇒ 12 行(含測試與註解)
git grep -n 'STORE_ADDRESS' -- apps/storefront/src        # ⇒ 見下方分類
```
**逐行分類後的顯示點**(這才是數字,不是上面的行數):

| 顯示點 | 星期 | 地址 |
|---|---|---|
| `components/ComingSoon.tsx:199` / `:2xx` | 🔴 硬寫 `週一-週六` | 🔴 硬寫 |
| `components/HomeFooter.tsx:138` / `:126` | 🔴 硬寫 `週一-週六` | 🔴 硬寫 |
| `components/MobileMenu.tsx:73` / `:72` | 🔴 硬寫 `週一-週六` | ✅ 已吃 `STORE_ADDRESS` |
| `data/legal-content.ts:57` / `:39` | ✅ 從 `days` 推導(`週一至週六`) | ✅ 已吃 |
| `lib/org-jsonld.ts:55` / `:47-51` | ✅ 直接吃 `days` | ✅ 已吃 |

🔴 **`#528` 條目裡「`STORE_ADDRESS` 消費端側完全沒量過」那一格,本 plan 把它量了**:
**地址同款落差確實存在,在 `HomeFooter.tsx:126` 與 `ComingSoon.tsx`**(兩處都有註解自陳是既有技術債)。
⇒ 依 Sean 2026-08-18 常設偏好「不要做一半」,**兩半一起做**,不拆成兩片。

## ③ 為什麼要修(鐵則 10「不修未來會痛在哪」)
Sean 哪天加開週日 ⇒ **法律頁正文與餵搜尋引擎的 JSON-LD 會跟著變,三個畫面顯示點不會**
⇒ 同一個站對營業日講兩種話,**而其中一份有法律效力**。
⚠️ 既有守門 `lib/site-config-wiring.test.ts` **只驗「有沒有取用 opens/closes/days 任一欄」**
⇒ 只吃時段、不吃星期的檔**照樣通過** ⇒ 它現在會給人「已經接上了」的錯覺。

## ④ 改法(最小;**搬既有邏輯,不新寫**)

`data/legal-content.ts:40-66` 已經有一份**寫得很好**的英→中星期推導
(連續 → `週一至週六`;不連續 → `週一、週三、週五`;**連續性實際判斷、不假設**)。
⇒ **把它從 `legal-content.ts` 搬到 `lib/site-config.ts` 旁邊,匯出成函式,四個消費端共用。**
不新增檔案、不新增依賴、不做抽象層。

```
lib/site-config.ts   + export function openDaysLabel(joiner = '至'): string   ← 從 legal-content.ts 整段搬
                     + export const STORE_ADDRESS_LINE                        ← 地址那半同理
data/legal-content.ts  改成 import(刪掉本地那 27 行)
components/HomeFooter.tsx   `週一-週六` → {openDaysLabel('-')}  ／ 地址 → STORE_ADDRESS_LINE
components/ComingSoon.tsx   同上
components/MobileMenu.tsx   `週一-週六` → openDaysLabel('-')(地址已經對了,不動)
```

🔴 **分隔符不同不是筆誤,是兩種文案**:法律頁用「週一**至**週六」、畫面用「週一**-**週六」
⇒ 所以是 `joiner` 參數,**不是統一成一種**(統一 = 偷改 design 的字面 = 鐵則 1)。

## ⑤ 🔴 驗收條件(每條可 yes/no)

1. **今天的畫面一個字都不能變**:`openDaysLabel('-')` ⇒ `週一-週六`、`openDaysLabel('至')` ⇒ `週一至週六`。
   既有斷言 `Header.test.tsx:388` 期望 `'週一-週六 10:00-19:00'` **不修改就要綠**。
2. **突變測試(這片唯一的那道檢查)**:把 `OPENING_HOURS.days` 加一個 `'Sunday'`
   ⇒ **四個顯示點與法律頁、JSON-LD 全部跟著變**;改回來 ⇒ 全部復原。
   🔴 **負向對照**:突變前先跑一次確認是綠的,否則我量的是另一個世界。
3. `site-config-wiring.test.ts` 補一格:**「取用 days」而不只是「取用 opens/closes 任一」**
   —— 否則本片修完,那支守門仍然分不出修沒修。
4. 四綠(`TURBO_FORCE=1`,動 .ts/.tsx ⇒ 含 build)全 rc=0。
5. `bash scripts/literal-sweep.sh '週一-週六'` 收工前跑一次,確認沒有漏網的硬寫載體。

## ⑥ 影響面 / rollback
- **影響面**:5 個 storefront 檔 + 2 支測試。**零 schema、零 API、零 migration、零部署設定**。
- **rollback**:單一 commit,`git revert <sha>` 即可。沒有資料面副作用。
- **風險**:唯一的風險是「搬過去之後字串變了而沒人發現」⇒ 驗收條件 1 就是為它設的。

## ⑦ 我沒做的事(講清楚,免得被讀成做完了)
- **不動 `design-reference`**(鐵則 1:design 是真權威;本片只改 storefront 怎麼取值,**不改它顯示什麼**)。
- **不做後台 CRUD**(L1,鐵則 9 不要求)。
- **不碰 `org-jsonld.ts`**(它本來就吃 SSoT,是對的)。
