'use strict';

process.env.TZ = 'America/New_York';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createContext, run } = require('../bin/slackctl');
const { fakeContext } = require('./helpers/context');
const { historyRoute } = require('./helpers/fake-slack');
const { capture, scriptedInput } = require('./helpers/streams');

const kAUTH        = require('./fixtures/auth-test.json');
const kPAGE_1      = require('./fixtures/channels-page-1.json');
const kPAGE_2      = require('./fixtures/channels-page-2.json');
const kDEVELOPMENT = require('./fixtures/history-development.json');

const kCHANNELS = { 'conversations.list': [{ body: kPAGE_1 }, { body: kPAGE_2 }] };

const runWith = async (argv, options) => {
    const harness  = fakeContext(options);
    const exitCode = await run(['node', 'slackctl', ...argv], harness.context);

    return { exitCode, stderr: harness.stderr.text, stdout: harness.stdout.text };
};

// Plan §5.6: the condition-to-exit-code table, row by row.

test('run: a completed command exits 0 with data on stdout and nothing on stderr', async () => {
    // Scenario: `channels` against a healthy workspace.
    const { exitCode, stdout, stderr } = await runWith(['channels'], { routes: kCHANNELS });

    assert.equal(exitCode, 0);
    assert.match(stdout, /^NAME/);
    assert.equal(stderr, '');
});

test('run: help and version exit 0', async () => {
    // Scenario: `--help` and `--version` with no token configured.
    for (const argv of [['--help'], ['--version'], ['help', 'delete']]) {
        const stdout  = capture();
        const context = createContext({ env: {}, stderr: capture(), stdin: scriptedInput([]), stdout });

        assert.equal(await run(['node', 'slackctl', ...argv], context), 0, argv.join(' '));
        assert.notEqual(stdout.text, '');
    }
});

test('run: a usage error exits 2 with commander\'s message on stderr and nothing on stdout', async () => {
    // Scenario: a missing argument, an invalid option value, and conflicting options.
    for (const argv of [['messages'], ['messages', 'development', '--limit', '0'], ['delete', 'development', '--ts', '1790800920.000300', '--mine']]) {
        const { exitCode, stdout, stderr } = await runWith(argv, { routes: kCHANNELS });

        assert.equal(exitCode, 2, argv.join(' '));
        assert.match(stderr, /^error: /);
        assert.equal(stdout, '');
    }
});

test('run: a missing token exits 1 with the bare message', async () => {
    // Scenario: SLACK_ADMIN_TOKEN unset in the shell.
    const stderr  = capture();
    const context = createContext({ env: {}, stderr, stdin: scriptedInput([]), stdout: capture() });

    assert.equal(await run(['node', 'slackctl', 'channels'], context), 1);
    assert.equal(stderr.text, 'SLACK_ADMIN_TOKEN is not set.\n');
});

test('run: a domain error exits 1 with the bare message', async () => {
    // Scenario: a channel name that does not exist.
    const { exitCode, stderr } = await runWith(['messages', 'nonexistent'], { routes: kCHANNELS });

    assert.equal(exitCode, 1);
    assert.equal(stderr, 'Channel not found: nonexistent\n');
});

test('run: the non-interactive refusal exits 1 with the bare message', async () => {
    // Scenario: `delete` piped from a script without --dry-run.
    const { exitCode, stderr } = await runWith(['delete', 'development', '--limit', '1'], {
        isTTY  : false,
        routes : { ...kCHANNELS, 'conversations.history': historyRoute(kDEVELOPMENT) },
    });

    assert.equal(exitCode, 1);
    assert.equal(stderr, 'Confirmation requires an interactive terminal; use --dry-run to preview.\n');
});

test('run: a Slack error code with a known explanation exits 1 with that explanation', async () => {
    // Scenario: the token was rotated; Slack answers invalid_auth.
    const { exitCode, stderr } = await runWith(['auth'], { routes: { 'auth.test': { body: { error: 'invalid_auth', ok: false } } } });

    assert.equal(exitCode, 1);
    assert.equal(stderr, 'Slack rejected the token (invalid_auth). Check SLACK_ADMIN_TOKEN.\n');
});

test('run: an unexplained Slack error code exits 1 naming the method and code', async () => {
    // Scenario: Slack answers an error this tool has no advice for.
    const { exitCode, stderr } = await runWith(['channels'], { routes: { 'conversations.list': { body: { error: 'internal_error', ok: false } } } });

    assert.equal(exitCode, 1);
    assert.equal(stderr, 'slackctl: conversations.list failed: internal_error\n');
});

test('run: any other failure exits 1 with the prefixed message', async () => {
    // Scenario: Slack's edge returns HTTP 500 with no JSON envelope.
    const { exitCode, stderr } = await runWith(['channels'], { routes: { 'conversations.list': { body: {}, status: 500 } } });

    assert.equal(exitCode, 1);
    assert.equal(stderr, 'slackctl: conversations.list: HTTP 500\n');
});
