# 🌙→🌅 品牌放量過夜晨報(2026-07-10 夜自跑、kickoff Sean 預批)

> 一句話:**9 家品牌版面全部做完、資料鏈接好、逐家乾跑 6 家全淨(2 家撞鍵待你 triage、ebc 待 seed)、demo 已開好等你看;全程零 prod 寫入、未 push。**
> 本檔=晨間決策用;技術細節見 STATUS 最後更新頂端 + memory `project_brand-rollout-8plus1-overnight`。

## 0. Demo 怎麼看

- **手機/外網**:`https://doctor-irc-assistance-nil.trycloudflare.com/dev-preview/brands`(cloudflared 免費 tunnel、電腦醒著才活;斷了看下方指令)
- **本機**:`http://localhost:3000/dev-preview/brands`(production build 已在跑)
- tunnel 斷線重開(兩條各自貼):

```
cd /Users/sean_1/pcm-website-v2/apps/storefront && PORT=3000 pnpm start
```

```
cloudflared tunnel --url http://localhost:3000
```

## 1. 每家一行狀態表

| 品牌 | 版面 | 乾跑 | demo(接在 tunnel 或 localhost 後) | 待決 |
|---|---|---|---|---|
| Evotech | ✅ 完整版+真 logo | ✅ 3,460 群全綠 | `/dev-preview/brands/evotech` | 附件(PDF/影片)來源今晚仍 0、晚到自動補 |
| LighTech | ✅ 完整版+真 logo | ✅ 4,566 群全綠 | `/dev-preview/brands/lightech` | 🔴 變體圖大宗 http(#275、決策⑤) |
| CNC Racing | ✅ 完整版+真 logo | ✅ 1,978 群全綠 | `/dev-preview/brands/cnc-racing` | 無(Vimeo 影片 55 群、寫入即回填) |
| Eazi-Grip | ✅ 完整版(文字 lockup) | ⚠ handle 1 筆+spec 40 群撞鍵 | `/dev-preview/brands/eazi-grip` | 🔴 #274 triage(決策②)+補 logo |
| Samco | ✅ 完整版+真 logo | ✅ 1,403 群/14,165 變體全綠 | `/dev-preview/brands/samco` | 無(變體王乾跑沒卡) |
| Motogadget | ✅ 完整版(文字 lockup) | ✅ 912 群全綠 | `/dev-preview/brands/motogadget` | 補 logo |
| Front3D | ✅ 精簡版(文字 lockup) | ✅ 108 群全綠 | `/dev-preview/brands/front3d` | 補 logo;⚠ 官網查無「義大利」(旁證西班牙)→ 版面沒寫產地+有賽道用途免責 |
| Materya | ✅ 精簡版+真 logo | ⚠ spec 2 群撞鍵 | `/dev-preview/brands/materya` | #274 triage;建議補高解析 logo |
| EBC | ✅ 精簡版+官方 logo | ⏸ brands 表缺列(預期擋下) | `/dev-preview/brands/ebc` | 🔴 決策③ db push seed migration |

離群價:**9 家全部 0 筆**(千分位 bug 未再現);分類:**100% 對上 16 大類**;乾跑完整 log:session scratchpad `dryruns/*.log`。

## 2. 批次決策題(回覆格式照抄最下面那行)

**Q1|逐家 demo 批准**(看完 demo 後、可逐家批):
A. 9 家全批(版面照現況上)
B. 部分批(回我品牌名清單;沒批的我改完再看)
C. 全部先不上(給修改方向)

**Q2|eazigrip/materya 撞鍵 triage(#274;不解=這兩家不能寫、其餘 7 家不受影響)**:
A. 報價單側修源(重複列合併/尾 hyphen SKU 清;同 #267 做法、最乾淨)(推薦)
B. 網站管線排除清單(跳過撞鍵群、其餘先上;撞鍵群之後補)
C. 先擱置(這兩家延後上)

**Q3|ebc seed migration db push**(`supabase/migrations/20260710120000_seed_ebc_brand.sql`、加 1 列品牌、premium 加成先設 0):
A. push(terminal 跑 `supabase db push`;之後我重乾跑 ebc 驗綠)(推薦)
B. 先不 push(ebc 延後)

**Q4|品牌補圖**(現用文字 lockup 佔位、版面能上、補圖後更好看):
A. 補 eazi-grip/motogadget/front3d logo 檔到 `/Users/sean_1/Desktop/廠牌LOGO 2/`(+ 建議:evotech 正式橫式 logo、materya 高解析)
B. 先用文字 lockup 上、之後再補

**Q5|lightech 變體圖 http(#275;版面卡片我已用 https 修好,這題管「寫入 DB 的 4,566 群變體圖」)**:
A. 報價單 fetcher 側改抓 lightech.it https 鏡像(治本)(推薦)
B. 網站 transform 層改寫 URL(治標快)
C. 先照寫(接受部分瀏覽器破圖、之後修)

**Q6|批准後上線順序**(全綠家):
A. 我一次列 confirm-write 指令清單給你逐家跑(小→大:front3d→motogadget→samco→eazi-grip*→cnc→evotech→lightech*→materya*→ebc*;*=待 Q2/Q3/Q5 解)(推薦)
B. 先上 2-3 家試水(回我品牌名)

```
回覆格式:Q1: A|B|C / Q2: A|B|C / Q3: A|B / Q4: A|B / Q5: A|B|C / Q6: A|B
```

## 3. 今晚做到哪(9 slice commit + 審查修正 + 收尾 docs、全未 push)

`9032663` 混格式影片三分流 → `b9a4805` batch A(pd-bs 骨架+evotech/lightech/cnc)→ `6d7ff36` batch B(eazi-grip/samco/motogadget)→ `b6fc9b1` code-reviewer R1 修正 → `528fb83` batch C(front3d/materya/ebc)→ `c99379d` 資料鏈(supplier-config 8 家+ebc migration)→ `68d45ab` R2 佐證修正 → `543c9c2` demo 頁 → `78d945e` demo CSS 修+logo 重裁 → adversarial 修正+收尾 docs commit(最後兩顆)。

- 每批三綠+build+完整 vitest(終態 **1863 全綠**);code-reviewer 兩輪(R1 FAIL→修→R2 PASS)。
- **adversarial-reviewer(fable 真跨模型)總審:PASS-with-comments**,findings 全 triage:
  - F1 EBC logo 授權=你半夜訊息「EBC的logo 你去網路上抓吧」——出處已記進檔頭,**Q4 請順手再確認一次**(kickoff 原規則 logo=授權 gate)。
  - F4「pickInstallVideo 放寬會不會把 bonamici 現役 YouTube 換成 Vimeo?」——**實查 590 群/15 支影片,替換=0**(放寬只補不換;push 後 cron 安全)。
  - F2 數字修正(全綠=6 家非 7)/F3 兩處 stale docstring/F5 demo 原型鏈 key 500/F6 UI 解析 protocol 守衛對齊/F7 demo lightech http 圖前置 https——全修。
- 信任狀紀律:數字全數官方 URL 佐證(各元件檔頭);**查無不寫**——front3d 產地(kickoff 原假設義大利、實查旁證西班牙)、samco MotoGP、motogadget Red Dot、ebc 1983/ISO 9001 全部棄用。
- 圖片紀律:版面商品圖=報價單 view 既有 image_url;logo=你提供的檔+EBC 官方 svg(你口頭授權);無檔 3 家文字 lockup。

## 4. 零 prod 寫入聲明(證據)

- 寫入硬擋:新 8 家+cncracing `writeAllowed: false`(runtime throw、有測試鎖全 false);整夜只跑 `--dry-run`(log 在 session scratchpad `dryruns/`、每份結尾「未寫入」)。
- ebc migration 只是 repo 檔案、未 db push;報價單庫只用 anon 唯讀 key 讀 view。
- `git log`:全部 commit 在本地 dev、origin/dev 仍 `e8a3c15`;未 push、未 deploy、未動金流 flag、未動 .env。

## 5. 已記檔的 follow-up

- **#273** 多支安裝影片(現行單支;kickoff 明文 follow-up)
- **#274** eazigrip/materya 撞鍵 triage(=Q2)
- **#275** lightech http 變體圖(=Q5)
- manifest/STATUS/memory 已照 SOP 更新;evotech/lightech 附件(嵌入指南稱已填)今晚實查仍 0 → 報價單側確認、晚到不阻擋。
- 誠實註記:`/graphify --update` 與 `/pcm-roadmap` **未跑**(kickoff §7 收尾清單未含;夜間單次大改知識圖無人驗、風險>效益)→ 你批 demo 後我下個 session 開工時補跑。
