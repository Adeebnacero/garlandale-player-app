// Tests for messages-view.js. Run with: node --test messages-view.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { childrenIn, filterByChild, groupMessages } from './messages-view.js';

const NOW = new Date('2026-11-02T10:00:00+02:00'); // Mon 2 Nov 2026, Cape Town
const m = (id, sentAt, playerName = 'Zaid', read = true) => ({ id, sentAt, playerName, read, body: id });

test('last 7 days first, then this month, earlier months, and the year when it differs', () => {
  const groups = groupMessages([
    m('a', '2026-11-02T08:00:00Z', 'Zaid', false),
    m('b', '2026-10-27T10:00:00Z'),            // within 7 days
    m('c', '2026-10-20T10:00:00Z'),
    m('d', '2026-09-15T10:00:00Z'),
    m('e', '2025-12-20T10:00:00Z'),
  ], NOW);
  assert.deepEqual(groups.map((g) => [g.title, g.messages.map((x) => x.id), g.unread]), [
    ['Last 7 days', ['a', 'b'], 1],
    ['October', ['c'], 0],
    ['September', ['d'], 0],
    ['December 2025', ['e'], 0],
  ]);
});

test('the rest of this month is "Earlier in" the month', () => {
  const groups = groupMessages([m('x', '2026-11-20T08:00:00Z')], new Date('2026-11-30T08:00:00Z'));
  assert.equal(groups[0].title, 'Earlier in November');
});

test('months follow Cape Town time, not UTC', () => {
  // 31 Oct 23:30 UTC is already 1 November in South Africa.
  const groups = groupMessages([m('x', '2026-10-31T23:30:00Z')], new Date('2026-12-15T08:00:00Z'));
  assert.equal(groups[0].title, 'November');
});

test('unsorted input still comes out newest first', () => {
  const groups = groupMessages([m('old', '2026-09-01T08:00:00Z'), m('new', '2026-11-01T08:00:00Z')], NOW);
  assert.deepEqual(groups.map((g) => g.messages[0].id), ['new', 'old']);
});

test('children for the filter, and filtering', () => {
  const list = [m('1', '2026-11-01T08:00:00Z', 'Zaid'), m('2', '2026-11-01T08:00:00Z', 'Amina'), m('3', '2026-11-01T08:00:00Z', '')];
  assert.deepEqual(childrenIn(list), ['Amina', 'Zaid']);
  assert.deepEqual(filterByChild(list, 'Amina').map((x) => x.id), ['2']);
  assert.equal(filterByChild(list, '').length, 3);
  assert.deepEqual(groupMessages([], NOW), []);
});
