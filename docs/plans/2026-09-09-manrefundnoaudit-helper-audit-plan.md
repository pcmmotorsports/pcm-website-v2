# ⟦b4-MANREFUNDNOAUDIT⟧ · 人工退款零稽核 —— plan

> **2026-09-09 · `money` 窗寫 · 板列 `docs/launch-todo.md:515`**
> 🛑 **本檔是 plan,零施工** —— 不動碼、不改簽章、不開片。鐵則 8 + 鐵則 12①③ ⇒ **Sean 批才能開工。**
> 🔴 **本檔【不修】任何一邊的矛盾** —— 主視窗 `-91` 2026-09-09 明令:先寫清楚它們矛盾在哪,
>    **改哪一邊【是那一題的一部分】**。下面 §3 只記錄,不裁定。

---

## §0 一句話

**現在人工退一筆錢,資料庫裡查不出是誰退的。** 而那不是漏掉一行 code ——
**是三份文件各自為真、互相指向對方,而每一份單獨讀都是對的。**

---

## §1 讀數(全部當場量的,附正負對照)

### 1-a 那支 helper 真的不寫稽核

`pcm_sync_order_refund_payment_status` = `orders.payment_status` 退款方向的**唯一寫入端**。

```
COMMENT 逐字(20260823010000:203-204,20260905010000:329-330 兩支檔同一段):
   「🔴 **內部 helper,不是對外 RPC** —— 零 GRANT、只有 owner 執行得到。
     它沒有 actor、不寫 audit ⇒ 開給 service_role 等於多開一條【沒有留痕的動錢入口】」

碼(最新代 20260905440000,只取函式體內、去掉註解行):
   INSERT INTO public.admin_audit_log ⇒ 0
   🟢 正對照 同段同尺找 UPDATE public.orders ⇒ 1  (尺是活的)
```
⇒ **COMMENT 與碼一致。這一半沒有問題。**

### 1-b 六個呼叫端:actor 全有,request_id 缺兩支,而**四支自己也不寫稽核**

每支取 repo 裡**最新那一代**的簽章與函式體(去註解行後數 `INSERT INTO public.admin_audit_log`):

```
函式                                    最新代            p_actor  p_request_id  自己寫稽核
admin_void_manual_refund              20260905440000      🟢        🔴            0
admin_correct_order_refund_verdict    20260905440000      🟢        🟢            1
admin_void_backfilled_refund          20260907030000      🟢        🔴            0
admin_correct_backfilled_refund       20260907050000      🟢        🟢            0
admin_backfill_tappay_console_refund  20260907130000      🟢        🟢            1
admin_record_manual_refund            20260905280000      🟢        🟢            0
⚪ 負對照 現造函式名 zzq_never ⇒ 抓不到任何一代
```

🔴🔴 **⇒ 板列寫的是「helper 不寫稽核」,而真正的形狀是【六支裡四支,整條路上一個人都沒寫】。**
　 其中 `admin_record_manual_refund` **正是** `-37` 2026-09-08 查 `X5F8WG` 撞到的那條路。

🔴 **而它不是退化 —— 三代都沒有**:
```
第1代 20260820021000  audit_insert=0  ledger_insert=1  碼 127 行
第2代 20260823020000  audit_insert=0  ledger_insert=1  碼 129 行
第3代 20260905280000  audit_insert=0  ledger_insert=1  碼 145 行
```
📌 **它從出生就沒有寫過。** 不是誰改壞的,沒有人可以怪 —— 而這反而是壞消息:
**沒有一個 diff 上看得見的時刻可以讓審查抓到它。**

### 1-c `admin_audit_log` 的形狀決定了這件事能怎麼做

建表 `20260712210000:44-58`:
```
actor       text NOT NULL   CHECK (actor      <> '')
request_id  text NOT NULL   CHECK (request_id <> '')
source_app  text NOT NULL   CHECK (source_app IN ('admin','quote'))  DEFAULT 'admin'
```
🔴 **兩個必填,不是一個。** 而上表顯示 **`p_request_id` 缺兩支**
(`admin_void_manual_refund` · `admin_void_backfilled_refund`)⇒ 那兩支**今天湊不出合法的一列**。

⚠️ 而 `admin_void_manual_refund` 缺 request_id **是有人裁定的,不是漏掉**
(`20260905440000` 函式體內註解逐字):
> 「而這一道是本 RPC『不需要 request_id』那個裁定的【前提】:
> 　主視窗 2026-08-20 裁定拿掉 request_id,理由是『不同的人 = 不同的 payload ⇒ 會 RAISE』」

⇒ 🛑 **要它寫稽核 = 要推翻一個 2026-08-20 的裁定。那是本 plan 必須端出來的東西,不是可以繞過的細節。**

表的 COMMENT 還逐字寫著(`20260712210000` source_app 欄):
> 「**系統自動化 / cron 事件不寫本表(各有自己的表)**」

⇒ 📌 **這句是 §5 那條前例的法源。**

---

## §2 為什麼三份文件都對,而合起來是錯的

```
① helper 的 COMMENT       「它沒有 actor、不寫 audit」                     ⇒ 🟢 與碼相符
② TS 那一層               manual-refund-repository.ts:12 逐字
                          「稽核由 RPC 同交易寫(D1 header 段自陳),本層不碰 admin_audit_log」
                                                                          ⇒ 🔴 它指的 RPC 三代都是 0
③ plan v7 §4-f① / §3-c②  「helper 每次實際寫入都寫 admin_audit_log」       ⇒ 🔴 從來沒有成立過
```
🎯 **② 與 ③ 都在說「另一邊會寫」,而 ① 說「我不寫」。三份各自為真 ⇒ 沒有一份是假的 ⇒ 沒有一份會被審查抓到。**

### 2-a ② 引的那個來源不存在

`manual-refund-repository.ts:12` 說「D1 header 段自陳」。實查那支 D1:
```
檔 supabase/migrations/20260820021000_m4b_e10_d1_record_manual_refund.sql  535 行
🔬 grep -ci 'audit|稽核' ⇒ 0
🟢 正對照 同尺 'refund'  ⇒ 82   (尺是活的)
⚪ 負對照 現造字 zzqnever ⇒ 0
```
⇒ 🔴 **一句 TS 註解引了一個【零命中】的來源,而它讀起來完全像在引用真的東西。**

### 2-b ③ 那份 plan 不在版控裡

`plan v7` 的落點 = **`~/pcm-mailbox/58-退款通知信-plan-v7-20260823.md`(557 行)**。
```
git log --all --diff-filter=A --name-only | grep -i v7  ⇒ 0
🟢 正對照 同尺找 plan-v4 ⇒ 2 支(docs/plans/…-v4.md · docs/specs/…-v4.md)
```
⇒ 📌 **一支 migration 的檔頭(`20260823020000:35,40`)拿它當前提,而 repo 裡沒有任何東西看得到它。**
　 🛑 **⇒ 沒有任何閘、任何 grep、任何審查在檢查那個前提還成不成立。**

### 2-c 這三份的矛盾**本身就是本列最有價值的產物**

📌 三份文件、三種載體(DB COMMENT / TS 註解 / 信箱裡的 plan),**互相授權對方不做這件事**。
🔴 **而「改哪一邊」不是文字工作,它決定了工程做在哪一層** ⇒ 見 §4 的三條路。

---

## §3 記錄,不裁定(主視窗 2026-09-09 明令)

```
🛑 本 plan 【不改】① ② ③ 任何一句。
   理由(主視窗逐字):「兩邊都不要先改 —— 先寫清楚它們矛盾在哪,
                      而改哪一邊【是那一題的一部分】。」
⇒ 改哪一邊 = §4 三條路各自帶著的後果, 那是 Sean 要批的那一批東西的一部分。
```

---

## §4 三條路(工程層面,互斥;本 plan 建議乙)

> 🔴 **共同前提**:六支呼叫端**全部**有 `p_actor`(§1-b 量到)⇒
> **「找不到人」這個理由不成立。** 舊的直覺「有些呼叫端沒有人」是錯的,那句我已對主視窗更正過。

### 甲 · helper 自己寫(= v7 §4-f① 的原始設想)
```
做法  helper 加兩個參數 (p_actor, p_request_id), 每次真的 UPDATE 就寫一列
代價  🔴 helper 是【內部 helper、零 GRANT】—— 加參數 ⇒ 六支呼叫端全部要改簽章傳值
      🔴 兩支今天沒有 request_id ⇒ 連帶要推翻 2026-08-20 那個裁定
      🔴 簽章改變 ⇒ PostgREST reload + 部署順序(碼先上而 DB 後貼, 每一把綠都看不見)
好處  只有一個寫入端 ⇒ 一個地方寫對, 全部路徑都留痕
```

### 乙 · 呼叫端各自寫(**建議**)
```
做法  四支今天不寫的呼叫端各補一列 audit, 寫在【它已經有的那個交易裡】
      helper 不動一個字 ⇒ 它的 COMMENT 保持成立
代價  🔵 四個地方各寫一次 ⇒ 要一道守門釘住「新的退款 RPC 一定要寫一列」
      🔴 admin_void_manual_refund / admin_void_backfilled_refund 仍缺 request_id
         ⇒ 那兩支仍要處理(補參數, 或由呼叫它的 TS 層帶)
好處  🟢 零簽章改變(除了那兩支)⇒ 沒有部署順序問題
      🟢 與現行 2/6 已經在寫的那兩支【同形狀】—— 抄它們, 不發明新做法
      🟢 actor 在呼叫端手上是【真的那個人】; helper 拿到的只會是一個被傳下去的字串
```

### 丙 · 不寫稽核,改列觀測點(= §5 前例的做法)
```
做法  照 20260809160000 那支排程的先例:明寫「本路徑不寫 admin_audit_log」+ 列出可查的替代點
代價  🔴 但那條前例的理由是「**它沒有 actor**」—— 而本列六支【全部有 actor】
      ⇒ 📌 前例的理由對本列【不成立】⇒ 丙沒有法源
好處  零工。而它答不出板列問的那句「誰退的」。
```

🎯 **⇒ 建議乙。理由一句:它是唯一一條【不改簽章、不推翻舊裁定、而且照抄現有兩支的形狀】的路。**

---

## §5 射程 —— 那條「刻意不寫稽核」的前例,以及它為什麼**不涵蓋本列**

`20260809160000:44-52`(未付款自動失效那支排程)逐字:
> 「`admin_audit_log`:`source_app` CHECK 只收 `('admin','quote')`(`20260712210000_*.sql`),
> 　**為了一支排程去放寬共用稽核表的 CHECK,代價大於收益。**」
> 「`order_cancellations`:那張表模型的是**客服取消**(actor、reason_code、逐品項)。
> 　**自動失效沒有 actor**、沒有品項層決策 ⇒ 硬塞會讓那張表的語意變髒。」
> 「🔴 **那要怎麼查『這支到底有沒有在跑、跑了什麼』**(觀測點,誠實列出):
> 　① 跑了什麼 → `SELECT * FROM public.orders WHERE cancelled_reason = 'payment_expired'`
> 　② 有沒有在跑 → pg_cron 的執行紀錄」

🔴🔴 **那條前例是【對的】,而它的射程止於「沒有 actor 的自動化」。**
```
前例的主詞  一支 cron ⇒ 沒有人 ⇒ 要寫進共用表就得放寬 source_app CHECK ⇒ 不划算
本列的主詞  六支 admin_* RPC ⇒ 【全部有 p_actor】⇒ source_app='admin' 直接合法 ⇒ 不必放寬任何 CHECK
```
📌 **⇒ 引這條前例來說「本列也不用寫」= 把一條正確的規矩用在它沒涵蓋的那一項。**
🔵 **而它有一半仍然適用**:「誠實列出觀測點」那個動作 —— 不論走哪條路,§7 那張表都要留下來。

---

## §6 關閉條件(板列已寫成三條 yes/no;逐條標【本片能不能證】)

```
① helper 加 audit 寫入(那段碼自己指定的那一格)
   ⇒ 🔴 **若 Sean 批乙, 這一條的字面要改** —— 乙不動 helper。
     它真正要問的是「這條路上有沒有留痕」, 而不是「留痕寫在哪一支函式裡」。
     ✅ 改寫成:**六支退款 RPC 每一支真的動到錢/狀態時, 稽核裡都留得下一列。**

② 回退包 §4-f① 的前提與 helper 的 COMMENT 不再互相矛盾(二選一改到對得上)
   ⇒ 🟢 本片做得到。而【二選一改哪一邊】是 §4 那三條路的直接後果, 不是獨立的一題。
   ⚠️ 而它有第三處要一起收:`manual-refund-repository.ts:12` 那句(§2-a, 引了零命中的來源)。
     ⇒ 📌 **板列只寫了兩處, 而實際是三處。** 只改兩處會留下一句仍在說謊的 TS 註解。

③ 一次真的人工退款之後, 稽核裡查得到「誰」做的
   ⇒ 🛑🛑 **本片證不到。**
     缺的那一道 = **真的退一筆**。
     那要:一張真的單 · 一個真的員工帳號 · 一次真的操作 · 而且是在 migration 貼上正式庫【之後】。
     ⇒ 🔴 **不得寫成「做完」** —— 碼上正確與「線上真的留下了一列」是兩個宣稱。
     ⇒ 這一條會自己到期:它在 Sean(或任何人)下一次真的退一筆錢的那天才有答案。
```

---

## §7 觀測點(不論走哪條路都要留;抄 §5 前例那個動作)

```
「這條路上留痕了沒」怎麼查(唯讀):
  SELECT action, count(*) FROM public.admin_audit_log
   WHERE action LIKE 'refund.%' OR action LIKE 'order.refund%' GROUP BY 1;
  🟢 正對照 今天的讀數 = 有 initiate / finalize / correct_verdict / unknown_state(卡片線)
  🔴 而【人工退款那條線今天一列都沒有】—— 那就是本列。

「一筆人工退款有沒有對應的稽核列」怎麼查:
  order_manual_refunds 的列數  vs  admin_audit_log 裡對應 target='order:<uuid>' 的列數
  ⇒ 今天必然對不上(前者有、後者 0)⇒ **那個差就是修好之後應該歸零的數。**
```
📌 **⇒ 這兩發是本列的【修前讀數】。修完要再跑一次比,不能只看測試綠。**

---

## §8 本 plan 證不到什麼(誠實列)

```
① 我沒有連正式庫 —— 上面所有讀數都是【repo 裡的 migration 檔】, 不是「正式庫現在跑的那一代」
   ⇒ 🔴 `latest-definition-of` 自己印的那句:「帳上寫著 apply 了」與「正式庫裡真的是那一版」是兩個宣稱
② 我沒有讀完那六支函式的全文 —— 我數的是【去掉註解行後的 INSERT INTO public.admin_audit_log】
   ⇒ 若有人用 EXECUTE / 動態 SQL / 另一支 helper 寫稽核, 我這把尺看不見
   ⇒ ✅ 而反向證據在:`manual-refund-repository.ts:12` 自己說「本層不碰」⇒ 兩層都指向對方
③ `plan v7` 我只讀了 §3-c 與 §4-f 兩段(557 行的檔), 沒有讀全文
④ 「片3 做了沒」= 做了(20260905440000), 而它【沒有】含那一格 ⇒ 那是量到的, 不是推的
   (helper 函式體內 admin_audit_log 命中 0, 正對照 UPDATE public.orders 命中 1)
```

---

## §9 端 Sean 的那一題 —— 【批一次】,不是【選一個字】

> 🔴 主視窗 `-91` 2026-09-09 的約束逐字:「給【他判得下去的形狀】」。
> 而 §1-b 量到六支呼叫端**全部有 actor** ⇒ **這一題已經不需要他做技術取捨了。**
> 剩下的只有一件他必須知道的事:**它要推翻一個 2026-08-20 的舊裁定。**

```
Q-MANREFUNDNOAUDIT:現在人工退一筆錢,資料庫裡查不出是誰退的。
  修法是:那六支退款功能,每一支真的動到錢的時候都留一筆「誰、什麼時候、做了什麼」。
  其中兩支要多帶一個追蹤編號 —— 而 2026-08-20 我們自己裁定過那兩支不用帶,
  這次要把那個裁定改掉。
  A: 批,照上面做
  B: 先不做,上線後再說
```
🔵 **推薦 A。** 理由一句:**這是「客人說我退款沒收到」的那一天,唯一查得出經手人的東西。**
⚠️ **而 B 不是錯的選項** —— 它今天不影響客人拿不拿得到錢,只影響**事後查不查得到**。

---

## §10 施工前置(Sean 批之後才啟動,本 plan 不執行任何一項)

```
① 片型 = 高風險片(鐵則 12① 錢 + ③ DB 結構)⇒ codex 對抗審查不降級
② 鐵則 8 ⇒ 本 plan 就是那份 plan;Sean 批准才動碼
③ 動 migration ⇒ 前置閘(md5 釘住現行代)+ 事後斷言(md5 / ACL / 屬性)照 109 那一片的形狀
④ 🔴 不 push、不 apply 正式庫 —— 貼是主視窗
⑤ 那兩支要改簽章的 ⇒ 部署順序問題(碼先上而 DB 後貼, 每一把綠都看不見)⇒ 走 deploy-order-gate
⑥ 修完跑 §7 那兩發, 比【修前 / 修後】兩個讀數 —— 不只看測試綠
```
