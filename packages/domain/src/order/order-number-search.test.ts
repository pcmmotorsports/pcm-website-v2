import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  normalizeOrderNumberSearch,
  LEGACY_ORDER_NUMBER_RE,
  ORDER_NUMBER_RE,
  MAX_ORDER_NUMBER_SEARCH_LENGTH,
} from './order-number-search';

describe('normalizeOrderNumberSearch(E10 A9b1 單號搜尋形狀守門)', () => {
  it('舊格式命中並保持原樣', () => {
    expect(normalizeOrderNumberSearch('PCM-2026-0104')).toEqual({
      kind: 'ok',
      value: 'PCM-2026-0104',
    });
  });

  it('新 6 碼格式命中', () => {
    expect(normalizeOrderNumberSearch('YWP3PC')).toEqual({ kind: 'ok', value: 'YWP3PC' });
  });

  it('去頭尾空白(客服從信件貼上常帶空白)', () => {
    expect(normalizeOrderNumberSearch('  PCM-2026-0104  ')).toEqual({
      kind: 'ok',
      value: 'PCM-2026-0104',
    });
    expect(normalizeOrderNumberSearch('\tYWP3PC\n')).toEqual({ kind: 'ok', value: 'YWP3PC' });
  });

  it('小寫輸入轉大寫後命中(手機鍵盤預設小寫)', () => {
    expect(normalizeOrderNumberSearch('ywp3pc')).toEqual({ kind: 'ok', value: 'YWP3PC' });
    expect(normalizeOrderNumberSearch('pcm-2026-0104')).toEqual({
      kind: 'ok',
      value: 'PCM-2026-0104',
    });
  });

  it('空輸入 = empty(不篩選)', () => {
    expect(normalizeOrderNumberSearch('')).toEqual({ kind: 'empty' });
    expect(normalizeOrderNumberSearch('   ')).toEqual({ kind: 'empty' });
    expect(normalizeOrderNumberSearch(undefined)).toEqual({ kind: 'empty' });
    expect(normalizeOrderNumberSearch(null)).toEqual({ kind: 'empty' });
  });

  it('🔴 格式不符 = invalid,不得與 empty 混為一談(否則打錯字會退化成列出全部)', () => {
    // 新格式排除的易混淆字元與母音
    expect(normalizeOrderNumberSearch('YWP3P0')).toEqual({ kind: 'invalid', input: 'YWP3P0' });
    expect(normalizeOrderNumberSearch('YWP3PA')).toEqual({ kind: 'invalid', input: 'YWP3PA' });
    // 長度不對
    expect(normalizeOrderNumberSearch('YWP3P')).toEqual({ kind: 'invalid', input: 'YWP3P' });
    expect(normalizeOrderNumberSearch('YWP3PCX')).toEqual({ kind: 'invalid', input: 'YWP3PCX' });
    // 舊格式流水號不足 4 碼
    expect(normalizeOrderNumberSearch('PCM-2026-104')).toEqual({
      kind: 'invalid',
      input: 'PCM-2026-104',
    });
    // 純文字
    expect(normalizeOrderNumberSearch('王小明')).toEqual({ kind: 'invalid', input: '王小明' });
  });

  it('🔴 PostgREST .or 注入形狀一律 invalid(逗號 / 括號 / 點號都會改變 filter 結構)', () => {
    const attacks = [
      'YWP3PC,payment_status.eq.paid',
      'PCM-2026-0104,legacy_display_id.is.null',
      'YWP3PC)',
      'display_id.is.null',
      'YWP3PC.or(x)',
      'YWP3P*',
      "YWP3PC'",
    ];
    for (const a of attacks) {
      const r = normalizeOrderNumberSearch(a);
      expect(r.kind, `注入形狀應被拒:${a}`).toBe('invalid');
    }
  });

  it('🔴 ok 的值只含可安全內插的字元 [A-Z0-9-]', () => {
    for (const raw of ['PCM-2026-0104', 'ywp3pc', ' YWP3PC ']) {
      const r = normalizeOrderNumberSearch(raw);
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') expect(r.value).toMatch(/^[A-Z0-9-]+$/);
    }
  });

  it('🔴 換行不得繞過錨點(D0 的 CHECK 同樣守這條)', () => {
    expect(normalizeOrderNumberSearch('YWP3PC\nBAD').kind).toBe('invalid');
    // trim 會吃掉尾端換行 ⇒ 這種形狀應該是 ok,確認 trim 的行為是刻意的
    expect(normalizeOrderNumberSearch('YWP3PC\n')).toEqual({ kind: 'ok', value: 'YWP3PC' });
  });

  it('🔴 超長輸入 = invalid(舊格式流水號無上界,不擋會把 .or 的 GET query string 撐爆)', () => {
    const huge = `PCM-2026-${'9'.repeat(3000)}`;
    const r = normalizeOrderNumberSearch(huge);
    expect(r.kind).toBe('invalid');
    // 回報用的 input 也要截斷,不要把 3000 字帶進錯誤訊息或畫面
    if (r.kind === 'invalid') {
      expect(r.input.length).toBeLessThanOrEqual(MAX_ORDER_NUMBER_SEARCH_LENGTH);
    }
    // 邊界:剛好上限內的合法值仍要通過
    expect(normalizeOrderNumberSearch(`PCM-2026-${'9'.repeat(4)}`).kind).toBe('ok');
  });

  it('🔴 非 ASCII 一律 invalid —— toUpperCase 會把 ß 變 SS、ﬀ 變 FF,靜默改寫成別人的單號', () => {
    // 'ß'.toUpperCase() === 'SS';不擋的話 '2345ß' 會變成合法的 '2345SS'
    expect('ß'.toUpperCase()).toBe('SS'); // 前提本身先驗,避免這條測試建立在錯誤假設上
    expect(normalizeOrderNumberSearch('2345ß').kind).toBe('invalid');
    expect(normalizeOrderNumberSearch('2345ﬀ').kind).toBe('invalid');
    // 全形、土耳其 i、Kelvin sign、零寬空格
    expect(normalizeOrderNumberSearch('ＹＷＰ３ＰＣ').kind).toBe('invalid');
    expect(normalizeOrderNumberSearch('YWP3Pı').kind).toBe('invalid');
    expect(normalizeOrderNumberSearch('YWP3PK').kind).toBe('invalid');
    expect(normalizeOrderNumberSearch('YWP3PC​').kind).toBe('invalid');
    // 阿拉伯數字字元不得被 \d 當成數字(JS 的 \d 只吃 ASCII,這條把前提釘住)
    expect(normalizeOrderNumberSearch('PCM-٢٠٢٦-٠١٠٤').kind).toBe('invalid');
  });

  it('🔴 regex 與 D0 migration 的 CHECK 同形狀 —— 直接讀 migration 檔比對,不是只 pin 自己的 source', () => {
    // 只 pin JS 自己的 .source 是假綠:SQL 那邊被放寬成 {1,6} 或把 O 加回字母表,測試照樣全綠。
    // D0 自己在 codex 關卡2 R1 就被抓過同一類問題,同一條線不再犯第二次。
    const migrationPath = fileURLToPath(
      new URL(
        '../../../../supabase/migrations/20260729010000_m4b_e10_d0_display_id_expand.sql',
        import.meta.url,
      ),
    );
    const sql = readFileSync(migrationPath, 'utf8');

    // migration 裡的兩條 regex 字面(SQL 用 [0-9],JS 用 \d,語意相同)
    const sqlLegacy = '^PCM-[0-9]{4}-[0-9]{4,}$';
    const sqlNew = '^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$';
    expect(sql, 'D0 的舊格式 CHECK 字面已變,搜尋端要同步').toContain(sqlLegacy);
    expect(sql, 'D0 的新格式 CHECK 字面已變,搜尋端要同步').toContain(sqlNew);

    // JS 端字面(把 SQL 的 [0-9] 換成 \d 之後應完全相同)
    expect(LEGACY_ORDER_NUMBER_RE.source).toBe(sqlLegacy.replaceAll('[0-9]', '\\d'));
    expect(ORDER_NUMBER_RE.source).toBe(sqlNew);
  });
});
