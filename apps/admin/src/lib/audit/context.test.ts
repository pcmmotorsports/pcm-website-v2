import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock next/headers cookies() + headers():就地 vi.mock + vi.hoisted。
const { cookieStore, headerStore } = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  headerStore: new Map<string, string>(),
}));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieStore.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) => headerStore.get(name) ?? null,
    }),
}));

import { getRequestId, buildAuditContext, recordAdminAudit } from './context';
import { InMemoryAuditLogRepository } from './in-memory-repository';
import { ACTOR_COOKIE } from '../session/actor';
import { REQUEST_ID_HEADER } from '../request-id';

describe('audit context', () => {
  beforeEach(() => {
    cookieStore.clear();
    headerStore.clear();
  });

  describe('getRequestId', () => {
    it('should read the correlation id from x-request-id header', async () => {
      headerStore.set(REQUEST_ID_HEADER, 'req_abc');
      expect(await getRequestId()).toBe('req_abc');
    });

    it('should fall back to a generated id when header missing', async () => {
      expect(await getRequestId()).toMatch(/^req_/);
    });
  });

  describe('buildAuditContext', () => {
    it('should assemble actor + requestId + admin source', async () => {
      cookieStore.set(ACTOR_COOKIE, 'sean');
      headerStore.set(REQUEST_ID_HEADER, 'req_1');
      expect(await buildAuditContext()).toEqual({
        actor: 'sean',
        requestId: 'req_1',
        sourceApp: 'admin',
      });
    });

    it('should throw fail-closed when no actor selected', async () => {
      headerStore.set(REQUEST_ID_HEADER, 'req_1');
      await expect(buildAuditContext()).rejects.toThrow(/actor/);
    });
  });

  describe('recordAdminAudit', () => {
    it('should record via the assembled context (correlation id 貫穿)', async () => {
      cookieStore.set(ACTOR_COOKIE, 'staff_1');
      headerStore.set(REQUEST_ID_HEADER, 'req_2');
      const repo = new InMemoryAuditLogRepository();
      await recordAdminAudit(repo, { action: 'order.cancel', target: 'order:5' });
      expect(repo.recorded[0]).toMatchObject({
        actor: 'staff_1',
        action: 'order.cancel',
        target: 'order:5',
        request_id: 'req_2',
        source_app: 'admin',
      });
    });
  });
});
