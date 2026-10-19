import { describe,it,expect } from 'vitest';
import { hashPassword,verifyPassword,tokenHash } from '../src/security.js';

describe('session cryptography',()=>{
  it('uses independently salted memory-hard password hashes',async()=>{
    const one=await hashPassword('correct horse battery staple');const two=await hashPassword('correct horse battery staple');
    expect(one).not.toEqual(two);expect(one).not.toContain('correct');
    expect(await verifyPassword('correct horse battery staple',one)).toBe(true);
    expect(await verifyPassword('wrong password',one)).toBe(false);
  });
  it('persists only a deterministic SHA-256 digest of opaque session tokens',()=>{
    expect(tokenHash('test-token')).toMatch(/^[a-f0-9]{64}$/);expect(tokenHash('test-token')).not.toContain('test-token');
  });
});
