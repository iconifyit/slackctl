'use strict';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

const { SlackApiError, SlackClient } = require('../src/slack');
const { createFakeSlack } = require('./helpers/fake-slack');

const kTOKEN   = 'xoxp-test-not-a-real-token';
const kCHANNEL = 'C02345DEF';

const kRATE_LIMITED = { body: { error: 'ratelimited', ok: false }, headers: { 'Retry-After': '2' }, status: 429 };

const historyPage = (messages, nextCursor = '') => ({
    body : { messages, ok: true, response_metadata: { next_cursor: nextCursor } },
});

const makeClient = (routes) => {
    const fake   = createFakeSlack(routes);
    const sleep  = mock.fn(async () => {});
    const log    = mock.fn();
    const client = new SlackClient({ fetch: fake.fetch, log, sleep, token: kTOKEN });

    return { calls: fake.calls, client, log, sleep };
};

test('call: sends a bearer-authenticated JSON POST and returns the ok body', async () => {
    // Scenario: one successful chat.postMessage to #development; no rate limiting.
    const { client, calls, sleep } = makeClient({
        'chat.postMessage': { body: { channel: kCHANNEL, ok: true, ts: '1759343520.000100' } },
    });

    const result = await client.call('chat.postMessage', { channel: kCHANNEL, text: 'PR is ready for review.' });

    assert.equal(result.ts, '1759343520.000100');
    assert.deepEqual(calls, [{
        args    : { channel: kCHANNEL, text: 'PR is ready for review.' },
        headers : { Authorization: `Bearer ${kTOKEN}`, 'Content-Type': 'application/json' },
        method  : 'chat.postMessage',
    }]);
    assert.equal(sleep.mock.callCount(), 0);
});

test('call: ok:false becomes a SlackApiError carrying method and code', async () => {
    // Scenario: history requested for a channel the token's user is not a member of.
    const { client } = makeClient({
        'conversations.history': { body: { error: 'not_in_channel', ok: false } },
    });

    await assert.rejects(client.call('conversations.history', { channel: kCHANNEL }), (error) => {
        assert.ok(error instanceof SlackApiError);
        assert.equal(error.method, 'conversations.history');
        assert.equal(error.code, 'not_in_channel');
        return true;
    });
});

test('call: a 429 waits for Retry-After seconds, logs the wait, and retries', async () => {
    // Scenario: the first history request is rate limited for 2 seconds; the second succeeds.
    const { client, calls, sleep, log } = makeClient({
        'conversations.history': [
            kRATE_LIMITED,
            historyPage([{ text: 'Fixed the deployment issue.', ts: '1759343520.000100', user: 'U01234567' }]),
        ],
    });

    const result = await client.call('conversations.history', { channel: kCHANNEL, limit: 100 });

    assert.equal(result.messages.length, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleep.mock.calls.map((call) => call.arguments), [[2000]]);
    assert.deepEqual(log.mock.calls.map((call) => call.arguments), [['Rate limited by Slack; waiting 2s...']]);
});

test('call: a 429 without Retry-After waits the one-second default', async () => {
    // Scenario: Slack rate limits without saying for how long.
    const { client, sleep } = makeClient({
        'conversations.history': [
            { body: { error: 'ratelimited', ok: false }, status: 429 },
            historyPage([]),
        ],
    });

    await client.call('conversations.history', { channel: kCHANNEL });

    assert.deepEqual(sleep.mock.calls.map((call) => call.arguments), [[1000]]);
});

test('call: five consecutive 429s fail with ratelimited after four waits', async () => {
    // Scenario: Slack never stops rate limiting; the client must give up, not spin.
    const { client, calls, sleep } = makeClient({
        'conversations.history': [kRATE_LIMITED, kRATE_LIMITED, kRATE_LIMITED, kRATE_LIMITED, kRATE_LIMITED],
    });

    await assert.rejects(client.call('conversations.history', { channel: kCHANNEL }), (error) => {
        assert.ok(error instanceof SlackApiError);
        assert.equal(error.code, 'ratelimited');
        return true;
    });
    assert.equal(calls.length, 5);
    assert.equal(sleep.mock.callCount(), 4);
});

test('call: a non-Slack HTTP failure is reported with method and status', async () => {
    // Scenario: Slack's edge returns a 500 with no JSON envelope.
    const { client } = makeClient({
        'conversations.list': { body: {}, status: 500 },
    });

    await assert.rejects(client.call('conversations.list'), (error) => {
        assert.ok(!(error instanceof SlackApiError));
        assert.equal(error.message, 'conversations.list: HTTP 500');
        return true;
    });
});

test('paginate: follows next_cursor and stops when it is empty', async () => {
    // Scenario: the channel list spans two pages of two channels each.
    const { client, calls, sleep } = makeClient({
        'conversations.list': [
            { body: { channels: [{ id: 'C01234ABC', name: 'general' }, { id: 'C02345DEF', name: 'development' }], ok: true, response_metadata: { next_cursor: 'dGVhbTpDMDM0NTZHSEk=' } } },
            { body: { channels: [{ id: 'G03456GHI', name: 'client-project' }, { id: 'C04567JKL', name: 'random' }], ok: true, response_metadata: { next_cursor: '' } } },
        ],
    });

    const pages = [];
    for await (const page of client.paginate('conversations.list', { exclude_archived: true, limit: 200 }, (body) => body.channels)) {
        pages.push(page.map((channel) => channel.name));
    }

    assert.deepEqual(pages, [['general', 'development'], ['client-project', 'random']]);
    assert.deepEqual(calls[0].args, { exclude_archived: true, limit: 200 });
    assert.deepEqual(calls[1].args, { cursor: 'dGVhbTpDMDM0NTZHSEk=', exclude_archived: true, limit: 200 });
    assert.equal(calls.length, 2);
    assert.equal(sleep.mock.callCount(), 0);
});

test('paginate: does not request the next page when the consumer stops early', async () => {
    // Scenario: a caller needs only the first page of a two-page history.
    const { client, calls } = makeClient({
        'conversations.history': [
            historyPage([{ text: 'Looking into this now.', ts: '1759264920.000300', user: 'U01234567' }], 'bmV4dA=='),
            historyPage([{ text: 'Older message.', ts: '1759178520.000400', user: 'U07654321' }]),
        ],
    });

    for await (const page of client.paginate('conversations.history', { channel: kCHANNEL, limit: 100 }, (body) => body.messages)) {
        assert.equal(page.length, 1);
        break;
    }

    assert.equal(calls.length, 1);
});
