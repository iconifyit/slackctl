'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ChannelNotFoundError } = require('../src/conversations');
const { fakeContext, runCommand } = require('./helpers/context');
const { createProgram } = require('../bin/slackctl');

const kPAGE_1 = require('./fixtures/channels-page-1.json');
const kPAGE_2 = require('./fixtures/channels-page-2.json');

const routes = () => ({
    'chat.postMessage'   : { body: { channel: 'C02345DEF', ok: true, ts: '1790886000.000800' } },
    'conversations.list' : [{ body: kPAGE_1 }, { body: kPAGE_2 }],
});

test('send --dry-run: shows the resolved channel and the text without posting', async () => {
    // Scenario: operator checks where a status update will land.
    const { stdout, calls } = await runCommand(['send', 'development', 'PR is ready for review.', '--dry-run'], { routes: routes() });

    assert.equal(stdout.text, 'Dry run. Would send to #development (C02345DEF):\nPR is ready for review.\n');
    assert.ok(!calls.some((call) => call.method === 'chat.postMessage'));
});

test('send: posts to the resolved channel ID and reports the new ts', async () => {
    // Scenario: a status update to #development.
    const { stdout, calls } = await runCommand(['send', '#development', 'PR is ready for review.'], { routes: routes() });

    const post = calls.find((call) => call.method === 'chat.postMessage');
    assert.deepEqual(post.args, { channel: 'C02345DEF', text: 'PR is ready for review.' });
    assert.equal(stdout.text, 'Sent to #development (C02345DEF) at 1790886000.000800.\n');
});

test('send: an unknown channel fails before posting', async () => {
    // Scenario: a channel that does not exist in the workspace.
    const harness = fakeContext({ routes: routes() });

    await assert.rejects(
        createProgram(harness.context).parseAsync(['node', 'slackctl', 'send', 'nonexistent', 'hello']),
        (error) => error instanceof ChannelNotFoundError,
    );
    assert.ok(!harness.calls.some((call) => call.method === 'chat.postMessage'));
});

test('send: the text argument is required', async () => {
    await assert.rejects(runCommand(['send', 'development'], { routes: routes() }), (error) => error.exitCode === 2);
});
