# D1a6 還原演練 —— Sean 操作包

> **這一步要證明的事:那包備份真的救得回來。**
>
> 目前只證明了「解得開」。**還沒證明「塞得回去」** —— 而 Fable 抓到的那個 BLOCKER
> (父表驗證查錯資料表、四種組合全滅)正好就是只讀腳本文字驗不到、必須實跑才會現形的那一類。
>
> 🔴 全程**不碰正式站**。演練跑在一個獨立的 Supabase 分支上,腳本本身也有守門:
> 演練版一旦連到正式站會當場中止。

---

---

## ✅ 2026-07-29 已完成一次(Claude 執行,隔離本機 PostgreSQL 17.10)

**結論:備份救得回來。** 走的是災難當天要用的同一批腳本,不是簡化版。

做法:本機起一個拋棄式叢集 → 套用 84 支 migration → 造一份**筆數與正式站 cohort 逐格相同**的
資料(orders 29 / items 39 / consents 4 / attempts 27 / invoices 3 / customers 2 / addresses 3 /
products 10 / variants 10 / terms 2)→ 跑**真正的匯出腳本** → 模擬 D1c 刪除 →
跑**真正的還原腳本** → 新連線重數。

| 驗到的事 | 結果 |
|---|---|
| 十五張表還原後筆數(新連線重數) | ✅ 全部相符 |
| 🔴 **運送快照沒被 trigger 覆寫** | ✅ 3 張誘餌單原值保住 |
| trigger 已復原啟用 | ✅ `tgenabled = 'O'` |
| 父表被刪的情境(刪掉 9 個商品)| ✅ 從備份補回 9 商品 + 9 規格 |
| 重複執行被擋 | ✅ 第二次跑當場中止(cohort 已存在) |
| 🔴 **負向測試:把 Fable 的 BLOCKER 放回去** | ✅ 第一張父表就中止、整批 rollback、零寫入 |

🔴 **最後一列是這場演練最重要的產出**:它證明這套演練**抓得到**那個 codex 兩輪 + 32 條突變
測試全都漏掉的缺陷。沒有它,「演練通過」只是另一個沒被驗證的宣稱。

**沒驗到的(誠實邊界):**
- **沒有用你那包真的加密備份** —— 解密需要你的 age 密碼。用的是同一支匯出腳本現場產的等價 CSV。
- **`scripts/d1-restore.sh` wrapper 的 TLS 那一步沒跑到** —— 本機叢集沒有 Supabase 的憑證,
  `verify-full` 在本機必然失敗。preflight 與校驗碼兩步有實跑。
- 環境是**本機 PostgreSQL、非 Supabase**:角色與預設權限照正式站實查值重建,
  但不是同一套基礎設施。
- 🔴 **`20260723120000` pg_cron 那支 migration 跳過**(需要正式站的 vault 密鑰)。

⇒ 若要補上第一項,你跑一次 `scripts/d1-rehearsal.sh` 即可(它會問你 age 密碼)。

---

## 這一步的成本

Supabase preview branch = **每小時 US$0.01344**(約 NT$0.44)。演練跑完就刪,總花費不到 NT$2。

---

## 你需要準備

**① 分支的連線字串** —— 我建好分支之後,你到
Supabase → 專案 **pcm-website-v2** → **Branches** → 點那個分支 → **Connect** → **Session pooler** 複製。

🔴 那是**分支自己的**連線字串,跟正式站那條不一樣。別用錯。

**② 解開備份**

```bash
cd ~ && age -d -o /tmp/d1.tar.gz d1-backup-20260729-v2.tar.gz.age && \
mkdir -p /tmp/d1r && tar xzf /tmp/d1.tar.gz -C /tmp/d1r --strip-components=1 && \
ls /tmp/d1r | wc -l
```

**要看到 `17`**(16 份 CSV + checksums.txt)。

---

## 執行

### 第 1 步:指向分支

```bash
export D1_DB_URL='分支的連線字串'
echo "長度=${#D1_DB_URL} / 尾段=${D1_DB_URL##*@}"
```

🔴 **尾段必須跟正式站不一樣**(專案代號不同)。如果尾段跟正式站那條長得一樣,**立刻停下來** ——
那代表複製到錯的地方了。

### 第 2 步:補帳號替身

```bash
cd /Users/sean_1/pcm-website-v2 && npx tsx scripts/d1-restore.ts --seed-rehearsal /tmp/d1r > /tmp/d1-seed.sql && test -s /tmp/d1-seed.sql && psql "$D1_DB_URL" -f /tmp/d1-seed.sql
```

**為什麼要這一步**:備份裡的客戶掛在 Supabase 帳號底下,而帳號表我們**刻意沒備份**(你拍的 Q3=A,
那張表有密碼雜湊)。全新的分支帳號表是空的,不補的話連第一張表都插不進去。

補的只有 **2 個 UUID,沒有任何個資** —— 帳號表唯一必填的欄位就是 id。

> 這一步本身也是那條殘餘風險的實證:**帳號一旦不見,那筆訂單就是救不回來**,
> 演練也得靠替身才跑得動。不是紙上推論。

### 第 3 步:真的還原

```bash
cd /Users/sean_1/pcm-website-v2 && scripts/d1-restore.sh pre rehearsal /tmp/d1r
```

會依序印出 5 個步驟。**任何一步紅了就整批 `ROLLBACK`,分支不會留下半套資料。**

---

## 跑完貼什麼給我

1. 第 2 步與第 3 步的**完整畫面輸出**(不含連線字串那行)
2. 這個:

```bash
psql "$D1_DB_URL" -c "SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS items, (SELECT count(*) FROM payment_charge_attempts) AS attempts, (SELECT count(*) FROM customers) AS customers;"
```

**應該是 orders 26 / items 36 / attempts 24 / customers 2。**

---

## 🔴 炸了怎麼辦(這才是演練的重點)

**炸掉是好事,不是壞事** —— 現在炸,總比真的需要還原那天才炸好。把訊息貼回來就好,不要自己想辦法繞過。

特別是這幾種,**都不要動腦筋修**,直接貼給我:

- `column name mismatch in header line` —— 備份的欄位跟分支的 schema 對不上
- `violates foreign key constraint` —— 有父列不在
- 任何 `D1:...拒繼續` 開頭的訊息 —— 那是我們自己的守門在講話,它擋下來一定有原因

🔴 **絕對不要做的事**:把腳本裡的 `HEADER MATCH` 改成 `HEADER`、或把任何 assert 註解掉。
那不是修好,那是把演練要驗的東西關掉。

---

## 收尾

演練通過之後告訴我,我把分支刪掉(停止計費),並清掉解壓出來的明文:

```bash
rm -rf /tmp/d1r /tmp/d1.tar.gz /tmp/d1-seed.sql
```
