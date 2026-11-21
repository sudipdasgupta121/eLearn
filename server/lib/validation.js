import { bad } from './errors.js';

export function luhn(digits) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Validates card form input. Returns the normalized number; throws HttpError(400) otherwise. */
export function validateCard(card, now = new Date()) {
  if (!card || typeof card !== 'object') throw bad('Card details are required');
  const str = (x) => (typeof x === 'string' ? x : '');
  const num = str(card.number).replace(/[\s-]+/g, '');
  if (!/^\d{13,19}$/.test(num) || !luhn(num)) throw bad('Invalid card number');
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(str(card.expiry));
  if (!m || +m[1] < 1 || +m[1] > 12) throw bad('Expiry must be MM/YY');
  // a card is valid through the END of its expiry month
  if (new Date(2000 + +m[2], +m[1], 1) <= now) throw bad('Card has expired');
  if (!/^\d{3,4}$/.test(str(card.cvc))) throw bad('Invalid CVC');
  return num;
}

export function validateEmail(email) {
  const e = (typeof email === 'string' ? email : '').trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('A valid email is required');
  return e;
}

export function validateName(name) {
  const n = (typeof name === 'string' ? name : '').trim().replace(/\s+/g, ' ');
  if (n.length < 1 || n.length > 100) throw bad('Name is required (max 100 characters)');
  return n;
}

// bcrypt only uses the first 72 bytes, so cap the length.
export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters');
  if (Buffer.byteLength(pw) > 72) throw bad('Password must be at most 72 bytes');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw bad('Password must contain at least one letter and one number');
  return pw;
}

/** Escape LIKE wildcards in user-supplied search text. */
export const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);
