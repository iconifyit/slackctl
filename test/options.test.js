'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { effectiveBounds, effectiveLimit } = require('../src/commands/options');

const kDAY = { latest: '1790827199.999999', oldest: '1790740800.000000' };

test('effectiveLimit: newest-N mode defaults to 20; a range or date has no cap; an explicit --limit always wins', () => {
    // Scenario: the four ways an operator can bound a query, with and without --limit.
    assert.equal(effectiveLimit({}), 20);
    assert.equal(effectiveLimit({ date: kDAY }), undefined);
    assert.equal(effectiveLimit({ tsFrom: '1790740800.000000' }), undefined);
    assert.equal(effectiveLimit({ tsTo: '1790827199.999999' }), undefined);
    assert.equal(effectiveLimit({ limit: 5, tsFrom: '1790740800.000000' }), 5);
    assert.equal(effectiveLimit({ limit: 5 }), 5);
});

test('effectiveBounds: --date supplies both bounds; --ts-from and --ts-to supply one each; nothing otherwise', () => {
    // Scenario: a local day, a lower bound alone, an upper bound alone, and an unbounded query.
    assert.deepEqual(effectiveBounds({ date: kDAY }), kDAY);
    assert.deepEqual(effectiveBounds({ tsFrom: '1790740800.000000' }), { oldest: '1790740800.000000' });
    assert.deepEqual(effectiveBounds({ tsTo: '1790827199.999999' }), { latest: '1790827199.999999' });
    assert.deepEqual(effectiveBounds({}), {});
});
