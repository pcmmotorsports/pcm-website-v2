> 🔴 **本檔是【正本】**(2026-09-05 從 `~/pcm-mailbox/plan-收BYPASSRLS-db-20260905.md` 搬進 repo;那份已改成指標)。
> 🔵 板列 `⟦b9-RLSHARDEN⟧` 與 `⟦01-RLSROLLBACKSNAP⟧` 指這裡。

# plan · 收掉 `service_role` 的 `BYPASSRLS`(線 `-db`,2026-09-05)—— **可執行版**

> 前置:`20260904270000` 已由 Sean 貼進正式庫。**沒貼就不開始。**
> 🛑 沒有回頭路的那一刻是 `ALTER ROLE` 執行的那一秒;之前每一步都可以停。

## 🔴 動手前查掉的三格(已查完,結論寫在這裡)

**① 後台用 `service_role` 讀的是哪幾頁 ⇒ 答案是【全部】**
```
apps/admin/src  createSupabaseServiceClient   41 支(非測試)
                createSupabaseAnonClient       0 支
                @supabase/ssr(cookie session)  0 支
                createBrowserClient            0 支
🟢 正對照:同一把尺對 apps/storefront/src ⇒ createSupabaseAnonClient 7 支(尺會動)
```
🛑 **⇒ 我上一版寫的「後台有些頁面走 authenticated/anon ⇒ 那些頁面正常不代表安全」【被證偽】。**
　 真相更簡單而更重:**整個後台都走 `service_role`** ⇒ **任何一頁都可能受影響**,
　 而那也表示第 3 步的走查**沒有「不用看的頁」**。

**② `ALTER ROLE` 受不受交易保護 ⇒ 受**
```
拋棄式 PG 實測:BEGIN; ALTER ROLE r_test BYPASSRLS; …交易內讀到 t… ROLLBACK; ⇒ 回到 f
🟢 正對照:同樣的 ALTER 走 COMMIT ⇒ 留下 t
```
⇒ **前置閘擋得住它** —— 閘紅時那一行 `ALTER ROLE` 會被回滾,不會半套。

**③ 走查誰做 ⇒ 主視窗 2026-09-05 裁:同一個窗用 `admin-probe` 對正式庫收前收後各一遍記筆數,不動用 Sean;Sean 只在收之後自己開後台看一眼當第三把尺。**(`docs/runbooks/local-admin-with-real-data-probe.md`)

## 八步

1. **驗前置**(唯讀):那 40 張逐張要有 `PERMISSIVE · SELECT · TO service_role · USING (true)` **且**有表層 `SELECT`。判準與 `270000` 的事後斷言⑤⑥ 同一個,不另寫一份。少一張就停。
2. **量基準線(收之前)**:`products`(全部 / `delisted_at IS NOT NULL`)、`orders`、`order_items`、`product_variants`、`product_fitments`。🔴 **收了之後就再也量不到,它是第 6 步唯一的對照組。**⚠️ 數字旁邊要寫**用哪個角色量的** —— 我的 `pcm_readonly` 自己也有 `BYPASSRLS`,它量到的「讀得到」對可見性零判別力。
3. **走查(收之前)**:`bash scripts/admin-probe/up.sh` 對正式庫,**每一頁記筆數**不是「看起來正常」。至少:商品列表(含**下架篩選**)、訂單列表、訂單明細、退款、出貨、客戶、儀表板。
3b. **非畫面那半(排程 / 寄信 / webhook)—— 收之後【手動打一發】**

🔴 **而查到一件會改變曝露面的事:非畫面路徑分兩族, 而它們【受不受影響完全不同】。**
```
Supabase* adapter(18 支)⇒ supabase-js + service_role 金鑰 ⇒ 🔴 受這片影響
Pg*        adapter(5 支)⇒ `import { Client } from 'pg'` + 連線字串
                          ⇒ 🟢 它【不是 service_role】⇒ 收 BYPASSRLS 對它們無效
   (PgAnomalyAlertReaderAdapter / PgChargeAttemptAdapter / PgReleaseSiblingAdapter /
    PgPollSettleThrottleAdapter / PgWebhookInboxAdapter)
```
📌 **前綴 `Pg` 與 `Supabase` 不只是命名 —— 它是兩條走不同角色的連線。**
✅ **`Pg*` 那族走的是誰 —— 查到了, 而且是【行為證據】不是從 env 名字推的**(2026-09-05 唯讀):
```
五支的連線字串全部來自 requireEnv('PAYMENT_CONFIRMER_DB_URL')
它們【只呼叫函式、從不直接打表】:SELECT * FROM public.claim_expired_pending_attempts(…) 等四支

而回庫問那四支函式:
  has_function_privilege('payment_confirmer', …, 'EXECUTE')  ⇒ 四支全 t
  has_function_privilege('service_role',      …, 'EXECUTE')  ⇒ 四支全 f  🔴
  ⇒ **若那條連線是 service_role, 它今天就跑不動了。而它跑得動。**
     ⇒ 那條連線【只可能】是 payment_confirmer —— 這是行為, 不是命名。

payment_confirmer 的表層 SELECT:0 / 57 張    🟢 正對照:service_role 44 張(尺會動)
payment_confirmer 的 rolbypassrls = f        ⇒ **它今天就已經活在 RLS 底下**
```
🎯 ⇒ **收掉 `service_role` 的 `BYPASSRLS`, 對這五支【零影響】** —— 它們從來沒有靠過那個屬性。
🔵 而這也是一個好消息的形狀:**那條路早就是收緊的**, 這片要收的是另一條。

**五支 cron route 經 Supabase\* adapter 碰到的表(剝註解 grep `.from('`)**:
```
customers · order_items · orders     ⇒ 🔴 在那 40 張裡(本片會補 policy)
email_outbox · shipments · shipment_items ⇒ 🟢 不在(它們【已經】有無條件讀路)
`.rpc(` 命中 0 —— 🟢 而正對照:整個 adapters 有 29 處 `.rpc(` ⇒ 尺會動, 這個 0 是真的
```

**收之後每支打一發**(值走環境變數, **不進對話、不進檔案**):
```bash
for r in anomaly-alert capture-recheck email-sweep order-ineligible-gate settle-sweep; do
  curl -s -o /dev/null -w "$r %{http_code}\n" \
    -H "Authorization: Bearer $PCM_CRON_SECRET" \
    "https://<顧客站網域>/api/cron/$r"
done
```
🔴 **判準不是 200** —— 200 只證它跑完。要看**它回報的筆數**與收之前那一發**一樣**。
🛑 **而 `anomaly-alert` / `email-sweep` 會【真的寄信】** ⇒ 打之前先確認今天可以寄, 或挑沒有待寄項目的時刻。

⚠️ **這一步的天花板**:我追的是 route → composition → adapter 三層的 `.from('` 字面。
　 **若有 adapter 把表名放在變數或常數裡, 這個分母撈不到它** —— 我沒有為那種形狀做正對照。

4. **那支 migration**:一行 `ALTER ROLE service_role NOBYPASSRLS`,前面掛第 1 步那組斷言當**前置閘**(第②格已證閘紅會連 `ALTER ROLE` 一起回滾)。
5. **回滾一行**:`ALTER ROLE service_role BYPASSRLS;` —— 寫進 migration 的最後一個 result grid **與** commit body 兩處。一秒生效、不需要資料。
6. **收之後立刻重跑第 2、3 步逐格比**。🔴 **判準不是「還看得到東西」,是「數字與收之前【一樣】」。** 最該盯的是下架商品 **559 筆**:少了它就是這片最大的預期風險成真 ⇒ 當場跑第 5 步。
6b. **收之後重看那 22 支 `SECURITY DEFINER` 函式**(2026-09-05 唯讀普查;板列 `⟦01-DEFINERPATHPROD⟧`)

🔴 **為什麼它們今天不是缺口, 而收完之後可能是**:
```
它們是 SECURITY DEFINER 且 search_path【沒有】鎖成空字串
  20 支 search_path=public, pg_temp   ·   2 支 pg_catalog 系
而 anon / authenticated 【一支都叫不動】(實測各 0)⇒ 今天不是缺口
🔴 而 service_role 【22 支全部叫得動】—— 而它今天有 BYPASSRLS
⇒ 收掉之後, 它們的 DEFINER 身分與 search_path 的組合要重看一次
```
🛑 **而我明說我【沒有】判它們有問題** —— `search_path=public, pg_temp` 是另一種寫法,
　 **不必然是缺陷**。本步要做的是**重看**, 不是**修**。(板列逐字寫了「本列不判它對錯」。)
⏰ **重看的判準**:收掉 `BYPASSRLS` 之後, 以 `service_role` 身分實際叫其中幾支,
　 看它們**還跑不跑得動** —— DEFINER 以 owner 身分執行、不受 RLS 影響,
　 而**它們讀的那些表現在受 policy 管了**, 那是新的組合。
⚠️ **而這一步的天花板**:我沒有讀過這 22 支的函式體 ⇒ 我不知道它們各自讀哪些表。
　 ⇒ 📌 **「要重看」是有來源的, 「重看要看什麼」只到「實際叫一次」這一層。**

那 22 支:
　 · admin_adjust_wallet  [search_path=public, pg_temp]
　 · admin_append_order_note  [search_path=public, pg_temp]
　 · admin_create_saved_order_view  [search_path=public, pg_temp]
　 · admin_delete_item_receipt  [search_path=public, pg_temp]
　 · admin_delete_saved_order_view  [search_path=public, pg_temp]
　 · admin_finalize_order_refund  [search_path=public, pg_temp]
　 · admin_initiate_order_refund  [search_path=public, pg_temp]
　 · admin_list_saved_order_views  [search_path=public, pg_temp]
　 · admin_record_item_receipt  [search_path=public, pg_temp]
　 · admin_set_customer_tier  [search_path=public, pg_temp]
　 · admin_set_product_listing  [search_path=public, pg_temp]
　 · admin_update_order_workflow  [search_path=public, pg_temp]
　 · admin_update_saved_order_view  [search_path=public, pg_temp]
　 · admin_upsert_item_procurement  [search_path=public, pg_temp]
　 · admin_upsert_supplier  [search_path=public, pg_temp]
　 · admin_void_item_procurement  [search_path=public, pg_temp]
　 · admin_void_manual_refund  [search_path=public, pg_temp]
　 · pcm_manual_refund_rail_cap  [search_path=public, pg_temp]
　 · pcm_order_refundable_remaining  [search_path=public, pg_temp]
　 · record_auth_callback_event  [search_path=pg_catalog, pg_temp]
　 · redeem_coupon  [search_path=public, pg_temp]
　 · rls_auto_enable  [search_path=pg_catalog]


7. **Sean 開後台看一眼**(第三把尺,獨立於前兩步)。
8. **收工**:`DROP TABLE public.pcm_rls_rollback_20260904270000`(板列 `⟦01-RLSROLLBACKSNAP⟧`)、`⟦b9-RLSHARDEN⟧` 改 `done`。

## 天花板(不要讀成比它強)
- `270000` 那 40 條 policy **到目前為止沒有在正式庫上被行為驗過** —— 它們第一次承重就是這一片。
- 第 3 步走查的是**畫面**;有些後台路徑(排程、寄信、cron)不經過畫面,**這份 plan 沒有涵蓋它們** —— 它們會在下一次排程跑到時才顯形,而那時沒有人站在旁邊。
