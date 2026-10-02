'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SlackClient } = require('../src/slack');
const { AmbiguousChannelError, ChannelNotFoundError, ConversationsService } = require('../src/conversations');
const { createFakeSlack } = require('./helpers/fake-slack');

const kPAGE_1 = require('./fixtures/channels-page-1.json');
const kPAGE_2 = require('./fixtures/channels-page-2.json');

const makeService = (routes) => {
    const fake    = createFakeSlack(routes);
    const client  = new SlackClient({ fetch: fake.fetch, log: () => {}, sleep: async () => {}, token: 'xoxp-test-not-a-real-token' });

    return { calls: fake.calls, service: new ConversationsService(client) };
};

const kTWO_PAGES = { 'conversations.list': [{ body: kPAGE_1 }, { body: kPAGE_2 }] };

test('listChannels: concatenates every page, excluding archived channels on each request', async () => {
    // Scenario: the workspace has five channels across two pages.
    const { service, calls } = makeService(kTWO_PAGES);

    const channels = await service.listChannels();

    assert.deepEqual(channels.map((channel) => channel.name), ['general', 'development', 'client-project', 'random', 'signups']);
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.equal(call.args.exclude_archived, true);
        assert.equal(call.args.limit, 200);
        assert.equal(call.args.types, 'public_channel,private_channel');
    }
});

test('resolveChannel: an ID is returned as-is with no request', async () => {
    // Scenario: operator pastes the ID shown by `channels`.
    const { service, calls } = makeService({});

    assert.deepEqual(await service.resolveChannel('C02345DEF'), { id: 'C02345DEF', name: 'C02345DEF' });
    assert.equal(calls.length, 0);
});

test('resolveChannel: a name is matched across pages, with or without a leading #', async () => {
    // Scenario: `signups` lives on the second page.
    const { service } = makeService(kTWO_PAGES);
    assert.deepEqual(await service.resolveChannel('signups'), { id: 'C05678MNO', name: 'signups' });

    const withHash = makeService(kTWO_PAGES);
    assert.deepEqual(await withHash.service.resolveChannel('#development'), { id: 'C02345DEF', name: 'development' });
});

test('resolveChannel: an unknown name fails naming it', async () => {
    // Scenario: operator mistypes the channel.
    const { service } = makeService(kTWO_PAGES);

    await assert.rejects(service.resolveChannel('developmnet'), (error) => {
        assert.ok(error instanceof ChannelNotFoundError);
        assert.equal(error.message, 'Channel not found: developmnet');
        return true;
    });
});

test('resolveChannel: a name shared by two channels fails and asks for the ID', async () => {
    // Scenario: a private and a public channel are both named `random`.
    const duplicated = {
        ...kPAGE_2,
        channels: [...kPAGE_2.channels, { id: 'G09999ZZZ', is_archived: false, is_member: true, is_private: true, name: 'random' }],
    };
    const { service } = makeService({ 'conversations.list': [{ body: kPAGE_1 }, { body: duplicated }] });

    await assert.rejects(service.resolveChannel('random'), (error) => {
        assert.ok(error instanceof AmbiguousChannelError);
        assert.equal(error.message, "Channel name 'random' matches 2 channels; pass the ID");
        return true;
    });
});
