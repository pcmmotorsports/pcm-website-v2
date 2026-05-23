# M-1-14 Code 一夜跑指令包

- **日期:** 2026-05-23
- **作者:** Cowork(A mode 整合)
- **PRD:** `docs/specs/m-1-14-customer-schema.md`(完整字面源、Code 跑時必先 Read)
- **拍板狀態:** Q1=B / Q2=A(預設)/ Q3=A(預設)/ Q4=Y / Q5=A 全拍完
- **推進模式:** Q3 混合段間 — 第 1 個 prompt(Block A)Code 跑 #1+#2 連跑、後 7 段(#3-#9)Sean 起床後逐段推
- **Sean 端阻塞:** sub-slice #7(M-1-14f2 LINE OAuth)前必完成 PRD §13 dashboard checklist
- **預估總時:** 5-8 hr(Block A 1.5-2 hr 一夜跑、剩 #3-#9 隔天逐段)

---

## 0. Sean 操作順序

1. **晚上睡前** — 開新 Claude Code session、貼下方 **§1 Block A Master Prompt**(M-1-14a + M-1-14b 連跑)
2. **隔天起床** — 看 Code session 報告(#1 + #2 都綠?)+ 收 Codex Packet(#1 必觸發)貼給 Codex
3. **白天逐段推** — 跟 Code session 講「繼續 M-1-14c」/「繼續 M-1-14d」...,Code 看 PRD §11 sub-slice 表執行
4. **#7 LINE OAuth 前** — 必先完成 PRD §13 三項 dashboard 操作(Google Cloud / LINE Developers / .env.local 寫入)
5. **全部跑完** — Cowork 整合 Sean 收尾、push origin/dev

---

## 1. Block A:M-1-14a + M-1-14b 連跑(Master Prompt、晚上睡前貼)

```
[M-1-14-A] M-1-14 Customer schema 一夜跑 Block A:Supabase 4 表 + RLS + GRANT + view + 4 trigger(M-1-14a)+ domain identity 擴 + ports 3 子(M-1-14b)連跑

═══════════════════════════════════════════
任務目標(1-2 句)
═══════════════════════════════════════════
按 PRD docs/specs/m-1-14-customer-schema.md §3 字面建 Supabase 第 11 筆 migration(含 §3.2-3.8 全部:customers / customer_addresses / customer_vehicles / customer_wallet_ledger + RLS + GRANT + customer_wallet_balance_check view + 4 個 trigger 含 Q1=B wallet_balance sync trigger),然後按 §4 + §5 字面擴 domain identity(Customer + 3 子 entity)+ 擴 ICustomerRepository + 新建 IAddressRepository + IVehicleRepository + IWalletRepository。兩段連跑、各自獨立 commit。

═══════════════════════════════════════════
前置檢查(全綠才繼續)
═══════════════════════════════════════════
cd /Users/sean_1/pcm-website-v2
git branch --show-current      # 預期 dev
git status                     # 預期 clean
git log --oneline -5           # 預期 HEAD = d458c32 (M-1-14-recon)、其次 bfdf745 / 0d9b0a4 / 34ed94e
git rev-list --count origin/dev..HEAD  # 預期 1(M-1-14-recon 已 commit 未 push)

任一不綠 → 停下回報,不自行修復。

═══════════════════════════════════════════
執行模式 + Subagent 模式
═══════════════════════════════════════════
mode: A(PRD 前置、commit-ready 字面在 PRD)
conductor: main session
subagent_chain: code-reviewer(每段 commit 前必跑)
fix_attempt_max: 2(per sub-slice)
/slice-checkpoint: 跑(每段)
/codex-review: **觸發 M-1-14a**(動 schema + RLS + 4 SECURITY DEFINER trigger、屬鐵則 12 高敏)/ M-1-14b 不觸發(純 type 擴)

═══════════════════════════════════════════
Manifest Impact + Review 觸發
═══════════════════════════════════════════
動到的 storefront 元件: 無(本 Block 純後端 schema + domain)
對應 design 源: AccountPages.jsx + WalletTab.jsx + TierComponents.jsx(PRD §3.2-3.5 已抽完整字面)
業務 override 不算誤翻譯: tier 升級走 service_role(Q1=A)、wallet_balance 走 trigger(Q1=B)
未解決偏離: 無(PRD 已校正 D-1 Medusa→Supabase 字面)
最近設計同步: design-reference HEAD 637dafc(已對齊)
review_triggers:
  prd_review: false(A mode、PRD Sean 已拍)
  slice_review: true(每段 Cowork 在 chat 收 Code 回報後判定)
  code_review: true(subagent_chain code-reviewer)
  security_review_required: true(M-1-14a)
  codex_review_required: true(M-1-14a)

═══════════════════════════════════════════
執行步驟
═══════════════════════════════════════════

**Step 0 — 讀 PRD + STATUS**

```
Read docs/specs/m-1-14-customer-schema.md  # 完整、6 件套字面源
Read STATUS.md                              # 對齊當前狀態
Read CLAUDE.md                              # 工作規則
```

確認讀完、回報「PRD 6 件套字面已讀、進 M-1-14a」。

**Step 1 — 跑 M-1-14a(Supabase migration)**

按 PRD §3 完整字面建 migration 檔:

1. `supabase/migrations/{timestamp}_init_customers_and_subtables.sql`(timestamp 用當前 UTC 時間、對齊既有命名格式)
2. 內容:依序貼 PRD §3.2 customers / §3.3 addresses / §3.4 vehicles / §3.5 wallet_ledger + view / §3.6 RLS 4 表 / §3.7 GRANT / §3.8 4 trigger(updated_at × 3 + auth.users insert + wallet sync)
3. 用 Supabase MCP `mcp__8108ee88-b641-41aa-8a16-11ddb1197f36__apply_migration` 套用(name 對齊檔名、project_id `bmpnplmnldofgaohnaok`)
4. 驗證:
   - `mcp__8108ee88-b641-41aa-8a16-11ddb1197f36__list_tables` schemas=["public"] 確認 4 表存在 + customer_wallet_balance_check view 存在
   - `mcp__8108ee88-b641-41aa-8a16-11ddb1197f36__get_advisors` type="security" 確認 RLS 全綠(沿用 products advisor pattern)
   - 三綠:typecheck / lint(build N/A、純 SQL)
5. **產 Codex Review Packet:** 對齊鐵則 12 高敏(schema + RLS + 4 SECURITY DEFINER trigger),packet 內含 migration 完整字面 + RLS rationale + trigger SECURITY DEFINER 必要性說明,存 `docs/codex-packets/m-1-14a-{date}.md`,**commit 前停下等 Sean 起床貼 Codex**
6. 精準 git add:
   ```
   git add supabase/migrations/{timestamp}_init_customers_and_subtables.sql
   git add docs/codex-packets/m-1-14a-*.md
   ```
7. commit:`feat(api): M-1-14a Supabase customers + 3 子表 schema + RLS + 4 trigger [M-1-14a]`,commit body 含:
   - 對應 PRD § + Q1=B / Q2=A / Q4=Y 拍板註
   - 字面 vs 事實註記:依實際落地寫
   - Codex Packet 已產、路徑 / Sean 早上貼 Codex
8. 更新 STATUS.md 7 欄(同一 commit、amend)
9. 跑 `node /Users/sean_1/pcm-tools/scripts/busboy-end.js pcm`
10. **不 push**

**Step 2 — 跑 M-1-14b(domain identity 擴 + ports 3 子)**

按 PRD §4 + §5 完整字面:

1. Edit `packages/domain/src/identity/types.ts` — 擴 Customer 8 欄字面(加 name / phone / birthday / walletBalance / totalDeposit / createdAt / updatedAt)
2. 新建 `packages/domain/src/identity/address.ts`(完整 §4.2 字面)
3. 新建 `packages/domain/src/identity/vehicle.ts`(完整 §4.2 字面)
4. 新建 `packages/domain/src/identity/wallet.ts`(完整 §4.2 字面)
5. Edit `packages/domain/src/index.ts` — re-export 新 type
6. Edit `packages/ports/src/ICustomerRepository.ts` — 改寫成 PRD §5 字面(find / update method、tier 寫入不在 interface)
7. 新建 `packages/ports/src/IAddressRepository.ts`(§5 字面)
8. 新建 `packages/ports/src/IVehicleRepository.ts`(類似結構、依 §4 vehicle entity)
9. 新建 `packages/ports/src/IWalletRepository.ts`(類似結構、含 listEntries / addEntry / getBalance)
10. Edit `packages/ports/src/index.ts` — re-export 新 interface
11. 跑 /slice-checkpoint(typecheck + lint,build 不必本層、@pcm/domain + @pcm/ports 無 build target)
12. 跑 code-reviewer subagent(動 type 不動 schema,review focus 在 type 完整 + JSDoc 對齊 + re-export 完整)
13. code-reviewer 全綠後精準 git add(列出新 / 改的檔)
14. commit:`feat(domain,ports): M-1-14b 擴 Customer + 3 子 entity + 3 子 port [M-1-14b]`
15. 更新 STATUS.md 7 欄(同一 commit、amend)
16. 跑 busboy-end
17. **不 push**

**Step 3 — Block A 收尾報告**

回報:
- M-1-14a / M-1-14b 兩 commit hash + STATUS HEAD
- Codex Packet 路徑(M-1-14a 對應)
- ahead=N(未 push)
- 下一段 = M-1-14c(packages/schemas zod、Sean 起床推)

**停下、不繼續跑 M-1-14c**,等 Sean 起床評估 + 推下一段。

═══════════════════════════════════════════
驗收條件(明確 yes/no)
═══════════════════════════════════════════
- [ ] PRD docs/specs/m-1-14-customer-schema.md 已 Read
- [ ] supabase/migrations/ 新增 1 筆 migration、含 §3.2-3.8 全部字面
- [ ] Supabase list_tables 顯示 4 表 + 1 view 存在
- [ ] Supabase get_advisors security 全綠(對齊 products advisor 標準)
- [ ] packages/domain/src/identity/{types,address,vehicle,wallet}.ts 完整字面對齊 PRD §4
- [ ] packages/ports/src/{ICustomerRepository,IAddressRepository,IVehicleRepository,IWalletRepository}.ts 完整字面對齊 PRD §5
- [ ] re-export index.ts 同步
- [ ] /slice-checkpoint 三綠
- [ ] code-reviewer subagent 跑(M-1-14b)0 must-fix
- [ ] M-1-14a 產 Codex Packet 存 docs/codex-packets/m-1-14a-*.md
- [ ] 兩 commit 訊息含「字面 vs 事實」+ STATUS 同 commit amend
- [ ] busboy-end 跑成功
- [ ] 未 push

═══════════════════════════════════════════
禁止清單
═══════════════════════════════════════════
- 不可動 PRD docs/specs/m-1-14-customer-schema.md 字面(Sean 已拍、字面凍結)
- 不可動 .env*(permissions.deny 硬攔)
- 不可動 storefront / api / admin / sync-engine 既有檔(本 Block 純後端 schema + domain + ports)
- 不可動 既有 SupabaseProductAdapter / product 相關檔
- 不可動 design-reference submodule
- 不可使用 git add . 或 git add -A
- 不可自動 push
- 不可繞過 Codex Packet(M-1-14a 動 schema + 4 SECURITY DEFINER trigger、必觸發)
- 不可繞 design-mirror.mjs(本 Block 不動 storefront、不觸發)
- 不可順手跑 M-1-14c(本 Block 只跑 #1+#2、後段 Sean 起床推)
- 不可順手 raise #156 / #158 backlog(留 M-1-14h 末段一次 raise)

— 禁止清單結束 —
```

---

## 2. Sean 起床後逐段推進(短指令)

Block A 跑完後,Sean 起床看到 #1 + #2 commit 都綠 + Codex Packet 已產。

**起床流程:**
1. 看 Code session 報告 + STATUS.md
2. 把 Codex Packet `docs/codex-packets/m-1-14a-*.md` 內容貼給 Codex 審查
3. Codex findings 若有 must-fix → 開 patch commit 修 → 再貼一次給 Codex
4. Codex PASS 後跟 Code session 講「繼續 M-1-14c」推下一段
5. 重複 #4 推 M-1-14d / M-1-14e / M-1-14f1 / M-1-14f2(前先做 §13 dashboard checklist!)/ M-1-14g / M-1-14h

**Code session 收到「繼續 M-1-14[X]」短指令時的處理(Code session 內部上下文已含 PRD):**

```
Read PRD docs/specs/m-1-14-customer-schema.md §11(sub-slice 表)→ 找對應 sub-slice 字面
按該 sub-slice 對應 PRD § 字面落地(M-1-14c → §6 / M-1-14d → §7 / M-1-14e → §8.1 / ...)
按通用六件套執行:前置檢查 → 執行步驟 → 三綠 → code-reviewer(動實作 code 必跑)→ Codex Packet(M-1-14d / M-1-14f2 必觸發)→ git add 精準 → commit + STATUS amend → busboy-end → 不 push
回報:commit hash / STATUS HEAD / Codex Packet 路徑(若有)/ 下一段是 M-1-14[X+1]
```

---

## 3. 各 sub-slice 速查(Code 跑「繼續 M-1-14[X]」時對齊用)

| Sub-slice | PRD 段 | Codex Packet | 預估 | Sean 端阻塞 |
|---|---|---|---|---|
| M-1-14c packages/schemas zod | §6 | 不觸發 | 30 min | 無 |
| M-1-14d 4 adapter + mappers | §7 | **觸發**(service_role 路徑) | 45-60 min | 無 |
| M-1-14e use-cases(9 個)| §8.1 | 不觸發 | 45-60 min | 無 |
| M-1-14f1 LoginPage + RegisterPage + Google OAuth | §8.3 + §8.4 signInWithGoogle | 不觸發(Supabase 內建) | 45-60 min | Sean 端 §13.1 Google Cloud + Supabase Dashboard 設好 |
| M-1-14f2 LINE OAuth API routes | §8.5 LINE 流程 | **觸發**(自寫 OAuth + service_role + session 發放高敏) | 60-90 min | **必 Sean 完成 §13.2 + §13.3** |
| M-1-14g AccountPage 主檔 + 7 子檔 | §8.3 AccountPage + Q5=A 拆檔 | 可選(Sean 拍) | 60-90 min | 無 |
| M-1-14h MobileTabBar + #156 + #158 backlog raise | §8.3 MobileTabBar + §12 backlog 校正 | 不觸發 | 30-45 min | 無 |

---

## 4. 通用 sub-slice 範本(每段 Code 套用)

```
[M-1-14[X]] {sub-slice 任務名}

═══════════════════════════════════════════
任務目標
═══════════════════════════════════════════
按 PRD §{對應段} 字面落地 {sub-slice 內容}

═══════════════════════════════════════════
前置檢查
═══════════════════════════════════════════
cd /Users/sean_1/pcm-website-v2
git branch --show-current      # dev
git status                     # clean
git log --oneline -5           # HEAD 對齊上一段 commit
git rev-list --count origin/dev..HEAD  # 越累越多、未 push

═══════════════════════════════════════════
執行模式 + Subagent 模式
═══════════════════════════════════════════
mode: A(PRD 前置)
conductor: main session
subagent_chain: code-reviewer(動實作 code 必跑)
fix_attempt_max: 2
/slice-checkpoint: 跑
/codex-review: {依 §3 速查表決定觸發}

═══════════════════════════════════════════
Manifest Impact + Review 觸發
═══════════════════════════════════════════
動到的 storefront 元件: {依 sub-slice}
對應 design 源: PRD § 對應段
業務 override 不算誤翻譯: {依 sub-slice}
最近設計同步: design-reference HEAD 637dafc
review_triggers: {依 §3 速查表}

═══════════════════════════════════════════
執行步驟
═══════════════════════════════════════════
Step 0: Read PRD 對應段
Step 1: 落地檔案(按 PRD 字面)
Step 2: 三綠(/slice-checkpoint)
Step 3: code-reviewer subagent(動 code 必跑)
Step 4: 若 §3 速查表標「觸發 Codex Packet」→ 產 Packet 存 docs/codex-packets/{sub-slice}-*.md、commit 前停下等 Sean 貼 Codex
Step 5: 精準 git add
Step 6: commit(訊息含「字面 vs 事實」+ STATUS amend 同 commit)
Step 7: busboy-end
Step 8: 不 push
Step 9: 回報下一段是 M-1-14[X+1]

═══════════════════════════════════════════
禁止清單
═══════════════════════════════════════════
- 不可動 PRD 字面
- 不可動 .env*
- 不可動 scope 外檔案(對齊 sub-slice 邊界)
- 不可使用 git add . 或 git add -A
- 不可自動 push
- 不可順手跑下一段
- 不可順手 raise #156 / #158(留 M-1-14h)

— 禁止清單結束 —
```

---

## 5. M-1-14h 末段特別處置:#156 + #158 backlog raise + 整個 M-1-14 收尾

M-1-14h 跑完 MobileTabBar 後,額外:

1. Edit `docs/phase-1-backlog.md`:
   - #156 段按 PRD §12.1 校正字面落地
   - #158 段按 PRD §12.2 校正字面落地(行號 162-193 → 166-190、CSS 來源從 `app.css` 改 `tweaks.css`)
2. 同 commit 加 PRD 路徑 cross-ref
3. M-1-14 整個 milestone 收尾報告寫進 STATUS.md「最後更新」段:`M-1-14 ✅(Customer schema 4 表 + RLS + adapter + zod + register/login + Google + LINE OAuth + AccountPage 7 tab + MobileTabBar + #156/#158 校正)`
4. 跑 busboy-end
5. 不 push(Sean review 全 9 段 + Codex findings 處置完 → 手動 push)

---

— END —
