import { describe, expect, it, vi } from 'vitest';
import { retryOnceOnStatementTimeout } from './retry-on-statement-timeout';

const timeout = () => Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });

describe('retryOnceOnStatementTimeout', () => {
  it('第一發 57014、第二發成功 ⇒ 回第二發的結果, 叫兩次', async () => {
    const run = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValueOnce('ok');
    await expect(retryOnceOnStatementTimeout('t', run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('兩發都 57014 ⇒ 丟出第二發的錯, 只叫兩次(不迴圈)', async () => {
    const run = vi.fn().mockRejectedValue(timeout());
    await expect(retryOnceOnStatementTimeout('t', run)).rejects.toMatchObject({ code: '57014' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('非 57014 的錯 ⇒ 不重試, 原樣丟出', async () => {
    const run = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: '42501' }));
    await expect(retryOnceOnStatementTimeout('t', run)).rejects.toMatchObject({ code: '42501' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('第一發就成功 ⇒ 只叫一次', async () => {
    const run = vi.fn().mockResolvedValue('ok');
    await expect(retryOnceOnStatementTimeout('t', run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
