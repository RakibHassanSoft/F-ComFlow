// Tests for the local (rule-based) COD risk scorer fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLocally } from '../services/risk-rules';

test('clean order from a repeat, no-return customer scores LOW', () => {
  const r = scoreLocally({
    phoneValid: true,
    address: 'House 12, Road 5, Dhanmondi, Dhaka',
    district: 'Dhaka',
    returnRate: 0,
    pastOrders: 5,
  });
  assert.equal(r.level, 'LOW');
  assert.ok(r.score < 35, `expected <35, got ${r.score}`);
});

test('invalid phone + incomplete address + new customer scores HIGH', () => {
  const r = scoreLocally({
    phoneValid: false,
    address: 'ctg',
    district: 'Dhaka',
    returnRate: 0,
    pastOrders: 0,
  });
  assert.equal(r.level, 'HIGH');
  assert.ok(r.score >= 60, `expected >=60, got ${r.score}`);
  assert.ok(r.factors.length > 0);
});

test('score is always within 0..100 and level matches thresholds', () => {
  const r = scoreLocally({ phoneValid: true, address: 'x', district: 'Dhaka', returnRate: 1, pastOrders: 4 });
  assert.ok(r.score >= 0 && r.score <= 100);
  const expected = r.score >= 60 ? 'HIGH' : r.score >= 35 ? 'MEDIUM' : 'LOW';
  assert.equal(r.level, expected);
});
