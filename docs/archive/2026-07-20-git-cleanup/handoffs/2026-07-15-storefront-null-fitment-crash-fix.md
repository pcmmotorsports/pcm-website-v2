# 作業單:商品頁 null 廠牌/型號 fitment 防呆修復(SSR crash 止血)

> 2026-07-15 由報價單 repo(PCM報價單-V2)調查 session 建立,唯讀查證+本檔,未動本 repo 其他檔案、未 commit。
> Sean 已拍板兩路修復:①本 repo 防呆止血(本作業單)②報價單側資料清理(該 repo 進行中)。

## 症狀與證據

- Sean 回報顧客站商品卡點開「404」,實為 Next.js client 錯誤畫面(This page couldn't load)。
- Vercel runtime error 群組(prj_4yNDP3XOt202tQIlYwF9auf5fLN7):
  `TypeError: Cannot read properties of null (reading 'trim')`,route `/products/[slug]`,
  **31 次/3 使用者**,first 2026-07-12T15:17Z、last 2026-07-15T02:01Z(與 Sean 回報時間吻合)。
  兩個 digest(3608893429/794305043)= 同一行兩個相鄰 `.trim()` 呼叫。
- 資料證據(website DB `products.fitments` jsonb):例 `handle='front3d-f3d-oth-007'` 含
  `{"modelCode":"GasGas 700 SM/Enduro","motoBrand":null}`。
- 影響面(2026-07-15 10:00 查):**55 個未下架商品/82 筆 fitment 條目** motoBrand 或 modelCode 為 null。

## 根因

`apps/storefront/src/components/product-card-fits.ts:49`(origin/main):

```ts
const key = `${f.motoBrand.trim()} ${f.modelCode.trim()}`;
```

`UIFitment.motoBrand`/`modelCode` 實際可為 null(上游 jsonb 直透),無防呆 → SSR 整頁炸。
注意 crash 在 **main(production)**;dev 分支同檔同樣寫法(dev 另有 toCardFitments 白名單,
是否已擋 null 請以 dev 現碼為準查證,勿假設)。

## 修法(建議最小 diff)

1. `formatCardFits` 迴圈內防呆:motoBrand/modelCode 非 non-empty string 的條目 **略過**
   (降級不炸頁;略過後若 byModel 為空 → 回 fallback)。或在資料進入點
   (`toCardFitments`/`catalogRowToUIProduct` 白名單)過濾非字串條目,兩處擇一,以資料進入點為佳。
2. 回歸測試:fitments 含 `motoBrand:null`/`modelCode:null`/兩者皆 null 的條目 → 不 throw、
   輸出降級正確(其餘正常條目照算;全髒 → fallback)。
3. 佈署注意:修復需到 **main/production** 才會止血;dev→main 的升版與 M-4a 進行中工作糾纏
   (07-12 已拍暫緩 FF),cherry-pick 或升版路徑由本 repo session 依現況判斷,先問 Sean。

## 資料側(報價單 repo,平行進行)

源頭=報價單庫 `fitment_parsed` 空值條目(129 個上架商品;storefront_catalog_v 仍輸出 94 群),
該 repo 正在走字典/parser 正規路徑清理+對抗驗證;清完後每日同步會自然沖掉本 repo 髒 jsonb。
防呆仍必要(保護未來任何髒資料)。

## 驗收

- 上述回歸測試綠;`/products/front3d-f3d-oth-007?from=catalog&category=…` 在資料仍髒的情況下可開。
- Vercel 該錯誤群組部署後不再新增。
