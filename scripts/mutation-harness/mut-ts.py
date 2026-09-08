import io, sys
# 突變都打在【表單元件】上, 而不是打在測試上 —— 測試是量具, 量具不該被突變
FORM = 'apps/admin/src/components/orders/manual-refund-entry-section.tsx'
M = {
 'M0': None,  # 🔴 不突變。第一發, 必須綠 —— 沒有它, 後面每一發的紅都可能是別的原因
 'M1': (FORM, '              disabled={isPending}', '              disabled={false === false ? true : true}'),
 'M2': (FORM, 'name={MANUAL_REFUND_AMOUNT_FIELD}', 'name="zzq_mutated_amount"'),
 'M3': (FORM, '<fieldset disabled={isPending}', '<fieldset disabled={true}'),
 'M4': (FORM, '      <form action={formAction}>', '      <div>'),
}
# ── --selftest ────────────────────────────────────────────────────────────────
# 🔴 **它要在【壞掉的時候回非 0】** —— 而本閘自己說「寫 true 一樣過得了, 那一格靠人」。
#    ⇒ 所以下面每一格都問一個【兩個世界會印不同東西】的問題, 不是問「檔案在不在」。
if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
    bad = []
    # ① M0 必須是 None —— 它是「不突變」那一發, 而整套的基準線靠它
    if M.get('M0', 'x') is not None:
        bad.append('M0 不是 None ⇒ 基準線那一發會變成一個突變')
    # ② 每一發的 old/new 必須不同 —— 一發「換成自己」的突變, 會永遠印【存活】
    #    ⇒ 而那看起來像「這裡沒有人在守」, 而實際上是這一發什麼都沒改
    for k, v in M.items():
        if v is None:
            continue
        _path, _old, _new = v
        if _old == _new:
            bad.append('%s 的 old 與 new 相同 ⇒ 那一發不會改變任何東西' % k)
    # ③ 每一發的 anchor 必須在目標檔裡【恰好一處】—— 0 處 ⇒ 作廢;多處 ⇒ 一次退兩道
    #    🔵 而找不到檔案時【不算失敗】:本支可能被從別的 cwd 呼叫
    #       ⇒ 那一格明說跳過, 不冒稱通過
    import os
    skipped = 0
    for k, v in M.items():
        if v is None:
            continue
        _path, _old, _new = v
        if not os.path.exists(_path):
            skipped += 1
            continue
        _c = io.open(_path, encoding='utf-8').read().count(_old)
        if _c != 1:
            bad.append('%s 的 anchor 在 %s 命中 %d 處(期望 1)' % (k, _path, _c))
    if bad:
        print('🔴 selftest 失敗:')
        for b in bad:
            print('  · ' + b)
        sys.exit(1)
    print('selftest 通過(檢查 %d 發突變;因找不到目標檔而跳過 anchor 檢查的:%d 發)'
          % (len([x for x in M.values() if x is not None]), skipped))
    sys.exit(0)

which = sys.argv[1]
spec = M[which]
if spec is None:
    print('M0 不突變'); sys.exit(0)
path, old, new = spec
s = io.open(path, encoding='utf-8').read()
n = s.count(old)
if n != 1:
    print('ANCHOR n=%d' % n); sys.exit(9)
if which == 'M4':
    s = s.replace(old, new, 1).replace('      </form>', '      </div>', 1)
else:
    s = s.replace(old, new, 1)
io.open(path, 'w', encoding='utf-8').write(s)
print('mutated ' + which)
