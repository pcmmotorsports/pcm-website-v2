# 2026-09-10 `⟦b9-SRVCONSUMERGAP⟧` —— 那格「另外 5 個沒有人查過」,查了

> 板列最後一格逐字:
> 🔴 **那份排除檔還有 5 個稽核/事件類的名字,它只追了這一個的消費者 ⇒ 另外 5 個有沒有同樣情形,沒有人查過。**
>
> **這一份把那 5 個查完了。而它同時【推翻了那唯一被查過的那一個】的結論。**

來源標籤:**【量的】**(命令 + 讀數,尺先證明會咬)/ **【推的】** / **【證不到】**

---

## 一、受詞是什麼 —— 先把那份檔的區塊開頭讀出來

`supabase/rls-service-role-select-exclusions.txt` 檔頭逐字:
> 🔴 這份檔的作用不是清單,是**把「為什麼不補」寫在一個查得到的地方**。
> 🛑 要加一行進來 = 你在宣告「後台不需要讀這張表」。

那一組的開頭逐字(**六個名字**):
```
# ── 稽核/事件類(6):寫進去就不再讀, 後台沒有頁面在讀它們 ──
admin_sso_login_events
order_legal_consents
payment_double_charge_anomaly_events
payment_refund_events              ← 板上唯一被追過的
payment_webhook_events
pcm_b2_shipping_idempotency
```

🛑 **我刻意把區塊開頭一起讀** —— 板列自己記著一次教訓:
> 🎯 **「在目標名單」與「在排除名單」的 grep 輸出【逐字一模一樣】,要往上讀 13 行才分得出。**

---

## 二、🔴 而第一個結果是:**那唯一被查過的那個,結論不成立**

板上寫:
> ✅ **`-auth` 建議**在那一行旁補一句「⚠️ `scripts/op6a-verify.sh:275,:391` 讀寫它
> ⇒ **收 `BYPASSRLS` 後那支腳本會壞**(工具,非顧客路徑)」

🔵 **而板上自己標了那是【推的】**,逐字:
> **沒實跑 `op6a-verify.sh`,「會壞」是讀那兩行推的**

【量的】我去開檔了。`scripts/op6a-verify.sh:35` 逐字:
```
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
```
而檔頭的用法逐字:
```
#   PORT=54375 bash scripts/op6a-verify.sh all /tmp/op6av    provision -> 跑 -> teardown
#   PORT=54375 bash scripts/op6a-verify.sh run  /tmp/op6av    對已起好的庫跑
```

⇒ 🔴 **兩件事讓那個結論垮掉,而任一件就夠**:
1. **它連的是 `127.0.0.1` 的本機叢集**,不是正式庫。
2. **它的身分是 `postgres`,不是 `service_role`。**

⇒ 📌 **收掉正式庫 `service_role` 的 `BYPASSRLS`,碰不到一支「以 `postgres` 連本機庫」的腳本。**
⇒ ✅ **那條建議不用補。**

🎯 **而這一格值得單獨看**:板列把它標成【推的】而**沒有人回頭驗**,然後那句推論就以「已知的消費者」的身分留在板上兩天。
📌 **一個被誠實標成【推的】的句子,如果沒有人回來驗,它與一個量出來的句子在板上長得一樣。**

---

## 三、另外 5 個 —— 逐個查

【量的】掃法:`os.walk` `apps/` `packages/` `scripts/` `supabase/migrations/`,排除
`node_modules` / `.next` / `dist` / `build` / `.turbo`,**共 2719 支**檔;
**逐行判它是不是註解行**(`//` `#` `--` `*` `/*` 開頭),兩個數都印;
排除 `.test.` 與 `database.types.ts`(型別產物不是消費者)。

### ① 應用側:有沒有任何【非測試】的碼在**讀**那六張表

```
admin_sso_login_events                 login-event.ts: insert · insert     ← 只有寫
order_legal_consents                   (零)
payment_double_charge_anomaly_events   (零)
payment_webhook_events                 (零)
pcm_b2_shipping_idempotency            (零)
payment_refund_events                  (零)
```
⇒ ✅ **六張表在應用側【一次 `select` 都沒有】。**
⇒ 📌 **那正是排除檔那句理由要的**:「寫進去就不再讀」——`admin_sso_login_events` 是唯一有應用側消費者的,**而它只 `insert`**。

### ② 腳本側:那些腳本連哪裡

| 表 | 非測試腳本消費者 | 連哪裡 |
|---|---|---|
| `payment_webhook_events` | `op4-verify.sh` · `rls-service-role-select-verify.sh` · `l3-verify.sh` | **`127.0.0.1`** |
| `pcm_b2_shipping_idempotency` | `w5-line-verify.sh` · `w4a-verify.sh` · `w7d1-verify.sh` · `w2-verify.sh` 等 7 支 | **`127.0.0.1`** |
| `payment_refund_events` | 14 支(含 `op6a-verify.sh`) | **`127.0.0.1`** |
| `order_legal_consents` | `d1t2-seed.ts` · `d1-orchestrator.ts` · `d1-export.ts` · `d1-restore.ts` · `d1t2-rehearsal.sh` | 🛑 **見下** |
| `payment_double_charge_anomaly_events` | `d1-orchestrator.ts` · `d1-export.ts` · `d1-restore.ts` | 🛑 **見下** |
| `admin_sso_login_events` | (腳本側只有註解 3 處) | — |

🛑 **`d1-*` 那一組我證不到**:`d1-restore.ts:956` 逐字 `const url = process.env.D1_DB_URL;`
⇒ **連線字串由呼叫者給** ⇒ 📌 **「檔裡沒有正式庫字面」不等於「它打不到正式庫」。**
⇒ 而**就算它打得到,它也不是以 `service_role` 連的**(那是一個 DB URL,不是 Supabase 的 anon/service key)
⇒ 🔵 **所以它一樣不受「收 `service_role` 的 `BYPASSRLS`」影響** —— 而這一句是**【推的】**,我沒有讀完那四支的連線建立處。

---

## 四、🛑 而我自己的尺歪過一次,寫下來

我第一版用「**檔裡有沒有 `initdb`**」判「這支腳本是不是自己起拋棄式庫」。
【量的】結果:碰那六張表的 **27 支**非測試腳本裡,**12 支沒有 `initdb`** —— 而 `op6a-verify.sh` 就在那 12 支裡。

🔴 **而它其實就是拋棄式** —— 它有 `provision` 與 `run` 兩個模式,`run` 是**對已經起好的庫跑**,所以它自己不必 `initdb`。
⇒ 📌 **我拿「有沒有起爐子」去判「在不在廚房裡」,而有些人是走進別人已經升好火的廚房。**
✅ **改法**:不看它起不起庫,**看它連到哪裡、用什麼身分** —— 那才是「收 `BYPASSRLS` 會不會影響它」的真受詞。

---

## 五、⇒ 結論

| 板上寫的 | 今天量到的 |
|---|---|
| 「另外 5 個有沒有同樣情形,**沒有人查過**」 | ✅ **查了。五個都沒有「以 `service_role` 讀正式庫」的消費者。** |
| 「`payment_refund_events` 收 `BYPASSRLS` 後那支腳本**會壞**」 | 🔴 **不成立** —— 它以 `postgres` 連 `127.0.0.1`。而板上自己標過那是【推的】。 |
| 排除檔那句理由「寫進去就不再讀,後台沒有頁面在讀它們」 | ✅ **六張表應用側零 `select`** ⇒ **那句理由今天站得住**,而且比它自己說的更強(不只「沒有頁面」,是**連寫入端都不讀**)。 |

⇒ 🔵 **所以那 6 道排除今天都不需要動,而理由現在是量出來的。**
🛑 **而這不是「拿掉一道說不出來由的例外」** —— 主視窗提醒過:**「找不到批准紀錄」≠「沒有人批准過」**,而那份檔的檔頭**寫著誰批的**(2026-09-04 主視窗批、Sean `Q-RLS` 拍甲)。**本份只補它的消費者盤點,不動任何一行。**

---

## 六、🛑 我證不到什麼

· **【證不到】`d1-*` 那四支到底連哪裡** —— 連線字串由呼叫者給(`D1_DB_URL`)。而「它不是 `service_role`」是**【推的】**。
· **【證不到】有沒有人在 Supabase Studio / SQL Editor 直接讀那六張表** —— 那量不到,**永遠是未確認**。
· **【證不到】板列 ④ 那一格**(拿掉 `BYPASSRLS` 之後後台還能不能建單)—— **Sean 2026-09-05 拍甲「先不驗」,等 harden 那天。本份沒碰。**
· **我只掃了 repo 的字面** —— 動態表名、`format(%I)`、注入鏈第二層,**一個都掃不到**(那是板列自己標過的盲點,我沒有補)。
· **【證不到】那六張表在正式庫今天的 policy 狀態** —— 本份查的是**消費者**,不是 policy。

**正式庫零寫入。本份沒有動任何檔,只有讀。**
