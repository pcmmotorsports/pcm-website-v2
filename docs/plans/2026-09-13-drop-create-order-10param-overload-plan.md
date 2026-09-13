# plan · DROP 掉 `public.create_order` 的 10 參數多載(鐵則 8)

> 2026-09-13。**只寫這份 .md,零實作、零 commit、不改任何 .sql/.ts。** Sean 已拍「做」,等這份 plan 過鐵則 12 審查再排 apply。
> 起因:memory `project_0909-dealer-price-whole-package-after-launch.md` 第 5 點(2026-09-13 主視窗查到)——
> `create_order` 正式庫有兩個活的多載,10 參那支**稅恆 0、不寫 `price_tax_mode`**,GRANT 給 `authenticated`,是一條「走了會算錯稅」的活路。

## 0 先講結論(三行)

1. 🟢 **這件事已經有人規劃過** —— `supabase/migrations/PENDING-C-drop-create-order-10arg.sql.txt`(2026-09-07 建立,commit `8dc9498bb`)是三步部署(A 建新簽名 / B 部署前端 / C DROP 舊簽名)的第三步草稿,副檔名刻意寫成 `.sql.txt` 不讓它被當成真 migration。本 plan 是把那份草稿的前提補齊、寫成可審可貼的正式 plan,**不是重新設計**。
2. 🔴 **10 參那支今天在 apps/packages 零呼叫端**(掃了 3 處,見 §2)——app 的 `CreateOrderRpcArgs.p_payment_channel` 是必填欄位(非 optional),`charge-actions.ts` 無條件送 11 個名字,PostgREST 用「名字集合」分辨多載 ⇒ 只會命中 11 參那支。
3. 🟡 **殘留風險不是 0,是「未量」** —— PENDING 草稿自己寫的判別訊號是「正式庫最近一筆 10 名呼叫是什麼時候」,那個數字今天沒有人在量(見 §3 殘留風險)。本 plan 把它列成前置閘的第 5 條,apply 當天由執行者決定要不要查 PostgREST/pg 日誌,或退而求其次接受「B 部署後已觀察 6 天(09-07 → 09-13)」這個間接證據。

## 1 改什麼

`DROP FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text);`

**只 DROP 這一個多載**(10 參,無 `p_payment_channel`)。11 參那支(帶 `p_payment_channel`)一個字不碰。

### 1-a 兩支的簽章(2026-09-13 唯讀實查正式庫,`scripts/readonly-prod-sql.sh` 跑 `pg_get_function_identity_arguments` / `md5(prosrc)`)

| | 10 參(**要 DROP**) | 11 參(**不動**) |
|---|---|---|
| identity args | `p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_notification_email text, p_coupon_code text` | 同左 + `p_payment_channel text`(排在 `p_client_ua` 之後、`p_notification_email` 之前) |
| `md5(prosrc)`(**現在**,2026-09-13 讀) | `d17be799fa2e1b33581312b5509fe8b1` | `42a9132a887b1e39995452009dd7cb47` |
| owner | `postgres` | `postgres` |
| `proacl` | `{postgres=X/postgres,authenticated=X/postgres}` | 同左 |
| `proconfig` | `{"search_path=\"\""}` | 同左 |
| 稅 | 🔴 `v_tax` 只初始化 `:= 0`,函式體內**沒有任何賦值**(逐支 grep `v_tax` 驗證過,見附錄 A)⇒ **恆 0** | 依 `v_price_tax_mode` + `p_payment_channel` 算(`exclusive` 且非匯款 ⇒ `round(... * 0.05)`) |

⚠️ **這三個 md5 與更早的兩份紀錄都不同**,照實列出、不裁定原因(未確認,見 §3 殘留風險①):
- migration `20260907040000` 的前置閘寫死期望值 11 參 `962dd03f767074a57335b05415edf3e3` / 10 參 `c37b74c2efdda336e6d588ecf66aa3ca`(那是 2026-09-07 貼那支 migration「之前」量到的值,貼完之後 body 本來就會變,所以不同不是異常)。
- memory `project_0909-dealer-price-whole-package-after-launch.md` 記的是 11 參 `83b2fbb1…` / 10 參 `a44869d8…`(未附完整值、未附讀取時間,標「未確認」)。
- 本 plan §1-a 表格的值是**這次唯讀查詢實測**,附完整 md5 與查詢方式(附錄 B),**這一份才是 apply 當天前置閘要比對的基準**。

### 1-b 誰在 migrations 裡定義過這兩支(附錄 A,逐支列出、供 rollback 抄底稿用)

`grep -ln "FUNCTION public.create_order" supabase/migrations/*.sql` 命中 13 支(按時間序):
`20260604130000`(初版 4 參起手)→ `20260613130000` → `20260614130000` → `20260630120000` → `20260716190000` → `20260716200000` → `20260719120000` → `20260730120100` → `20260825130000` → `20260901003000` → `20260904020000`(段 1-A,新增 `p_payment_channel`,11 參與 10 參**首次並存**)→ `20260906500000`(兩支各一次 `CREATE OR REPLACE`,簽名不變)→ `20260907040000`(**最新**,兩支各一次 `DROP + CREATE`,補經銷稅邏輯 —— 本 plan §1-a 的兩支現行定義都在這支檔的 145 行與 668 行)。

**最新版**各在 `supabase/migrations/20260907040000_m4b_m208_b2c_create_order_dealer_untaxed.sql`:
- 11 參:145–666 行(含 `p_payment_channel`,有算稅段 548–554 行 = `v_tax :=` 相對函式體第 404/406/408 行,見附錄 A md5 對照)
- 10 參:668–1164 行(無 `p_payment_channel`,`v_tax` 只在函式體第 46 行初始化,**全函式體再無 `v_tax :=`**;收尾 `$fn$;` 在檔案第 1164 行)

## 2 為什麼

那條路「稅恆 0、不寫 `price_tax_mode`」——`orders.price_tax_mode` 欄位的 COLUMN COMMENT(`supabase/migrations/20260905360000_m4b_pricecopytax_p2_manual_order_computes_tax.sql:101`)逐字:
> 「⇒ 新增任何 orders 的 writer 時, 必須決定它寫哪一個值 —— **不寫等於宣稱含稅**。」

10 參那支不寫 `price_tax_mode` ⇒ 依欄位 DEFAULT 落在 `'inclusive'`(含稅)⇒ 若真的有人打到它,系統會用「未稅價 + 恆 0 稅」造一張自稱含稅的單。今天經銷會員 0 人(memory 正對照:`customers.tier` store=0)⇒ 零影響 ⇒ **零影響的時機就是現在**,晚一天等到第一個經銷會員,這條路就從「理論」變成「會做錯帳的活路」。

## 3 影響:誰會壞?

**答案應該是「沒人」,證據分三層:**

### 3-a 呼叫端零命中(掃了 3 處)

1. **`apps/` + `packages/`**:`git grep -n "create_order" -- apps packages | grep -v "\.test\."` 命中約 70 行,逐一過濾後**沒有任何一處呼叫 10 參形狀**。關鍵證據:
   - `packages/adapters/src/supabase/mappers/order.ts:80-84`:`CreateOrderRpcArgs.p_payment_channel` 型別是 `'tappay' | 'bank_transfer'`(**必填,非 optional**),註解逐字「**所以這個鍵【不可以是 optional】** —— 少送一次就會靜靜掉回舊那支」。
   - `apps/storefront/src/app/checkout/charge-actions.ts:403-406`:結帳唯一建單路徑,無條件帶 `paymentChannel`,註解「新舊兩支 `create_order` 靠【名字集合】各自被唯一命中 ⇒ 送它 ⇒ 命中新那支」。
   - `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:703-735`:`placeOrder` 呼 `.rpc('create_order', args)`,`args` 即上述必填 `p_payment_channel` 的物件。
   ⇒ **顧客站與 admin 的 TS 碼裡,沒有任何一條路徑能組出 10 參的呼叫**(型別層面就擋掉了)。

2. **後台手動建單**:`apps/admin/src/lib/orders/manual-order-repository.ts` 等檔案雖然多處提到 `create_order`,但那是「參照它的邏輯」(如白名單、空電話允許值),後台走的是另一支 `admin_create_manual_order` RPC,不呼 `create_order`。

3. **報價單 repo**(`~/API大量上架/PCM報價單-V2`):`grep -rn "create_order"` **零命中**。

⇒ 零呼叫端(掃了 apps/packages 的 TS 碼 + 報價單 repo,共 3 處)。

### 3-b PostgREST 多載解析(fail-loud,不是 fail-silent)

`20260904020000` 檔頭與 `20260907040000:672-679` 都記過實測結論:PostgREST 用**參數名字集合**分辨兩支多載,不是參數個數。⇒ DROP 掉 10 參那支之後:
- 誰若還在送「不含 `p_payment_channel` 的 10 個名字」呼叫 PostgREST `/rpc/create_order` ⇒ **從「打到 10 參那支」變成「PGRST202 找不到函式」**。
- 這是 **fail-loud**(客人結帳當場報錯、看得見)不是 **fail-silent**(不會有「悄悄用一般價/悄悄稅算錯」這種看不出來的壞法)。
- 11 參那支的解析**不受影響**(它的名字集合裡有 `p_payment_channel`,不論 10 參那支在不在都是唯一命中)。

### 3-c 🟡 殘留風險(未量,照實寫不裁定)

PENDING 草稿(`supabase/migrations/PENDING-C-drop-create-order-10arg.sql.txt`)自己記的前提③:
> 「仍在途的舊部署 / CDN 快取 / 使用者已開著的分頁,都還在送 10 個名字」

**今天沒有人在查「正式庫最近一筆 10 名呼叫是什麼時候」**(未確認,PostgREST/連線層日誌是否保留這個粒度、要查多久,本 plan 沒有查證)。間接證據:段 1-A(`20260904020000`,新增 `p_payment_channel`)2026-09-04 上線、B(前端無條件送 11 個名字)最晚 2026-09-07 已在 `20260907040000` 的檔頭被記為「已在線上」,到今天 2026-09-13 已經 **6 天**。是否足夠長,**留給 Sean 或 apply 當天執行者判斷**,本 plan 不裁定「6 天=安全」。

## 4 rollback

**回退不對稱**(PENDING 草稿原話):一旦 DROP,要退 app 回舊版(送 10 個名字)之前,**必須先把舊函式救回來**,否則那些客人結帳直接 PGRST202。

### 4-a rollback 內容

把 10 參那支**這次 DROP 之前**的最後一版 body,原樣重建。底稿來源 = `supabase/migrations/20260907040000_m4b_m208_b2c_create_order_dealer_untaxed.sql:668-1164`(**CREATE FUNCTION** 那一段,不含 REVOKE/GRANT/COMMENT,那三樣另外處理),因為那是目前 repo 裡最新的一份,而且已用 §1-a 的 md5(`d17be799fa2e1b33581312b5509fe8b1`)與正式庫現值核對一致。

```sql
-- rollback:重建 10 參 create_order(逐字取自 20260907040000:668-1163,body 不改一字)
CREATE FUNCTION public.create_order(
  p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb,
  p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text,
  p_notification_email text DEFAULT NULL::text,
  p_coupon_code text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  -- (原樣貼 20260907040000_m4b_m208_b2c_create_order_dealer_untaxed.sql:669-1163 的函式體,不改一字)
$fn$;

ALTER FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb, uuid, text, jsonb, uuid, text, text, text, text, text) TO authenticated;
```

🛑 **人現場貼**(依 `docs/runbooks/apply-paste-board.md` §0-b②:「repo 裡沒有現成的可以跑」),不是預先寫好的自動 rollback 腳本。貼之前照該 runbook §1 帶 `lock_timeout`(避免撞到進行中的結帳交易卡住)。

### 4-b rollback 觸發條件

DROP 之後若觀察到 PGRST202 回報異常升高(§3-c 那個殘留風險成真)⇒ 先跑 §4-a 重建,**確認 11 參與 10 參都能被叫到之後**,才談是否要退 app。

## 5 前置閘(apply 當天重跑,不是現在跑一次就算數)

依 `docs/runbooks/apply-paste-board.md` 與 memory `reference_create-or-replace-resets-set-clause.md` 的模式(本次是 DROP 不是 REPLACE,SET 子句不受影響,但**簽章與 body 指紋一樣要比對現值,不能信 repo 檔**):

1. 10 參簽章 `pg_get_function_identity_arguments` 存在 ⇒ 存在才 DROP(不存在代表已經被別人處理過,停下查為什麼)。
2. 10 參 `md5(prosrc)` = 本 plan §1-a 記錄的 `d17be799fa2e1b33581312b5509fe8b1` ⇒ 不符 ⇒ **停,代表這支在本 plan 寫完之後又被改過,不能沿用這份 plan 的 rollback 底稿**,要重新唯讀量測再改。
3. 11 參簽章與 `md5(prosrc) = 42a9132a887b1e39995452009dd7cb47` 也要在場(DROP 前確認「另一支活著」,不是靠印象)。
4. `proacl` 兩支都還是 `{postgres=X/postgres,authenticated=X/postgres}`(GRANT 沒有在這之間被人加寬,例如加了 anon)。
5. 🟡 **可選、建議跑**:若能查到 PostgREST/連線層日誌,量一次「最近一筆 10 參呼叫」的時間戳,佐證 §3-c 的殘留風險已經過了安全窗;查不到就照實寫「未查」,不假裝有這個數字。

## 6 事後閘

1. `SELECT count(*) FROM pg_proc WHERE proname='create_order'` ⇒ **1**(只剩 11 參)。
2. 該筆 `pronargs = 11`、`md5(prosrc)` 與 DROP 前記錄的 11 參值一致(**沒有被 DROP 動到**——DROP 只點名 10 參那支,理論上 11 參原地不動,但仍要唯讀驗證,不是信任「理論上」)。
3. `proacl` 仍是 `{postgres=X/postgres,authenticated=X/postgres}`。
4. `GRANT`/`REVOKE` 隨 DROP 一起消失,**不需要**額外一道 REVOKE(DROP FUNCTION 本身就把該多載的 ACL 一起丟掉)——但要在事後閘裡確認「消失的只有那一組」,不是兩支的 ACL 都被清空。

## 7 版本號

今天(2026-09-13)`ls supabase/migrations/ | grep '^20260913'` 現況只看到三支:`010000` / `020000` / `030000`(`_m4b_bank_order_amount_changed_pending` / `_m4b_order_notes_soft_delete` / `_m4b_outbox_handed_to_provider_at`)。

⚠️ **與交辦文字裡「04/06 已用、05 留 B 窗、07 留匯率」不符**(未確認為何不符——可能是其他窗尚未推、或版號規劃只存在別的地方,本 plan 未查)。

**建議版本號:`20260913090000`**(🔵 2026-09-13 20:4x 主視窗改:原建議 08 已被 B 窗 P1b「月統計 CHECK」用掉;05 是月統計 RPC、06 發票抬頭 RPC、07 留匯率),**但 apply 當天要重新跑 `ls supabase/migrations/ | grep '^20260913'` 再確認一次沒有撞號**,不要沿用本 plan 寫下的這個數字當作已核實。

建議檔名:`20260913090000_m4b_drop_create_order_10param_overload.sql`(取代 `PENDING-C-drop-create-order-10arg.sql.txt`,貼板時把 PENDING 檔改名/刪除,避免兩份同時存在造成混淆)。

## 8 🔴 這支 migration 之外,還有一處要跟著改(PENDING 草稿原文第 5 點)

`apps/admin/src/lib/orders/subtotal-writers-allowlist.test.ts:532` 登記了 `20260904020000_m4b_create_order_payment_channel.sql`,該檔案 527-534 行的註解逐字寫著:
> 「而 C 那一步要回來改這一列:C 會 `DROP` 舊的 10 參數版 ⇒ 那時 `20260604130000` 那一族的舊條目**是否還算寫入者**要重判 ⇒ 這道閘【兩個方向都抓】⇒ 所以 C 不改這裡的話,它會紅。」

⇒ 本 DROP migration commit 時,**同一 slice 要一併檢查/更新這支 allowlist 測試**(這是鐵則 8 plan 的一部分,不是另開一片 —— 兩者是同一個變更的一體兩面)。本 plan 不預先判定要怎麼改(需要看 DROP 之後 `20260604130000` 那一族的條目是否還該留在 allowlist,那要等實際跑一次測試看紅在哪),只記下「apply 時必須跑」。

## 9 鐵則 12:codex 唯讀審查

DROP 一個 `SECURITY DEFINER` + `authenticated` GRANT 的金流 RPC 多載,屬鐵則 12「錢 + 權限」雙中類別,commit 前必過一輪。

```bash
codex exec -s read-only --disable apps -m gpt-6-astra "$(cat docs/plans/2026-09-13-drop-create-order-10param-overload-plan.md)" < /dev/null > /tmp/codex-review-drop-create-order-10param.txt 2>&1
```

must-fix 修完才 commit;R1 有 must-fix 才 R2。純文字 finding 一律 nit。

## 10 沒查到的(照實列)

- 10 參那支「正式庫最近一筆呼叫」的實際時間戳 —— 未查(§3-c、§5-5)。
- 今天 md5 與 `20260907040000` 前置閘期望值、與 memory 舊紀錄三份都不同的**原因** —— 未確認是否為多次 `CREATE OR REPLACE`/`DROP+CREATE` 累積的正常結果,還是有別的東西動過它;不影響本 plan 結論(現值已唯讀核實,rollback 底稿也已核對 md5 一致),但列在這裡供下一個人查證。
- 交辦文字裡「今天 04/06 已用、05/07 已留位」與本 repo 實際只見 01/02/03 三支的落差 —— 未查(§7)。
