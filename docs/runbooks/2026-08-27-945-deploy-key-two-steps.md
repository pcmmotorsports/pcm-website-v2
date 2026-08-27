# 兩步紙 · 讓 CI 讀得到 `design-reference`(`#945` 片B 的鑰匙)

> # 🛑🛑 **這張紙現在還不該端給 Sean,而理由已經【升級】了。**
>
> **2026-08-27 R3(codex)之後**:問題不再只是「順序」, 而是 **片B 可能在解錯的問題** ——
> 那三個要驗的字面**已經在我們自己的公開 repo 裡了**(`WalletTab.test.tsx` 的 `DELIBERATELY_OMITTED`)
> ⇒ 「反恆真」那一半用一份 fixture 就夠, **不需要任何鑰匙**。
> 要先關的是 plan `§13-7b`(這片要買的是「反恆真」還是「抓漂移」)。
> 🔴 **在那一題關掉之前, 這整份操作紙的存在理由未定。**
> ⚠️ 而 R3 另外列了 7 條 must-fix 在這份紙上(plan `§13-7c`), **一條都還沒修** ——
>    刻意不修, 因為上面那一題若答「反恆真」, 這份紙整份消失。
>
> ---
>
> # 🔴 (原本的第一層阻擋, 仍然成立)
> **前置條件:`Q-945-3`(fork PR 怎麼處置)要先關掉。** 那題有一個選項是 **丙 = 不做片B**,
> 而**丙不需要鑰匙** ⇒ 現在端出去,若後來落到丙,他貼的是一把
> **永遠不會被用到、而躺在一個公開 repo 裡**的 secret。
> 選項與現況:`docs/specs/2026-08-27-945-submodule-in-sandbox-and-ci-plan.md` `§13`。
> ✅ 關掉 `Q-945-3` 且結論不是丙 ⇒ **刪掉這個框,這張紙就可以直接端。**

> 產出者:線4,2026-08-27。`Q-945-1` = **甲 deploy key**(主視窗 `-5b` 裁,依 Sean 2026-08-27
> 「這兩個問題應該是你們要自己決定的,用你建議的方式繼續就好」的授權 ——
> 🔴 **這是「Sean 授權主視窗決定、指定照推薦案」,不是「Sean 拍了甲」。**)

---

## 🔴 給端這張紙的人:**四個檢查我方自己做得到,不要叫 Sean 用肉眼回報**

```
① 那把 key 到底是不是唯讀(這是全篇唯一一個【錯了完全沒有訊號】的動作):
   gh api repos/pcmmotorsports/pcm-website-design/keys --jq '.[]|[.title,.read_only]|@tsv'
   ⇒ 要看到 read_only = true。負對照:現在跑它 ⇒ [](還沒有任何 key)
   🔴 我方對 design repo 有 admin(實測:這支 admin-only endpoint 回 [] 而不是 403)
      ⇒ **這一格不該由他的眼睛供給。**
② secret 名字有沒有打錯:
   gh secret list -R pcmmotorsports/pcm-website-v2   ⇒ 現在 6 個, 要變成 7 個且含
   DESIGN_REFERENCE_DEPLOY_KEY
③ 這把鑰匙到底讀不讀得到 design repo(貼完就驗得到, 不必等片B):
   GIT_SSH_COMMAND='ssh -i ~/.ssh/pcm_design_deploy -o IdentitiesOnly=yes' \
     git ls-remote git@github.com:pcmmotorsports/pcm-website-design.git
   🔴 `IdentitiesOnly=yes` **不可省** —— 少了它 ssh 會拿 Sean 自己的金鑰去試 ⇒ **假綠**。
   (兩個世界印不同東西:通 ⇒ 一列 SHA + refs;不通 ⇒ Permission denied。)
④ ①②③ 全過之後,**才**叫他刪掉本機那份私鑰(步驟 4)。
   🔴 順序不能顛倒:貼歪 / 截斷要等驗證才浮現, 而那時鑰匙已經被刪掉的話, 連 design 那把
      deploy key 都要一起重來。
```

---

## 🔴 Sean 做之前要知道的

```
1. 這是把一把【能讀非公開 repo】的鑰匙,放進一個【公開】repo 的 Actions secret。
   pcm-website-v2 是 PUBLIC(2026-08-27 量:不帶憑證打 API ⇒ 200)。
   🔴 forkCount 今天是 0,而 allow_forking=true ⇒ **任何人隨時可以把它變成 1,不需要任何人同意。**
2. 這是 GitHub 的標準做法,不是漏洞。而它成立靠四條前提,四條今天都在(逐條量過):
   · repo 裡沒有 `pull_request_target`(以及 `workflow_run` / `issue_comment` 同族)⇒ 今天皆 0
   · 現有 workflow 沒有把 secret 印進 log 的形狀
   · 🔴 **有 push 權的人 = 讀得到這把鑰匙的人。** repo 的 owner type 是 **User** ⇒
     那個「collaborators = 1」不是「只有一個人」,是**一個共用帳號** ——
     **每一個用 `pcmmotorsports` 身分在推的施工窗都在這個 1 裡面。**
   · 🔴 鑰匙在 job 執行期間躺在 runner 磁碟上 ⇒ **同一個 job 後面每個 step 都讀得到**,
     而 CI 用了 4 支 action(3 支 `actions/*` 自家 + 1 支 `pnpm/*`)**全部釘在可變的 major tag**
     ⇒ 供應鏈也在前提裡
   ⇒ **四條都是今天的狀態,不是保證。**
3. 這把鑰匙**只要步驟 2 那個框沒有勾錯**,就是【唯讀】而且【只開 design 那一個 repo】。
   ⚠️ 「唯讀」不是它天生的性質,**是那一個框決定的** ⇒ 所以我方會用 ① 去核。
   洩了 = 對方能讀設計稿,不能寫任何東西。
   📌 參考:這個 repo 現在已經放著 **6 個** repo 層 Actions secret(範圍:不含 Dependabot /
      Codespaces / environment secrets),含資料庫的 `SUPABASE_SECRET_KEY` ——
      這一把比那些便宜得多。
4. 🔴 **貼完不會馬上有效** —— 還要我們加一個 step 到 workflow(不是一行)。
   貼完跟我們說,**驗證我們來做**。
```

---

## 步驟 0 · 確認資料夾在(做過就跳過)

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo "ok 步驟0 完成"
```

## 步驟 1 · 產一把鑰匙

```bash
ssh-keygen -t ed25519 -C "pcm-website-v2 CI reads design-reference" -f ~/.ssh/pcm_design_deploy -N "" && echo "ok 步驟1 完成"
```
· 產出兩個檔:`~/.ssh/pcm_design_deploy`(**私鑰**)與 `~/.ssh/pcm_design_deploy.pub`(**公鑰**)
· `-N ""` = 不設密碼(CI 沒有人可以幫它輸入密碼)
· 若它問 `Overwrite (y/n)?` ⇒ 代表已經有同名的了 ⇒ **停下來問我們**,不要覆蓋
  (⚠️ 那句提示的逐字字面我**沒有實跑驗過**(跑了會在這台機器上留一把真鑰匙)⇒ 未確認;
   看到任何在問「要不要蓋掉」的句子都算)

## 步驟 2 · 公鑰 → 貼到 **design** repo

```bash
pbcopy < ~/.ssh/pcm_design_deploy.pub && echo "已複製, 開頭是: $(pbpaste | cut -c1-20)"
```
🔴 **那行 `echo` 就是檢查** —— 要看到 `ssh-ed25519 AAAA`。
   看到別的(或空的)⇒ 剪貼簿裡不是公鑰,**不要往下貼**。
   (`pbcopy` 失敗時 rc=0 且零輸出 ⇒ 你會把上一次剪貼簿的東西貼進去,而 GitHub 照收。)

**貼到這一頁:**
```
https://github.com/pcmmotorsports/pcm-website-design/settings/keys
```
1. 按 **Add deploy key**
2. **Title** 填:`pcm-website-v2 CI (read-only)`
3. **Key** 貼上
4. 🔴🔴 **「Allow write access」那個框【不要勾】**
5. 按 **Add key**

## 步驟 3 · 私鑰 → 貼到 **pcm-website-v2** repo

```bash
pbcopy < ~/.ssh/pcm_design_deploy && echo "已複製, 第一行是: $(pbpaste | head -1)"
```
🔴 要看到 `-----BEGIN OPENSSH PRIVATE KEY-----`。看到別的 ⇒ **不要往下貼**。
🔴 **不要 `cat` 私鑰** —— 多行用滑鼠拉最容易少一行,而少一行的錯誤訊息不會告訴你少了什麼;
   它也會留在 Terminal 的捲軸紀錄裡。

**貼到這一頁:**
```
https://github.com/pcmmotorsports/pcm-website-v2/settings/secrets/actions
```
1. 按 **New repository secret**
2. **Name** 填(逐字,大小寫要一樣):`DESIGN_REFERENCE_DEPLOY_KEY`
3. **Secret** 貼上
4. 按 **Add secret**

⚠️ **私鑰不要貼進任何對話視窗**(包含跟我們的對話)。它只該出現在那一個輸入框裡。

**貼完跟我們說一聲。** 我們跑上面那三個檢查,過了才叫你做步驟 4。

## 步驟 4 · (**等我們說過了才做**)清掉本機那份私鑰

```bash
rm -f ~/.ssh/pcm_design_deploy ~/.ssh/pcm_design_deploy.pub && pbcopy < /dev/null && echo "ok 步驟4 完成"
```
· ⚠️ **不要**把這把鑰匙加進 `~/.ssh/config` 或 `ssh-agent` —— 它只給 CI 用
· 要重來 ⇒ 從步驟 1 產一把新的、把舊的刪掉即可(deploy key 可以有很多把)
🔴 **「清掉」的射程,不要讀成「哪裡都沒有了」** —— 上面那行清的是
  **本機那兩個檔 + 當前剪貼簿**。它**不涵蓋**:
```
· Universal Clipboard(Handoff)—— 私鑰可能已同步到你其他 Apple 裝置
· 剪貼簿歷史工具(Raycast / Alfred / Paste 之類)—— 它們自己留一份
· Time Machine / APFS 本地快照 —— 步驟 1 到步驟 4 之間若跨過一次備份, 那份會留著
⇒ 這三處我沒有辦法從這裡清, 也沒有量過你機器上有沒有開。**寫出來讓你自己判斷。**
```

---

## 🔴 出事了怎麼撤(先看一眼,免得當下現找)

```
情況              動作
貼錯 / 想重來      design repo → Settings → Deploy keys → 那一列右邊 Delete
                  v2 repo → Settings → Secrets → DESIGN_REFERENCE_DEPLOY_KEY → Remove
懷疑私鑰外洩       **先刪 design repo 那把 deploy key**(這一步就切斷了存取)
                  再刪 secret, 然後從步驟 1 產新的
不小心勾了 write   同「貼錯」—— 刪掉重來。**不要只改 Title, 那個框改不了。**
```

---

## ⚠️ 這張紙自己的射程

```
✅ 查過的(我方當場跑的, 不是引述):
   · 兩個 URL 的 repo 名與 `.gitmodules` 逐字相符;`pcm-website-design` 不具公開讀取權
   · design repo 目前 deploy keys = **0** ⇒ 不會撞名(而這個數字本身證明我方讀得到那支 endpoint)
   · `gh secret list` 現在 **6** 個 ⇒ 貼完要變 7 個
   · `~/.ssh/pcm_design_deploy*` 目前不存在 ⇒ 步驟 1 的 overwrite 分支不會觸發
   · `github.com` 已在 `~/.ssh/known_hosts`(3 筆)⇒ 上面那個 `git ls-remote` 驗證不會跳 host key 提示
❌ 沒查的:
   · 那兩個 settings 頁面的**畫面**我沒有開過 ⇒ **按鈕字面是照 GitHub 通用版型寫的, 未確認**
     ⇒ 你看到的字不一樣 ⇒ **停下來問我們**, 不要猜哪個按鈕最像
   · `ssh-keygen` 的 overwrite 提示逐字字面 —— 未實跑
   · 片B 的 workflow 還沒寫 ⇒ 「CI 上到底跑不跑得起來」要等那時才驗得到
```
