import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeLike, luhn, validateCard, validateEmail, validateName, validatePassword } from '../../lib/validation.js';
import { HttpError } from '../../lib/errors.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const good = { number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123' };
const badRequest = (fn) => assert.throws(fn, (e) => e instanceof HttpError && e.status === 400);

test('luhn accepts valid and rejects invalid numbers', () => {
  assert.equal(luhn('4242424242424242'), true);
  assert.equal(luhn('4000000000000002'), true);
  assert.equal(luhn('4242424242424241'), false);
  assert.equal(luhn('1234567812345678'), false);
});

test('validateCard returns the normalized number for a good card', () => {
  assert.equal(validateCard(good, NOW), '4242424242424242');
  assert.equal(validateCard({ ...good, number: '4242-4242-4242-4242' }, NOW), '4242424242424242');
});

test('validateCard rejects bad input', () => {
  badRequest(() => validateCard(undefined, NOW));
  badRequest(() => validateCard('4242424242424242', NOW));
  badRequest(() => validateCard({ ...good, number: '4242 4242 4242 4241' }, NOW));
  badRequest(() => validateCard({ ...good, number: 'abcd efgh ijkl mnop' }, NOW));
  badRequest(() => validateCard({ ...good, number: '4242' }, NOW));
  badRequest(() => validateCard({ ...good, expiry: '13/30' }, NOW));
  badRequest(() => validateCard({ ...good, expiry: '1230' }, NOW));
  badRequest(() => validateCard({ ...good, cvc: '12' }, NOW));
  badRequest(() => validateCard({ ...good, cvc: 'abc' }, NOW));
});

test('validateCard: valid through the end of the expiry month', () => {
  assert.equal(validateCard({ ...good, expiry: '06/26' }, NOW), '4242424242424242'); // current month still OK
  badRequest(() => validateCard({ ...good, expiry: '05/26' }, NOW));
});

test('validateEmail normalizes and rejects', () => {
  assert.equal(validateEmail('  Foo@Example.COM '), 'foo@example.com');
  badRequest(() => validateEmail('nope'));
  badRequest(() => validateEmail('a@b'));
  badRequest(() => validateEmail(undefined));
  badRequest(() => validateEmail('a b@c.com'));
  badRequest(() => validateEmail('a'.repeat(250) + '@x.com'));
});

test('validateName trims, collapses spaces, limits length', () => {
  assert.equal(validateName('  Ada   Lovelace '), 'Ada Lovelace');
  badRequest(() => validateName('   '));
  badRequest(() => validateName('x'.repeat(101)));
  badRequest(() => validateName(undefined));
});

test('validatePassword enforces policy', () => {
  assert.equal(validatePassword('Secret123'), 'Secret123');
  badRequest(() => validatePassword('short1'));
  badRequest(() => validatePassword('allletters'));
  badRequest(() => validatePassword('12345678'));
  badRequest(() => validatePassword('a1'.repeat(40)));
  badRequest(() => validatePassword(12345678));
  badRequest(() => validatePassword(undefined));
});

test('escapeLike escapes wildcards', () => {
  assert.equal(escapeLike('50%_off\\'), '50\\%\\_off\\\\');
  assert.equal(escapeLike('plain'), 'plain');
});
