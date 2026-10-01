// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// 2026-10-01:本機開訂單頁, server 渲染這支時 log 出「Too many re-renders」(:192), 那次請求回 500。
//   原因:server 端的 useActionState 每次渲染都直接回傳我們傳進去的初值, 而初值是每次渲染新做的物件
//   ⇒ 「seen.state !== state」永遠成立 ⇒ 每次渲染都 setSeen ⇒ server 一直重畫到上限。
//   瀏覽器端的 useActionState 會記住 state, 所以只有 server 渲染會炸。
vi.mock('../../lib/orders/note-actions', () => ({
  appendOrderNoteAction: async () => ({ status: 'idle', requestToken: 'x' }),
}));

import { NoteComposeForm } from './note-compose-form';

describe('NoteComposeForm server 渲染', () => {
  it('server 渲染不會無限重畫', () => {
    const html = renderToString(
      <NoteComposeForm
        orderId='3f2f2c1e-0000-4000-8000-000000000001'
        returnTo='/orders/3f2f2c1e-0000-4000-8000-000000000001'
        serverToken='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        correctTarget={null}
      />,
    );
    expect(html).toContain('新增備註');
  });
});
