'use strict';

process.env.TZ = 'America/New_York';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SlackApiError } = require('../src/slack');
const { MessageNotFoundError } = require('../src/messages');
const { runCommand } = require('./helpers/context');
const { historyRoute } = require('./helpers/fake-slack');

const kAUTH        = require('./fixtures/auth-test.json');
const kPAGE_1      = require('./fixtures/channels-page-1.json');
const kPAGE_2      = require('./fixtures/channels-page-2.json');
const kDEVELOPMENT = require('./fixtures/history-development.json');
const kSIGNUPS     = require('./fixtures/history-signups.json');

const kOK_DELETE = { body: { ok: true } };

const routes = (history, chatDelete = kOK_DELETE) => ({
    'auth.test'             : { body: kAUTH },
    'chat.delete'           : chatDelete,
    'conversations.history' : historyRoute(history),
    'conversations.list'    : [{ body: kPAGE_1 }, { body: kPAGE_2 }],
});

const deletedTs = (calls) => calls.filter((call) => call.method === 'chat.delete').map((call) => call.args.ts);
const usageError = (error) => error.exitCode === 2;

const kNEWEST_THREE = ['1790879520.000100', '1790875200.000500', '1790871420.000200'];

// ── preview, dry run, confirmation ──────────────────────────────────────────

test('delete --dry-run: previews the candidates and deletes nothing', async () => {
    // Scenario: operator checks what `--limit 3` would remove from #development.
    const { stdout, calls } = await runCommand(['delete', 'development', '--limit', '3', '--dry-run'], { routes: routes(kDEVELOPMENT) });

    assert.match(stdout.text, /^The following messages will be deleted:\n\nDATE {14}TS {17}USER {7}MESSAGE\n/);
    assert.equal(stdout.text.trim().split('\n').length, 3 + 3 + 1, 'intro, blank, header, three rows, dry-run line');
    assert.match(stdout.text, /Dry run\. Nothing deleted\.\n$/);
    assert.deepEqual(deletedTs(calls), []);
});

test('delete: typing delete removes the candidates newest first and reports success', async () => {
    // Scenario: the three newest messages in #development, confirmed.
    const { stdout, stderr, calls } = await runCommand(['delete', 'development', '--limit', '3'], { routes: routes(kDEVELOPMENT), stdinLines: ['delete'] });

    assert.deepEqual(deletedTs(calls), kNEWEST_THREE);
    assert.match(stderr.text, /Type 'delete' to confirm: /);
    assert.match(stderr.text, /Deleted 1\/3: 1790879520\.000100\n.*Deleted 2\/3.*\n.*Deleted 3\/3/s);
    assert.match(stdout.text, /Deletion successful\. 3 messages deleted\.\n$/);
});

test('delete: stops at the first failure and reports how far it got', async () => {
    // Scenario: the second message belongs to Dana and the token may not delete it.
    const chatDelete = [kOK_DELETE, { body: { error: 'cant_delete_message', ok: false } }, kOK_DELETE];
    let harness;

    await assert.rejects(
        runCommand(['delete', 'development', '--limit', '3'], { routes: routes(kDEVELOPMENT, chatDelete), stdinLines: ['delete'] }).then((result) => { harness = result; }),
        (error) => error instanceof SlackApiError && error.code === 'cant_delete_message',
    );
    // The harness is not returned on rejection; re-run with the same inputs to inspect streams and calls.
    const probe = { routes: routes(kDEVELOPMENT, chatDelete), stdinLines: ['delete'] };
    const { fakeContext } = require('./helpers/context');
    const { createProgram } = require('../bin/slackctl');
    harness = fakeContext(probe);
    await assert.rejects(createProgram(harness.context).parseAsync(['node', 'slackctl', 'delete', 'development', '--limit', '3']));

    assert.deepEqual(deletedTs(harness.calls), kNEWEST_THREE.slice(0, 2), 'the third delete is never attempted');
    assert.match(harness.stderr.text, /Deleted 1 of 3\. Failed on 1790875200\.000500: cant_delete_message\n/);
    assert.doesNotMatch(harness.stdout.text, /Deletion successful/);
});

test('delete: any answer but the exact word aborts with nothing deleted', async () => {
    // Scenario: operator types "yes".
    const { stdout, calls } = await runCommand(['delete', 'development', '--limit', '3'], { routes: routes(kDEVELOPMENT), stdinLines: ['yes'] });

    assert.match(stdout.text, /Aborted\. Nothing deleted\.\n$/);
    assert.deepEqual(deletedTs(calls), []);
});

test('delete: refuses to confirm when stdin is not a terminal', async () => {
    // Scenario: `echo delete | slackctl delete ...` from a script.
    await assert.rejects(
        runCommand(['delete', 'development', '--limit', '3'], { isTTY: false, routes: routes(kDEVELOPMENT), stdinLines: ['delete'] }),
        { message: 'Confirmation requires an interactive terminal; use --dry-run to preview.' },
    );
});

test('delete --dry-run: works without a terminal', async () => {
    // Scenario: a cron job previews what would be deleted.
    const { stdout } = await runCommand(['delete', 'development', '--limit', '3', '--dry-run'], { isTTY: false, routes: routes(kDEVELOPMENT) });

    assert.match(stdout.text, /Dry run\. Nothing deleted\./);
});

test('delete: nothing matching prints a notice and asks nothing', async () => {
    const { stdout, stderr } = await runCommand(['delete', 'development', '--pattern', 'kubernetes'], { routes: routes(kDEVELOPMENT) });

    assert.equal(stdout.text, 'No messages matched.\n');
    assert.equal(stderr.text, '');
});

// ── --ts ────────────────────────────────────────────────────────────────────

test('delete --ts: previews exactly the given messages and deletes them in the given order', async () => {
    // Scenario: two timestamps pasted from the `messages` table, oldest first.
    const tsList = ['1790800920.000300', '1790871420.000200'];
    const { stdout, calls } = await runCommand(['delete', 'development', '--ts', ...tsList], { routes: routes(kDEVELOPMENT), stdinLines: ['delete'] });

    assert.equal(stdout.text.trim().split('\n').length, 3 + 2 + 2, 'intro, blank, header, two rows, blank, success');
    assert.deepEqual(deletedTs(calls), tsList);
});

test('delete --ts: one unknown timestamp fails before anything is deleted', async () => {
    // Scenario: a typo in the second timestamp.
    const { fakeContext } = require('./helpers/context');
    const { createProgram } = require('../bin/slackctl');
    const harness = fakeContext({ routes: routes(kDEVELOPMENT), stdinLines: ['delete'] });

    await assert.rejects(
        createProgram(harness.context).parseAsync(['node', 'slackctl', 'delete', 'development', '--ts', '1790800920.000300', '1790800921.000999']),
        (error) => error instanceof MessageNotFoundError && error.message === 'Message not found: 1790800921.000999',
    );
    assert.deepEqual(deletedTs(harness.calls), []);
    assert.equal(harness.stdout.text, '');
});

test('delete --ts: a repeated timestamp is a usage error, so one message is never deleted twice', async () => {
    // Scenario: the same ts pasted twice.
    await assert.rejects(runCommand(['delete', 'development', '--ts', '1790800920.000300', '1790800920.000300'], { routes: routes(kDEVELOPMENT) }), usageError);
});

test('delete --ts: cannot be combined with other selectors', async () => {
    for (const extra of [['--limit', '5'], ['--mine'], ['--pattern', 'x'], ['--date', '2026-09-30'], ['--ts-from', '1790800920.000300'], ['--select']]) {
        await assert.rejects(runCommand(['delete', 'development', '--ts', '1790800920.000300', ...extra], { routes: routes(kDEVELOPMENT) }), usageError, extra.join(' '));
    }
});

// ── range and date ──────────────────────────────────────────────────────────

test('delete --ts-from --ts-to: previews every message in the inclusive range and no others', async () => {
    // Scenario: the middle four messages in #development.
    const { stdout, calls } = await runCommand(
        ['delete', 'development', '--ts-from', '1790797200.000700', '--ts-to', '1790871420.000200', '--dry-run'],
        { routes: routes(kDEVELOPMENT) },
    );

    const rows = stdout.text.trim().split('\n').slice(3, -1);
    assert.deepEqual(rows.map((row) => row.split(/\s{2,}/)[1]), ['1790871420.000200', '1790868000.000600', '1790800920.000300', '1790797200.000700']);
    const history = calls.find((call) => call.method === 'conversations.history').args;
    assert.equal(history.inclusive, true);
    assert.equal(history.oldest, '1790797200.000700');
    assert.equal(history.latest, '1790871420.000200');
});

test('delete: reversed range and date combined with a bound are usage errors', async () => {
    await assert.rejects(runCommand(['delete', 'development', '--ts-from', '1790871420.000200', '--ts-to', '1790797200.000700'], { routes: routes(kDEVELOPMENT) }), usageError);
    await assert.rejects(runCommand(['delete', 'development', '--date', '2026-09-30', '--ts-from', '1790797200.000700'], { routes: routes(kDEVELOPMENT) }), usageError);
});

test('delete --date --pattern: the signups cleanup previews only that day\'s matching notices with the app as author', async () => {
    // Scenario: the motivating invocation from the task.
    const { stdout, calls } = await runCommand(
        ['delete', 'signups', '--date', '2026-09-30', '--pattern', '/testmember[0-9]+/', '--dry-run'],
        { routes: routes(kSIGNUPS) },
    );

    const rows = stdout.text.trim().split('\n').slice(3, -1);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.includes('VectorIcons Messenger') && /testmember[0-9]+/.test(row)));
    assert.ok(!stdout.text.includes('testadmin') && !stdout.text.includes('testcontributor') && !stdout.text.includes('9f00e1aa'));
    assert.deepEqual(deletedTs(calls), []);
});

// ── --select ────────────────────────────────────────────────────────────────

test('delete --select: deletes exactly the picked candidates after a second preview and confirmation', async () => {
    // Scenario: four candidates numbered on screen; operator picks 2 and 4, then types delete.
    const { stdout, calls } = await runCommand(
        ['delete', 'development', '--limit', '4', '--select'],
        { routes: routes(kDEVELOPMENT), stdinLines: ['2,4', 'delete'] },
    );

    assert.match(stdout.text, /\n#  DATE/);
    assert.match(stdout.text, /\nSelected:\n\nDATE/);
    assert.deepEqual(deletedTs(calls), ['1790875200.000500', '1790868000.000600']);
    assert.match(stdout.text, /Deletion successful\. 2 messages deleted\./);
});

test('delete --select: three bad answers abort with nothing deleted', async () => {
    const { stdout, calls } = await runCommand(['delete', 'development', '--limit', '4', '--select'], { routes: routes(kDEVELOPMENT), stdinLines: ['9', '9', '9'] });

    assert.match(stdout.text, /Aborted\. Nothing deleted\.\n$/);
    assert.deepEqual(deletedTs(calls), []);
});

test('delete --select --dry-run: picks, shows the selection, and exits without asking for confirmation', async () => {
    const { stdout, stderr, calls } = await runCommand(['delete', 'development', '--limit', '4', '--select', '--dry-run'], { routes: routes(kDEVELOPMENT), stdinLines: ['1'] });

    assert.match(stdout.text, /Selected:\n\nDATE[^\n]*\n[^\n]*1790879520\.000100[^\n]*\nDry run\. Nothing deleted\.\n$/);
    assert.doesNotMatch(stderr.text, /Type 'delete'/);
    assert.deepEqual(deletedTs(calls), []);
});

test('delete --select: requires a terminal even with --dry-run', async () => {
    await assert.rejects(
        runCommand(['delete', 'development', '--limit', '4', '--select', '--dry-run'], { isTTY: false, routes: routes(kDEVELOPMENT), stdinLines: ['1'] }),
        { message: 'Confirmation requires an interactive terminal; use --dry-run to preview.' },
    );
});
