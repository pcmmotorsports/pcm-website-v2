# e2e-prod preflight 加一道「這把鑰匙真的能用」· plan(2026-08-16 I 窗)

> **狀態:等批。命中鐵則 12④(CI 設定)⇒ 只提 plan、未動任何檔。**
> **提出者** I 窗(整合窗)· **要求者** 主視窗 · **預估** 單一檔案、約 25 行、15-45 分鐘一片。

---

## 1. 為什麼(起因是一個實測出來的空窗,不是想像)

```
兩把 secret 輪替時間      2026-08-16T07:29Z   （gh api .../actions/secrets 的 updated_at）
最後一次 e2e-prod run     2026-08-16T06:05Z   （gh run list --workflow e2e-prod.yml）
                          ↑ 輪替【晚】84 分鐘
```
🔴 **⇒ 新值從來沒有被任何一次 CI 用過。** 而現行 preflight 只驗**非空**
(`apps/storefront/scripts/e2e-prod-preflight.mjs:63-65` 的 `isNonEmpty`)
⇒ **貼錯成另一個專案的 key、貼成過期的 key、貼成 service key —— 三種都會通過 preflight。**

**⇒ 現行守門回答的是「這格有沒有填」,不是「這把鑰匙能不能用」。**

⚠️ **現行設計本身是好的、不要重寫**:它刻意用 `@next/env` 的 `loadEnvConfig`
(`:48-55` 檔頭寫了理由)—— 走 Next **同一份**載入實作,而不是自己猜解析順序。
**本片只在它後面接一道,不碰前面。**

---

## 2. 要改什麼(一支檔,約 25 行)

`apps/storefront/scripts/e2e-prod-preflight.mjs`,在既有的非空檢查
(實測命中五行 `:37` `REQUIRED_KEYS` 兩顆 / `:63` `isNonEmpty` 定義 / `:73` 呼叫它 /
`:94` 缺值時 `process.exit(1)` / `:98` 全數通過的訊息)
**全數通過之後**追加(**這三處是本檔僅有的檢查段落,量法 `grep -n 'REQUIRED_KEYS\|isNonEmpty\|process.exit' <該檔>` ⇒ 5 行**):

```
對 `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/` 發一個 GET
  header: apikey: <ANON_KEY>          ← 不進 log、不進錯誤訊息
  timeout: 5s，最多重試 2 次（間隔 2s）
判讀:
  HTTP 2xx / 404        ⇒ 通過（PostgREST 有回應且接受這把 key）
  HTTP 401 / 403        ⇒ 🔴 硬紅 exit 1，訊息「金鑰被 Supabase 拒絕」
  連不上 / 逾時 / DNS   ⇒ ⚠️ exit 2，訊息「連不上 Supabase（不是金鑰問題）」
```

### 🔴 為什麼要把「金鑰錯」與「連不上」分成兩個 exit code

repo 自己已經立過這條(`ci.yml:83-85` 逐字):**一個會被繞過的守門比沒有守門更糟。**
**網路抖一下就整條 CI 紅**,人會學會忽略那個紅 —— 然後**真的金鑰錯的那次也被忽略**。
⇒ **兩種失敗必須長得不一樣**,而且訊息要講得出**下一步做什麼**(Sean 08-13 定調:
錯誤訊息要讓人知道下一步,不是丟技術碼)。

### ⚠️ 不做的事(刻意)
- **不驗 key 的「權限對不對」**(例如是不是誤貼 service key)—— 那要打真表、會踩 RLS,
  範圍暴增且可能寫入。**本片只回答「PostgREST 接不接受這把 key」。**
- **不加任何重試以外的容錯**、不快取結果、不寫檔(檔頭 `:30` 明文「絕不寫入任何檔案」)。

---

## 3. 驗收條件(每條可 yes/no,且都要能實跑)

```
① 正向  正確的 URL+KEY ⇒ preflight exit 0，且後面的 build 照跑
② 🔴負向-金鑰  故意把 ANON_KEY 改成 'sb_publishable_deadbeef' ⇒ exit 1
              且 stderr 出現「被拒絕」字樣、【不含金鑰任何片段】
③ 🔴負向-連線  故意把 URL 改成 https://127.0.0.1:9   ⇒ exit 2（不是 1）
              ⇒ 證明兩種失敗真的分得開，不是同一條路
④ 洩漏檢查  ②③ 兩次的完整 stderr 都 grep 不到 KEY 的任何 8 字元子字串
⑤ 既有行為不變  把 KEY 清空 ⇒ 仍走【原本】那條非空檢查 exit 1（本片沒有取代它）
```

🔴 **②③ 必須是【兩個不同的 exit code】** —— 若兩者都回 1,本片等於沒做到它宣稱的那件事,
而**測試會綠**(因為兩個都「紅了」)。⇒ **驗收要比對數字,不是比對「有沒有紅」。**

---

## 4. 影響面與 rollback

```
影響面  只有 e2e-prod 這條 workflow 的啟動階段。
        ci.yml 的 check job 一個字都不動 ⇒ 主 CI 不受影響。
        本機跑 pnpm test:e2e:prod 會多一次 5s 內的網路往返。
rollback  單檔、單段落。git revert 該顆即可，無資料面、無 migration、無 schema。
🔴 新風險  引進一個【對外部網路的依賴】到 CI 啟動路徑。
          這是本片最該被質疑的地方 —— 而 e2e-prod 本來就要連 Supabase 才跑得起來
          （它 build 完會真的起 next start 打資料），所以不是【新增】依賴，是【提前】暴露它。
          ⇒ 現況是「連不上就在測試中途以奇怪的方式紅」，本片改成「一開始就講清楚」。
```

---

## 5. 相關但**不是本片**的一件(避免被合併進來)

我今天量到:近 30 天 Actions 用量約 **2798 分/月**。
**量法(可重跑;`--limit` 要夠大,`300` 會拿到剛好 `300` = 上限不是真值)**:
```bash
for w in ci.yml e2e-prod.yml rpm-sync.yml; do
  gh run list --workflow $w --limit 1000 --json createdAt,updatedAt \
    --jq '[.[]|select(.createdAt>"2026-07-17")|…updatedAt−createdAt…]|add'
done      # 實得 1421 / 925 / 452 分,run 數 538 / 514 / 30
```
⚠️ **口徑**:`createdAt→updatedAt` 是 wall-clock,**不等於計費分鐘**(含排隊會高估、多 job 會低估)⇒ **推算**。
🔴 **但這個結論不依賴精確度** —— `2798` 對免費額度(**`2000` 這個數字未確認、需 Sean 在 Billing 頁自看**)
差約 40%,**誤差 ±30% 方向仍不變**。**不要把「數字不精確」讀成「可能沒事」。**

而 repo 若從 public 改 private,**額度用完時 GitHub 預設不是收費是【停跑】**
⇒ **CI 靜默消失,而本機三綠照樣全綠**。
**「SQL 探針那一層只有 CI 有」的數法**(見 `docs/patterns/slice-checkpoint.md` §6.5,已實跑):
```bash
grep -rn 'initdb\|pg_ctl' .husky/ package.json turbo.json 2>/dev/null | wc -l   # 實得 0（本機側）
grep -cn 'initdb' .github/workflows/ci.yml                                       # 實得 9（CI 側）
```

🔴 **那是「CI 不見了沒人知道」,本片是「CI 有跑但鑰匙是壞的」—— 兩個不同的洞,不要合成一片。**
⇒ 前者要的是**外部**偵測(有東西在 CI 之外盯著 CI 有沒有在跑),與本片無關。

---

## 6. 給批准者的一句話

**本片把一個「已經存在、且今天可證實從未被驗過」的空窗關掉,成本是一支檔約 25 行。**
**它不會讓任何現有的綠變紅** —— 除非那把鑰匙真的是壞的,而那正是我們想知道的事。
