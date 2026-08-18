import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/password.js';

describe('password: scrypt-хэш', () => {
  it('круговая проверка: верный пароль проходит, неверный нет', async () => {
    const hash = await hashPassword('secret');
    expect(hash).not.toBe('secret');
    expect(await verifyPassword('secret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('разные соли дают разные хэши для одного пароля', async () => {
    expect(await hashPassword('a')).not.toBe(await hashPassword('a'));
  });
});
