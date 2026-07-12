import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock next/headers cookies():就地 vi.mock + vi.hoisted(storefront 慣例;無共用 setup)。
const { cookieStore } = vi.hoisted(() => ({ cookieStore: new Map<string, string>() }));

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieStore.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));

import { getSessionActor, ACTOR_COOKIE } from './actor';

describe('getSessionActor', () => {
  beforeEach(() => cookieStore.clear());

  it('should return the StaffActor for a valid actor cookie', async () => {
    cookieStore.set(ACTOR_COOKIE, 'sean');
    expect(await getSessionActor()).toEqual({ id: 'sean', label: 'Sean(老闆)' });
  });

  it('should return null when no actor cookie set', async () => {
    expect(await getSessionActor()).toBeNull();
  });

  it('should return null when cookie holds an unknown id (fail-closed)', async () => {
    cookieStore.set(ACTOR_COOKIE, 'ghost');
    expect(await getSessionActor()).toBeNull();
  });
});
