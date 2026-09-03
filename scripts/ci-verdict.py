#!/usr/bin/env python3
"""push 之後查那一顆的 CI, 而【四個世界印四種東西】。

🔴🔴 **這支腳本存在的理由, 寫在最前面** ——
   2026-09-03 16:47 一發 CI 紅了, 而它紅到 09-04 01:0x 才被人看到 = **8 小時**。
   而在那 8 小時裡主視窗**推了兩次**, 而**沒有人看過任何一發 CI**。
   ⇒ 🎯 **⇒ 所以「我會記得去看」不是可以假設的東西, 它是那個要被做成機制的東西。**

🔬 **而它要解的不是「紅太多」** —— 2026-09-04 均勻抽 10 發紅歸戶量到:
   形狀是【串聯單一栽培】(每段時間只有一個成因, 而它一路紅到有人去修)
   ⇒ 73% 不是「有幾個東西壞了」, 是一個**速率**(六七個窗整夜推 × 每推必跑全套)
   ⇒ 🛑 **⇒ 修完現有成因只會換成下一個** ⇒ 「讓紅變罕見」在這個工作型態下不可達。
   ⇒ ✅ **⇒ 真正的槓桿是縮短「弄壞」到「弄壞的人知道」之間的時間。**

🛑 **本檔【不發訊息】。** 它只印。要不要轉給哪條線, 是人的動作 ——
   而那個人要先看得到內容。(主視窗 2026-09-04 明訂。)

## 四個世界(🔴 它們**不得有任何兩個印同一個東西**)
    rc=0  ✅ 綠     —— 而它**必須印一行**, 否則「綠」與「我根本沒跑這支」印同一個安靜
    rc=1  🔴 紅     —— 印【哪一支測試】+ 【動過那支檔的最近幾顆 commit】
    rc=3  ⏳ 還在跑 —— 🛑 **最容易被寫成跟綠一樣的那個世界**
    rc=2  ⚠️ 量不到 —— 那顆 sha 上沒有任何 CI run / gh 壞了 / 沒登入
          🔴 **「查無 run」與「跑完了是綠的」是相反的兩件事, 而它們都很安靜。**

## 🔴 歸屬那一半的【已知限制】, 明寫不藏
   全隊共用 git 身分 `probe <probe@local>`(2026-09-04 實測最近 15 顆 15/15)
   ⇒ **作者欄結構上答不出「哪個窗」** ⇒ 本檔改用【動過那支檔的最近 commit】當線索,
     而那是**線索不是答案** —— 一支測試可以被 A 窗的改動弄紅而它上一顆是 B 窗推的。
"""
import json
import subprocess
import sys

REPO = 'pcmmotorsports/pcm-website-v2'
WORKFLOW = 'CI'


def sh(args: list[str]) -> tuple[int, str]:
    p = subprocess.run(args, capture_output=True, text=True)
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def failing_test_files(run_id: str) -> list[str]:
    """從 --log-failed 抽出紅的測試檔。

    🔴 **抽法用的是【檔名 pattern】而不是先剝 ANSI** —— 2026-09-04 實測:
       GitHub log 那層的跳脫**不是** `\\x1b[..m`, 剝了等於沒剝
       ⇒ 而當時那把尺對 **10 發不同的 run 印出同一個答案** ⇒ 那就是它壞掉的形狀。
       ⇒ 📌 **抓到它的不是更仔細, 是「十個都一樣」這件事本身不合理。**
    """
    rc, out = sh(['gh', 'run', 'view', run_id, '--repo', REPO, '--log-failed'])
    if rc != 0 and not out.strip():
        return []
    import re
    seen: list[str] = []
    for line in out.splitlines():
        if 'FAIL' not in line:
            continue
        for m in re.findall(r'[A-Za-z0-9_/.-]+\.test\.tsx?', line):
            if m not in seen:
                seen.append(m)
    return seen


def main() -> int:
    argv = [a for a in sys.argv[1:] if a != '--selftest']
    sha = argv[0] if argv else ''
    if not sha:
        rc, out = sh(['git', 'rev-parse', 'HEAD'])
        if rc != 0:
            print(f'⚠️ rc=2 拿不到 HEAD:{out.strip()}')
            return 2
        sha = out.strip()
    sha = sha.strip()
    # 🔴 **API 的 `head_sha` 只吃【完整 40 碼】** —— 餵短 sha 它回 `workflow_runs: []`,
    #    而那與「這顆真的沒跑過 CI」**印同一個東西**。2026-09-04 兩發對照都撞到這裡:
    #    一發已知紅、一發已知綠, 而它們印出**一模一樣**的「量不到」。
    #    ⇒ 🎯 **⇒ 抓到它的不是更仔細, 是【該不同的兩發印了相同】。**
    #    ⇒ 📌 **⇒ 而若我當初只跑了其中一發, 那個 rc=2 會看起來完全合理。**
    if len(sha) < 40:
        rc, out = sh(['git', 'rev-parse', sha])
        if rc != 0:
            print(f'⚠️ rc=2 【量不到】:展不開 {sha}(本地沒有這顆?)\n   {out.strip()[:200]}')
            return 2
        sha = out.strip()

    rc, out = sh(['gh', 'api', f'repos/{REPO}/actions/runs?per_page=100&head_sha={sha}'])
    if rc != 0:
        print(f'⚠️ rc=2 【量不到】:gh 呼叫失敗(沒登入 / 網路 / repo 打錯)\n   {out.strip()[:300]}')
        return 2
    try:
        runs = json.loads(out).get('workflow_runs', [])
    except json.JSONDecodeError:
        print(f'⚠️ rc=2 【量不到】:gh 回的不是 JSON\n   {out.strip()[:300]}')
        return 2

    mine = [r for r in runs if r.get('name') == WORKFLOW]
    if not mine:
        print(
            f'⚠️ rc=2 【量不到】:{sha[:8]} 上沒有任何 `{WORKFLOW}` run。\n'
            f'   🛑 那**不是**綠 —— 常見成因:這顆還沒 push / push 到沒開 CI 的分支 / workflow 改名。\n'
            f'   🔴 「查無 run」與「跑完了是綠的」是相反的兩件事, 而它們都很安靜。'
        )
        return 2

    run = sorted(mine, key=lambda r: r.get('created_at', ''))[-1]
    status = run.get('status')
    concl = run.get('conclusion')
    url = run.get('html_url', '')

    if status != 'completed':
        print(f'⏳ rc=3 【還在跑】{sha[:8]} · status={status} · {url}\n   🛑 這【不是】綠。跑完再跑一次本檔。')
        return 3

    if concl == 'success':
        print(f'✅ rc=0 綠 {sha[:8]} · {url}')
        return 0

    if concl != 'failure':
        print(f'⚠️ rc=2 【量不到】{sha[:8]} conclusion={concl}(cancelled / timed_out / …)· {url}\n   🛑 那不是綠, 也不是「這顆有問題」—— 它沒跑完。')
        return 2

    files = failing_test_files(str(run['id']))
    print(f'🔴 rc=1 紅 {sha[:8]} · {url}')
    if not files:
        print('   ⚠️ 測試層抽不到 FAIL ⇒ 紅在 typecheck / lint / build 層(或抽法壞了)。開上面那個網址看。')
    for f in files:
        print(f'   🔬 紅的測試檔:{f}')
        rc2, log = sh(['git', 'log', '-3', '--format=%h %ad %s', '--date=short', '--', f])
        for line in (log.strip().splitlines() if rc2 == 0 else []):
            print(f'      ← {line}')
    print(
        '   🔴 **歸屬是【線索】不是答案** —— 全隊共用 git 身分 `probe`, 作者欄結構上答不出哪個窗;\n'
        '      而一支測試可以被 A 窗的改動弄紅, 而它上一顆是 B 窗推的。'
    )
    return 1


def selftest() -> int:
    """離線自檢:只驗【四個世界不會印同一句】這件事, 不打網路。

    🔵 **為什麼自檢不打網路** —— 打了它就會因為別人的 CI 紅而紅,
       而那種閘會死於誤報然後被關掉。
    """
    import io
    import re

    full = io.open(__file__, encoding='utf-8').read()
    # 🔴 **只數 `main()` 的【本體】** —— 第一版我數整支檔, 而它把上面 docstring 裡
    #    【解釋這四個世界的那幾行】也數進去 ⇒ 每個 token 都是 2 ⇒ 自檢紅。
    #    ⇒ 📌 **寫進檔案的數法會數到它自己。**(而它紅得誠實, 所以我看得見。)
    m = re.search(r'\ndef main\(\) -> int:\n(.*?)\ndef selftest\(', full, re.S)
    if not m:
        print('🔴 selftest FAIL:切不出 main() 本體 ⇒ 抽法壞了, 不是四個世界壞了')
        return 1
    body = m.group(1)
    bad = []
    for tok, want in [('rc=0 綠', 1), ('rc=3 【還在跑】', 1), ('rc=1 紅', 1)]:
        if body.count(tok) != want:
            bad.append(f'{tok} 在 main() 裡出現 {body.count(tok)} 次, 期望 {want}')
    # rc=2 有四個出口(gh 失敗 / 非 JSON / 查無 run / 非 failure 結論), 刻意不釘成 1
    if body.count('rc=2 【量不到】') < 3:
        bad.append('rc=2 的出口少於 3 個 ⇒ 有世界被合併掉了')
    # 🔵 正對照:切出來的 body 要真的有東西, 否則上面每個 count 都是 0 而「≠1」照樣叫,
    #    而那時的紅指向錯的方向(看起來像世界不見了, 其實是切法壞了)。
    if len(body) < 500:
        bad.append(f'切出來的 main() 本體只有 {len(body)} 字元 ⇒ 抽法壞了')
    if bad:
        print('🔴 selftest FAIL:\n  ' + '\n  '.join(bad))
        return 1
    print('✅ selftest OK:四個世界各自有不同的字面(綠 1 · 還在跑 1 · 紅 1 · 量不到 ≥3 個出口)')
    return 0


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else main())
