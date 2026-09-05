# Plan(一頁):**「開待退款失敗」今天是沉默的 —— 讓它出聲**

> 派工:主視窗 `-f8` 2026-09-05 晚上(`⟦b4-NCPCRONRACE⟧` 剩二)。**不動正式碼,只出 plan。**

## 1. 病灶(逐字位置)

`pcm_noncard_settle_recompute`(`20260904230000:339-341`):
```
EXCEPTION WHEN OTHERS THEN
  RAISE LOG '[pcm_noncard_settle] order=% 重算失敗(%), 收款事實保留、狀態不動'
```
🔴 **`RAISE LOG` 進 Postgres log,而沒有任何人在看那個 log。**
⇒ 📌 **「開待退款失敗」與「開成功」在今天的訊號上是同一個:什麼都沒有。**

🔵 而它**吞掉是刻意的**(碼裡寫著):不讓重算的失敗把**客人那筆收款**一起回滾。
⇒ 🛑 **本片不碰那個決定** —— 要改的只有「吞掉之後有沒有留下一個看得見的痕跡」。

## 2. ⛔ 一個被否決的做法(留著,因為它看起來很合理)

⛔ ~~重用 `pcm_settle_retry_attempts`(20260905220000)~~ —— **codex 2026-09-05 否決,理由我接受**:
```
那張表【一列 = 付款狀態重算的重試生命週期】(attempts / gave_up_at / last_error)
塞退款開列失敗進去 ⇒ 不是永遠不告警(它不在 retry sweep 的候選裡, 不會被撈到),
                   就是要【偽造 gave_up_at】才看得見
而 get_settle_retry_gaveup_health() 會把退款故障報成「settle retry 放棄」
⇒ tracked_total 與抽樣單號一起失真
```
📌 **我把「有一張看得見的表」讀成「那張表裝得下這個語意」。**

## 3. 兩案

### 甲:專用的 `pcm_incident` 一張小表(推薦)
```
public.pcm_incident
  id          bigserial PK
  kind        text NOT NULL      -- 'pending_refund_open_failed' 之類, 封閉集(CHECK)
  subject_id  uuid               -- 這裡是 order_id
  detail      text NOT NULL      -- SQLERRM
  created_at  timestamptz NOT NULL DEFAULT now()
  resolved_at timestamptz        -- 人看過並處理了
```
- ✅ 語意乾淨:**它不假裝自己是別的東西**;`kind` 是封閉集 ⇒ 新的一種失敗要明文加一格。
- ✅ 告警端只要多讀一個 count ⇒ 接進 `check-anomaly-alerts` 的形狀與既有那幾個 `*Unknown` 一樣。
- 🔴 代價:**多一張表** ⇒ 四道 REVOKE + RLS + 告警端一個新欄位 + 白名單 ⇒ **它不是一行**。
- ⚠️ 而它會**吸引下一個人把所有東西都丟進來** ⇒ `kind` 的封閉集是唯一擋得住的東西。

### 乙:寫進既有的心跳表 `sweeper_heartbeat`
```
欄位實量:job_name, last_success_at, last_failure_at, consecutive_failures, updated_at
```
- ✅ 不新增表,告警端**已經在讀它**(`cron-heartbeat-read`)。
- 🔴 **而它一列 = 一支排程的健康**,不是一個事件 ⇒ 塞進去要嘛用一個假的 `job_name`,
  要嘛把 `consecutive_failures` 當事件計數 ⇒ 📌 **與甲 被否決的理由是同一個病。**
- 🛑 **所以乙 其實不成立** —— 它只是換一張表犯同一個錯。**列在這裡是為了讓下一個人不用再想一次。**

## 4. 推薦:**甲**,而它的第一步不是建表

🔴 **先量:那個 EXCEPTION 今天被觸發過幾次。**
- 如果是 0 ⇒ 這一片是**預防**,而預防片的驗收不能是「補到幾筆」(今天 `orders` 全表 1 張單)。
- 如果不是 0 ⇒ **那幾次的錢現在在哪** —— 那比建表急。
🛑 **而我量不到** —— `RAISE LOG` 只在 Postgres log 裡,而**唯讀角色讀不到 log**。
⇒ 📌 **這一片的第一步是一個【我做不到】的量測** ⇒ 要 Sean 或 service_role,或**先接上再說**。

## 5. 🛑 這份 plan 證不到什麼
- **它證不到這件事發生過** —— 見 §4。「沒有訊號」與「沒有發生」今天是同一個畫面。
- 它假設告警信那條路是活的 ⇒ 而 `pcm_settle_retry_attempts` 今天**還沒有第一列**,
  ⇒ 🔴 **那條端到端沒有走通過一次。**
- 🔵 它**不修**那個競態本身(`⟦b4-NCPCRONRACE⟧` 剩三要 Sean 拍終態)——
  本片只讓「網破了」這件事**看得見**。
