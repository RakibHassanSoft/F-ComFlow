// Tests for the pure customer-message helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderStatusMessage, productPitch } from '../services/message-format';
import { isWithinBusinessHours } from '../lib/time';

test('orderStatusMessage returns a message for real states and null otherwise', () => {
  assert.match(orderStatusMessage(1042, 'CONFIRMED')!, /#1042/);
  assert.match(orderStatusMessage(1042, 'DISPATCHED')!, /shipped/i);
  assert.match(orderStatusMessage(1042, 'DELIVERED')!, /delivered/i);
  assert.equal(orderStatusMessage(1042, 'DRAFT'), null);
  assert.equal(orderStatusMessage(1042, 'WHATEVER'), null);
});

test('productPitch shows price, and a bulk line when quantity > 1', () => {
  assert.equal(productPitch('Panjabi', 1200), 'Panjabi — ৳1200. Want to order? 🙂');
  const bulk = productPitch('Panjabi', 1200, 3);
  assert.match(bulk, /For 3 pcs: ৳3600/);
});

test('isWithinBusinessHours: null hours means always open', () => {
  assert.equal(isWithinBusinessHours(new Date(), null, null), true);
  assert.equal(isWithinBusinessHours(new Date(), 9, null), true);
});

test('isWithinBusinessHours: normal daytime window (BD = UTC+6)', () => {
  // 10:00 UTC = 16:00 BD -> inside 9..22
  assert.equal(isWithinBusinessHours(new Date('2026-07-05T10:00:00Z'), 9, 22), true);
  // 20:00 UTC = 02:00 BD -> outside 9..22
  assert.equal(isWithinBusinessHours(new Date('2026-07-05T20:00:00Z'), 9, 22), false);
});

test('isWithinBusinessHours: overnight window (20..6) wraps midnight', () => {
  // 19:00 UTC = 01:00 BD -> inside 20..6
  assert.equal(isWithinBusinessHours(new Date('2026-07-05T19:00:00Z'), 20, 6), true);
  // 06:00 UTC = 12:00 BD -> outside 20..6
  assert.equal(isWithinBusinessHours(new Date('2026-07-05T06:00:00Z'), 20, 6), false);
});
