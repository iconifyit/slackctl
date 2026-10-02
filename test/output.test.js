'use strict';

process.env.TZ = 'America/New_York';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const output = require('../src/output');
const { capture, scriptedInput } = require('./helpers/streams');

const kMESSAGE_COLUMNS = [
    { header: 'Date', key: 'date' },
    { header: 'TS', key: 'ts' },
    { header: 'Message', key: 'message' },
];

test('table: uppercase headers, widths from the longest cell, two-space gutters, last column unpadded', () => {
    // Scenario: three of Scott's messages in #development, as the `messages` command prints them.
    const rows = [
        { date: '2026-10-01 14:32', message: 'Fixed the deployment issue.', ts: '1790879520.000100' },
        { date: '2026-10-01 12:17', message: 'PR is ready for review.', ts: '1790871420.000200' },
        { date: '2026-09-30 16:42', message: 'Looking into this now.', ts: '1790800920.000300' },
    ];

    const expected = [
        `DATE${' '.repeat(12)}  TS${' '.repeat(15)}  MESSAGE`,
        '2026-10-01 14:32  1790879520.000100  Fixed the deployment issue.',
        '2026-10-01 12:17  1790871420.000200  PR is ready for review.',
        '2026-09-30 16:42  1790800920.000300  Looking into this now.',
        '',
    ].join('\n');

    assert.equal(output.table(kMESSAGE_COLUMNS, rows), expected);
});

test('table: a header longer than every cell sets the column width', () => {
    // Scenario: the MEMBER column holds only 'yes'/'no', shorter than its header.
    const rendered = output.table([{ header: 'Member', key: 'member' }, { header: 'ID', key: 'id' }], [{ id: 'C01234ABC', member: 'yes' }]);

    assert.equal(rendered, 'MEMBER  ID\nyes     C01234ABC\n');
});

test('reservedWidth: the offset at which the column after the given ones starts', () => {
    // Scenario: DATE (16 wide) and TS (17 wide), each followed by a two-space gutter.
    const rows = [{ date: '2026-10-01 14:32', ts: '1790879520.000100' }];

    assert.equal(output.reservedWidth(kMESSAGE_COLUMNS.slice(0, 2), rows), 16 + 2 + 17 + 2);
});

test('table and keyValue: every cell and value is sanitized, so an app username cannot rewrite the screen', () => {
    // Scenario: an app posts with a custom username carrying a clear-screen sequence; the auth block shows a workspace name with a bell.
    const rows = [{ id: 'C01234ABC', user: 'Vector\x1b[2JIcons \x07Messenger' }];

    assert.equal(output.table([{ header: 'User', key: 'user' }, { header: 'ID', key: 'id' }], rows), 'USER                   ID\nVectorIcons Messenger  C01234ABC\n');
    assert.equal(output.keyValue([['Workspace', 'Vecto\x1b]0;x\x07pus']]), 'Workspace:  Vectopus\n');
});

test('keyValue: values align after the longest label', () => {
    // Scenario: the `auth` block.
    const rendered = output.keyValue([['Workspace', 'Vectopus'], ['User', 'Scott Lewis'], ['User ID', 'U01234567']]);

    assert.equal(rendered, 'Workspace:  Vectopus\nUser:       Scott Lewis\nUser ID:    U01234567\n');
});

test('formatDate: renders a Slack ts in local time', () => {
    // Scenario: 2026-10-01T18:32:00Z is 14:32 in New York (EDT).
    assert.equal(output.formatDate('1790879520.000100'), '2026-10-01 14:32');
});

test('dayRange: bounds cover one local day, upper bound one microsecond before next midnight', () => {
    // Scenario: 2026-09-30 in New York runs from 04:00Z on the 30th to 04:00Z on the 1st.
    assert.deepEqual(output.dayRange('2026-09-30'), { latest: '1790827199.999999', oldest: '1790740800.000000' });
});

test('dayRange: rejects impossible and malformed dates', () => {
    // Scenario: February has no 30th; 'yesterday' is not a date.
    assert.throws(() => output.dayRange('2026-02-30'), { message: 'Invalid date: 2026-02-30' });
    assert.throws(() => output.dayRange('yesterday'), { message: 'Invalid date: yesterday' });
});

test('oneLine: strips terminal escape sequences and control characters from untrusted text', () => {
    // Scenario: a message crafted to clear the screen and move the cursor before the operator confirms.
    const hostile = 'Deploy \x1b[2J\x1b[H\x07done\x1b]0;title\x07 \x00now\x9b31m.';

    assert.equal(output.oneLine(hostile, 80), 'Deploy done now31m.');
});

test('oneLine: truncates by code point so an emoji at the boundary is kept whole or dropped, never split', () => {
    // Scenario: a message whose 20th visible character is a surrogate-pair emoji.
    const text = 'Deploy done for all ' + '🎉' + ' teams today';

    assert.equal(output.oneLine(text, 20), 'Deploy done for all…');
    assert.equal(output.oneLine(text, 22), 'Deploy done for all 🎉…');
    assert.ok(!/[\uD800-\uDFFF]/.test(output.oneLine(text, 21).replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, '')), 'no lone surrogate');
});

test('oneLine: collapses whitespace and truncates with an ellipsis', () => {
    // Scenario: a multi-line message shown in a 20-character column.
    assert.equal(output.oneLine('Fixed the\n\n  deployment   issue.', 20), 'Fixed the deploymen…');
    assert.equal(output.oneLine('Short.', 20), 'Short.');
});

test('messageWidth: terminal width minus reserved, floored at 20; 100 when not a terminal', () => {
    // Scenario: a 120-column terminal, a 60-column terminal, and a pipe.
    assert.equal(output.messageWidth(capture({ columns: 120, isTTY: true }), 50), 70);
    assert.equal(output.messageWidth(capture({ columns: 60, isTTY: true }), 50), 20);
    assert.equal(output.messageWidth(capture({ isTTY: false }), 50), 100);
});

test('messageWidth: a terminal that reports no column count gets the minimum width', () => {
    // Scenario: a pseudo-terminal (as `expect` or `script` provide) with `columns` undefined.
    const stream = capture({ isTTY: true });
    stream.columns = undefined;

    assert.equal(output.messageWidth(stream, 50), 20);
});

test('authorOf: user, then app username, then bot_id', () => {
    // Scenario: a human post, an app post with a display name, an app post with only a bot id.
    assert.equal(output.authorOf({ text: 'Looking into this now.', user: 'U01234567' }), 'U01234567');
    assert.equal(output.authorOf({ bot_id: 'B0AAA1111', text: 'New signup: testmember1ed43567', username: 'VectorIcons Messenger' }), 'VectorIcons Messenger');
    assert.equal(output.authorOf({ bot_id: 'B0AAA1111', text: 'New signup: testmember1ed43567' }), 'B0AAA1111');
});

test('parseSelection: indices and ranges become sorted, unique, 0-based indices', () => {
    // Scenario: six candidates on screen.
    assert.deepEqual(output.parseSelection('1,3-5', 6), [0, 2, 3, 4]);
    assert.deepEqual(output.parseSelection('5, 1-2, 1', 6), [0, 1, 4]);
    assert.deepEqual(output.parseSelection('all', 6), [0, 1, 2, 3, 4, 5]);
});

test('parseSelection: rejects out-of-range, reversed, non-numeric, and empty answers naming the token', () => {
    // Scenario: six candidates on screen.
    for (const [expression, token] of [['0', '0'], ['7', '7'], ['5-3', '5-3'], ['a', 'a'], ['', "''"]]) {
        assert.throws(() => output.parseSelection(expression, 6), { message: `Invalid selection: ${token}` });
    }
});

test('confirm: only the exact word confirms', async () => {
    // Scenario: three operators answer the delete challenge differently.
    for (const [answer, expected] of [['delete', true], ['DELETE', false], ['yes', false]]) {
        const prompter = output.createPrompter({ input: scriptedInput([answer]), output: capture() });
        assert.equal(await output.confirm('delete', prompter), expected);
        prompter.close();
    }
});

test('confirm: writes the challenge to the output stream', async () => {
    // Scenario: the challenge text goes to stderr, where prompts belong.
    const err      = capture();
    const prompter = output.createPrompter({ input: scriptedInput(['delete']), output: err });

    await output.confirm('delete', prompter);
    prompter.close();

    assert.equal(err.text, "Type 'delete' to confirm: ");
});

test('pick: returns the chosen indices', async () => {
    // Scenario: four candidates; operator picks the second and fourth.
    const prompter = output.createPrompter({ input: scriptedInput(['2,4']), output: capture() });

    assert.deepEqual(await output.pick(4, prompter), [1, 3]);
    prompter.close();
});

test('pick: three bad answers abort with null, each reported to the operator', async () => {
    // Scenario: four candidates; operator answers out of range, nonsense, then zero.
    const err      = capture();
    const prompter = output.createPrompter({ input: scriptedInput(['9', 'x', '0']), output: err });

    assert.equal(await output.pick(4, prompter), null);
    prompter.close();

    assert.equal((err.text.match(/Invalid selection:/g) ?? []).length, 3);
    assert.equal((err.text.match(/Select messages to delete/g) ?? []).length, 3);
});

test('pick then confirm share one reader when both answers arrive in one chunk', async () => {
    // Scenario: the operator's two answers are delivered together, as a pipe or paste does.
    const prompter = output.createPrompter({ input: scriptedInput(['2,4', 'delete']), output: capture() });

    assert.deepEqual(await output.pick(4, prompter), [1, 3]);
    assert.equal(await output.confirm('delete', prompter), true);
    prompter.close();
});

test('prompter: an answer never comes when input ends', async () => {
    // Scenario: stdin is closed with nothing on it; the prompt must resolve, not hang.
    const prompter = output.createPrompter({ input: scriptedInput([]), output: capture() });

    assert.equal(await output.confirm('delete', prompter), false);
    prompter.close();
});
