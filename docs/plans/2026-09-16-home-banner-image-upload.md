# 首頁大圖「上傳圖片」plan(2026-09-16 設計窗)

> 鐵則 8 的 plan。**Sean 批了才動碼。** 現在零改碼、零建桶、零上傳。
> 起因:Sean 2026-09-16 裁「丙 = 開一條上傳的路」。他先挑了 Bonamici 大圖的 A 版(裝車照),
> 而 A 版是**我們裁過的圖**(裁掉官網燒在上面的字)⇒ 官網沒有那個網址 ⇒ 沒地方放 ⇒ 那張大圖上不了線。

## 1. 為什麼要做(全部實查,不是推論)

| # | 查到什麼 | 出處 |
|---|---|---|
| 1 | 後台大圖那一格**只收一串文字、只驗 https**,沒有「選檔上傳」 | `apps/admin/src/lib/home-banners/home-banner-form.ts:82`(`readText`)、`:104`(`isHttpsUrl`) |
| 2 | `image_desktop_url` / `image_mobile_url` 的 DB CHECK 是 `^https://…` ⇒ **相對路徑會被擋** | `home_banners` 表 CHECK |
| 3 | 整個 repo **沒有任何上傳碼**:`S3Client` / `PutObject` / `storage.from(` / `createSignedUploadUrl` / `R2_` 掃 `apps` `packages` `scripts` ⇒ **0 命中**(唯一命中是 storefront dev-preview 的寫死示範網址) | grep |
| 4 | `image_origin` 的 CHECK 收 `'supplier_url' \| 'storage'` ⇒ **`storage` 這個值存在於 schema,而沒有任何程式產得出它** | `home_banners` 表 CHECK |
| 5 | 🔴 **Supabase Storage 有裝,但一個桶都沒有** | 見下方 §2 的實查 |
| 6 | 唯一存在的圖床是**報價單的商品圖桶** `pub-267d5f9578a344cc92267571caab1743.r2.dev` ⇒ **明令不准碰** | 分配單 ③④、主視窗四次 |

**⇒ 結論:不是「少一個按鈕」,是這條路整條不存在。**

## 2. 放哪裡 —— 選 **Supabase Storage**(不開新服務)

實查(2026-09-16,`pcm-website-v2` = `bmpnplmnldofgaohnaok`,唯讀 SELECT):

```
storage 這個 schema 的表數  8   ← 🔬 正對照:查得到 ⇒ 我的查詢是活的
storage.buckets            0   ← 真的 0,不是查不到
storage.objects            0
public.home_banners 列數    0   ← 📌 順帶證實:正式站現在【一列大圖都沒有】
public.brands 列數         25   ← 🔬 第二個正對照
```

> ⚠️ 先前用唯讀 psql 帳號查同一格是 `permission denied for schema storage`(= 沒查到),
> 這次換成看得到的身分重查才拿到 0。**兩者不可混為一談。**

**選它的理由(不是偏好,是省掉整包新東西):**
- 同一個 Supabase 專案、同一套 auth 與 service_role,後台本來就在用(`createSupabaseServiceClient()`,`@pcm/adapters/server`)。
- `@supabase/supabase-js@^2.105.3` **已經是相依**(`package.json:212`),Storage API 內建 ⇒ **零新套件、零新帳單、零新 secret**。
- 公開讀取的桶給的就是 `https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>` ⇒ **直接滿足現有的 https CHECK,不用改 schema。**

**沒有選 Vercel Blob / R2 的理由:** 兩者都是新外部相依 + 新 secret + 可能有錢,而上面那條零成本的路沒有被證明不行。

## 3. 誰能傳(碰權限,寫死)

| 項 | 決定 |
|---|---|
| 桶名 | `home-banners`,**public read**(首頁大圖本來就要給客人看) |
| 誰能寫 | **只有 service_role**。桶上不給 `anon` / `authenticated` 任何 INSERT/UPDATE/DELETE policy |
| 客人端 | **client 完全不碰 Storage**。上傳走後台既有的 server action(`home-banner-actions.ts` 那一層),檔案經 server 再進桶 |
| 檔案大小 | `file_size_limit` = **5 MB**(現有 25 張品牌頁圖最大 1156K;大圖用不到 5MB) |
| 允許型別 | `allowed_mime_types` = `image/jpeg` `image/png` `image/webp` **只收圖** |
| 檔名 | **不用使用者給的原名**。伺服器產:`<uuid>.<ext>`,副檔名由**實際嗅探到的 MIME** 決定,不信副檔名 |
| 🔴 裁過的圖要看得出來 | 檔名另存一欄 `rights_note` 寫來源與「我們裁過」,例:`來源 bonamiciracing.it/…/components.jpg;PCM 裁掉上方燒字,未改像素` |

## 4. 後台那一格怎麼變(舊資料一列都不能壞)

現在:一格文字,貼 https 網址 ⇒ 存進 `image_desktop_url`,`image_origin` 由人選。

改後 **兩條路並存**:

```
貼網址(現況,不動)  → image_origin = 'supplier_url'
選檔上傳(新)        → 傳完拿到 public URL 回填同一格 → image_origin = 'storage'
```

- 🔴 `image_origin` 那個 CHECK **本來就是為這件事準備的**,兩個值各自對應一條路 ⇒ **不用改 schema、不用 migration。**
- 🔴 **既有列不動**:現在是 0 列(§2 實查),而將來貼網址的列仍走 `supplier_url`,行為一字不改。
- 上傳只是**多一個產出 URL 的方式**;URL 產出來之後,後面那整段(驗 https、存草稿、發布)**完全沿用現有的路**。

## 5. 影響 / rollback

**會動到的檔(預估,批准後才動):**
```
apps/admin/src/lib/home-banners/home-banner-actions.ts   多一個 uploadBannerImage server action
apps/admin/src/app/home-banners/page.tsx                 那一格旁邊多一顆「選檔上傳」
packages/adapters/…                                      若要共用上傳,放這裡;否則不動
supabase/migrations/                                     ⚠️ 建桶與 policy 是 DDL ⇒ 要一支 migration
```
🔴 **「不用 migration」那句只對欄位成立** —— 建桶與桶的 RLS policy 仍然是 DDL,要一支 migration,而且**貼板的人是 Sean**(或他明文授權的那一次)。

**rollback:**
- 碼:revert 那顆 commit ⇒ 後台那格退回只能貼網址,**已經存好的 `storage` 那種列仍然活著**(URL 還在、桶還在)。
- 桶:`drop bucket` 會把圖一起帶走 ⇒ **先把引用到那些 URL 的大圖列改回 supplier_url 或下架,再刪桶**,順序寫進 runbook。
- 🔴 **傳上去的圖誰能刪**:只有 service_role(= 後台),客人端沒有刪的路。後台要不要做「刪圖」按鈕 = **本片不做**(YAGNI),要刪先走 Dashboard。

**怎麼證「上傳真的成功了」而不是只證「按鈕按得下去」:**
- 🔴 三綠證不到這件。要一格**真的傳一張進去、再用回傳的 public URL fetch 回來比 byte 數**的檢查。
- jsdom 證不到「畫面上看得到那張圖」⇒ 那一格留給 Sean 走一遍,不宣稱測過。

## 6. 鐵則 12

**這一片碰【對外寫入 + 權限 + migration】三項 ⇒ 適用。**
codex 額度 09-20 12:12 才回 ⇒ 期間走 `adversarial-reviewer`(opus)。
R1 PASS 就收工;R1 有必修才 R2;R2 還有必修 ⇒ 停下端主視窗,不跑 R3。

## 7. 做完之後那張大圖怎麼上

1. 傳 A 那張裁過的圖進 `home-banners` 桶 ⇒ 拿到 public URL。
2. 後台建一列(**走 CRUD,不是改碼**),欄位照 `~/pcm-mailbox/bonamici-大圖草稿-0916/index.html` 那份:
   眉標 `BONAMICI RACING ‧ 車型專用` / 車款 `Kawasaki Ninja ZX-10R` / 大標 `賽道出身的鋁合金部品` /
   副標 `拉桿、三角台、腳踏後移等 33 件`(Sean 拍甲:寫死)/ 按鈕 `看 ZX-10R 能裝的` /
   連結 `/products?vehicle=kawasaki:ninja-zx-10r&pbrands=bonamici`(已在正式站點過,落地印 33 件商品)。
3. 🔴 改完**等過 60 秒**再重整(`home-banner-live-v2` 快取 60 秒;**那個 key 不可以改回 v1**)。
4. 截圖驗**第 1 格** —— 輪播會自動換,靠 `aria-label`「第 1 張:…」認,不要截到第 2 格靜態圖。

## 8. 沒解決的 / 要 Sean 知道

- ⚠️ A 那張是**我們裁的**(裁掉官網燒在上面的字),官網沒有這一版。**更好的解是跟 Bonamici 要無字原檔** ——
  那條路不需要圖床,但要等回信。**兩條可以同時走。**
- ⚠️ A 那張外圈有一層淺色邊框看得到(草稿截圖上就有)⇒ 那是**修圖**,獨立一件,不在本 plan。
- ⚠️ 官網分類圖 600x400 低於 SOP 的 ≥800、b2b 多圖檔名 `_1`/`_2`/`-2`/`_amb` 全 404 ⇒ **「去官網找同款乾淨圖」這條我走過了,是斷的。**
