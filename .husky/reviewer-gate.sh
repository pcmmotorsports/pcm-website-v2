# PCM reviewer gate(Sean 2026-08-04 拍板 Q3=A;機制優先律)
# 背景:施工視窗兩度「先 commit、後跑 code-reviewer、再 amend」(D3a、D3c-1)——
#   規則寫了仍復發,照機制優先律改上 hook。兩次事故都發生在「測試全綠、感覺可以收工」
#   那一刻,是「忘了」不是「想繞」⇒ 本 gate 把「要不要審」的決定逼到 commit 之前,
#   不是防偽:標記自報,且 `git commit --no-verify` 跳過 pre-commit、`HUSKY=0` 關掉
#   全部 hook —— 想繞永遠繞得掉,gate 擋的是「忘了」。
#
# 放行條件(任一即過):
#   1. merge commit(MERGE_HEAD 存在)—— 主視窗 --no-ff 收割不受影響
#      (無衝突的 auto merge 根本不跑 pre-commit;squash merge / cherry-pick 衝突後的
#      手動 commit 不在此列、會照一般判定 —— 本 repo 收割固定 --no-ff,屬可接受摩擦)。
#   2. 本次 staged 沒碰到受審面 —— docs / STATUS / handoff / memory 類 commit 不受影響。
#      受審面 = apps/ packages/ supabase/ scripts/ .github/ + 根層平台設定(鐵則 12 ④
#      那族,**刻意含 lockfile 與 package.json**:純升版依賴也要過審)+ vitest.config
#      與 .npmrc(測試設施與套件解析來源)。
#      刻意不擋:.husky/ 自己、design-reference submodule 指標、*.md、.gitignore/
#      .gitmodules/.graphifyignore —— 這些屬 docs/流程面,誤擋成本高於漏擋。
#   3. 標記檔存在且第一行 = 當下 HEAD:$git_dir/pcm-reviewer-ran
#
# 標記寫法(跑完 code-reviewer、或依片型分級自判輕量片跳審之後,在自己的 worktree 根執行):
#   { git rev-parse HEAD; echo "reviewed: <片名或跳審理由>"; } > "$(git rev-parse --git-dir)/pcm-reviewer-ran"
# 標記釘在寫入當下的 HEAD ⇒ 任何 commit 落地後 HEAD 一動、標記自動失效(不需要
# post-commit 消耗;.husky/post-commit 是 graphify 本機 hook 保留位、.gitignore:84 擋著)。
# 代價:同一片的 amend、或 reviewer 跑完後先落了別的 commit,都要重寫標記 —— 一行的事。
# 已知邊界:標記失效不刪檔,HEAD 若被 reset/checkout 回被釘的那顆 commit,標記會復活
#   放行一次 —— 本 repo 紀律本就不自行 reset,不另寫程式封。
#
# 注意:本檔被 husky 以 `sh -e` 執行 —— 可能非零的命令都放在條件位置或 || 收尾;
#   staged 清單抓取失敗會讓 commit 被擋(fail-closed),不會靜默放行。

git_dir=$(git rev-parse --git-dir)

if [ -f "$git_dir/MERGE_HEAD" ]; then
  exit 0
fi

staged=$(git -c core.quotePath=false diff --cached --name-only)

if ! printf '%s\n' "$staged" | grep -qE '^(apps|packages|supabase|scripts|\.github)/|^(vercel\.json|turbo\.json|package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|eslint\.config\.js|tsconfig|vitest\.config|\.npmrc)'; then
  exit 0
fi

head=$(git rev-parse -q --verify HEAD || echo none)

if [ -f "$git_dir/pcm-reviewer-ran" ] && [ "$(sed -n 1p "$git_dir/pcm-reviewer-ran")" = "$head" ]; then
  exit 0
fi

echo '' >&2
echo '⛔ PCM reviewer gate:本次 commit 動到受審面(code 或根層平台設定),' >&2
echo '   但本 worktree 沒有釘在當下 HEAD 的 reviewer 完成標記。' >&2
echo '   · 已跑過 code-reviewer(或本片=輕量片、依分級可跳審)→ 寫標記再 commit:' >&2
echo '       { git rev-parse HEAD; echo "reviewed: <片名或跳審理由>"; } > "$(git rev-parse --git-dir)/pcm-reviewer-ran"' >&2
echo '   · 還沒審 → 先跑 code-reviewer、折完 findings 再回來。' >&2
echo '   · amend 或中間落過別的 commit ⇒ 標記已因 HEAD 移動失效,重寫上面那行即可。' >&2
echo '   背景:Sean 2026-08-04 拍板 Q3=A(D3a/D3c-1 兩次「先 commit 後審」)。' >&2
exit 1
