'use strict';

process.env.TZ = 'America/New_York';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { MissingTokenError, createContext, createProgram } = require('../bin/slackctl');
const { SlackApiError } = require('../src/slack');
const { fakeContext, runCommand } = require('./helpers/context');
const { capture, scriptedInput } = require('./helpers/streams');

const kAUTH    = require('./fixtures/auth-test.json');
const kPAGE_1  = require('./fixtures/channels-page-1.json');
const kPAGE_2  = require('./fixtures/channels-page-2.json');

const kCHANNELS_ROUTE = { 'conversations.list': [{ body: kPAGE_1 }, { body: kPAGE_2 }] };

// ── auth ────────────────────────────────────────────────────────────────────

test('auth: prints workspace, user, user ID, token type, and status', async () => {
    // Scenario: a working user token for the Vectopus workspace.
    const { stdout } = await runCommand(['auth'], { routes: { 'auth.test': { body: kAUTH } } });

    assert.equal(stdout.text, [
        'Workspace:  Vectopus',
        'User:       Scott Lewis',
        'User ID:    U01234567',
        'Token:      user',
        'Status:     authenticated',
        '',
    ].join('\n'));
});

test('auth: a rejected token reports the failure and exits non-zero', async () => {
    // Scenario: the token was rotated; Slack answers invalid_auth.
    const harness = fakeContext({ routes: { 'auth.test': { body: { error: 'invalid_auth', ok: false } } } });
    const program = createProgram(harness.context);

    await assert.rejects(program.parseAsync(['node', 'slackctl', 'auth']), (error) => error instanceof SlackApiError && error.code === 'invalid_auth');
    assert.equal(harness.stdout.text, 'Token:   user\nStatus:  failed (invalid_auth)\n');
});

// ── channels ────────────────────────────────────────────────────────────────

test('channels: prints every channel sorted by name with ID, type, and membership', async () => {
    // Scenario: five channels across two pages, one private, one the user has not joined.
    const { stdout } = await runCommand(['channels'], { routes: kCHANNELS_ROUTE });

    assert.equal(stdout.text, [
        'NAME            ID         TYPE     MEMBER',
        'client-project  G03456GHI  private  yes',
        'development     C02345DEF  public   yes',
        'general         C01234ABC  public   yes',
        'random          C04567JKL  public   no',
        'signups         C05678MNO  public   yes',
        '',
    ].join('\n'));
});

// ── token and help ──────────────────────────────────────────────────────────

test('a real command with no token fails before any request', async () => {
    // Scenario: SLACK_ADMIN_TOKEN is unset in the shell.
    const stdout  = capture();
    const stderr  = capture();
    const context = createContext({ env: {}, stderr, stdin: scriptedInput([]), stdout });
    const program = createProgram(context);

    await assert.rejects(program.parseAsync(['node', 'slackctl', 'channels']), (error) => {
        assert.ok(error instanceof MissingTokenError);
        assert.equal(error.message, 'SLACK_ADMIN_TOKEN is not set.');
        return true;
    });
    assert.equal(stdout.text, '');
});

test('help works without a token and lists the commands', async () => {
    // Scenario: a new operator runs `slackctl --help` before configuring anything.
    const stdout  = capture();
    const context = createContext({ env: {}, stderr: capture(), stdin: scriptedInput([]), stdout });
    const program = createProgram(context);

    await assert.rejects(program.parseAsync(['node', 'slackctl', '--help']), (error) => error.exitCode === 0);
    assert.match(stdout.text, /Usage: slackctl/);
    assert.match(stdout.text, /\bauth\b/);
    assert.match(stdout.text, /\bchannels\b/);
});
