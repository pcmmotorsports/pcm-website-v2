# 經銷價要第一次灌進顧客站之前(給按按鈕的那個人)

> 🔴🔴 **這一份的權威是別人**:內容以 `~/pcm-mailbox/plan-DEALERPRICE-A-現行做法-20260907.md`
> 的 **2026-09-07 14:41:45 版**(當場 `stat` 量的 mtime)為準。
> ⚠️ **那份 A 檔【還在動】** —— 已知未定的兩格:商品層「讀不到 ⇒ 不輸出整欄」(auth `ee62f287d` 之後)
> 與 `rpm-load` 分批那一格。**本檔與 A 檔對不上 ⇒ 以 A 檔為準, 不是以本檔為準。**
> 🛑 **B 檔的決策史本檔不抄** —— 抄了會變成第二份會過期的權威。
>
> 🔵 **形狀照 `docs/runbooks/hct-first-shipment-activation.md`**(同一個母題:一個不可逆的第一發)。

---

## 一、按鈕的人是誰

**A(主視窗)** —— 因為那顆按鈕是 `gh secret set DEALER_PRICE_SUPPLIERS`,而 secret 只有他設得動。
🛑 **施工窗不設 secret、不 dispatch。** 施工窗做的是本機唯讀 dry-run 與讀數。
🔴 **而「A 按」不等於「A 決定」** —— 決定的人是 Sean,他要說**一個字**(見第三關)。

---

## 二、按之前:這五道門。**任何一道答不出來 ⇒ 今天不灌。**

### 門 1 · 兩把 secret 都在
`DEALER_PRICE_DATABASE_URL`(有值)· `DEALER_PRICE_SUPPLIERS`(**先設成空字串**)。
🔵 **漏設不會炸整支** —— 在 allowlist 裡而缺 URL 走 **A2**(那一家跳過 + 紅字 + 標降級)。
🛑 **而仍然要確認**,因為 A2 的代價是**那一家的變體整輪都不更新**(不只價,新品與孤兒也順延)。
⚠️ **值不進這份文件、不進對話、不進 log。** 憑證在 `~/pcm-secrets/dealer_price_reader.env`(600),
   **在 shell 組成 URL 再餵,組 URL 那一行不進 log**。

### 門 2 · allowlist 空的第一發跑過,而且【三個基線數沒有行為差】
先 merge、`DEALER_PRICE_SUPPLIERS` **保持空字串**,dispatch 一發。
**硬閘(不過就停)**:前後 `price_store` 非 null 筆數不變(今天 1)且商品層 `store <> general` 仍 0。
**只並排看、不判定**的三個數(跨日本來就有來源漂移):upsert / 孤兒 / `price_general` 改動。
基線 = 09-06 schedule run `34022762858` 的 rpm job:來源 9,015 · 孤兒 96 不刪 · WRITE 1,122 商品 / 8,041 變體。

### 門 3 · 本機唯讀 dry-run 的三格讀數
指令 **`rpm-import --dry-run`**(顯式旗標,`scripts/rpm-import.ts:116`)。
⚠️ **兩個旗標都不帶會走寫入模式閘、第一道就 throw** ⇒ 拿不到完整報告。
要落 handoff 一段 + 板列一格的:**checksum · 三堆 count · 值域異常 · 時點+分支+HEAD**。
🔴 **checksum 不是只印,是要【綁定】**:dry-run 產 `(supplier_slug, sku, price_store)` 的 sha256,
   **給 `workflow_dispatch` 加一個 input 收它**,寫入前重算比對,不同就停那一家的經銷價那一半。
   📌 **沒有這一步,「Sean 核准的那批」與「真正寫進去的那批」沒有任何綁定。**

### 門 4 · Sean 說了那一個字
**「灌」** —— 他說了,A 才 `gh secret set DEALER_PRICE_SUPPLIERS=rpm`。
🛑 沒有那個字 ⇒ 不設、不 dispatch。**「他上次說可以」不算**(那是別的東西的可以)。

### 門 5 · pre-image 先取,再 dispatch
順序**不可以顛倒**:先取 pre-image ⇒ 才 dispatch。
落點 `~/pcm-preimage/dealerprice-<UTC 時戳>/`(700+600,**repo 外**),
內容:整列 · `variants.jsonl` / `products.jsonl` / `MANIFEST`(筆數 + sha256 + 時點)。
🛑 **不能更早取** —— ①②之間每日同步照跑、列會動 ⇒ 早取的 pre-image 到首灌時已經過期。

---

## 三、停法只有三態(逐字抄 `~/pcm-wt-auth/scripts/dealer-price-gate.ts`,`origin/dev` 的 `5719e56e9` 版)

**八個觸發條件, 一條對一個動作 —— 照抄, 沒有改寫:**
```
upstream_key_not_unique  ⇒ A1_carry_old
illegal_key              ⇒ A1_carry_old
missing_over_threshold   ⇒ A1_carry_old
checksum_mismatch        ⇒ A1_carry_old
old_values_read_short    ⇒ A2_skip_family
local_key_not_unique     ⇒ A2_skip_family
missing_upstream_url     ⇒ A2_skip_family
value_out_of_range       ⇒ report_only
```
**三態各是什麼(碼裡的原話, 我只轉成白話, 沒有加條件)**:
- **A1 · 帶舊值** —— 上游有問題,**而本站舊值讀得到** ⇒ 那一家全部帶舊值(每一列都把 `price_store` 鍵帶上、值 = 本站現值)。其餘同步照常完成。
- **A2 · 整家跳過** —— **本站舊值讀不到、或本站鍵不可信** ⇒ 那一家這一輪**整個變體同步跳過**(不呼叫變體同步 RPC)。這一輪標【降級完成】**不是【成功】**。
- **report_only · 只印不停** —— 資料長得怪,而不是我們算錯 ⇒ 照常寫,只把可疑的列印出來。
🔴 **A1 與 A2 都要印成紅字 + 進 handoff, 不是靜靜跳過。**
🛑 **停整支 job 的情況【一種都沒有】** —— 經銷價的任何狀況都不得 abort 共用管線
   (會連 `price_general`、新品、下架對賬一起停)。**停的是【經銷價那一欄】, 不是【那支 job】。**

---

## 四、灌下去之後怎麼看「真的進去了」

🔴 **不看 workflow 綠不綠, 看三格 count 有沒有動** —— 被丟棄的 run 在 Actions 上**不留紅**。
dispatch 之前先看 Actions 有沒有 running/pending 的 `rpm-sync`(有就等)。
⚠️ **排程時刻不可預測**(實測 11 發:9 發台灣 16:28–19:17、2 發深夜)⇒ **靠看 Actions, 不靠挑時間**。

---

## 五、怎麼退(**這一節請整段讀完再開始**)

**回退 = 兩步, 順序不可換**:
1. **allowlist 清空**(`gh secret set DEALER_PRICE_SUPPLIERS=` 空字串)——
   ⚠️ **每次貼完整名單, 不貼增量**(`gh secret set` 沒有 append 語意)。
2. **下一輪同步會【帶舊值】把價寫回去** —— 不在名單的家走的就是 A1 那條路。
🔴 **「不動」的實作【不是不送那個鍵】** —— 缺鍵 = NULL,而同步 RPC 是無條件覆蓋
   ⇒ **不送鍵 = 清價, 而且零紅**。所以不在名單的家**也要讀舊值、也要把鍵帶上**。

🛑 **止血只有一根桿子:收掉那個人的 store tier。**
   **把 `price_store` 清成 NULL【不是止血】** —— 會整批落回「多收 5%」。

🔴 **救不回來的東西(誠實版, 不要略過)**:
- 那一跑的**孤兒硬刪**(`scripts/rpm-import.ts:750-751`)—— UPDATE 型 pre-image 救不回被刪的列,
  也救不回被 `SET NULL` 的 `order_items.variant_id`。
- **沒有 canary**:`.github/workflows/rpm-sync.yml` 沒有 `--group` / `--limit`
  ⇒ **最小顆粒是整家**(rpm 8,041 筆一次到位)。
- **還原時間未量** —— 寫入端實測 10-13 分/全 matrix,而還原是另一個方向、**沒有人跑過**。
**還原前**:先比 MANIFEST 的筆數與 sha256,**不符就停, 不還原**。
**失敗處置**:可重入(以 `(supplier_slug, sku)` 冪等);**連兩次失敗就停, 不跑第三次**。

---

## 六、這份文件答不出什麼(不要把它讀得比它大)

- **它不是權威** —— A 檔才是,而 A 檔**還在動**(檔頭已標 mtime 與兩格未定)。
- **它不涵蓋 extreme 那一步** —— 那一步是**本機寫入**(`rpm-import --confirm-write`),
  與「零本機寫入」相反 ⇒ **要 Sean 另一個字**,不得順手做掉。細節看 A 檔 §落地順序 ⑥。
- **它不涵蓋端到端(結帳那段)** —— 動手前先讀 `~/pcm-mailbox/plan-QB12-v3-Sean親跑-20260907.md`。
- **它答不出「灌完之後對不對」** —— 收工條件是「仍未灌價的變體數歸零」+ 覆蓋率驗過,
  **不是「18 家都跑過一次」**;而那個分母要**排除已知例外**(`manual` 那 1 筆上游零列、永遠不會有)。
- 🔴 **它不會提醒後台那一頁**:灌完之後**後台商品頁的價不再等於經銷客看到的價**,
  而看那頁的員工**不會知道**(`apps/admin/src/lib/products/product-repository.ts:96` 只 select `price_general`,
  同檔 `:92` 逐字禁止加入 `price_store` —— 那是**刻意排除、防外洩**,有測試釘著)。
  ⇒ 「要不要在後台標一句『經銷價另計』」**是另一片**,這裡只負責讓它被看見。

---

### 附註:本檔引用的路徑, 我逐一 `test -e` 驗過(2026-09-07)
```
~/pcm-mailbox/plan-DEALERPRICE-A-現行做法-20260907.md   ✅
~/pcm-wt-auth/scripts/dealer-price-gate.ts              ✅
scripts/rpm-import.ts · rpm-transform.ts · rpm-fetch.ts ✅
.github/workflows/rpm-sync.yml                          ✅
docs/runbooks/hct-first-shipment-activation.md          ✅
apps/admin/src/lib/products/product-repository.ts       ✅
~/pcm-secrets/dealer_price_reader.env                   ✅(只驗存在, 沒開它)
```
⚠️ **`test -e` 只答「那個路徑今天在」** —— 答不出裡面的行號還對不對。引用行號前自己開一次。
