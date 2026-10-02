'use strict';

process.env.TZ = 'America/New_York';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { runCommand } = require('./helpers/context');
const { historyRoute } = require('./helpers/fake-slack');

const kAUTH        = require('./fixtures/auth-test.json');
const kPAGE_1      = require('./fixtures/channels-page-1.json');
const kPAGE_2      = require('./fixtures/channels-page-2.json');
const kDEVELOPMENT = require('./fixtures/history-development.json');
const kSIGNUPS     = require('./fixtures/history-signups.json');

const routes = (history) => ({
    'auth.test'             : { body: kAUTH },
    'conversations.history' : historyRoute(history),
    'conversations.list'    : [{ body: kPAGE_1 }, { body: kPAGE_2 }],
});

const usageError = (error) => error.exitCode === 2;

test('messages --mine --limit 3: resolves the name and lists three of the caller\'s messages', async () => {
    // Scenario: Scott wants his three latest posts in #development.
    const { stdout, calls } = await runCommand(['messages', 'development', '--mine', '--limit', '3'], { routes: routes(kDEVELOPMENT) });

    assert.equal(stdout.text, [
        'DATE              TS                 USER       MESSAGE',
        '2026-10-01 14:32  1790879520.000100  U01234567  Fixed the deployment issue.',
        '2026-10-01 12:17  1790871420.000200  U01234567  PR is ready for review.',
        '2026-09-30 16:42  1790800920.000300  U01234567  Looking into this now.',
        '',
    ].join('\n'));
    assert.ok(calls.some((call) => call.method === 'auth.test'), 'the caller\'s ID comes from auth.test');
    assert.equal(calls.find((call) => call.method === 'conversations.history').args.channel, 'C02345DEF');
});

test('messages --limit 3: lists the newest three from any author with the USER column', async () => {
    // Scenario: the latest activity in #development, whoever posted it.
    const { stdout, calls } = await runCommand(['messages', 'C02345DEF', '--limit', '3'], { routes: routes(kDEVELOPMENT) });

    assert.deepEqual(stdout.text.trim().split('\n').slice(1).map((line) => line.split(/\s{2,}/)[2]), ['U01234567', 'U07654321', 'U01234567']);
    assert.ok(!calls.some((call) => call.method === 'auth.test'), 'no auth.test without --mine');
    assert.ok(!calls.some((call) => call.method === 'conversations.list'), 'an ID needs no channel lookup');
});

test('messages --date --pattern: lists only that local day\'s matching app posts, author shown as the app name', async () => {
    // Scenario: the signups cleanup query from the task, for 2026-09-30.
    const { stdout, calls } = await runCommand(
        ['messages', 'signups', '--date', '2026-09-30', '--pattern', '/testmember[0-9]+/'],
        { routes: routes(kSIGNUPS) },
    );

    const lines = stdout.text.trim().split('\n');
    assert.equal(lines.length, 3, 'header plus two matches');
    assert.match(lines[1], /^2026-09-30 \d\d:\d\d  1790799000\.000003  VectorIcons Messenger  New signup: testmember1ed43567/);
    assert.match(lines[2], /^2026-09-30 \d\d:\d\d  1790770200\.000001  VectorIcons Messenger  New signup: testmember7ab10c22/);

    const history = calls.find((call) => call.method === 'conversations.history').args;
    assert.deepEqual(history, { channel: 'C05678MNO', inclusive: true, latest: '1790827199.999999', limit: 100, oldest: '1790740800.000000' });
});

test('messages: multi-line text is shown on one line', async () => {
    // Scenario: Dana's two-line message about the red build.
    const { stdout } = await runCommand(['messages', 'development', '--pattern', 'CI log'], { routes: routes(kDEVELOPMENT) });

    assert.match(stdout.text, /Build is red on develop\. See the CI log\.$/m);
});

test('messages: nothing matching prints a notice, not an empty table', async () => {
    // Scenario: a pattern no message contains.
    const { stdout } = await runCommand(['messages', 'development', '--pattern', 'kubernetes'], { routes: routes(kDEVELOPMENT) });

    assert.equal(stdout.text, 'No messages matched.\n');
});

test('messages: bad option values are usage errors', async () => {
    // Scenario: zero limit, an unparsable pattern, an impossible date, a malformed ts, a reversed range, date with a bound.
    const cases = [
        ['--limit', '0'],
        ['--pattern', '/[/'],
        ['--date', '2026-02-30'],
        ['--ts-from', 'yesterday'],
        ['--ts-from', '1790879520.000100', '--ts-to', '1790800920.000300'],
        ['--date', '2026-09-30', '--ts-from', '1790800920.000300'],
    ];

    for (const extra of cases) {
        await assert.rejects(runCommand(['messages', 'development', ...extra], { routes: routes(kDEVELOPMENT) }), usageError, extra.join(' '));
    }
});
