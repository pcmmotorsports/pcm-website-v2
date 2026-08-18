# Plan — `#231`③ 心跳**寫入端 + 讀取端**:讓「sweeper 靜默死亡」被人知道

> **狀態:未批。** 命中 **鐵則 12①**(金流路徑上的排程)⇒ 要對抗審查。
> 主視窗 2026-08-19 派工(甲案),理由逐字:「**你剛做完的東西,它的可觀測性懸在這一片上**」。
> **本片先寫 plan、不動 code、不動 `.sql`、不動 `packages/`。**

---

## 0. 🔴 這張表為什麼存在 —— **它自己的 COMMENT 講得最準**
`supabase/migrations/20260817070000_m4b_231_3_sweeper_heartbeat.sql:73-78` 逐字:
> 「存在理由:告警的觸發條件**全部要靠 sweeper 活著才成立** ⇒ sweeper 死掉時,
>  **正好用來報告它的那個計數器會停在 0 而不告警**。」

⇒ **這就是本片要擋的那個世界**:sweeper 死了 ⇒ 沒有東西被掃 ⇒ 計數全 0 ⇒ **告警說「一切正常」**。
⇒ 🔴 **它與「沒有異常」在畫面上是同一句話。**

## 0-b 現況(兩邊獨立查到、一致)
```
表已建、已 apply。而【零 app 端寫入者】:
  git grep -ln "heartbeat" -- 'apps/*' 'packages/use-cases/*'  ⇒ 0
  負向對照 git grep -ln "sweepSettlements" 同範圍               ⇒ 7(尺會動)
那份 plan 自己寫著:`docs/specs/2026-08-17-sweeper-heartbeat-plan.md:25` 逐字
  「寫入端 ⏳ 一行都沒開始。🔴 **沒有東西在寫的心跳表【不會心跳】**」
```
**表的欄位**(同 migration `:65-70`):
`job_name`(PK)/ `last_success_at` / `last_failure_at` / `consecutive_failures` / `updated_at`

---

## 1. 🔴🔴 設計核心:**裝在被監測物裡面的心跳,測不出它整個沒跑**

主視窗指出的那一格,**它是對的,而且它決定整片的形狀**:
```
心跳由 route 自己寫 ⇒ 只能證明「**它跑完了**」
而我們怕的正是「**它根本沒跑 / 跑到一半被砍**」⇒ 那時**沒有人會寫任何東西**
⇒ 🔴 **寫入端【永遠】偵測不到自己的缺席。**
```
⇒ **所以本片是兩半,缺一等於沒做:**
```
① 寫入端  route 跑完就蓋章  ⇒ 回答「我活著」
② 讀取端  **另一個東西**定期看那個章有多舊 ⇒ 回答「它多久沒說話了」
🔴 而 ② 【必須不是同一條路】—— 否則它跟著一起死。
```

## 2. 寫入端要寫在哪(答第 1 格)
```
位置:apps/storefront/src/app/api/cron/settle-sweep/route.ts,**在 finally 語意的位置**
     ⇒ 成功 ⇒ last_success_at = now()、consecutive_failures = 0
     ⇒ 失敗(503 / catch)⇒ last_failure_at = now()、consecutive_failures += 1
🔴 **要寫在 enabled gate 之後**:flag 關著時 route 回 200 no-op,那不是「活著在工作」
   ⇒ 關著也蓋章 ⇒ 心跳會替一個沒在做事的排程背書。
⚠️ 而**被平台砍的那一輪,兩種章都蓋不到** —— **那正是要靠 ② 讀出來的**。
```

## 2-b ✅ 寫入端用什麼身分 —— **查完了,而答案讓這片更便宜**
```
心跳表的權限(20260817070000:125-137):
  GRANT SELECT, INSERT, UPDATE ON public.sweeper_heartbeat TO service_role;
  + 三條顯式 policy(select / insert / update,TO service_role)
  🔴 而該檔刻意【不依賴 BYPASSRLS】——:106-113 逐字說明為什麼(與 repo 慣例相反、不該被依賴)
⇒ 寫入端要走 **service_role 的 Supabase client**,不是 route 現有的 payment_confirmer pg 連線。

而 storefront **已經有那條路**(不必新增 env、不必新憑證):
  git grep -ln 'createSupabaseServiceClient' -- 'apps/storefront/src/*'  ⇒ 5 檔
  (auth/composition.ts、email/composition.ts…;對照 admin ⇒ 55 檔,尺會動)
⇒ **零新 env、零新憑證、零 migration。**
```
⚠️ 而**多一個連線**:route 現在只建 pg deps,加一個 Supabase client 是**新的資源**
  ⇒ 要放在 **lazy** 位置(該 route `:36-38` 有明文不變式:factory 必須維持 lazy),
    否則 flag 關著的 no-op 路徑會被迫建它 —— **那會打破那條跨包不變式**。

## 3. 讀取端 —— **走既有的告警通道,不要再造一條**(答第 2 格)
```
✅ 通道是真的、而且已經接好:
   packages/adapters/src/payment/LineAlertNotifierAdapter.ts
   packages/adapters/src/payment/EmailAlertNotifierAdapter.ts
   由 packages/use-cases/src/check-anomaly-alerts.ts:156 `deps.notifiers.map(n => n.notify(message))`
⇒ 讀取端掛在 **anomaly-alert route**(`0 1 * * *`,與 settle-sweep 是**不同端點**)
⇒ settle-sweep 死掉不會讓 anomaly-alert 跟著死 ⇒ 滿足「② 不是同一條路」
```
### 3-b ✅ **怎麼接 —— 查完了,而它避開一個會撞邊界的做法**
```
getAnomalyAlertDeps()(composition.ts:214-245)回 { reader, notifiers }
CheckAnomalyAlertsDeps(check-anomaly-alerts.ts:27-31)= { reader; notifiers: IAlertNotifier[] }
```
🔴 **把心跳併進既有告警訊息 ⇒ 會動 `packages/use-cases`**(擴 deps 型別或改訊息組裝)
   ⇒ 鐵則 12⑥ + 主視窗現行邊界**明文禁止**。
✅ **而有一條不用碰 `packages/` 的**:
```
route 本來就拿得到 deps.notifiers(它自己建的)
⇒ 心跳過期時,route 直接呼 deps.notifiers[i].notify(<心跳訊息>)
⇒ **獨立一則推播,不併進既有文案** ⇒ 零 packages/ 改動
```
📌 而**分開推反而更對**:那是不同的事件(「它沒說話」vs「有幾筆異常」),併成一則會互相稀釋。
⚠️ 代價:心跳持續過期 ⇒ 每天一則、不去重;而既有告警**也是這個語意**
  (`anomaly-alert/route.ts:130` 逐字「無去重、持續提醒」)⇒ **一致,不是新行為。**

🔴 **而這條路的殘餘我不掩蓋**:
```
· anomaly-alert 自己若死了,**沒有人會知道** ⇒ 這是【誰看守看守者】的無限迴歸
  ⇒ 本片**只砍第一層**,並明寫殘餘。要再往上一層是另一片。
· 它是【每天一次】⇒ sweeper 死掉最久可能 24 小時後才有人知道。
  ⇒ 而那仍然遠好過現在的**永遠不知道**。
· 🔴🔴 **第三個殘餘,而它是【本片照不到的死角】**(2026-08-19 自查,完整推理 §5-b):
  ```
  Q:心跳做完之後,`#662`(sweep 的 Record hang ⇒ 整輪被砍)會不會變得看得見?
  A:**一半會、一半不會。**
     【持續】掛住 ⇒ 章一直不刷新 ⇒ 讀取端看得到 ⇒ ✅ 會
     【偶發】掛住 ⇒ 有些輪跑完、把章刷新了 ⇒ 🔴 **心跳永遠不會過期 ⇒ 看不見**
  ```
  ⇒ **本片關掉的是「持續死」那一半;`#662` 的偶發形態是【死角】,要靠真的修它(給 signal)。**
  ⇒ 🔴 **不要因為心跳做完就把 `#662` 當成被覆蓋了。** 已同步寫進 `#662` 條目。
· ⚠️ 前一版我寫過「503 是吵不是啞」—— **那句已收回**(§18-2):
  503 只吵在 Vercel log,而 pg_cron 側聽不到、`net._http_response` 零程式在讀。
  ⇒ **不要把讀取端接到那條同樣沒人看的路。**
```

## 4. 失敗語意:寫心跳**不得弄壞 sweep**(答第 3 格)
```
🔴 fail-open:心跳寫入 throw ⇒ **吞掉,不影響 sweep 的回應與狀態**
   理由:心跳是【觀測】不是【業務】。讓觀測弄壞被觀測的東西 = 淨值為負的守門。
   📎 memory `feedback_a-guard-on-a-safe-path-is-net-negative`
🔴 **而 fail-open 要【印】**:吞掉但 console.error 一行固定 reason code
   ⇒ 否則心跳自己靜默死亡,而我們正在做的就是治這個病。
⚠️ 已知代價:心跳寫入持續失敗時,讀取端會看到「章很舊」而**誤報 sweeper 死了**。
   ⇒ 告警文案要能分辨:**「心跳很舊」≠「sweeper 死了」**,只能說「**它超過 N 沒說話**」。
```

## 5. 要記什麼才夠(答第 4 格)
```
現有四欄剛好夠,而**用法要寫死**:
  last_success_at        ⇒ 「最後一次真的跑完」
  last_failure_at        ⇒ 「最後一次跑了而失敗」
  consecutive_failures   ⇒ 分辨【偶發】與【持續】——🔴 **而只在「跑了而失敗」那一族內**,見下
  updated_at             ⇒ 分辨「跑了沒撿到東西」與「根本沒跑」
🔴 判別:**跑了而沒撿到東西 ⇒ last_success_at 會更新**(counts 是 0,而章是新的)
        **根本沒跑        ⇒ 三個時戳全部不動**
⇒ 這就是主視窗第 4 格要的那個分辨,而**現有欄位已經做得到,不必加欄**。
```

### 5-b 🔴🔴 **`consecutive_failures` 對「被砍」那一族【系統性失明】**(2026-08-19 自查)
```
兩個寫入分支都在【行程裡面】:
  成功 ⇒ last_success_at / failures=0
  失敗(503 / catch)⇒ last_failure_at / failures+=1
🔴 而【被平台砍】的那一輪,**兩個分支都到不了** ⇒ 一個欄位都不動。
⇒ **`consecutive_failures` 數的是「跑了而回報失敗」,不是「沒能跑完」。**
⇒ 那一族**唯一**看得見的訊號 = `last_success_at` 的【新鮮度】。
```
📌 **連帶兩個限制,告警文案不得逾越**:
```
① 心跳只看得見【持續】的死亡。若 Record 只是偶發掛住 ——
   有些輪被砍、有些輪跑完 ⇒ **章會被跑完的那些輪刷新** ⇒ 心跳【永遠不會過期】
   ⇒ 🔴 `#662` 的【偶發】形態,本片**看不見**。它只關掉「持續死」那一半。
② 所以告警只能說「**它超過 N 沒說話**」,不能說「它死了」,
   也**不能**用 `consecutive_failures` 當「它壞得多嚴重」的指標 —— 那個數字在最壞的世界裡是 0。
```
⇒ 這一格要寫進 `#662` 的條目:**心跳做完不等於 `#662` 關掉。**

## 6. 🔴 上線後怎麼證明它在跳(答第 5 格,雙向表演)
```
正向:讓它跳一次 ⇒ 拋棄式環境跑一輪 sweep ⇒ last_success_at 從 NULL 變成 now 附近
反向:讓它停一次 ⇒ **不跑 sweep**,把時鐘往前推(或直接改那一列的時戳)
     ⇒ 讀取端**必須告警**;不告警 = 讀取端是恆綠的
🔴 兩發都要,而**只做正向 = 只證明「會寫」,沒證明「不寫時有人叫」** ——
   而後者才是本片存在的理由。
⚠️ 效度限定:上面兩發都在**拋棄式環境**;正式站要跳一次才算真的驗過,
   而那需要正式庫存取 ⇒ **不是我能做的**,要寫進交付說明。
```

## 7. 依賴順序(不可換)
```
1. 寫入端(route + 一支窄 RPC 或既有 adapter 路徑)
2. 讀取端(anomaly-alert 那條加一段 + 文案)
3. 雙向表演的測試
🔴 只做 1 不做 2 = **又一個「機器在、沒接線」** —— 而那正是本片要治的病。
   ⇒ **兩半必須同一片交付。** 這條寫死,不接受拆。
```

## 8. 我還沒查的(不要當已驗)
```
~~· 寫入權限未確認~~ ✅ **已查,見 §2-b**(service_role 有 SELECT/INSERT/UPDATE + 三條 policy;
  而 storefront 已有 `createSupabaseServiceClient`,5 檔 ⇒ 零新 env)
~~· anomaly-alert deps 組裝沒讀~~ ✅ **已讀,見 §3-b**:併進去會動 `packages/`(禁)⇒ 改由 route 直接呼 `deps.notifiers`
~~· 告警文案既有格式沒逐字讀~~ ✅ **不再需要** —— §3-b 改成獨立推播,不併進那段文案
· 🔴 **「sweeper 現在有沒有正在死」我答不出來** —— 證據在正式庫的
  `net._http_response` 與 `cron.job_run_details`,而**repo 內看不到、也沒有程式在讀**
  ⇒ 這決定本片是【急件】還是【背景債】,而**那一格要 Sean 的 DB 存取才答得出來**。
```
