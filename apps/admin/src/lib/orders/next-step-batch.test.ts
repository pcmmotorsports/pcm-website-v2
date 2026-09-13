import { describe, expect, it } from 'vitest';
import { BATCH_ROWS_MAX, batchFieldName, splitBatchRows } from './next-step-batch';

// next-step-batch.test.ts — 拆列(B9-b)。一列的欄位原樣、只掛前綴;server 端拆回每列一份 FormData。
const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';

describe('splitBatchRows', () => {
  it('依列 id 分組、去前綴、保序;不帶前綴的欄位不進任何列;同名多值保留(讓下游「送兩份」閘照樣擋)', () => {
    const fd = new FormData();
    fd.set('batch_kind', 'receipt');
    fd.append(batchFieldName(A, 'quantity'), '1');
    fd.append(batchFieldName(B, 'quantity'), '2');
    fd.append(batchFieldName(A, 'note'), 'x');
    fd.append(batchFieldName(A, 'note'), 'y');
    const rows = splitBatchRows(fd);
    expect([...rows.keys()]).toEqual([A, B]);
    expect(rows.get(A)!.get('quantity')).toBe('1');
    expect(rows.get(A)!.getAll('note')).toEqual(['x', 'y']);
    expect(rows.get(B)!.get('quantity')).toBe('2');
    expect(rows.get(A)!.has('batch_kind')).toBe(false);
  });

  it('列 id 不是 uuid 形狀、或欄位名空 ⇒ 那顆欄位丟掉,不會變成一列', () => {
    const fd = new FormData();
    fd.append('r.not-a-uuid.quantity', '1');
    fd.append(`r.${A}.`, '1');
    fd.append('r..quantity', '1');
    fd.append(`r.${A}.quantity`, '3');
    const rows = splitBatchRows(fd);
    expect([...rows.keys()]).toEqual([A]);
    expect([...rows.get(A)!.keys()]).toEqual(['quantity']);
  });

  it('上限常數是 50(主視窗裁 10 張 / 50 列)', () => {
    expect(BATCH_ROWS_MAX).toBe(50);
  });
});
