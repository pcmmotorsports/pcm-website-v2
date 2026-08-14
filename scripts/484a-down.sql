-- ============================================================
-- 片 A #484a · 回退腳本(forward-only 之下的手動 down)
-- ============================================================
-- 標的 = supabase/migrations/20260814140000_m4b_e10_484a_order_goods_axis_view.sql
-- 🔴 用法(最省事的那條先講)= **整檔複製,貼進 Supabase Dashboard → SQL Editor,按 Run。**
--    本檔**沒有用到任何 psql 變數**(`:'var'` 形式 0 命中),且整檔包在單一 `BEGIN; … COMMIT;` 裡
--    ⇒ **不需要 psql、不需要連線字串,而且中途出錯會整個回滾。**
-- (次要)若真要用 psql:`psql "<連線字串>" -v ON_ERROR_STOP=1 -f scripts/484a-down.sql`
--    ⚠️ **不要照抄 `$DATABASE_URL`** —— 實查 `.env.local`:**`DATABASE_URL` 0 命中**,照抄連不上。
--
-- 🔴 **順序要看「A2 部署了沒」,分兩種情況 —— 這是 codex 關卡2 R2 抓到的,原版寫錯了**:
--    原版無條件寫「先 revert app」,但 **A1 階段根本沒有任何 app code 依賴這支 view**
--    (adapter 換源是 A2)⇒ 那個理由在 A1 是**假的**。
--
--   **情況一:只 apply 了 A1,A2 還沒部署(= 交件當下的狀態)**
--     直接跑本檔即可。**沒有消費端,DROP 不會弄壞任何畫面。**
--
--   **情況二:A2 已經部署(adapter 已指向 view)**
--     ① 先把 A2 那顆 commit revert 掉並**部署完成**(adapter 指回 `.from('orders')`)
--     ② 確認線上訂單列表正常(開一次 `/orders`,看廠牌與客戶欄有值)
--     ③ 才跑本檔
--     🔴 反過來(先 DROP)會讓線上 app 指向不存在的關聯 ⇒ 訂單列表整頁壞掉。
--        同族 = 08-07 A9h「應用層先於 migration 上線」,正式站壞了 8 小時。
--
-- ── 這支做什麼 ──────────────────────────────────────────
--   只 DROP 一個 view。**本片是 additive 的:沒有動過任何既有表 / 函式 / 索引 / 權限**
--   ⇒ 回退不需要還原任何東西,也沒有 ACL 要補(view 的 GRANT 隨 DROP 一起消失)。
--
-- ── 回退後的預期狀態 ────────────────────────────────────
--   `admin_order_list_v` 不存在;`orders.fulfillment_status` 那個(壞掉的)篩選軸回到原狀
--   ⇒ **`#488` 那個「篩已到貨永遠零筆」的 bug 會跟著回來。** 這是知情的取捨,不是漏掉。

-- ⚠️ **第三種情況(code-reviewer nit):view 被別的物件相依時**(A2 之後若有人再疊第二支 view /
--    function 在它上面),`DROP VIEW` 無 `CASCADE` 會回 `2BP01` 並讓整個 `BEGIN` 中止。
--    **這是大聲失敗、不是靜默** ⇒ 看到就停下來,**先去看是誰相依**,不要直接加 `CASCADE`
--    (`CASCADE` 會把那個相依物件一起刪掉,那通常不是你想要的)。
BEGIN;

DROP VIEW IF EXISTS public.admin_order_list_v;

-- 🔴 **這叫「view 物件零留痕」,不是「資料庫零留痕」**(codex 關卡2 nit):
--    `DROP VIEW` 會一併帶走 view 的 ACL 與兩個 COMMENT(那些都掛在 view 上);
--    **但 migration ledger 那一列不會消失** —— 要重新前進請走新的 migration,不要改寫歷史。
-- view 物件零留痕檢查:回退後這一列必須回 0
SELECT count(*) AS should_be_zero
FROM information_schema.views
WHERE table_schema = 'public' AND table_name = 'admin_order_list_v';

COMMIT;
