import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthorizeUrl, buildExchangeUrl, getSsoConfig } from './config';

const SECRET = 'x'.repeat(40); // >= MIN_SECRET_LEN

describe('getSsoConfig', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns config when valid (prod https + strong secret)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PCM_QUOTE_SSO_BASE', 'https://quote.example.com');
    vi.stubEnv('PCM_SSO_EXCHANGE_SECRET', SECRET);
    expect(getSsoConfig()).toEqual({ quoteBase: 'https://quote.example.com', exchangeSecret: SECRET });
  });

  it('null when base or secret missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PCM_SSO_EXCHANGE_SECRET', SECRET);
    expect(getSsoConfig()).toBeNull(); // base unset
  });

  it('prod rejects http base (MF4)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PCM_QUOTE_SSO_BASE', 'http://quote.example.com');
    vi.stubEnv('PCM_SSO_EXCHANGE_SECRET', SECRET);
    expect(getSsoConfig()).toBeNull();
  });

  it('dev allows http base', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PCM_QUOTE_SSO_BASE', 'http://localhost:3000');
    vi.stubEnv('PCM_SSO_EXCHANGE_SECRET', SECRET);
    expect(getSsoConfig()).toEqual({ quoteBase: 'http://localhost:3000', exchangeSecret: SECRET });
  });

  it('rejects short secret < 32 (MF5)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PCM_QUOTE_SSO_BASE', 'https://quote.example.com');
    vi.stubEnv('PCM_SSO_EXCHANGE_SECRET', 'short');
    expect(getSsoConfig()).toBeNull();
  });

  it('rejects malformed base URL', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PCM_QUOTE_SSO_BASE', 'not a url');
    vi.stubEnv('PCM_SSO_EXCHANGE_SECRET', SECRET);
    expect(getSsoConfig()).toBeNull();
  });

  it('builds authorize + exchange URLs', () => {
    expect(buildAuthorizeUrl('https://quote.example.com', 'st')).toBe(
      'https://quote.example.com/api/sso/authorize?state=st',
    );
    expect(buildExchangeUrl('https://quote.example.com')).toBe('https://quote.example.com/api/sso/exchange');
  });
});
