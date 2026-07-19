# 交接:M-4a B-2(`create_order` 8→9 參)✅ **已上 production 並通過驗收**(2026-07-19)

> **本檔是接手 session 的唯一入口。** 讀完本檔即可動工,不需重讀整條線歷史。
> **紀律**:本檔所有「已驗/未驗」皆為實測結果;**未驗項不得當已驗用**,接手後任何宣稱請自己重驗。

## 0. 一句話現況

**B-2 收工:已 `db push` 上 production、路徑② 驗收全過、四輪對抗審查 21 條 findings 全數處置。**
**下一片 = B-3**(結帳頁 email 欄 + zod 驗證)。

⚠️ **B-2 上線 ≠ 通知功能上線**:第 9 參仍 `DEFAULT NULL`、`authenticated` 直呼可省略 →
必填收緊是 **B-6**。**在 PRD §6 八項上線 gate 全數達成前,禁用「通知功能上線」「孤兒已消滅」字面。**

## 1. 動工前必讀(依序)

1. 本檔
2. 上位真權威 PRD:`docs/specs/2026-07-18-b0-order-notification-email-prd.md` §4 B-3 / §5 / §6
3. 片級 plan:`docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md`
   —— **§8.2**(B-3/B-4 必銷的舊字面清單 11 項)、**§16**(apply 後驗收全文)
4. 拍板 memory:`project_m4a-b2-create-order-9param-decisions`(Q1-Q7 + 收案段)

## 2. B-2 最終狀態(prod 實查,接手仍請自己重驗)

| 項目 | 值 |
|---|---|
| 簽章 | `create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)`,**總數 1** |
| 完整指紋 | `850e2e3cf5f503391df5fe6fe0067cce`(== apply 前於 prod 實測的預測值) |
| `prosrc` md5 | `0bc0d256b7483c5dd6ef1f8f97b4e9a7` |
| `proacl` / owner | `{postgres=X/postgres,authenticated=X/postgres}` / `postgres` |
| 六角色矩陣 | authenticated=**t**;anon / service_role / payment_confirmer / authenticator / PUBLIC 皆 **f** |
| migration 水位 | `20260719120000`(**history 已記,M-5 裂縫未發生**) |
| 資料面 | `orders` 30 筆、`notification_email` 非 NULL **0** 筆、產號序列 `last_value=100` 未跳 |

重取指令(勿信本檔字面):

```
select p.oid::regprocedure::text, md5(p.prosrc), coalesce(p.proacl::text,''), pg_get_userbyid(p.proowner)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='create_order';
```

## 3. 🔴 未驗項(**不得當已驗用**)

1. **CLI 交易邊界原子性**:Sean 拍 Q3=A 明示不做 failure-injection。這次 history 有正確記上,
   **但那是一次成功案例、不是證明** → migration 檔頭的三查 SOP(查 history → 查簽章 → 查完整指紋)
   **仍然有效**,日後 apply 失敗時不得因「上次沒事」而直接重按 `db push`。
2. **PostgREST smoke 的落差**:原設計要以 `authenticated` 進入函式體看 `RAISE`;實際無可用使用者 JWT
   (簽發需 `.env` JWT secret、受規則封鎖)→ 改用 publishable key(anon)+ 對照組。
   **證明了**簽章在 schema cache 可解析、8 參無 `42725`、anon 無權執行;
   **沒有證明**函式體內部行為。
3. **security label 偵測**:`classoid`/`objsubid` 過濾是結構性修正,**未做正向注入測試**(本機無 label provider)。
4. **跨檔案指紋公式一致性**無程式強制(B-2 migration 與 rollback SQL 各一支 `pg_temp` helper;單檔內才是結構性保證)。
5. **本機 PG 17.10 vs prod 17.6**:byte-level 與指紋相符已大幅降低風險,**非證明**。

## 4. rollback 路徑(若日後需要退版)

**唯一權威** = `docs/reviews/2026-07-19-b2-preapply-snapshot.md` + **補充檔**
`docs/reviews/2026-07-19-b2-preapply-snapshot-supplement.md`(後者含完整 `pg_get_functiondef`、
E11 全欄、**已 parse 且已正/負向實跑驗證的 rollback SQL**)。

🔴 **步驟 0(交付模式無關的硬前置)**:B-4 上線後**先退 app、再退 DB**。
不論走哪種交付模式,只要先退 DB,呼叫端就會撞 `42883` / `PGRST202` = **結帳全斷**。

🔴 **交付模式**:rollback **必須另存為新時戳的 forward-only migration** 走正常 `db push`;
**不要直接貼 SQL Editor**(schema 會退但 `schema_migrations` 仍記載 B-2 已套用 → 下次 `db push`
跳過 B-2 = 裂縫)。break-glass 才可用 SQL Editor,且須附 history reconciliation + app 回滾 + 三查 SOP。
詳補充檔 §5.1 / §5.2 / §5.3。

## 5. 下一片 B-3(結帳頁 email 欄 + zod)

🔴 **硬條件**:zod **必鏡像 DB CHECK 的全部六條件**(可列印 ASCII / 去尾點 / 擋子網域 …)。
漏做 = **app 放行、DB 擋 → 結帳 500**。六條件字面見 PRD §3.4。
單一 env flag 同時翻四層、**預設 off**。

🔴 **跨片唯一合法順序**(PRD codex R3 #7):
`B-1/B-2 完成並驗證 → B-3/B-4 部署但 flag 保持 off → 開 flag 並記錄精確切換時戳(=cutoff)→ 觀察窗 → B-6`。

🔴 **B-3/B-4 動 TS 時必銷的「8 參數」舊字面清單 11 項** = plan §8.2,含**兩處硬編碼 8 鍵測試斷言**
(`packages/adapters/src/supabase/mappers/order.test.ts:38-47` 的 sorted 陣列、
`SupabaseOrderAdapter.test.ts:55-64` 的 mock)—— **不同步即為假綠**。
另 **Q2=A**:`database.types.ts` 刻意停在 8 鍵、**留 B-4 補**(是拍板結果、不是漏做)。

## 6. 審查史與教訓(接手務必知道)

**四輪對抗審查、21 條 findings 全數處置**:
codex CLI 關卡2 round1(5 must-fix)→ round2(3+1 nit)→ **Sean 拍 A:不開 CLI round 3、改網頁版 Codex**
(4+3 nit)→ **Fable**(2 must-fix + 2 nit;🟢 判定 **migration SQL 本體零 must-fix**)
→ Fable 複核判 **`GO`(PASS-with-comments)**。銷案表 = plan §15 / §15.2 / §15.3 / §15.4 / §15.5。

🔴 **本片最大教訓(已成 memory `feedback_control-named-beyond-its-actual-power`)**:
同一片內連續 **5 次**「替防護措施取了它做不到的名字」(假互斥的鎖 / 自稱「全屬性」卻漏欄位的指紋 /
宣稱能證明一致但其實沒比對的斷言 …),加上「只改被點名那一處」復發至**第 6 次**。
**治本手法(已落地,請沿用)**:
① **在產生器內加 `assert` 讓漏改當場炸**(例:`assert 'object-scoped' not in rb`)
② 把**負向測試**列為「宣稱某控制有效」的**硬前置** —— 正向通過只證明沒壞。

## 7. git / 部署狀態

- branch `dev`;最後 commit 見 `git log --oneline -1`;未推數見 `git rev-list --count origin/dev..HEAD`
  (**本欄一律不寫死,寫死當場過期**)。
- ⚠️ **2026-07-19 push 事故**:B-2 視窗**從未執行 `git push`**,但其 commit 已被推上 `origin/dev`
  (研判平行 session 推 `dev` 連帶;**reflog 不記執行者、無法證明是誰**)。**損害為零**
  (prod DB 當時未動、CI 內無 `db push`)。Sean 拍 **A:不撤、接受現況**。
  🔴 **教訓**:`dev` 是線性共用分支,**單線「我不推」的自律擋不住別線 push**;收工前務必查
  `git rev-list --count origin/dev..HEAD` 與 `git reflog show origin/dev | head -3`,不符即停下回報,
  **不要自行 force-push**(有 branch ruleset)。詳 memory `project_parallel-sessions-shared-git-index-collision`。
- ⚠️ **Sean ownership 凍結檔(勿動、勿混入 commit)**:`.gitignore`、`docs/progress-roadmap.html`、
  各 `*.png`、`docs/handoff/2026-07-1*`(**本檔除外**)、`docs/specs/2026-07-15|16-*`、
  `docs/specs/2026-07-19-m4a-email-e2a-2-plan.md`、`docs/reviews/2026-07-16-*`、`docs/superpowers/`
- **精準 `git add <路徑>`,禁 `git add .` / `-A`**

## 8. 接手起手

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --porcelain | head -5 && git log --oneline -3
```

預期:branch=`dev`、工作區只有 §7 的凍結檔。
