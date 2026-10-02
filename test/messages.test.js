'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SlackApiError, SlackClient } = require('../src/slack');
const { MessageNotFoundError, MessagesService, parsePattern } = require('../src/messages');
const { createFakeSlack, historyRoute } = require('./helpers/fake-slack');

const kDEVELOPMENT = require('./fixtures/history-development.json');
const kSIGNUPS     = require('./fixtures/history-signups.json');

const kCHANNEL = 'C02345DEF';
const kSCOTT   = 'U01234567';

const makeService = (routes) => {
    const fake   = createFakeSlack(routes);
    const client = new SlackClient({ fetch: fake.fetch, log: () => {}, sleep: async () => {}, token: 'xoxp-test-not-a-real-token' });

    return { calls: fake.calls, service: new MessagesService(client) };
};

const texts = (messages) => messages.map((message) => message.text);

test('fetchMessages: author filter stops paging once the limit is met, never returning a fourth', async () => {
    // Scenario: Scott's messages alternate with Dana's; pages hold two; three of Scott's are wanted.
    const { service, calls } = makeService({ 'conversations.history': historyRoute(kDEVELOPMENT, { maxPageSize: 2 }) });

    const found = await service.fetchMessages({ channel: kCHANNEL, limit: 3, userId: kSCOTT });

    assert.deepEqual(texts(found), ['Fixed the deployment issue.', 'PR is ready for review.', 'Looking into this now.']);
    assert.ok(found.every((message) => message.user === kSCOTT));
    assert.equal(calls.length, 3, 'three pages satisfy the limit; the fourth page is never requested');
});

test('fetchMessages: without filters returns the newest `limit` messages regardless of author', async () => {
    // Scenario: the three most recent messages in #development, two by Scott and one by Dana.
    const { service, calls } = makeService({ 'conversations.history': historyRoute(kDEVELOPMENT) });

    const found = await service.fetchMessages({ channel: kCHANNEL, limit: 3 });

    assert.deepEqual(texts(found), ['Fixed the deployment issue.', 'Can you look at the staging deploy?', 'PR is ready for review.']);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, { channel: kCHANNEL, limit: 100 });
});

test('fetchMessages: bounds are sent inclusive on every page and every message in range is returned when unlimited', async () => {
    // Scenario: a ts range covering the middle four messages, fetched two per page.
    const oldest = '1790797200.000700';
    const latest = '1790871420.000200';
    const { service, calls } = makeService({ 'conversations.history': historyRoute(kDEVELOPMENT, { maxPageSize: 2 }) });

    const found = await service.fetchMessages({ channel: kCHANNEL, latest, oldest });

    assert.deepEqual(found.map((message) => message.ts), ['1790871420.000200', '1790868000.000600', '1790800920.000300', '1790797200.000700']);
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.equal(call.args.oldest, oldest);
        assert.equal(call.args.latest, latest);
        assert.equal(call.args.inclusive, true);
    }
});

test('fetchMessages: a pattern keeps only matching text and the limit counts matches', async () => {
    // Scenario: eleven app-posted signup notices; only `testmember` followed by a digit is wanted.
    const pattern = parsePattern('/testmember[0-9]+/');
    const { service } = makeService({ 'conversations.history': historyRoute(kSIGNUPS) });

    const all = await service.fetchMessages({ channel: 'C05678MNO', pattern });
    assert.deepEqual(all.map((message) => message.text.slice(12, 30)), ['testmember9f00e1aa', 'testmember1ed43567', 'testmember7ab10c22']);

    const capped = await service.fetchMessages({ channel: 'C05678MNO', limit: 2, pattern });
    assert.equal(capped.length, 2);
});

test('fetchMessages: author and pattern filters are both required', async () => {
    // Scenario: messages mentioning deploys; Dana's question must not appear in Scott's results.
    const { service } = makeService({ 'conversations.history': historyRoute(kDEVELOPMENT) });

    const found = await service.fetchMessages({ channel: kCHANNEL, pattern: parsePattern('/deploy/i'), userId: kSCOTT });

    assert.deepEqual(texts(found), ['Fixed the deployment issue.', 'Deploying 1.4.2 to staging.']);
});

test('parsePattern: slash form carries flags, bare form has none, stateful flags are dropped', () => {
    // Scenario: the three ways an operator may type the same pattern.
    const withFlag = parsePattern('/testmember[0-9]+/i');
    assert.equal(withFlag.source, 'testmember[0-9]+');
    assert.equal(withFlag.flags, 'i');

    const bare = parsePattern('testmember[0-9]+');
    assert.equal(bare.source, 'testmember[0-9]+');
    assert.equal(bare.flags, '');

    assert.equal(parsePattern('/signup/gi').flags, 'i');
});

test('parsePattern: a body that does not compile is a usage error naming the reason', () => {
    assert.throws(() => parsePattern('/[/'), { message: /^Invalid pattern: / });
});

test('fetchMessagesByTs: returns messages in the order given, each fetched by exact ts', async () => {
    // Scenario: operator pastes two timestamps from the `messages` table, oldest first.
    const { service, calls } = makeService({ 'conversations.history': historyRoute(kDEVELOPMENT) });

    const found = await service.fetchMessagesByTs({ channel: kCHANNEL, tsList: ['1790800920.000300', '1790871420.000200'] });

    assert.deepEqual(texts(found), ['Looking into this now.', 'PR is ready for review.']);
    assert.deepEqual(calls[0].args, { channel: kCHANNEL, inclusive: true, latest: '1790800920.000300', limit: 1, oldest: '1790800920.000300' });
    assert.deepEqual(calls[1].args, { channel: kCHANNEL, inclusive: true, latest: '1790871420.000200', limit: 1, oldest: '1790871420.000200' });
});

test('fetchMessagesByTs: a missing ts fails naming it, with no partial result', async () => {
    // Scenario: the second timestamp belongs to a thread reply, which history does not return.
    const { service } = makeService({ 'conversations.history': historyRoute(kDEVELOPMENT) });

    await assert.rejects(
        service.fetchMessagesByTs({ channel: kCHANNEL, tsList: ['1790800920.000300', '1790800921.000999'] }),
        (error) => {
            assert.ok(error instanceof MessageNotFoundError);
            assert.equal(error.message, 'Message not found: 1790800921.000999');
            return true;
        },
    );
});

test('deleteMessage: Slack refusing the deletion propagates as SlackApiError', async () => {
    // Scenario: the token's user may not delete Dana's message.
    const { service, calls } = makeService({ 'chat.delete': { body: { error: 'cant_delete_message', ok: false } } });

    await assert.rejects(service.deleteMessage({ channel: kCHANNEL, ts: '1790875200.000500' }), (error) => {
        assert.ok(error instanceof SlackApiError);
        assert.equal(error.code, 'cant_delete_message');
        return true;
    });
    assert.deepEqual(calls[0].args, { channel: kCHANNEL, ts: '1790875200.000500' });
});

test('postMessage: sends channel and text and returns the new ts', async () => {
    // Scenario: a status update posted to #development.
    const { service, calls } = makeService({ 'chat.postMessage': { body: { channel: kCHANNEL, ok: true, ts: '1790886000.000800' } } });

    const result = await service.postMessage({ channel: kCHANNEL, text: 'Deploy complete.' });

    assert.deepEqual(result, { ts: '1790886000.000800' });
    assert.deepEqual(calls[0].args, { channel: kCHANNEL, text: 'Deploy complete.' });
});
