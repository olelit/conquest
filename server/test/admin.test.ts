import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.js';
import { signToken, verifyToken, authAdmin, planCredentialChange } from '../src/admin.js';

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
  it('authAdmin сверяет логин и scrypt-хэш пароля из БД', async () => {
    const stored = { username: 'custom-admin', passwordHash: await hashPassword('custom-pass'), sessionSecret: 'x' };
    expect(await authAdmin('custom-admin', 'custom-pass', stored)).toBe(true);
    expect(await authAdmin('custom-admin', 'wrong', stored)).toBe(false);
    expect(await authAdmin('admin', 'custom-pass', stored)).toBe(false);
  });
});

describe('admin: смена кредов (planCredentialChange)', () => {
  async function storedFor(password: string): Promise<{ username: string; passwordHash: string; sessionSecret: string }> {
    return { username: 'admin', passwordHash: await hashPassword(password), sessionSecret: 'secret-A' };
  }

  it('требует корректный текущий пароль', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'wrong', newPassword: 'new' });
    expect(r).toEqual({ ok: false, status: 401, error: 'Current password is incorrect' });
  });

  it('отклоняет пустую смену', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old' });
    expect(r).toEqual({ ok: false, status: 400, error: 'Nothing to change' });
  });

  it('отклоняет пустой новый логин', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newLogin: '   ' });
    expect(r).toEqual({ ok: false, status: 400, error: 'New login cannot be empty' });
  });

  it('отклоняет пустой новый пароль', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newPassword: '' });
    expect(r).toEqual({ ok: false, status: 400, error: 'New password cannot be empty' });
  });

  it('отклоняет совпадение нового логина с текущим', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newLogin: 'admin' });
    expect(r).toEqual({ ok: false, status: 409, error: 'New login is the same as current' });
  });

  it('отклоняет совпадение нового пароля с текущим', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newPassword: 'old' });
    expect(r).toEqual({ ok: false, status: 400, error: 'New password is the same as current' });
  });

  it('меняет только пароль', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newPassword: 'new' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.username).toBe('admin');
    expect(await verifyPassword('new', r.passwordHash)).toBe(true);
    expect(await verifyPassword('old', r.passwordHash)).toBe(false);
  });

  it('меняет логин и пароль', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newLogin: 'root', newPassword: 'new' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.username).toBe('root');
    expect(await verifyPassword('new', r.passwordHash)).toBe(true);
  });

  it('ротация session_secret убивает старые токены', async () => {
    const secretA = 'secret-A';
    const token = signToken({ u: 'admin', exp: Date.now() + 60000 }, secretA);
    expect(verifyToken(token, secretA)).toEqual({ u: 'admin' });
    expect(verifyToken(token, 'secret-B')).toBeNull();
  });

  it('нестроковый текущий пароль не падает (401)', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: { x: 1 } as unknown as string, newPassword: 'new' });
    expect(r).toEqual({ ok: false, status: 401, error: 'Current password is incorrect' });
  });

  it('null новый пароль не падает (трактуется как ничего не меняем)', async () => {
    const stored = await storedFor('old');
    const r = await planCredentialChange(stored, { currentPassword: 'old', newPassword: null as unknown as string });
    expect(r).toEqual({ ok: false, status: 400, error: 'Nothing to change' });
  });
});
