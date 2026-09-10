# 2026-09-10 · ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 查證:判準沒換,而分母還是 0

> 板列 `docs/launch-todo.md:1547`。🟢 **全程唯讀**(`bash scripts/readonly-prod-sql.sh`)+ 開檔讀碼,沒有改任何資料、沒有改任何碼、沒有寄任何信。
> 🔴 **不動該列的 ⟨擋·等真資料⟩** —— 那是 tidy 判 ⑤。

---

## 0 量具自陳(今天的分母)

```
orders      8 張
shipments   4 個(其中 deleted 3 · shipped_at 非空 3 · hct_dispatched_at 非空 0)
            🔴 tracking_corrected_at 非空 = 0        ← 這一格是本列的受詞
email_outbox 7 列(2026-09-07 那次查是 5 列)
⚪ 負對照 shipments.tracking_number = 'ZZQQ絕不存在' ⇒ 0
⚪ 負對照 email_outbox.event_type = 'zz_never_an_event' ⇒ 0
🟢 正對照 orders 8 ⇒ 尺確實接到資料
```

## 1 🟢 本列的關閉條件【仍未滿足】—— 而分母仍然是 0

板列逐字的關閉條件:「**等下一封真的 `order_shipped` 寄出去,量它的 `sent_tracking_recorded` / `sent_tracking_number`**」。

```
email_outbox 逐列(全部 status = sent):
  order_created       2026-09-02 02:55Z   seq ✗  recorded ✗
  order_shipped       2026-09-02 03:05Z   seq ✗  recorded ✗   ← 舊 worker 時代
  order_shipped       2026-09-02 03:30Z   seq ✗  recorded ✗   ← 舊 worker 時代
  bank_order_created  2026-09-06 14:50Z   seq ✓  recorded ✓
  bank_order_created  2026-09-06 15:00Z   seq ✓  recorded ✓
  order_created       2026-09-07 15:45Z   seq ✓  recorded ✓
  bank_order_created  2026-09-10 09:50Z   seq ✓  recorded ✓   ← 新增的那一列(今天)

order_shipped 且 sent_at > 新 worker 上線(084e7ed9b, 2026-09-05 23:16 +08)⇒ 【0 封】
🟢 正對照:上線之後寄的 4 封, seq 與 recorded 全部有 ⇒ 機制活著, 尺會動
```

📌 **⇒ 三天前那一次查是「5 列 / order_shipped 上線後 0 封」;今天是「7 列 / 仍然 0 封」。
新增的兩列都不是本列的受詞。⇒ 分母沒有從 0 長出來。**

## 2 🔴 「判準還沒換」⇒ **仍成立** —— 而這一次的受詞是【正式庫現在跑的那支 view】

板列先前是用 `grep` 數「11 支檔」,並自標「**沒有量那 11 支裡幾支是判準本身、幾支只是註解**」。

🛑 **我先重跑了那把尺,而它更糟:今天命中 26 支檔** —— 其中大半是 **migration 歷史檔**(改不動、也不是今天在跑的東西)。
⇒ 📌 **那把尺的受詞是「repo 裡提過這個字的檔」,不是「今天在擋客人的那個判準」。** 所以我換受詞。

**去問正式庫它現在真的在跑什麼:**

```
public.pcm_tracking_corrected_email_pending   ← 決定「要不要寄更正信」的那一面
   用 tracking_corrected_at(時間比較) ⇒ t
   用 sent_tracking_number(逐字比對) ⇒ 🔴 f  ← 一次都沒出現

public.pcm_tracking_correction_candidates     ← 診斷面
   用 tracking_corrected_at ⇒ t
   用 sent_tracking_number ⇒ t(而它只在 CASE WHEN last.sent_tracking_recorded IS TRUE
                                 THEN last.sent_tracking_number ⇒ 那是【顯示】不是【判準】)

🟢 正對照:提到 email_outbox 的 view 共 10 支 ⇒ pg_get_viewdef 這把尺讀得到東西
⚪ 負對照:現造字串 zz_never_a_column_qq ⇒ 0
```

**擋門那一面的 WHERE 逐字仍是:**

```
e0.event_type = 'order_shipped' AND … AND e0.sent_at IS NOT NULL
  AND e0.sent_at < s.tracking_corrected_at
```

⇒ 🎯 **⇒ 載體(`sent_tracking_number` 欄位)在,寫入路徑在,而【擋門那一面沒有用它】。
本列那句「載體做完了,而用它的人還沒改」——今天仍然逐字成立,而現在它是量到的,不是讀 grep 讀出來的。**

## 3 ✅ 關掉本列自標的一格「我沒有讀那段碼」

板列逐字:「`sent_tracking_number` 全 5 列皆空 …… 而 `order_shipped` 那一欄要不要填、由誰填,**我沒有讀那段碼** ⇒ 不斷言」。

**讀了。`packages/use-cases/src/sweep-email-outbox.ts:2183-2190`:**

```ts
const sentTrackingNumber: string | null =
  job.eventType === 'shipment_tracking_corrected'
    ? (payload.tracking_number ?? null)
    : job.eventType === 'order_shipped'
      ? (shipped?.trackingNumber ?? null)
      : null;
```

⇒ ✅ **只有 `order_shipped` 與 `shipment_tracking_corrected` 這兩種信會填,其餘一律 `null`,而那是設計。**
⇒ 🎯 **所以今天 7 列的 `sent_tracking_number` 全空【是對的】** —— 那 4 列 recorded 的信都是
`bank_order_created` / `order_created`,**它們的信裡本來就沒有號碼**。
📌 **⇒ 一個「全空」的欄位,在讀到那段三元式之前,與「壞掉」印同一個東西。**

## 4 🟢 今天的曝險:**0 次**,而那是有分母的 0

本列的失效時序要求「**有人在寄出貨信那幾秒把號碼改掉**」。

```
shipments 4 個 ⇒ tracking_corrected_at 非空 = 【0】
⇒ 這個競態到今天為止【一次都沒有被觸發過】
```

🛑 **而那不是「安全」** —— 板列 2026-09-05 的訂正逐字寫著:`admin_update_shipment_tracking`
已經上線 ⇒ **改號今天是日常操作**。⇒ 📌 **今天的 0 是「還沒有人改過號」,不是「改了也沒事」。**

## 5 順帶:一個預期中的 permission denied

```
select count(*) from public.pcm_tracking_corrected_email_pending
⇒ ERROR: permission denied for view
```
🟢 **那是預期的,不是故障** —— 板列自己記過那支面只授 `service_role`,而我是 `pcm_readonly`。
📌 寫在這裡,因為**下一個人跑同一發會看到同一行紅字,而它讀起來像壞掉**。

## 6 本文答不出什麼

- **沒有驗那個競態本身** —— 板列自己寫過:探針跑在單一交易裡,結構上到不了那個世界。我也沒有做並發測試。
- **沒有寄任何信,也沒有造任何假資料。**
- **沒有量「11 支檔裡幾支是判準」** —— 我判斷那把尺的受詞是錯的,所以換成問正式庫;**原來那一格因此仍然沒有答案**,而我認為它不需要答案了。
- **沒有碰 `docs/runbooks/duplicate-shipping-email-sop.md`** 那兩句相反的指示(板列 2026-09-05 已訂正,我沒複驗)。
- **`hct_dispatched_at` 非空 = 0**,而主視窗說「1 箱走過新竹」⇒ 🔴 **兩者對不起來,而我沒有去查是哪一個欄位記的** —— 不是本列的受詞,標著不猜。
