# 上線待辦板(統一管理清單)

> **這一份的職責:回答「離上線還有多少工作」,而且答得出【數字】。**
> 建於 2026-08-24(督導窗 `pcm-website-v2-7c`;Sean 要求「一個完整的待辦清單,可以持續加上去、處理完畢刪除、進度統一管理」)。
>
> 🔴 **為什麼不放 Artifact**:Sean 2026-08-24 逐字「**我們會換 claude 帳號**」⇒ Artifact 綁帳號,換帳號那份紀錄就消失。
>    ⇒ **紀錄一律住 repo。** 曾經發過一版 Artifact 板(`56345cff`),已作廢,**不得當成真相**。

---

## 這份與 `docs/phase-1-backlog.md` 的分工(先讀,不然會變成兩份打架的清單)

```
docs/phase-1-backlog.md   = 總帳。713 條、append-only、含所有歷史。條目正本住那裡。
docs/launch-todo.md(本檔) = 工作板。只收【擋上線的】、可增可刪、每列帶 `#編號` 指回總帳。
```
🔴 **衝突時以總帳的條目內文為準**,本檔只是入口與狀態。
🔴 **本檔刪掉一列 ≠ 總帳結案** —— 刪的是「它還擋不擋上線」,不是「這件事沒發生過」。

## 怎麼改(任何 session 都照這個做)

| 動作 | 怎麼做 |
|---|---|
| 標完成 | 該列 `態` 改 `done`。**確定不再擋上線 ⇒ 整列刪掉**(歷史在 git log 與總帳) |
| 新增 | 照下表欄位加一列。有總帳編號就填,沒有就填 `—` |
| 擱置 | `態` 改 `parked`,**並在「卡什麼」寫清楚在等誰** |

## 🔴 `態` 是封閉集,只有四個值(這是本檔存在的理由之一)

```
open     沒開工
doing    有人在做
parked   刻意先不做（必須寫清楚在等什麼）
done     做完了（確定不再擋上線就刪列）
```
**數法(任何人都可當場重跑):**
```bash
grep -c '^| ' docs/launch-todo.md                      # 總列數（含表頭，減 4 個表頭列）
grep -oE '\| (open|doing|parked|done) \|' docs/launch-todo.md | sort | uniq -c
# 負對照：grep -cE '^\| zzz-bogus \|' docs/launch-todo.md   應為 0
#   🔴 **2026-08-23 修**:~~原本寫 `grep -c '| zzz-bogus |'`~~ —— 那條命令**會命中它自己這一行**
#   ⇒ 它永遠回 ≥1,而它旁邊寫著「應為 0」⇒ **一個永遠達不到它自己宣稱值的負對照**。
#   照做的人只有兩種下場:以為板子壞了,或以為負對照壞了而不再跑它。加 `^\|` 行首錨才分得開。
#   📌 形狀:**負對照寫在被它掃描的那份檔裡** ⇒ 量具的名字出現在解釋它的句子裡 = 它已經被污染了。
```
⚠️ **這四個值以外的字一律視為錯填。** 這正是總帳踩的坑:
`docs/phase-1-backlog.md` 713 條、601 條有狀態欄、**158 種不同寫法**、112 條沒有欄位
⇒ **「還剩幾件」在那份檔上機械答不出來。本檔不重蹈。**

---

## A · 真登入 E8-B(做完連帶關掉三條安全項)

> 七片做完四片。決定全有(2026-08-21 用 Supabase 內建 / 2026-08-22 各自信箱),規格 776 行也有。**缺的只是有人去做。**
> 逐片證據見 `~/pcm-mailbox/督導-005-收工交接-20260824.md` §2。

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| open | — | **B5-a 後台去讀票上的身分** | 待派 | 4 支檔 + 1 個新開關 + 16 格驗收。鐵則 8 + 12②。🔴 **三件必須一起出**(只做前兩件 ⇒ 所有人會說「真登入上線了」而系統還在信任使用者自選的人) |
| parked | — | B5-b 讀取閘去查員工名單 | 先解 `#17` | `proxy.ts` 現行 4 個 import 全是 runtime-neutral 純函式、零 DB ⇒「能不能連 A 庫」repo 內無答案 |
| open | — | B7 端到端負向驗收 + 打開開關 | 待派 | 前置 = B5。八條負向驗收在 plan v4:218-228 |

🔴 **派 B5-a 時派工單要附這句**(沒有它,做的人第一反應是去改測試):
> ✅ **2026-08-24 已消耗**:B5-a 開工當下 `b5-identity-wiring-trigger` **確實從綠變紅**(如它自己預言的),
> 三件齊出後照它的退場條款刪除(原文 `git show 952c0c42:apps/admin/src/lib/session/b5-identity-wiring-trigger.test.ts`)。
> ⛔ ~~這條線一開工,`b5-identity-wiring-trigger` 會從綠變紅 —— **那是它在做對的事,不是你弄壞了。**~~

---

## B · 上線前必關(正本 `docs/security/2026-08-17-pre-launch-must-close-checklist.md`)

> 實體工作 16 條。**⑯⑰⑲ 三條前置都是 B5-a ⇒ 收在 A 組,本表不重列。**

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| open | ⑦ | 客人可偽造 cookie 假裝經銷商 | 待排片 |🔴 **2026-08-23 Sean 拍甲:單獨排一片,不併進接經銷價那片**(理由:那片動錢=鐵則 12①,再塞權限改動 ⇒ 一片同時動錢與權限)。 🔴 清單標它「**最近會爆的一條**」——引爆點是我們自排的接真經銷價,不是上線那天。`tier.ts:59` 逐字「本行現狀未改、只釘樁」 |
| open | ⑪ | 用 LINE 的客人拿不到出貨通知 | 待派 | 紙上沒有、Email 沒有、LINE 沒有,而我們不會知道。缺的是可推播 id,要客人主動加好友並發訊息 |
| open | ③ | 新表出生自帶對外權限 —— **最毒的那半已關** | 已評估:兩格都不擋上線 |🔴 **2026-08-23 Sean 親跑 `scripts/check-anon-grants-prod.sh`(對照組兩發皆過:`legal_terms_versions×anon` 期待>0 實得 1 / `admin_audit_log×anon` 期待=0 實得 0;量具自證 51 筆)**。結果:`public|r|` grantor=postgres 那列 ⇒ `postgres=arwdDxtm` + `service_role=Dxtm`,**`anon=Dxtm` 已不在** ⇒ 新表出生**不再自帶 TRUNCATE**。成因=`20260817060000_e683_1_public_default_privileges_revoke.sql` **2026-08-18 已 apply**(帳本 ⇒ 1,負對照 ⇒ 0)。🔴 **正本清單 `:150` 那句「網站庫的 postgres 那一半還沒清」已過期,它是同日【早上】的值。** ⚠️ 殘留:`public|S| anon=w/postgres`(**SEQUENCES**,E683 `:44-45` 只 REVOKE `ON TABLES`)+ `storage|r| anon=arwdDxtm/postgres`(storage schema 未在範圍內)✅ **2026-08-23 已評估(Sean 追問,repo 就答得出八成,原本標「要 DB」是分類錯)**:
**序號那格 = 低** —— 全樹真正的序號只有 **2 個**(`order_display_seq` `CREATE SEQUENCE` / `product_fitments_index.id` `IDENTITY`);`DEFAULT nextval` **0 個真實用法**(29 筆 `nextval` 有 21 筆在註解);`setval` **2 筆全是註解**。🔴 而**預設授權只影響【以後】新建的序號**,現有那兩個早有自己的 ACL。**可達性**:anon 走 PostgREST,而它**沒有「執行任意 SQL」的入口** —— `setval` 是 `pg_catalog` 內建、未暴露,我們也沒有函式呼叫它 ⇒ **權限在手上但沒有路**。⚠️ **這一句是我對 PostgREST 設計的推理,不是量到的**;要驗只有一發:拿真 anon key 打 `/rpc/setval` 看回什麼。
**storage 那格 = 幾乎不適用** —— `grep -rl 'storage\.' supabase/migrations/` ⇒ **0 檔**(正對照 `public\.` ⇒ **181 檔**)⇒ **我們從來沒在 `storage` schema 建過東西**,而預設授權只咬「新建的、由 postgres 建的」表;Supabase 自己那兩張是 `supabase_admin` 建的且早就存在,不受影響。⚠️ 分母只涵蓋 `supabase/migrations/` —— **經 Dashboard / SQL Editor 建的不在裡面**。
🔴 **兩格都【不必在上線前處理】,而「為什麼低」的理由會過期**:A4 低是因為**現在沒有路**(有人寫一個碰序號的暴露函式,路就通);A5 低是因為**我們不在 storage 建表**(哪天建了它就活過來)。**而那兩天都不會有任何東西變紅。**
📌 量測時自己中招留痕:第一發 `grep -ci serial` ⇒ 13,**其中 12 筆是 `SERIALIZABLE`**(交易隔離等級)—— 字集比宣稱寬,同族母題。`supabase_admin` 那一半照正本不查、也改不動 | SQL 2026-08-18 已套,而清單同日寫「仍未關」⇒ 先後判不出來。跑 `scripts/check-anon-grants-prod.sh` 才定案 |
| open | ⑤ | 結算程式死了沒人知道 —— **心跳表已在庫上, 且今天第一次看見它活著** | 差「停一輪」那一發 |✅ **心跳表 migration `20260817070000_m4b_231_3_sweeper_heartbeat.sql` 在帳本 ⇒ 1**(正對照 `20260615120000`/`120001`/`20260723120000` 各 ⇒ 1,負對照假版號 ⇒ 0)⇒ 前置已到位。✅ **2026-08-23 意外取得行為證據**:Vercel Firewall Traffic 頁過去一小時 Top User Agent 有 `pg_net/0.20.0` **97 次** —— 那是 Supabase `pg_cron` 在打我們的 route ⇒ **排程確實在跑**。🔴 **但這【不等於】⑤ 關掉了** —— ⑤ 問的是「它死掉時我們會不會知道」,而「現在活著」在「有告警」與「沒告警」兩個世界印同一句話。驗收仍照原法:**停掉一輪,心跳表要看得出來**(停的那輪與正常那輪印不同的值) | 心跳表已建。驗法是「**停一輪看心跳表變不變**」——沒有人做過那一發。**表建好 ≠ 驗過** |
| open | ① | TapPay 通知端點沒有限流 —— **兩個結構性障礙今天都拆了** | 可排片 |🔴 **2026-08-23 兩件事同時改變**:①**Sean 升 Vercel Pro**(推翻他 07-25 的「先不升」)⇒ WAF 限流規則數 **1 → 40**(官方 `rate-limiting` §Limits 逐字表)⇒ 原本「只有一個名額且已給 `facet-counts`」那個死結消失,**tappay-notify 與 facet-counts 可以都要**。②**觀測端通了** —— `Firewall → Traffic` 頁實際看得到流量(Sean 截圖,督導窗讀),而 `§W-b` 原本的結論是「三個 API 端點兩個 404 一個回空 ⇒ 25 發驗不出東西」⇒ **那個前提不再成立**。⚠️ 升級前一發 `config/active` API 回 `HTTP 403`,升級後同一發回 `200` —— **是不是方案造成的:未確認**(403 只量到一次,沒讓它雙向表演)。**現況(2026-08-23 API 實讀)**:`firewallEnabled=true`;三條自訂規則全 `active` 但動作皆為 `log`(`facet-counts` 的 `rateLimit.action` 也是 `log`);IP 封鎖 0 筆。🔴🔴 **2026-08-23 深挖:這條原本是【死結】,兩條路都被堵死** —— ①**限流**:方案書 `規則 2` 標題逐字「**永遠只 Log,不要擋**」+ 內文「🔴 **不要改成 Deny/Challenge/Rate Limit**」,理由=「擋錯 = TapPay 的通知進不來 = **訂單付了款卻沒被標成已付**」(鐵則 12①)。②**IP allowlist**(方案書給的正解):Sean 2026-08-21 逐字「**tappay 我沒有 ip 可以索取**」⇒ 死。③**app 層**:該支 route 實查 `grep -ciE 'rate|429|throttle'` ⇒ **0**(正對照 `export` ⇒ 2 / `secret` ⇒ 7,負對照 ⇒ 0)⇒ **邊緣沒擋、程式也沒擋**。而 `TAPPAY_3DS_ENABLED` **已經是 true**(Sean 截圖)⇒ **那道 BLOCKER 已經被跨過去了**。✅ **2026-08-23 Sean 拍甲:設一個「高到不可能誤擋」的門檻** —— `/api/checkout/tappay-notify/` 前綴、`fixed_window` 60 秒、**limit 300**、key=IP、**動作先 Log**。🔴 **300 這個中間解方案書沒有考慮過**(它寫「不要限流」時想的是 20 那種會誤擋的門檻)⇒ **本列不算推翻方案書,是補一個它沒列的選項;真要改成擋之前必須先看 Log 數據**。✅ **2026-08-23 Sean 已加,API 逐格驗過**(不是看畫面):`規則數 3 → 4`、`version 7 → 8`,新規則 `tappay-notify flood ceiling` = `action=rate_limit` / `limit=300` / `window=60` / `keys=['ip']` / `algo=fixed_window` / **內層 `action=log`** / `if path pre /api/checkout/tappay-notify/` —— **七格全中**。📌 順手關掉一個未確認:**Pro 的自訂規則總數上限 >3**(Hobby 是 3,我們現在 4 條加得上去;**確切上限仍未知,但已不擋我們**)。🔴 **這一列【還沒關】** —— 現在是 `log`,而 BLOCKER 要的是**擋**。**下一步不是再設定,是【等數據】**:觀察 Firewall Traffic 的 `Rate Limited` 欄,連續幾天為 0 ⇒ 才有底氣把內層動作改成 `429`/`deny`。**在那之前 ① 維持 open。** | 三條 WAF 規則實測全在 `log` 模式 = 觀察不是限流。驗法:連送 25 發看擋回來的是哪一層 |
| parked | ② | 有人可灌爆通知信箱 | 綁 ① | 清單自陳「實質綁在 ① 上」 |
| open | ④ | `net` 兩表對外全開、RLS 關 —— **權限已乾淨, RLS 仍關** | 要決定 RLS 補不補 |✅ **2026-08-23 Sean 親跑,新版腳本(走 `pg_class.relacl` / `pg_attribute.attacl`,不受可見性過濾)**:(0) 兩表都在、relacl 各 2 筆 ⇒ **不是「表不存在造成的空」**;(a) 表級空 / (b) 欄級空 / (a2) `information_schema` 空且**與 (a) 列數一致** ⇒ 三條件齊,**anon+authenticated 的 DML/TRUNCATE 確實收乾淨了**。🔴 **這一發才算數** —— 08-18 網站庫那一發用舊版(只有 `information_schema`)⇒ 那個空是可見性過濾造的假綠。⚠️ **仍未關的那半**:`_http_response` 與 `http_request_queue` 皆 `rls=false / policies=0` ⇒ 第二道防線沒裝。零 GRANT 之下 anon 進不來(**這是我依 PG 語意推的,不是量到的**)⇒ 要不要補 RLS = 決策題,正本 `docs/security/2026-08-17-e686-net-table-write-exposure-guard-spec.md` | 那兩表是 sweeper 與告警的證據來源 |
| open | ⑥ | 錢真的記成「已付」那步沒被走過 | 要真交易 | 口徑鐵線:**不得寫成「3DS 結算兜底已驗證」** |
| done | ⑧ | 三個排程開關現值沒人親眼看過 —— **已取證** | 已關 |✅ **2026-08-23 Sean 貼 Vercel 面板截圖四張,督導窗逐張讀**(專案 `pcm-website-v2`)⇒ **從「轉述」升級為「取證」**:`ANOMALY_ALERT_ENABLED`=true(Production and Preview)/ `CRON_SWEEPER_ENABLED`=true(**All Environments**)/ `CHECKOUT_NOTIFICATION_EMAIL_ENABLED`=true(Production and Preview)/ `TAPPAY_3DS_ENABLED`=true(Production and Preview)。⚠️ **`CRON_SWEEPER_ENABLED` 的環境範圍與另外三個不同**(All vs Production+Preview)⇒ 它在 Development 也是 true。**是不是刻意的:未確認、沒有人拍過**。✅ **2026-08-23 Sean 當場改成 `Production and Preview`,四個已一致**(截圖:值仍 `true`、`Updated just now`)。改前查證:認證(`CRON_SECRET` Bearer + `timingSafeEqual` + `<32` fail-closed)在**旗閘之前**(`settle-sweep/route.ts` 第 1 步 vs 第 2 步)⇒ **那格不是門、是門後的第二道閘**,故此改屬**收斂與一致性,不是補洞**;全樹除兩支 route 外零依賴(`turbo.json:21` 只是快取名單)。🔴 **而我當時說「改 env 不會立刻生效、要等下次部署」是【錯的】** —— Vercel 面板當場跳 `Deployment created`,**改 env 會自動觸發部署**。Production 的值改前改後都是 `true` ⇒ 行為無變化,但**那是一次真的 production 部署**。✅ 清單要求的交叉檢查已跑:sweeper 四支 migration 全在帳本(`20260615120000`/`120001`/`20260723120000`/`20260817070000` 各 ⇒ 1,負對照 ⇒ 0)⇒ **不是「旗標開著而 migration 沒套」那個組合** | 清單標「回報 → 轉述 → 未親眼看」。⑤ 落地後由行為證明、不必靠回報 |
| parked | ⑫ | LINE token 洩漏可冒用官方帳號發訊 —— **Sean 裁定接受殘餘風險** | 等客人推播上線再開 |🔴 **2026-08-23 Sean 收掉這條,逐字「我不想換 token 這邊沒問題」** ⇒ **這是【他明示接受殘餘風險】,不是【已驗證沒問題】** —— 兩者在紙上長得一樣,本列刻意分開寫。✅ 同日 (b) 已答「**沒有**」⇒ token **不在 Supabase**,位置收斂為 `.env.local` + 兩個 Vercel 專案,原答案裡的「或者」消掉了。🔴 **仍然沒有人量過的那一格**:2026-08-19 輪替後,**舊 push token 有沒有真的失效**(事件檔 `:31-32` 只驗了 Login 那一半:「顧客站登入成功;報價單側回正常」)⇒ 若當時只是多發一把,舊的仍活著,而**兩個世界印同一句話**。⚠️ **本裁定的前提會過期**:它成立於「今天只推給 Sean 自己、客人推播尚未實作」。🔴 **客人推播上線那一刻,爆炸半徑從 1 人變成全部 LINE 客人 ⇒ 本列要重開,而不會有人自動回來改它。** 📎 同族 `feedback_status-file-fixed-fields-hide-stale-claims`。原三題判讀與 `LINE_CHANNEL_ACCESS_TOKEN`/`LINE_ALERT_TO` 讀取點(`composition.ts:288-289`)見本輪 memory |🔴 **2026-08-23 Sean 逐字答三題**:①「在 env 跟 vercel 或者 supabase」②「有」(輪換程序)③「**看得出來有問題, 但是找不到人**」。**逐格判讀**:①「**或者**」= 位置沒有單一真相 ⇒ 程式實際讀的是 `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_ALERT_TO`(`apps/storefront/src/lib/payment/composition.ts:288-289`,走 `requireEnv`),另有 LINE Login 三兄弟 `LINE_CHANNEL_ID`/`LINE_CHANNEL_SECRET`/`LINE_REDIRECT_URI`;~~**在不在 Supabase Vault:未確認**~~ ✅ **2026-08-23 Sean 答「沒有」** ⇒ 位置收斂為 `.env.local` + 兩個 Vercel 專案(S2 那支 Vault 只存 `cron_base_url`/`cron_secret`,與此無關)。②**「有」是真的、有實例** —— 2026-08-19 真的發生過洩漏(`docs/security/2026-08-19-line-credential-exposure-and-rotation.md`:一發帶 `--include=*.env*` 的 grep 把 `.env.local` 拉進 transcript,**channel secret 與 access token 兩個都在裡面**),Sean 當天已輪替兩個 Vercel 專案 + 本機。🔴 **但驗證只做了一半**:事件檔 `:31-32` 逐字「顧客站登入成功;報價單側 Sean 回『正常』」⇒ **那驗的是 Login 那一半**。**push token 換完能不能推、舊 push token 有沒有失效 —— 兩件都沒有人驗過**,而「新的能用」在「舊的也還能用」的世界印同一句話。③ **推翻了督導窗原本的判斷**(原判「看不出來」)⇒ 真實狀態 = **偵測有、歸因無**。⇒ 剩兩格要 Sean 答:**(a) 舊 push token 拿去打一發, 回 401 還是 2xx** / **(b) 那把 token 到底在不在 Supabase** | 爆炸半徑 = 全部 LINE 客人,以我們的名義 |
| open | ⑯b | 報價單那邊 2FA 現值要重量 | 要 DB | 現有數字是 **2026-07-27** 的,而且在另一個 repo 的庫。清單自己寫「上線前要重量」 |
| parked | ⑳ | 員工分權那題只是沒結案 | 跟 B5-a 收 |
| open | 總帳無號 | 🔴 **三個要【回來看】的數字 —— 沒人看就等於沒開** | 2026-08-26 起看 | **2026-08-23 全部設定完成,而全部是 `log`(刻意的,官方建議先觀察再擋)。** 收工現況(API 實讀 `version=9`):自訂規則 **4** 條(`facet-counts` 20/60/IP→log · `Log TapPay notify`→log · `Log login`→log · **`tappay-notify flood ceiling` 300/60/IP→log**)+ 託管 **2** 個(`bot_protection` active/log · `ai_bots` active/log)。🔴 **log 模式的價值全部押在「有人回來讀」上,而讀的動作沒有任何機制在催** ⇒ 本列就是那個機制。**去 `Firewall → Traffic` 看三個數字**:①**`Rate Limited`** 連續幾天 =0 ⇒ 300 門檻不誤擋 ⇒ **才可以把 `tappay-notify flood ceiling` 內層動作改成 `429`,① 那時候才算關**;②**Bot Protection** 把那 206 個 `X11 Linux`(AWS,一小時)分成什麼;③**AI Bots** 誰在爬、幾隻 —— 🔴 **③ 是生意題不是資安題**(`Deny` = 我們從 AI 搜尋結果消失;`Allow` = 型錄與一般售價被免費抓走)**,督導窗不判,要 Sean 拍**。⚠️ 經銷價不在外洩面(爬蟲是匿名訪客,Server 端鐵則守住) |
| open | 總帳無號 | 🔴 **改 Bot Protection 為 `Challenge` 的【前置】—— 不是它的旁邊** | **要把它改成 Challenge 的那個人** |🔴 **這一格是【兩個已知缺陷相乘】**(主視窗 2026-08-23 指出,收下):`A` 防火牆會擋死我們自己的排程 × `B` 排程死了沒有人會知道(必關清單 ⑤)⇒ **A 單獨看是「會壞」;A×B 是「會壞而且不會有人發現」。** 所以它是**前置**,不是提醒。**「誰」欄刻意寫成動作而不是窗名** —— 規矩要住在**會經過的人**身上,而現在還不知道那是誰。 **2026-08-23 開了 Bot Protection(`managedRules.bot_protection` active=true / action=**log**,版本 6→7;API 實讀,不是看畫面)**。現在是 log ⇒ 安全。🔴 **但官方文件逐字:它會對「violate browser-like behavior」的流量發 JavaScript 挑戰** —— 而 Vercel Traffic 頁量到我們自己的 `pg_net/0.20.0` **一小時 97 次**(Supabase `pg_cron` 打我們的 route),那是**徹底的非瀏覽器流量**。⇒ **改成 `Challenge` 那一刻,結算排程會被我們自己的防火牆擋死**,而 ⑤ 說了**沒有告警會告訴我們**。**改之前必做**:先加一條 WAF custom rule 用 **bypass** 動作放行我們自己的排程(官方文件明列這個做法)。✅ 另查:我們**沒有反向代理**(`curl -sI` ⇒ `server: Vercel` / `x-vercel-id: hkg1::sin1::…`,Cloudflare 標頭 ⇒ 0)⇒ 官方警告的「Cloudflare 後面會失準」不適用。✅ Google/Facebook 等**已驗證機器人自動排除**,不會被誤傷 |
| parked | 總帳無號 | OWASP Core Ruleset 拿不到 —— **Enterprise 專屬** | 要談 Enterprise |🔴 **2026-08-23 Sean 截圖:`OWASP® Core Ruleset` 旁掛紫色 `Enterprise` 標籤,只給 `Contact Sales` 與 `View Rules`** ⇒ **Pro 開不了**。🔴 **而督導窗一度判錯**:API 讀到 `crs` 的 `gen`/`rce`/`xss`/`sqli` 四組 `active: true`,我寫成「已經開了、可能已在計費」—— **錯**。功能沒授權 ⇒ 那四個 `true` 是**存在設定裡的偏好值,沒有在跑**,也沒有計費。誤判來源=定價頁「`Included (Pro): 4KB`」被我讀成資格宣告,它其實只講**用量**。📌 **`active: true` 在「真的在跑」與「根本沒授權」兩個世界印同一個字** —— 本 repo 母題再一次。⚠️ 「`crs` 沒在跑而 `managedRules` 有在跑」是我從**兩個 key 的行為差異推的**(後者是點完才出現的新 key),**未確認**。⇒ **不影響主線** —— ① 要的是限流不是 OWASP | Sean 2026-08-16 已拍「內部不分權是刻意的,防的是外部」。主視窗判:分兩次改會讓清單前後不一致 |
| open | 總帳無號 | merge/deploy 前的安全閘 —— **腳本寫好了、沒有人呼叫它** | `cf` 補洞窗(排 B4 之後) | 🔴 `scripts/pre-push-attack-surface-sweep.sh` **396 行**,而 `grep -rn attack-surface-sweep .husky/ package.json turbo.json` ⇒ **零命中**。`.husky/pre-push` 實跑四段(typecheck / lint / deploy-order-gate / migration-ledger-divergence)**沒有一段是安全檢查**。⚠️ **接線前必須先量誤擋率** —— 補跑 `5e97aabd 3bdf6c7d`(12 顆)⇒ `rc=3`、5 類全中 ⇒ 直接掛 pre-push 很可能變噪音(實錘 `manual-refund-787-trigger` 紅 26 小時無人停)。🔴 這一列的**前一版寫「零規格」是錯的** —— 那個 0 來自我自己挑的字「安全硬閘」,換分母(`ls scripts/`)就出現了(原句逐字留存:~~「修法已核可=拆兩半,而**輕的那一半至今零規格**」~~ **2026-08-23 作廢**)。🔴 **2026-08-23 主視窗裁三格**:①歸 `cf` 不歸 V 窗(V 窗那句是 08-17 寫的,**歸屬要問不要推**)②**先不接 pre-push** —— 12 顆中 5 類 ⇒ 這不是誤擋率高, 是**幾乎每次推都會響**, 而「每次都響」與「從不響」訓練人的效果相同 ⇒ 先做成手動工具、且輸出要能讓人知道下一步 ③判別句給 `cf`:**「這份輸出讀完之後, 人會做什麼?」答不出來就不要掛任何鉤子**
| open | 總帳無號 | 註冊那道門是【公開端點】, 而信箱驗證是關的 | 要面板 + 要 code | 🔴 `#173` 早就立了(`docs/phase-1-backlog.md:5145`), 而**這張板子上一次都沒出現過** —— 2026-08-23 主視窗讀 `5e97aabd..3bdf6c7d` 的 auth 類 diff 時獨立撞到, 才發現板上沒有它。事實:註冊最終走 `supabase.auth.signUp` = GoTrue **公開端點**, 拿 anon key 就能直呼、**繞過我方表單**;而 Confirm email 是 **OFF**(`packages/adapters/src/supabase/SupabaseAuthAdapter.ts:37` 逐字「Phase 1 Q1=A Confirm email OFF 時應恆 false」)⇒ 直呼就拿得到可用帳號。⚠️ **⇒ 我方那兩道註冊 denylist**(`field-validation.ts` client + `app/register/actions.ts:46` server)**不在攻擊者的路徑上** —— 不得宣稱「合成/佔位信箱不會被搶註」。🔴 **未確認**:GoTrue 那條路實際通不通(captcha / rate limit / allowed domains)= **平台面板設定、不在 repo 裡、沒有人量過**。⚠️ **不得為了確認它去實打正式站 signup** —— 那會在正式庫建出一個真帳號。現有緩解在 `apps/admin/src/lib/customers/manual-customer.ts`(佔位信箱 local-part 不可枚舉 + `app_metadata` 身分鍵 fail-closed), 而**緩解不是關掉**。⇒ 兩步:①Sean 看一次 Supabase Auth 面板的三個設定並回報字面 ②上線前重開 Confirm email + 補「請收信驗證」UI(`#173:5159`)。📌 為什麼今天不緊急:Sean 2026-08-23 逐字「現在都是假帳號」⇒ 沒有真人受害。🔴 **而那句話會過期, 過期當天 repo 裡不會有任何東西變紅。**
| parked | 總帳無號 | 最終全站滲透測試 —— 屆時把 strix 當第二把尺 | 等完工 | 計畫已在 `docs/security/2026-08-17-full-site-pentest-plan.md`(**316 行**,只擱著不跑)。🔴 **2026-08-23 Sean 拍甲:現在不裝 strix** —— 它最強的是打**活的站**,而站還沒上線。`usestrix/strix` Apache 2.0 / 要 Docker + 一把 LLM API key / 會自己寫 PoC(我們現有的 `pcm-security-audit` 不寫)。⚠️ 本列是**等完工**不是**不做**

---

## C · 功能線

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| doing | #858 | 手動建**訂單**(客人匯款那條路)—— ⚠️ **不是手動建商品,兩條線** | 窗 C | Sean 2026-08-23 答「上線前要能用」⇒ 升成擋上線。收款端做好、建單端無 `/orders/new`。🔴 **片0-b 已開工未 commit**(`?? apps/admin/src/lib/customers/manual-customer.ts` + `.test.ts` 在磁碟)⇒ 用 `git log` 查它會拿到沒判別力的 0。🔴🔴 **這片今天是【地基】不是【可用功能】**:督導窗自驗 `createManualCustomer|findCustomerCandidatesByPhone` 於 `apps/admin` 排除自身與測試 ⇒ **production 呼叫端 0**(正對照 `authorizeAdminMutation` ⇒ 46 檔)⇒ 要等片1 接。**現況表不得寫成「手動建單能用了」** |
| doing | — | 訂單確認信改版(HTML + 金額 + PDF) | 窗 A | A 版(Sean 看過三版選的)。片A 前置在飛(`?? SupabasePaidEmailContextAdapter.ts`)。sender 仍純文字(`IEmailSender` / `ResendEmailSenderAdapter` `grep -c 'html'` ⇒ 0 / 0)。🔴 **真正只剩 Sean 做得到的一格 = Resend 到達率截圖** |
| doing | #841 | 登錄匯款後單子從畫面消失 | 窗 B | 🔴🔴 **推之前必須先套 SQL,否則後台訂單列表整個 400**:code 已讀 `paid_total`(工作樹 2 處 / `origin/dev` 0 處),而 `20260823030000_..._order_paid_total_view.sql` 是 `??` 未進版控、`grep -c '^20260823030000' APPLIED.tsv` ⇒ 0(正對照 `20260823020000` ⇒ 1)。**三綠不會紅**,dev=production。順序:貼 SQL → 落帳本 → commit → push。✅ **2026-08-23 更新**:主視窗已把它從「靠人記得的順序」升級為**拆片**(第一顆只有 migration + 守門,程式那半等 SQL 貼完才 commit)⇒ **結構上做不到錯**。🔴 **而分邊【今天動過兩次】,都是 B 窗量出來的**(①`order-detail.tsx` 進第二顆 —— 不是因為它讀 `paid_total`(它不讀),是因為它的**正確性依賴新述詞已生效**;判準是【依賴】不是【引用】 ②`packages/domain/*` 三支進第二顆 —— adapter 已 import 那個常數,不可分)⇒ **本表只記「分邊由主視窗維護」,不抄任何一版清單。** |
| open | — | 出貨文件 PDF(一鍵出圖傳客人) | 待派 | 🔴 **不是整條沒做** —— HTML 列印頁早就有(`app/print/orders/[id]/{picking,shipping/[shipmentId]}/page.tsx`),缺的只有「**伺服器渲染成 PDF**」那一段(`git grep 'application/pdf' -- apps packages scripts` ⇒ 空)。不用加套件。驗收=**中文字真的在** |
| done | #806 | ~~解除退款封印~~ ⇒ **結論=【不解除】,封印已還原** | 窗 `c4` 收工(2026-08-24) | 🔴 **不是還沒做,是做完了而答案是「不要做」。**codex 對抗審查當場構造出取錢路徑:持有效後台 session ⇒ 不經畫面直送 `recordManualRefundAction` ⇒ 一張純刷卡**未付款**單 ⇒ 金額 ≤ 訂單總額 ⇒ 寫進假的人工退款 ⇒ 永久扣低可退餘額。成因=RPC 上限用 `o.total`(訂單總額)而非**該軌淨實收** ⇒ **修那件事的就是 `#866`,而 `#866` 兩支 migration 未 apply ⇒ 現在解封 = DB 側零保護**。還原證據:`manual-refund-entry-gate.ts` / `manual-refund-actions.ts` 非註解 diff = **0 行**;`manual-refund-entry-gate.ts:69` `MANUAL_REFUND_ENTRY_BLOCKED_BY_787 = true`。🔴 **本列原字面「那顆紅著的觸發器在等這件事」已過期**:`manual-refund-787-trigger.test.ts` 已**換靶④**,量的是「`APPLIED.tsv` 有沒有 `#866` 的版本號」⇒ 今天 **0 ⇒ 綠** ⇒ **它不再紅,也不再在等**(負對照 `20260823020000` ⇒ 1,尺是活的)。⚠️ **2026-08-24 主視窗壓縮後照本列舊字面把它重新派了出去,被 `c4` 攔下** —— 記在這裡是因為**過期在字面上長得跟現行一樣**,而下一個讀到的人會做同樣的動作 |

---

## D · 整合與衛生(不做不會壞,但會讓每次盤點都重來一次)

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| open | — | 總帳狀態欄加封閉集欄位 | 待派 | 713 條 / 601 有欄 / **158 種寫法** / 112 條無欄。便宜解:加一行封閉集、守門**只擋新條目**、存量回填另排。🔴 驗收要雙向表演 |
| open | #838 | traps-inbox 收割停了而堆積翻倍 | 待派 | 27 檔(`#838` 記的是 9),而「**為什麼停**」沒人答。便宜解:把「查坑走 `scripts/traps-neighbours.py`」寫進 CLAUDE.md 路由表一行,不併檔 |
| open | — | 三顆「等事件」觸發器記成一張清單 | 待派 | 787-trigger 🔴紅 / b5-identity-wiring ✅綠(**現在綠是對的**) / login-event-drop-fuse ✅綠。**這張表現在任何地方都沒有** ⇒ 建議記進 `#806` |
| doing | — | 33 項「員工的一天」6 格重量 | 排隊中 | `#2` `#10` `#15` `#16` `#19` `#27`。主視窗排隊,等第一個窗收工 |
| parked | — | 刷新 `docs/progress-roadmap.html` | 等 6 格 | 2026-08-12 之後 **2,791 顆 commit**。它的產生器讀 STATUS,而 6 格還在重量 ⇒ 現在刷會把過期數字**畫成圖**,而圖比文字更讓人相信 |

---

## E · 客人看得到的(2026-08-24 六面掃描新增;本輪之前**沒有人盤過顧客站**)

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| open | — | **新品牌上架後客人看到 404** | 待派 | 品牌內容寫死 21 家(`grep -cE '^\s+"slug":' apps/storefront/src/data/brand-content.ts` ⇒ 21),`app/brands/[slug]/page.tsx:102` 不在那 21 筆就 `notFound()` —— **與 DB 無關**。🔴 **backlog 換 pattern 重掃仍查無條目** |
| open | — | **品牌牆撈不到就整面全灰,而且不說話** | 待派 | `lib/brand-products.ts:66-68` 無 try/catch,下游 catch 回 `[]` ⇒ `app/brands/page.tsx:52-55` 註解逐字「撈取失敗 → 空集合(fail-closed)⇒ 20 家全部泛白」。🔴 **未立案**;⚠️ 那句註解自己寫 20 而實際 21 ⇒ 註解已過期 |
| open | #64 | 客人拿不到發票 | 待派 | 後台**填得了**(`workflow-form.ts:25` `invoice_number`),而 `grep -rn 'invoice_number' apps/storefront/src` ⇒ **0** ⇒ 填了客人看不到。自動開票整合零命中 |
| open | #35 #183 #821 | 全站沒有搜尋框 | 待派 | 無 `search/` 路由;`searchByKeyword` 在 storefront 唯一命中是測試 stub ⇒ 零消費者。`#821` 已記「政策宣告了一個不存在的功能」 |
| open | #136 | 頁尾「聯絡客服」灰掉按不動 | 待派 | `HomeFooter.tsx` `<button disabled aria-label="聯絡客服(尚未上線)">`,而同排 FB/IG/LINE 是真連結 ⇒ 灰鈕夾在活連結中間 |

## F · 紅著的閘(2026-08-24 新增)

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| doing | — | 🔴 **CI 已經連紅約 74 小時,而沒有人被通知** | 待派 | 末次 success `2026-08-20T03:29:01Z`,其後 **29 顆連續非 success**。`STATUS.md:31` 已記「CI 非閘、無人被通知」。⚠️ STATUS 寫的「34 小時」已過期 | 🔴 **2026-08-23 更新(主視窗)**:根因查明並已 commit —— runner 內建 python 3.12.3 < `check-syntax-nonts` 的地板 `PY_MIN=[3,14]`,而三支 workflow 裡 `python|setup-python` **零命中** ⇒ 那 8 格從裝上以來**在 CI 上一次都沒成功通過**。修法 `a8ce7578`(`actions/setup-python@v7`, 釘 3.14), codex 對抗審查 R1 FAIL 3 must-fix(**全部在新寫的註解上,做法本身零 finding**)已修完。⚠️ **仍是 doing 不是 done**:它**要真的跑一次 CI 才驗得到**,而那顆還沒推。🔴 而 push 輸出已第三方佐證此事:`Bypassed rule violations … Required status check "check" is expected`。
| done | #315 | `brand-products.test.ts` 紅 —— 釘住清單過期 | 待派 | 加了第 13 個分類「進氣系統」(commit `6c937647`)⇒ `:80` diff `+ "進氣系統"`;`:85`/`:86` 的 12→13 / 52→53 同片要改。✅ **直接改是合法的**:`#791` 已對真 taxonomy 比對過(migration 已 apply、真瀏覽器 753 件 / 負對照 0) | ✅ **2026-08-23 由 `cf` 退場(B1)**:`#791` 已把「進氣系統」那件做完(`6c937647`,真瀏覽器 753 件 + 負對照 `?category=zzz` ⇒ 0) ⇒ 這是**事件型觸發器響完該退場**,不是「改期望值讓它變綠」。🔴 它的能力邊界**沒有變**:仍只守設計側,「與真目錄對得上」**仍然沒有機制**,第 14 個分類來時一樣要重量。(未 commit —— 在 `cf` 手上,見 `~/pcm-mailbox/MAIN-137-工作樹歸屬地圖-20260823.md`)
| done | #701 | `procurement-wiring` 3 個 unhandled error | 待派 | `TypeError: revealed.current?.scrollIntoView is not a function` @ `danger-zone-details.tsx:77`;本 repo 無全域 `setupFiles`(`grep -n setupFiles vitest.config.ts` ⇒ 0)。🔴 **不是一支檔的事** —— 另兩支掛同元件的測試只是沒展開那塊 ⇒ 下一個寫展開測試的人會再踩 | ✅ **2026-08-23 由 `cf` 修完(B2)**:一行 stub(`beforeEach` 裡 `Element.prototype.scrollIntoView = vi.fn()`)。🔴 值得留的兩件:①`revealed.current?.scrollIntoView(...)` **有 `?.` 而它照樣 throw** —— optional chaining 擋的是「屬性不存在」,不是「它不是函式」;②那 3 個錯**不會讓測試變紅**(`Tests 4 passed` 與 `Errors 3 errors` 是**不同欄**)⇒ 只看 Tests 那行的人看不到它。(未 commit,同上)
| open | — | 沒有任何東西對【新增的 .sql】自動跑語法規則② | 待派 | `scripts/migration-static-checks.sh:276-300` 規則②活著,但 lint-staged 只在**該腳本自己被 staged 時**跑它的 `--selftest` ⇒ **新 migration 不會被它檢查** |
| open | — | `migration-post-commit-guard.sh` **不是重複的孤兒 —— 它是【做好了沒接線】** | `cf` 補洞窗 | 🔴 **2026-08-23 更正,原處置作廢**。原句留痕:~~「它防的那類缺陷已被 `migration-static-checks.sh` 規則②**更嚴格地**涵蓋 ⇒ 處置是**刪**,不是『裝上』」~~。**那句話漏掉了那支腳本的一半。** 它有兩道閘:**閘① 最後一個 COMMIT 之後不得有 DDL/DML** ⇒ ✅ 確實被規則② 更嚴格涵蓋;**閘② `#530` 交易區塊【內】不得有會沖掉批次的語句**(`CREATE INDEX CONCURRENTLY` / `REINDEX … CONCURRENTLY` / `VACUUM` / `CLUSTER` / `ALTER SYSTEM`)⇒ 🔴 **零人涵蓋**。數法(全 repo,附負對照):`grep -nE "CONCURRENTLY|VACUUM|CLUSTER|ALTER SYSTEM" scripts/migration-static-checks.sh` ⇒ **零命中**;負對照同尺量它確有的字 `grep -c "commit"` ⇒ **6**(尺是活的);全 repo 提到 `CONCURRENTLY` 的 3 支裡,`l5b2-2d-verify.sh:513` 是**在用**它、`269b-gate.sh:93` 是**提示文字**,只有本支是**偵測式**。⇒ **刪掉它 = 刪掉 `#530` 唯一的守門。** 🔴 而它零呼叫端的原因寫在它自己的 commit 標題裡:`166f3554` 逐字「**本片【不掛 hook】—— 這是刻意的邊界,不是漏做**」+ 「**掛上去那一行由主視窗或平台設定的負責人做**」⇒ **接線那一步被指派給主視窗,而那一步沒發生。**⇒ 新處置:**掛上去**(`.husky/` = 平台設定 = 鐵則 12④ ⇒ 要跑對抗審查)。掛之前兩件硬前提:①量誤擋率(拿最近 20 支 migration 各跑一次,紅的逐支開檔判是真違規還是字集太寬)②🔴 **它一次都沒跑過 ⇒ 「該紅會紅」從來沒有人證明過** ⇒ 要餵一支故意違規的 migration 證明它真的紅、再還原。🔴 **同批那 7 支 0 引用腳本:一支都不准整批處置** —— 「零呼叫端」有兩種而處置相反(甲 做完了沒人再需要 ⇒ 可刪 / 乙 做好了沒接線 ⇒ 刪掉等於丟掉別人做完的工)⇒ **逐支問甲乙**。📌 形狀:「它被涵蓋了」這句話**沒有分母** —— 它比對的是「兩支都在管 COMMIT」,不是「兩支各自守住哪些形狀」 |

| done | — | 🔴🔴 **`20260823030000` 那支 SQL 沒有被 `git add`** | 窗 B / 主視窗 | `git status` ⇒ `??` 未進版控。**這是那顆炸彈的成因**:精準 add 漏一支 ⇒ code 走了、SQL 留在本機。修法=`git add` 它,並與 code **同一顆或它在前** commit | ✅ **2026-08-23 全部走完**:已 `git add` 並 commit(`4057eece`)、Sean 本人貼進正式庫(螢幕逐字 `Success. No rows returned`)、`APPLIED.tsv` 補列(`3bdf6c7d`)、code 那一半 commit(`0853bf2b`)。🔴 **post-apply 值層實測** `admin_order_list_v` ⇒ **20 / 10 / 0** ——第二格的 **10** 是承重的:窄 view 若靜默回空,每張單 `paid_total` 都是 0 ⇒ 那格會是 **0**。⇒ **壞掉與正確在這一格印不同的數字。**
| open | — | 🔴🔴 **放寬推 dev 的閘** —— ✅ Sean 2026-08-24 答「**放寬**」 | 待排 plan | 現況 `scripts/deploy-order-gate.sh:141` **只抽 FUNCTION 名**。當場量:本支 FUNCTION ⇒ **0** / VIEW ⇒ **6** / 正對照另一支 ⇒ 2 ⇒ 一個名字都抽不到、push 不會被擋。🔴 **這一板推翻他自己的 `Q2=B`**(`:16` 那句「寧可漏擋、只比對 RPC 函式名」作廢 —— **劃掉加註記,不要刪**)。命中 **12④** ⇒ 對抗審查不降級。全文 memory `project_0824-sean-widens-deploy-order-gate` |
| open | — | 🔴 放寬那道閘的**第三格驗收**(最容易被跳過的) | 同上 | ①該紅必紅(餵只建 view 且 code 已在讀 ⇒ 擋)②該綠必綠(只建 view 沒人讀 ⇒ 放行)③**對現有 210 支 migration 全量乾跑,看它擋下幾支** —— 擋下一大票 ⇒ **那不是放寬成功,是把閘變成噪音**。實錘:`787-trigger` 紅 26 小時、跨 21 顆 commit 沒人停 |
| open | — | 🟡 `20260822010000`(出貨信 view)到底套了沒 | 要 DB | ⚠️ **只有帳本一個訊號,不夠**。`APPLIED.tsv` 自陳 **283 列裡 168 列是事後補記** ⇒「帳上沒有」是**弱訊號**。要一發對正式庫的 `to_regclass('public.pcm_shipped_email_pending')` + 編造名負對照 |

## G · Sean 2026-08-24 已裁(**不要再拿這幾格去問他**;逐字與連帶效應在 memory `project_0824-sean-five-scope-rulings`)

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| open | — | **優惠券／折扣碼** —— Sean 逐字「開發啊,去做啊」 | 待寫 PRD | 🔴 **從零開始的新功能**:`優惠券`/`優惠卷`/`折扣碼`/`coupon` 於 backlog ⇒ **全 0**(正對照 `出貨單` ⇒ 18);code 三處全是「不做」註解。**零條目、零 PRD、零 schema**。必動訂單金額計算 ⇒ 鐵則 12① ⇒ **先寫 PRD 等批,不是直接開工** |
| open | — | **客戶篩選多軸 + 註冊表單加性別** —— 他逐字「當然要做啊......... 性別、生日這個在客戶註冊時候也要有」 | 待寫 plan | 🔴 **他把範圍擴到顧客站了**,三段一起:註冊表單 / `customers` schema 加 `gender` / 後台篩選多軸。生日**已有一半地基**(`20260523034911:19` `birthday date`、`:231` 已有欄級 GRANT)⇒ 缺的是註冊表單有沒有在收。`gender` 全樹 0。命中 **12③ + 12⑤** ⇒ 對抗審查不降級。⚠️ **既有客人的回填策略他沒說 —— 那是還沒問的第六題** |
| open | #660 #390 | **商品編輯後台** —— ✅ Sean 2026-08-24 已定義範圍 | 線A / 待寫 plan | 他逐字:「**可以編輯、新增手動商品,而編輯的功能更完善,可以編輯很多地方。只是會連動到報價單比較麻煩而已**」⇒ 三件:①**新增手動商品**(網站上沒有的)②既有商品**多欄位可編輯**③與同步管線共存。現況 `components/products/` 唯一表單是 `product-listing-form.tsx`,檔頭自陳「上下架表單」⇒ 零編輯欄位、零新增入口 |
| open | — | 🔴 **商品編輯的真正難題:每天會被覆蓋一次** | 待寫 plan | Sean 自己點到的「連動到報價單比較麻煩」= 本題核心。商品頁**自陳**逐字「**不能在後台改**」「**多數商品每天會被覆蓋一次**」(`apps/admin/src/app/products/[id]/page.test.tsx:255,354`)。同步管線 `scripts/rpm-delta.ts` 等會 upsert。🔴 **2026-08-24 複驗更正(換掉分母,原判作廢)**:~~「只有 1 支命中 `product_source\|is_manual\|origin`」⇒ 區分大概不存在~~ —— **那三個欄名是我猜的,分母是我自己列的**。改用【建表語句本身】當分母重量:`products` 出生 14 欄(`20260507004826_init_products.sql:23`)、後續 `ALTER TABLE products ADD COLUMN` 共 8 欄(`delisted_at highlights manuals price_general price_store sound_clips supplier_slug video_url`;負對照假表名 ⇒ 0)⇒ ✅ **區分【存在】,叫 `supplier_slug`**,`20260602135934:34` `NOT NULL DEFAULT 'rpm'`。⇒ **真正的題目換掉了**:不是「要加一個欄位」,是「**手動商品的 `supplier_slug` 填什麼,而同步管線看到那個值要略過它**」。同步端是另一個 repo ⇒ 跨 repo 合約 |
| parked | #236 | 安裝預約／合作店家「即將上線」 | — | ✅ **他裁「尚未做,等上線運作後再補」** ⇒ 那兩個入口**留著**,不是缺陷。**下一個盤點的人不要再報一次** |
| parked | #202 | 儲值金分頁空白 | — | ✅ 他答「**目前是**」⇒ ⚠️ **我讀成「維持現狀、不隱藏」,而這是我的解讀不是他的原話**。低風險故未回頭問;**真要動那個分頁之前先確認** |

## H · 制度衛生(不擋上線,但會讓每次盤點都重來)

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| open | — | `MEMORY.md` 超過精簡線 | 待派 | 2026-08-24 當場量 ⇒ **21,438 字元**(門檻約 17,000)。量法 `python3 -c "import io;print(len(io.open(F,encoding='utf-8').read()))"`。🔴 **撤條目需 Sean 拍板**(檔頭自訂規矩),照既有瘦身手冊:零刪除、只換檔 |

## I · 客人買東西那條路(2026-08-24 雙線掃描新增)

> 🔴 **前提**:全 repo 真瀏覽器測試 **3 支**(首頁 / 未登入被踢 / build 起得來),
> 而 `checkout|結帳|cart|購物車|付款|加入購物車` 於 `*.spec.ts` ⇒ **全 0**(正對照 `登入` ⇒ 1、負對照 ⇒ 0)。
> ⇒ **從選商品到收信這條路,零端到端覆蓋。**
> ✅ **好消息:器材已經架好** —— `apps/storefront/playwright.config.ts` 在、`package.json:14` 有 `test:e2e`
> ⇒ 補一支的成本是**一個檔**,不是一套建置,而它剛好會抓到下面第 1、2 條。

**證據等級**:標 ✅督導窗自驗 的三條是我自己開檔跑的;其餘為對抗審查員複驗後轉述,**我未逐條開檔**。

| 態 | # | 事 | 誰 | 卡什麼 / 客人會看到什麼 |
|---|---|---|---|---|
| open | — | 🔴🔴 **網路抖一下,客人整車商品消失** ✅督導窗自驗 | 待派 | `hooks/useResolvedCart.tsx:139-143` catch ⇒ `setResolved([])`;型別 `:37` 只有 `loading\|empty\|ready`,**沒有 error 這一格**。🔴 **而 `useResolvedCart.test.tsx:125` 有一條【綠的】測試把它鎖成期望行為** ⇒ **要修得先改掉一條綠測試**。客人:右上角寫 3 件、頁面寫「購物車是空的」,他以為被清空了,而我們零通知 |
| open | — | 🔴🔴 **購物車不綁帳號,換人登入前一個人的車還在** ✅督導窗自驗 | 待派 | `contexts/CartContext.tsx` `grep -c 'userId'` ⇒ **0**(正對照 `addItem` ⇒ 10、負對照 ⇒ 0);登出不清。✅ **修法就在隔壁**:`contexts/FavoritesContext.tsx:161` 逐字「登入(或換人)後載入那個人的收藏;**登出清空**」⇒ 同一個 bug 類別、正解現成沒抄過來。**車行共用一台電腦** ⇒ 前一個人的車原封不動出現 |
| open | — | 🔴 **正式站躺著一張收不掉的空單 + 一個測試帳號** ✅督導窗自驗 | 待派 | 不是推論,有座標:`docs/probes/2026-08-18-tappay-sandbox-charge-log.md:42` 單號 **`WCYCW5`** / `orders.id 52d1f82f…` / 2026-08-18 23:45 建於**正式站** / NT$1,500 已收 **0** / `unpaid`。同檔:測試帳號 `g3-sandbox-test@pcmmotorsports.com` 亦留在正式站 auth。🔴 **而那次是最後一次真人端到端刷卡 —— 它失敗了**(UI 出「付款失敗,請聯繫客服 LINE」) |
| open | — | 桌機按「加入購物車」零回饋 | 待派 | `ProductInfo.tsx:271-284` 只呼叫 `addItem` 就結束;`已加入` 字面只在 `ProductCard.tsx:183` 與 `ProductPage.tsx:288`(手機列)。客人:畫面完全不動 ⇒ 再按三下 ⇒ 結帳發現買了 4 個 |
| open | — | 有些商品的顏色／尺寸**選不到** | 待派 | `ProductInfo.tsx:191` `.filter(g => g.values.length > 1)` ⇒ 主列+變體列那種形狀(distinct 只有 1 個值)**整組選擇器被濾掉**,而 `ProductPage.tsx:118` 預設第 0 個變體。⚠️ **嚴重度未確認** —— 缺「幾件商品是這種形狀」那一發(要查正式庫)。客人:排氣管有黑銀兩色,只看得到一種 |
| open | — | 離島運費沒有概念 | 待派 | 用**建表語句**當分母(不猜欄名):`20260523034911:40-61` 地址欄只有 `name/phone/line/invoice_*`,**無 city/postal/zip/region**;唯一後續 ALTER 只加 `email`。`shipping.ts` 全檔零地址字樣。客人:澎湖客人刷完 NT$100 運費,出貨才發現 |
| open | — | 購物車圖片載不到就破圖 | 待派 | `CartView.tsx` 全檔零 `onError`,而 `ProductGallery.tsx` 有 3 處(`:191/:242/:277`)⇒ **商品頁會自動換圖,購物車不會**。🔴 有實績:08-22 才發生過真實破圖(外部圖 + `Accept: image/webp`)。客人:結帳前那一頁破圖,最容易讓他關分頁 |
| open | — | 數量合併靜默夾到 99 | 待派 | `CartContext.tsx:249` `clampQty(p.qty + safeQty)`,`addItem` 全函式無提示路徑(而輸入框那條**有**,`ProductInfo.tsx:214-218`)。客人:車裡 90 再加 20 變 99,**沒有一個字告訴他少了 11 個** |
| open | — | 🔴 **客人刷不出卡,我們這邊不會響** | 待派 | 三個獨立分母同向:①`package.json` 全 dep(storefront 18 + root 21)⇒ 零監控套件 ②`find api -name route.ts` ⇒ 10 支,無 ingest/log 端點 ③`sendBeacon\|window.onerror\|global-error\|ErrorBoundary` ⇒ 1 命中且只寫 state 不外送。客人:只能自己打 LINE 來罵 |
| open | — | `capture-recheck` 是唯一 route 級零測試的那支 | 待派 | 分母不靠猜:`route.ts` **10 支** vs `route.test.ts` **9 支**,差的**恰好只有它**。它的三道閘沒有一發測試看著。車行:那是唯一去重讀「錢到底收了沒」的路,**它壞了會安靜地回 200** |
| open | — | 結帳第 2 步地址不見了,整區靜默消失 | 待派 | `CheckoutStep2ReviewSections.tsx:85` `{(currentAddr \|\| hasError) && (...)}` ⇒ 兩者皆無時 body 不渲染,只剩標題與「編輯」鈕 |
| open | — | ✅ **補一支購物車 e2e**(器材已架好) | 待派 | 成本一個檔。它會同時抓到本組第 1、2 條。`playwright.config.ts` 在、`test:e2e` 在、`e2e/` 已有 3 支可抄形狀 |

### ⚠️ 這一輪被對抗審查員【駁回】的(不要再報一次)
```
「購物車不能刪東西」  假的 —— CartView.tsx:156 有 removeItem, qty=1 照樣可按
「經銷價分支沒接上」  是刻意的 —— page.tsx:7-9 明寫理由(傳真 tier 會顯 NT$0), 拍板釘死
「測試有 74 格」      數字全高估 —— 實際 13/7/17/28 = 65
「無圖商品會空白」    21,220 件裡只有 1 件 —— 幾乎打不到人
```

### 🔴 兩件標「未確認」,不要當成量到的
```
· 線上 CHECKOUT_NOTIFICATION_EMAIL_ENABLED 是開是關 —— repo 看不出來, 沒人讀過 Vercel env
· 那 5 支 pg_cron 在正式庫排上了沒 —— APPLIED.tsv 第 3 欄 159/184 列是 backfill
  ⇒ 「這支上線了沒」在帳本裡【兩個世界印同一個東西】
```

## J · 跨 repo 接點與付款後(2026-08-24 雙線掃描新增)

> **證據等級**:標 ✅督導窗自驗 的是我自己跑的;標 ⚠️未確認 的我試過但兩個訊號打架;其餘為對抗審查員複驗後轉述。

| 態 | # | 事 | 誰 | 卡什麼 / 客人或車行會遇到什麼 |
|---|---|---|---|---|
| open | — | 🔴 **DNA 這家不在每日同步名單裡** ✅督導窗自驗 | 待派 | `grep -ci 'dna' .github/workflows/rpm-sync.yml` ⇒ **0**(正對照 `rpm` ⇒ 4、負對照 `zzzsupplier` ⇒ 0)。而該檔 `:3` 自陳「每天 12:30 自動跑全量同步」、`:25` 自陳 matrix 涵蓋「**所有品牌每日同步**」(2026-07-12 Sean 拍板)⇒ **宣稱與實際不符**。客人:DNA 的價格庫存凍在灌進去那天,看到的可能是舊價舊庫存,**而不會有人收到通知** |
| open | — | 🔴🔴 **`supplier_slug` 預設 `'rpm'` 是活的 —— 這是商品編輯那片的地雷** | 待派 | 建表語句當分母:`20260602135934:34-35` 兩表皆 `NOT NULL DEFAULT 'rpm'`。⇒ **後台一開放建商品,只要沒填供應商,那筆會被當成 rpm 的貨、隔天被自動同步蓋掉。** 今天沒事只因為後台還沒有那個按鈕。🔴 **這格必須在商品編輯開工前解掉**,不是之後。⚠️ **2026-08-23 更正歸屬**:~~推給窗 C(`#858`)~~ —— **`#858` 是手動建【訂單】,不是建【商品】,兩條線**。代購品項走 `order_items.variant_id = NULL` + 快照(`20260604120000:143-146`,督導窗自驗)⇒ **不建商品、不寫 `supplier_slug`,那顆地雷踩不到它**。⇒ **本格歸【商品編輯】那條線(G 組),而那條線今天還沒有人在做** |
| open | — | ⚠️**未確認** 停產品會不會自動從店裡下架 | 待派 | 🔴 **我試過,兩個訊號打架,不報成已確認**:①`rpm-sync.yml:3` 自陳每天跑「S4 下架對賬」 ②而 `scripts/rpm-reconcile.test.ts:136` 有一條測試斷言 `updates` **不得包含** `delisted_at`。⇒ 缺的檢查=**對正式庫數一發「上游已標停產而站上仍 `delisted_at IS NULL`」的筆數**。若成立,代價是**停產品還掛在店裡賣** |
| open | — | 🔴 **SSO 的 `sub` 被丟掉,兩本帳對不起來** | 併 B5-a | `app/api/sso/callback/route.ts:73` `buildAdminSession(result.amr, result.auth_time)`、`:117` `recordSsoLogin('success', loginEvent, …)` —— **兩處都沒帶 `sub`**。⚠️ **2026-08-23 更正座標**(~~`:72`/`:84`~~ 被同日那顆 commit 自己推移掉了 —— 這正是不引行號的理由)。✅ **而「靜默」那一半已經修掉**:`lib/sso/identity-drop-trace.ts` 讓它出聲(上游一送而我們沒接 ⇒ 留一行痕)。**接線本身仍未做,仍併 B5-a。**出事那天查「是誰按的」:報價單那邊查得到,網站這邊查不到 |
| ~~open~~ **半關** | — | 🔴 那兩顆 fuse **守不到上游** | — | ✅ **2026-08-24 B5-a 關掉一半**:~~`b5-identity-wiring-trigger.test.ts:59`~~ 該支**已退場刪除**(原文 `git show 952c0c42:apps/admin/src/lib/session/b5-identity-wiring-trigger.test.ts`),它守的那條線改由 `b5a-identity-acceptance.test.ts` 的 **19 格行為測試**顧(不是 regex)。🔴 **另一半仍開著,而 migration 已經寫好了**:~~`login-event-identity-drop-fuse.test.ts:66`~~ 該支已依自己的退場條款**刪除**(原文 `git show 952c0c42:apps/admin/src/lib/sso/login-event-identity-drop-fuse.test.ts`,189 行)——它守的兩個訊號現在都成立。改由 `lib/sso/login-event.test.ts` 的**行為測試**顧。`admin_sso_login_events` 原本**沒有身分欄**(`20260818190000:72-90` 逐欄讀過)⇒ **已補** `supabase/migrations/20260824030000_m4b_b5a_sso_login_events_actor.sql`(加 `actor_kind` / `actor_staff_id` + 2 道 CHECK,零資料異動)。✅ **接線已做**(`login-event.ts` 的 insert + callback 帶 sub)。🔴 **仍未 apply**(貼 SQL 是 Sean 的)⇒ 空窗期由 `login-event.ts` 一段**會出聲的退回路徑**接住:帶身分的 insert 被拒 ⇒ 退回不帶身分那版寫成 ⇒ 那一列**不會不見**,並印一行固定字串(apply 後永不再出現)。⚠️ **順序是硬的且與直覺相反**:先加欄後接線(欄位閒置、無事);先接線後加欄 ⇒ **每次登入靜默降級**,而那正是那顆 fuse 武裝的那一刻 |
| open | — | 🔴 **死人偵測的表建好了,而全樹零程式在寫它** | 待派 | `20260817070000_m4b_231_3_sweeper_heartbeat.sql:65` 建 `public.sweeper_heartbeat`(已 apply)⇒ **表在 ≠ 偵測到位**。這是本板 B 組 `⑤` 的更精確版:不只「沒人驗過」,是**根本沒有寫入端** |
| doing | `c4` | 🔴 **這一格的傷害模型【原本是錯的】—— 它不是雙扣, 而真題是【零訊號】** | ✅ 已 commit 進 dev | 🔴 **2026-08-24 `c4` 查證:~~「會真的再打一次 TapPay」~~ 字面為真而【推論錯了】。** `settleCharge` 第三步打的是 **`recordQuery`(查詢 API)**(`settle-charge.ts:21` / `:79`);該檔 `payByPrime` / `payByToken` 命中數 = **0**(數法 `grep -c "payByPrime\|payByToken" packages/use-cases/src/settle-charge.ts`)⇒ **代價是 Record 查詢額度,不是錢。** 而已經有一道 durable per-order throttle 在擋(`IPollSettleThrottle`,DB row lock 序列化)。🔴🔴 **⇒ 真正的缺口是:那道 throttle 擋掉幾次 / `settleCharge` 拋錯幾次 —— 【零訊號】。** 量法(2026-08-24 當場):`grep -c console "apps/storefront/src/app/api/orders/[orderId]/payment-status/route.ts"` ⇒ **0**;同支 `:145-147` 是一個**空的** `catch {}`;`charge-actions.ts` 的 `isInFlightSettledFailed` 裡 `if (!allowed) { return false; }` 同樣零訊號。⇒ **「它從來沒出過問題」與「它一直在失敗」,在我們這端是同一個畫面。** ✅ **已補並 commit**(行為零改動、只加 log,三條路各印【不同】的東西:throttle 擋下 = `info` / 拋錯 = `error`,兩者印不同字串才分得出兩個世界)。⚠️ **不印 `payment_url` / prime / rec_trade_id**(`CheckoutRedirecting.tsx:9` 的紀律)。⚠️ 而 `PollOrderStatus.tsx:34` 那個「13 次共 51.5 秒 ⇒ 51 秒後畫面永遠停在處理中」**仍然成立、本片沒碰**。🔴 鐵則 12① 命中(檔在金流路徑上)⇒ codex 由主視窗派;`c4` 自評「只加 log」**不構成免審** |
| doing | `c4` | ✅ **卡住的單,客人在自己帳號裡看不到 —— 已做完並 commit(Sean 拍【甲】)** | `SupabaseOrderAdapter.ts:619`(列表)與 `:655`(明細)都有 `.neq('payment_status','unpaid')` ⇒ **兩支都是客人端入口**。他付款卡住 ⇒ 訂單在他那邊等於不存在。🔴 **2026-08-24 `c4` 查證:這不是 bug,是 `#249` 的治標,而它把前提寫在同一行 —— 而那個前提已經死了。**`:620` 逐字「`#249` 治標:藏放棄付款的 unpaid 孤兒單(**前提=無線下待付款單**)」(`git log -L 620,620` ⇒ `ff79534a`)。而 `20260810200000_..._record_manual_payment.sql:236-238` allowlist **第一個就是 `unpaid`** ⇒ 人工收款登錄的**主要用途**就是「這張單是 unpaid,客人拿現金/匯款來付」⇒ **線下待付款單現在是一級公民** ⇒ 那一行連**正在等客人匯款的單**一起藏了。🔴🔴 **而真正的發現是兩套規則**:後台走 `packages/domain/src/order/order-hidden-rule.ts`(`#841`,120 格完整交叉乘積真值表 + 真打 PostgREST 的量測 fixture;用它的人 `SupabaseOrderAdapter.ts:945` + `order-hidden-notice.tsx`),**客人走 `:620`/`:656` 那個裸 `.neq`** ⇒ **已經有一份正確答案,而它沒有被接到最需要它的那條路上**;`#278`(兩個後台頁互相矛盾)是同一件事的第三個受害者。⇒ 三案並列待 Sean 裁:**甲** 客人端改用 `order-hidden-rule`(消除第二份規則,但那份是為後台視角設計的)/ **乙** 只收窄述詞(射程最小,但「怎麼判斷放棄」本身是拍板題)/ **丙** 不藏、改成顯示並標示狀態(直接解掉「客人找不到 ⇒ 再刷一次」,**而客人可見文案是 Sean 的板**)。🔴🔴 **2026-08-24 Sean 拍了【兩次】,而你要照第二次**:先答「依照推薦」= 丙(不要藏);code-reviewer 抓到丙會製造它要防的那件事(所有已取消單也是 `unpaid` ⇒ 拆掉濾網後全部冒出來且清單上分不出來 ⇒ 客人會去付一張已作廢的單)⇒ 重新問 Q7,他逐字答:「**甲 顯示但標「已取消」, 不能點去付款**」。✅ **已做完(20 支,三綠過、四發突變都打中)**:`ORDER_LIST_SELECT` 加 `cancelled_at` / `cancelled_reason`、取消軸壓過付款軸(`orderStatusLabel` 第三參數**必填**)、明細頁三格(徽章不再是催付款的 `is-action`、金額欄不再寫「應付金額」、逾期不再把機器碼 `payment_expired` 印給客人)、`IOrderRepository.ts` 那句反向的命令句劃掉。交件 `~/pcm-mailbox/A-249-交件-已取消單與查無文案-20260824.md`。⚠️ **【丁:不動版面】那一格 Sean 沒有被問到**(端出去的 Q7 只有甲乙)⇒ 本片零版面改動,要動版面得再問他。🔴 鐵則 12① 命中 ⇒ codex 已由主視窗跑完(FAIL 1 must-fix:員工內部字會給客人看 ⇒ 已修成【型別閘】,原文在 mapper 端就收斂,客人端拿不到)⇒ **已 commit `2e276a10`** |
| open | — | 🔴 那條「每天中午寫進正式庫」的線,**不在 Sean 這台機器上** | 待派 | 分母換成 `~/Library/LaunchAgents/` 實際載入面(不是檔案存在)⇒ 它跑在**另一台 Mac mini**,靠那台機器上剛好有一個密碼檔在對的位置。**那台關機或檔案搬走,同步就靜靜停了** |

### ✅ 這一輪的兩個好消息(實際比對過,不是猜的)
```
· 報價單開始送 sub 之後,員工【不會】突然登不進後台
  —— sanitizeSub 是 exact-key、壞形狀整包拒;審查員逐格比對兩端形狀
· 經銷價目前沒有任何地方在用 —— 那 2 處命中都是「確保它不會外洩」的測試,不是漏洞
```

## K · 報價單 repo(2026-08-23 首次盤點;**它現在正在被車行使用**)

> ⚠️ **另一個 repo** `/Users/sean_1/API大量上架/PCM報價單-V2`,不套本 repo 規矩、本板不派它工。
> 列在這裡的理由:**它出事會直接打到車行,而它今天之前沒有任何一張表在追。**
> 全部為對抗審查員複驗後轉述,**督導窗未逐條開檔**(標 ✅ 者除外)。

| 態 | # | 事 | 卡什麼 / 車行會遇到什麼 |
|---|---|---|---|
| open | — | 🔴 **33 支後台 API 沒有自己的門鎖,全靠一道 middleware** | 分母=所有非公開 `app/api/**/route.ts`,逐檔 `grep -c 'requireAdmin\|verifySession\|getSession\|cookies()'` ⇒ **33 支 0 命中**。✅ 已試著擊穿:Next `15.5.23`,CVE-2025-29927(繞過 middleware)**已修** ⇒ 今天大門沒壞。**哪天大門壞了,匯出全部報價與成本那支 API 直接對全世界開** |
| open | — | 🔴 新開的 API **出生就是不用登入可打**,而零測試在看 | `git ls-files \| grep -iE 'test\|spec' \| xargs grep -l 'middleware\|PUBLIC_PATHS'` ⇒ 生產測試 **0 支**。以後任何人在 `app/api/quote/` 下新開一支,**三綠全綠、沒人會收到通知** |
| open | — | 防灌水自己掛掉時**安靜地放行** | `lib/quote-guard.ts:45` `if (error) return { allowed: true }` + `:48` catch ⇒ fail-open。公開報價頁被狂刷時,**沒有人會知道** |
| open | — | 🔴 **2FA 蓋好了,但沒有「這支手機是誰的」** | 用建表語句當分母(不猜欄名):`totp_devices` 14 欄零 `user_id`(`baseline_schema.sql:5029-5044`);🆕 `recovery_codes` 同病(`:4674-4682`)。⇒ **現在開 2FA,出事查不出是誰**。連動本板 B 組 `⑯` |
| open | BL-37 | 部件講錯／方向講反(15 筆) | ⚠️ 那份 backlog 用「有沒有 DONE/✅」當尺 ⇒ **方向性漏掉正好做一半的那幾條**。這兩件**最會讓客人買錯零件** |
| open | BL-47 | 寫入路徑缺交易與 CAS | 同上,被同一把尺漏掉 |
| open | — | 🔴 **那棵樹沒有 husky 閘,而現在兩個窗共用一個 git index** ✅督導窗自驗 | `ls -d <報價單>/.husky` ⇒ **無此目錄**(本 repo 對照 ⇒ 8 項)。兩窗約好各自 `git commit -- <逐檔>`、都不 push ⇒ ✅ 做法對,🔴 **但那是【提醒】不是【機制】**,會在某人趕時間時失效,**而歸屬錯了零機械訊號** |
| open | — | 🟡 那棵樹 **4 顆未推**,其中兩顆修的是客人看得到的 ✅督導窗自驗 | `git -C <報價單> rev-list --count origin/main..main` ⇒ **4**:`382c456` 變體面板年份(**3,850 個商品的年份不再消失**)/ `bdf1c5f` 掃描器誤標 116→31 / `f2c716d` 改名 243 列 / `ca298c0` 改名腳本。**不推 ⇒ 網站側等的東西不會來,而不會有訊號** ⇒ **推不推是 Sean 的** |

### 這一面被駁回的(不要再報一次)
```
「LINE 送不出去會卡住」        已修 —— lib/line.ts:136-138 有 AbortSignal.timeout(10_000)
「最需要警報時叫不到」        已處理 —— 剩下那小塊是故意留的
「公開路由只有 11 條 / 86 檔」 兩個數字都不是量到的（實測 route+page = 85）
```

## L · 2026-08-23 對抗審查抓到的(**四片全在審查鏈裡,沒有一片卡在不會寫**)

> 🔴 **本節存在的理由**:主視窗 2026-08-23 被 Sean 問「這張板子你有在更新對吧」——
> **答案是沒有。** 當天立了 `#866`/`#868`-`#873` 共七條,而板上一條都沒有。
> ⇒ **一張「自己數得出來」的板子,前提是有人把東西放進去。**

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| doing | #866 | 人工退款可以超過實際收到的錢 | `c4` 窗 A | codex R1 **9 must-fix** + R3 2 條,全修完(`PASS=48`)。🔴 **最重的一條在【檢查工具自己】**:負測把「任何 SQL 錯誤」都當成「上限擋下了」⇒ FK / CHECK / 權限 / 連線斷掉全部冒充成命中。修完釘 SQLSTATE 重跑 ⇒ **另外 17 格當場紅**,而根因是 harness 的 schema 少了 `request_id NOT NULL` 與 `void_trio` CHECK ⇒ **原本那 31 格全部跑在一張正式庫裡插不進任何一列的表上**。🔴 **裁定:不加鎖**(會製造第二種鎖順序,而 `20260823020000:69-70` 逐字記著「C 那支已經因為鎖的形狀踩過一次死結」)⇒ 併發那格寫成**已知殘餘風險 + 失效條件**。⚠️ **未 commit、未 apply。** |
| doing | #858 | 員工手動建單(電話/LINE 來的訂單) | `96` 線 C | codex R1 **6** + R2 **3** must-fix、R3(Fable)**1** must-fix,全修完。🔴 R3 的框架句:**建單(無 actor)→ 灌假收款(零上界)→ 退款(分母已被灌大)—— 三片各自都說「那不歸我管」,而沒有一片說錯,聯集是一條路。** F1(補 `admin_audit_log` 一列)已做完並實測。🔴 **而它做到的事要講準:它讓「沒有經手人紀錄的手動單」變成一個 DB 拒絕的狀態 —— 那與「可稽核」是兩回事**(見 `#870`)。⚠️ **未 commit、未 apply;而它的唯一消費者(M12-A 呼叫端)還沒開工** ⇒ apply 之後會有一段【零呼叫端】的時間。 |
| open | #870 | 🔴 金流 RPC 的歸屬只到「某個有後台密碼的人」 | 待排(綁 `E8-B`) | R3 實測把它變得更硬:`staff.id` 是**人可讀的短代號**(`^[a-z0-9_]{1,64}$`,像 `probe_alice`)**而且就列在後台的選人下拉選單裡** ⇒ 不是「知道同事名字的人填得出來」,是**任何能登入後台的人都看得到全部可用代號**;加上共用密碼 ⇒ **冒名門檻接近零**。⇒ `admin_audit_log` 記下的是**一個自稱**:答得出「有人用 `probe_alice` 的名義建了這張單」,**答不出「是誰送出這個請求」**。🔴 **不得因為 `#858` 補了 audit 就讓本條看起來被處理掉** —— 前者關「什麼都沒記」,本條是「記的東西不可信」,修法完全不同(後者是真登入 `E8-B`)。 |
| open | #873 | 🔴 DB 多一個會員等級 ⇒ **那位客人的結帳頁掛掉,他結不了帳** | 待派 | `checkout/page.tsx:74` 裸 cast `as MemberTier` → `TierBadge` → `utils.ts:85-91` 的 `never` exhaustive **`throw TypeError`**。🔴 那個 `never` 是**編譯期**保護,而裸 cast 把執行期的值繞過型別系統 ⇒ **編譯照樣綠**。📏 **不是「讀起來會 throw」——窗 B 讓它表演過一次**(`render(<TierBadge tier={'platinum_dealer' as never} />)` ⇒ throw)。🔴 **觸發條件是「有人在 DB 加一個 enum 值」,與接經銷價無關** —— 主視窗第一版判成「接經銷價那片的前置」,**窗 B 量了之後推翻**。⇒ 守門要住在**動 enum 的那條路上**,不在結帳那支檔。⚠️ **未確認**:那個 throw 在 Next server component 會不會被 error boundary 接住 ⇒「客人看到什麼」沒有人看過。 |
| doing | #215 / ⑦ | 客人可偽造 `pcm-tier` cookie 假裝經銷商 | `33` 窗 B | Sean 2026-08-23 拍**單獨排一片**。實作完成:cookie 那條路**整項拿掉**、改 server 查 `customers.tier`。codex FAIL **4 must-fix** 修中。🔴 **其中一條是一道八天前就寫好在等它的退場閘**:`scripts/storefront-tier-cookie-writer-guard.test.ts` 檔頭 `:32` 逐字「cookie 路徑整個移除之日 ⇒ 格1 紅=**本檔大聲退場**,該片刪整檔並在 commit body 引 `#215`」。⚠️ **codex 沒跑過測試**(唯讀 sandbox EPERM)⇒ 那條「必紅」是它推的,窗要實跑確認。 |
| doing | #530 / #872 | 那道 migration 守門**寫好了、沒接線,而且從來沒有正確過** | `cf` 補洞窗 | 接線這個動作揭露了三條:🔴 **關鍵字比對區分大小寫** ⇒ 合法的小寫 `begin; vacuum …; commit;` **直接放行**;只認 `COMMIT;` 離開交易 ⇒ `ROLLBACK`/`END;`/`COMMIT WORK;` **誤紅**;沒追蹤 dollar-quote。codex R1 **6** + R2 **9** must-fix 全修完(三條都**先親眼復現才動手**)。🔴 **兩句同時為真**:「刪掉它 = 刪掉 `#530` 唯一的守門」與「那個唯一的守門本來就不太管用」。`#872` = 它的逃生門是**方便不是控制**(零機械驗證、零永久留痕)。 |
| open | #868 | 一句「A8a3 還沒 apply」過期了,而它撐著一個值班面結論 | `c4` 窗 A | ✅ Sean 2026-08-23 拍**甲**(已付款但被取消的單 ⇒ **寄之前發現就不寄**+記一列跳過)。🔴 而問這題的起點是**一句寫錯的預測**:那支 port 自陳「不補第三態 ⇒ 一次半夜告警」,而實際是**一封「付款成功」信寄給一張已取消的單** —— **被預測成大聲失敗的東西,實際是安靜地做錯**。⇒ 修法走既有機制(`skipped_order_ineligible` 早在 DB 值域裡)⇒ **零 migration**。 |
| open | #869 / #523 | `it.fails` 是本 repo 已驗證的「過期即紅」機制,而**只有一條線在用** | 待排 | `grep -rn "it\.fails"` ⇒ 8 處全落在 **2 支檔**、同一個資料夾。🔴 **病不是「要不要做閘」,是【已經有的那道閘沒有人知道】** —— 2026-08-23 有人差點重新發明一次。`#523` 那條**當天走完了**(重跑 `supabase gen types` ⇒ 逐字比對 ⇒ 兩條退場)。⚠️ 涵蓋不到:觸發條件**不是 migration apply** 的那些(「CI 沒 python」/「換機器」/ 片名而非編號)機器對不到。 |

---

## M · 2026-08-24 夜班收工新增(**這一節是補漏 —— 當天生出來的洞,當天沒有進板子**)

> 🔴 **本節存在的理由是一個量測**:2026-08-24 收工時查,當天產生的七個編號
> (`#900` `#903` `#904` `#905` `#906` `#907` `#908`)在本檔命中 **全部 0**,
> 而同尺正對照昨天的 `#806` ⇒ 2 ⇒ **尺是活的,那個 0 是真的**。
> ⇒ 病灶不是「沒人維護這份檔」——它 08-23 一天被 commit 五次。
> 🔴 **它在維護【舊的洞】,而【今天新發現的洞】沒有進來** ——
>    看起來一直有人在更新,所以沒有人去檢查它涵蓋得完不完整。

| 態 | # | 事 | 誰 | 卡什麼 / 關鍵事實 |
|---|---|---|---|---|
| open | #907 | 🔴 **`supabase/migrations/` 從零 apply 重現不了正式庫** | 待派 | 窗A 在乾淨 PG 上 apply 117 支 ⇒ 失敗 38 支,而 38 個裡 `already exists` = 0 ⇒ **全是真的缺前置**。根因:`product_fitments_effective` 被引用 7 支、被建立 0 支(主視窗複驗,活性對照同尺抓所有 `CREATE VIEW` 目標名 ⇒ 30)。🔴 **最貴的可能**:那張 view 也許只活在正式庫、從未進版控 ⇒ repo 與正式庫之間有一段沒人重建得出來的落差,**而災難復原就是從零重建**。⚠️ 連帶:`throwaway-postgres-for-migration-verification.md` 整份 runbook 的前提失效,而它仍在 CLAUDE.md 路由表裡被指著 |
| open | #908 | 🔴 **actor cookie 可自選 ⇒ 稽核紀錄會署名成別人** | 待派 | codex **R2 與 R3 兩個不同模型各抓一次**。✅ **不是權限問題**(`authorize.ts` 檔頭自己寫「actor 只標我是誰、非授權,授權在 ①」)⚠️ 而線 C 自標射程 = 那支 RPC + `lib/session/` 這個目錄,**不是全 repo**。失敗情境:已登入者換掉自選 cookie ⇒ 能做的事一件沒多,**而 `admin_audit_log` 署名成他選的那個名字** ⇒ 出事那天查「這張單是誰建的」查到假名字。🔴 升級理由(codex R2 原句):「這雖是既有風險,但**本片新增造單能力**,不能因此免除」。判別句:**問的不是要不要修,是 `ADMIN_REQUIRE_REAL_IDENTITY` 打開的那一天排在哪** |
| done | — | ~~🔴 **`20260824020000` 已 apply 而帳本沒記,退場動作欠著**~~ | 線4 | ✅ **2026-08-24 夜關掉**。兩段各自發生、不要讀成一件:①**帳本那一列早已 commit**(`a31bf037`)⇒ 原文「仍在工作區未 commit」在寫下之後就過期了;②**退場動作 2026-08-24 夜由線 4 走完**(有 Supabase 存取):重 gen `EXIT=0`/3999 行 ⇒ 逐字比對(型別 15 行**零差異**,只多兩行手貼註解)⇒ 刪 ⑬ 段 ⇒ 檔頭計數 `十三個函式、共二十九處` ⇒ `十二個函式、共二十八處` ⇒ 第二層 `it.fails` describe 一併退場。守門兩層現皆綠,且「名單空了」與「二十八」各表演過一次紅。交件 `~/pcm-mailbox/線4-交件-⑬退場-20260824.md`。⚠️ **退場的只有「型別會不會被重 gen 沖掉」** —— 那支 RPC 的**行為**在正式庫上一次都沒被真的走過,`docs/probes/2026-08-24-858-orders-pair-valid-performs.sql` 仍**零次執行** ⇒ **不得讀成「#858 驗過了」** |
| open | #906 | 退款 ID 在傳遞途中被丟掉 | 待派 | 確定掉點 2 + 未確認候選 2。規格輸入在 `~/pcm-mailbox/F-003-906-refundId斷點規格輸入-20260824.md`,**零實作**。`TapPayChargeAdapter.ts` 的 logRefund 帶著 `wire.refundId`,而**丟出去的訊息沒有帶** ⇒ 客服要對帳時查不到那筆 |
| open | — | 🔴 **退款告警的分母不含退款表** | 待派 | Sean 2026-08-24 實跑:`refunding_stuck_count` = 0 而畫面上有 5 筆卡住的退款 —— 因為它 `FROM payment_double_charge_anomalies`。✅ 排程與寄信**都活著**(pg_cron 每天台北 09:00,Sean 貼過信件截圖)。🔴 **所以這比「完全沒有通知」更難發現,因為信真的有來**。窗F 規格已定稿(`F-004`),新欄名 Sean 線裁甲 `order_refunds_stuck_count`(名字要唸得出分母的表),**門檻甲/乙/丙未裁**  ✅ **2026-08-24 夜 Sean 裁甲:門檻 = 30 分鐘**(與畫面同值,錨 `refund-ledger-view.ts` 的 `REFUND_EXCEPTION_STALL_MS`)。🔴 理由不是 30 比較好,是乙/丙會造出「畫面 5 筆而信 2 筆」的不一致。📌 連帶必做:**信裡把剛卡住的與過夜的分開列**,不是把剛卡住的藏起來 |
| open | — | 🔴 **那封每日告警叫的是一件後台做不到的事,已叫 15 天** | 待派 | Sean 2026-08-24 跑的定論 SQL:`2SQH2P` age **14 天 23 小時**、`GVRDMH` age **5 天**。而信自己寫著「這一類後台沒有手可以處理」。🔴 **第二筆是新的** ⇒ 它不只叫不動舊事,**連新事都叫不動** ⇒ 指向流程不指向資料。要嘛把那隻手做出來,要嘛這類單不進每日信 —— **Sean 拍板題**  ✅ **2026-08-24 夜已結掉**:Sean 裁甲,主視窗給 SQL、他本人貼,`attempt_manual_review_count_after` 螢幕逐字回 **0**。🔴 **不為它做按鈕** —— 這 2 筆是歷史殘留不是持續場景;**結掉之後看一個月,再有新的就做按鈕**。⚠️ 那張表**沒有備註欄** ⇒ 這個決定在 DB 裡留不下理由,紀錄只在 memory `project_0824-sean-alert-threshold-and-closing-two-attempts` |
| open | #904 | 數量輸入的分母是 **5 處不是 3 處** | 待派 | 分母被兩把窄尺各騙一次。`#905` 已關掉其中一處(`af201cc2`),其餘未查判別力 |
| ~~open~~ **done** | #905 | 出貨數量欄可以清空 | — | ✅ `af201cc2`(2026-08-24)。守門 45 → 59,三發突變各紅 5/3/4 格。🔴 **而 code-reviewer 抓到作者把隔壁那道 N2 守門殺死了** —— 「尺量的是顯示層,而我把真相搬離了畫面」,而那正是作者當時在寫的那條教訓。⚠️ **閘③(SQL `quantity <= 0`)未驗**,卡在 `#907`。⚠️ park 一條:靜默夾(remaining=2 打 9 ⇒ 夾成 2 而沒有提示)—— 設計題不是 bug |
| open | #903 | B5-a 的 rollback 是**紙上約束** | 待派 | 正確動作是輪換 `ADMIN_SESSION_SECRET`,不是移除 env。而 `git revert` 預設丟掉 body ⇒ 那條約束若只寫在 body,**恰好在最需要它的那天看不到**(`ede72879` 的 subject 因此帶著 runbook 名字) |
| ~~open~~ **done** | — | 🔴 **B5-a 的 `20260824030000` 仍未 apply** | Sean | 加 `admin_sso_login_events.actor_kind` / `.actor_staff_id`。空窗期由 `login-event.ts` 一段會出聲的退回路徑接住。⚠️ **順序是硬的且與直覺相反**:先加欄後接線(欄位閒置、無事);先接線後加欄 ⇒ 每次登入靜默降級  ✅ **2026-08-24 夜 Sean 本人貼,螢幕逐字回「Success. No rows returned」**,已記進 `supabase/APPLIED.tsv`。⇒ **此刻起靜默降級關閉**(接線碼 `ede72879` 早就上線了) |

## 🔴 這張板子沒涵蓋什麼(不要把它讀得比它大)

1. **線A 的 UI 統整** —— Sean 2026-08-24 告知「資訊還在那邊沒出來」⇒ **後台畫面那一塊完全沒盤。** 它交件後本檔要再長一段。
2. ✅ **六個面的背景掃描已於 2026-08-24 併入**(E/F/G 三組即是)。⚠️ 那一輪的驗證員自陳分母限制:**34 個 dirty 檔只開了 4 支** ⇒ ✅ **2026-08-24 已補查:35 支全開,四批獨立掃,結論=只有 `paid_total` 那一顆,無第二顆。**
   ⚠️ 而那一輪自己更正了一件事:`grep APPLIED.tsv ⇒ 0` **不等於未 apply**(168/283 列是事後補記)。
   那顆炸彈的判定**不靠帳本**,靠的是「`origin/dev` 對 `paid_total` 零命中」+「那支 SQL 未進版控」。
3. 本檔多數證據來自 **repo 字面與帳本**,不是**線上行為**。標「要 DB / 要打線上 / 要真交易」的那幾條,是**量不到**,不是比較不重要。
4. 上線清單有 **11 格沒有錨點檔**(判它們的依據是 route 清單)⇒ 不在本輪掃描分母裡。
5. **本檔沒有任何估時。** 估時要動手的人給。

## 維護紀律

- 每列的「關鍵事實」要能讓人**不必開別的檔就知道下一步**;要細節才去追 `#編號` 或正本路徑。
- 🔴 **加列時先 grep 總帳**(`grep -n '<關鍵字>' docs/phase-1-backlog.md`),有條目就填編號、不要開新號。
- 🔴 **改「態」時同步改「卡什麼」** —— `parked` 而沒寫在等誰 = 這一列會永遠躺著。
- 本檔任何數字都綁量測時點。引用前重跑它旁邊那行指令。
