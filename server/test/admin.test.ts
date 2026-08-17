import { describe, expect, it } from 'vitest';
import { signToken, verifyToken, authAdmin } from '../src/admin.js';

const SECRET = 'test-secret';

describe('admin: токен сессии', () => {
  it('корректный токен проходит проверку', () => {
    const token = signToken({ u: 'admin', exp: Date.now() + 60000 }, SECRET);
    expect(verifyToken(token, SECRET)).toEqual({ u: 'admin' });
  });
  it('подделанный токен отклоняется', () => {
    const token = signToken({ u: 'admin', exp: Date.now() + 60000 }, SECRET);
    const forged = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(verifyToken(forged, SECRET)).toBeNull();
  });
  it('протухший токен отклоняется', () => {
    const token = signToken({ u: 'admin', exp: Date.now() - 1000 }, SECRET);
    expect(verifyToken(token, SECRET)).toBeNull();
  });
  it('токен с другим секретом отклоняется', () => {
    const token = signToken({ u: 'admin', exp: Date.now() + 60000 }, SECRET);
    expect(verifyToken(token, 'other-secret')).toBeNull();
  });
  it('authAdmin сверяет логин и пароль', () => {
    expect(authAdmin('admin', 'admin')).toBe(true);
    expect(authAdmin('admin', 'wrong')).toBe(false);
  });
});
