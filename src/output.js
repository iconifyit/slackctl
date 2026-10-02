'use strict';

/**
 * Presentation: tables, key/value blocks, dates, one-line text, and the two
 * interactive prompts. Knows how the terminal looks and behaves; knows nothing
 * about Slack beyond which message fields name an author.
 */

const readline = require('node:readline');

const kGUTTER                = '  ';
const kNON_TTY_MESSAGE_WIDTH = 100;
const kMIN_MESSAGE_WIDTH     = 20;
const kCONFIRM_ATTEMPTS      = 3;
const kELLIPSIS              = '…';
const kDATE_PATTERN          = /^(\d{4})-(\d{2})-(\d{2})$/;
const kSELECTION_RANGE       = /^(\d+)-(\d+)$/;
const kSELECTION_SINGLE      = /^\d+$/;
// ANSI CSI and OSC escape sequences, then any remaining C0/C1 control or DEL byte.
const kESCAPE_SEQUENCES      = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const kCONTROL_CHARACTERS    = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
const kMILLISECONDS_PER_SECOND = 1000;

/**
 * Remove terminal escape sequences and control characters from text that
 * came from Slack. Every rendered cell and value passes through here, so no
 * field written by another user or app can rewrite the screen before the
 * operator confirms a deletion.
 *
 * @param {string} text
 * @returns {string}
 */
const sanitizeTerminalText = (text) => text.replace(kESCAPE_SEQUENCES, '').replace(kCONTROL_CHARACTERS, '');

/**
 * A row's value for a column, as a sanitized string.
 *
 * @param {object} row
 * @param {string} key
 * @returns {string}
 */
const cellOf = (row, key) => sanitizeTerminalText(String(row[key] ?? ''));

/**
 * Width of one column as `table` will render it: the longest cell or the header.
 *
 * @param {{ key: string, header: string }} column
 * @param {object[]} rows
 * @returns {number}
 */
const columnWidth = ({ header, key }, rows) =>
    Math.max(header.length, ...rows.map((row) => cellOf(row, key).length));

/**
 * Horizontal space `table` will spend on the given columns, each followed by
 * a gutter: the offset at which the next column starts. Lets a caller size a
 * final free-text column without re-deriving the layout rule.
 *
 * @param {Array<{ key: string, header: string }>} columns - The leading columns.
 * @param {object[]} rows
 * @returns {number}
 */
const reservedWidth = (columns, rows) =>
    columns.reduce((total, column) => total + columnWidth(column, rows) + kGUTTER.length, 0);

/**
 * Render rows as a fixed-width table with uppercase headers.
 *
 * Column width is the longest cell (header included); columns are separated
 * by two spaces; the last column is not padded. Ends with a newline. Every
 * cell is sanitized for the terminal.
 *
 * @param {Array<{ key: string, header: string }>} columns - Column order, row key, and header text.
 * @param {object[]} rows - Objects holding a value per column key.
 * @returns {string} The rendered table.
 */
const table = (columns, rows) => {
    const widths = columns.map((column) => columnWidth(column, rows));

    const renderLine = (cells) => cells
        .map((cell, index) => (index === cells.length - 1 ? cell : cell.padEnd(widths[index])))
        .join(kGUTTER);

    const lines = [
        renderLine(columns.map(({ header }) => header.toUpperCase())),
        ...rows.map((row) => renderLine(columns.map(({ key }) => cellOf(row, key)))),
    ];

    return `${lines.join('\n')}\n`;
};

/**
 * Render label/value pairs with the values aligned in one column. Values are
 * sanitized for the terminal.
 *
 * @param {Array<[string, string]>} pairs - Label and value, in display order.
 * @returns {string} The rendered block, ending with a newline.
 *
 * @example
 * keyValue([['Workspace', 'Vectopus'], ['User', 'Scott Lewis']]);
 * // 'Workspace:  Vectopus\nUser:       Scott Lewis\n'
 */
const keyValue = (pairs) => {
    const labelWidth = Math.max(...pairs.map(([label]) => label.length)) + 1;

    return pairs
        .map(([label, value]) => `${`${label}:`.padEnd(labelWidth)}${kGUTTER}${sanitizeTerminalText(String(value))}\n`)
        .join('');
};

const pad2 = (value) => String(value).padStart(2, '0');

/**
 * Render a Slack `ts` as a local-time `YYYY-MM-DD HH:mm`.
 *
 * @param {string} ts - Slack timestamp, seconds with a fractional part.
 * @returns {string}
 */
const formatDate = (ts) => {
    const date = new Date(Number(ts) * kMILLISECONDS_PER_SECOND);

    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} `
        + `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

/**
 * Slack `ts` bounds covering one local calendar day.
 *
 * `oldest` is local midnight at the start of the day; `latest` is one
 * microsecond before local midnight of the next day, so the upper bound is
 * exclusive at Slack's precision while `inclusive: true` is sent.
 *
 * @param {string} date - `YYYY-MM-DD`.
 * @returns {{ oldest: string, latest: string }}
 * @throws {Error} `Invalid date: <date>` when the value is not a real calendar date.
 */
const dayRange = (date) => {
    const match = kDATE_PATTERN.exec(date);

    if (!match) {
        throw new Error(`Invalid date: ${date}`);
    }

    const [year, month, day] = match.slice(1).map(Number);
    const start = new Date(year, month - 1, day);
    const isRealDate = start.getFullYear() === year && start.getMonth() === month - 1 && start.getDate() === day;

    if (!isRealDate) {
        throw new Error(`Invalid date: ${date}`);
    }

    const end           = new Date(year, month - 1, day + 1);
    const startSeconds  = Math.floor(start.getTime() / kMILLISECONDS_PER_SECOND);
    const endSeconds    = Math.floor(end.getTime() / kMILLISECONDS_PER_SECOND);

    return {
        latest : `${endSeconds - 1}.999999`,
        oldest : `${startSeconds}.000000`,
    };
};

/**
 * Collapse whitespace to single spaces and truncate with an ellipsis.
 *
 * Terminal control sequences and control characters are removed first:
 * message text is written by other users and apps, and an escape sequence
 * in a preview could clear or rewrite the screen right before the operator
 * confirms a deletion.
 *
 * @param {string} text - Raw message text.
 * @param {number} maxWidth - Maximum length of the result.
 * @returns {string}
 */
const oneLine = (text, maxWidth) => {
    const collapsed = sanitizeTerminalText(text).replace(/\s+/g, ' ').trim();

    // Truncate by code point, not UTF-16 unit, so an emoji is never split into a lone surrogate.
    const codePoints = Array.from(collapsed);

    if (codePoints.length <= maxWidth) {
        return collapsed;
    }

    return `${codePoints.slice(0, maxWidth - kELLIPSIS.length).join('')}${kELLIPSIS}`;
};

/**
 * Width available for the MESSAGE column.
 *
 * @param {NodeJS.WriteStream} stream - Usually stdout.
 * @param {number} reservedWidth - Width taken by the other columns and gutters.
 * @returns {number}
 */
const messageWidth = (stream, reservedWidth) => {
    if (!stream.isTTY) {
        return kNON_TTY_MESSAGE_WIDTH;
    }

    // A pseudo-terminal may report no column count; treat that as narrow rather than NaN.
    return Math.max(kMIN_MESSAGE_WIDTH, (stream.columns ?? 0) - reservedWidth);
};

/**
 * Display name for a message's author. App-posted messages carry no `user`.
 *
 * @param {{ user?: string, username?: string, bot_id?: string }} message
 * @returns {string}
 */
const authorOf = (message) => message.user ?? message.username ?? message.bot_id ?? 'unknown';

/**
 * @param {NodeJS.ReadStream} stream - Usually stdin.
 * @returns {boolean} Whether the stream is a terminal.
 */
const isInteractive = (stream) => Boolean(stream.isTTY);

/**
 * Parse a pick expression into 0-based indices.
 *
 * Grammar: comma-separated 1-based indices and inclusive ranges (`1,3-5`), or
 * the word `all`. Result is ascending and without duplicates.
 *
 * @param {string} expression - The operator's answer.
 * @param {number} count - Number of candidates on offer.
 * @returns {number[]}
 * @throws {Error} `Invalid selection: <token>` naming the first bad token.
 */
const parseSelection = (expression, count) => {
    const trimmed = expression.trim();

    if (trimmed === 'all') {
        return Array.from({ length: count }, (_, index) => index);
    }

    if (trimmed === '') {
        throw new Error("Invalid selection: ''");
    }

    const indices = new Set();

    for (const token of trimmed.split(',')) {
        const part  = token.trim();
        const range = kSELECTION_RANGE.exec(part);

        if (range) {
            const [from, to] = range.slice(1).map(Number);

            if (from < 1 || to > count || from > to) {
                throw new Error(`Invalid selection: ${part}`);
            }

            for (let index = from; index <= to; index += 1) {
                indices.add(index - 1);
            }
        }
        else if (kSELECTION_SINGLE.test(part)) {
            const index = Number(part);

            if (index < 1 || index > count) {
                throw new Error(`Invalid selection: ${part}`);
            }

            indices.add(index - 1);
        }
        else {
            throw new Error(`Invalid selection: ${part}`);
        }
    }

    return [...indices].sort((left, right) => left - right);
};

/**
 * One line reader over `input` for the life of a command.
 *
 * A single reader is used for every prompt in a run because a second reader
 * opened on the same stream would miss lines that the first already consumed
 * from a shared chunk. Call `close()` when the command is done so the process
 * can exit.
 *
 * @param {{ input: NodeJS.ReadableStream, output: NodeJS.WritableStream }} io
 * @returns {{ ask: (prompt: string) => Promise<string>, write: (text: string) => void, close: () => void }}
 */
const createPrompter = ({ input, output }) => {
    const reader  = readline.createInterface({ input, terminal: false });
    const pending = [];
    const waiters = [];
    let   closed  = false;

    reader.on('line', (line) => {
        const waiter = waiters.shift();

        if (waiter) {
            waiter(line);
            return;
        }

        pending.push(line);
    });

    reader.on('close', () => {
        closed = true;
        waiters.splice(0).forEach((waiter) => waiter(''));
    });

    const ask = (prompt) => {
        output.write(prompt);

        if (pending.length > 0) {
            return Promise.resolve(pending.shift());
        }

        if (closed) {
            return Promise.resolve('');
        }

        return new Promise((resolve) => waiters.push(resolve));
    };

    return {
        ask,
        close : () => reader.close(),
        write : (text) => output.write(text),
    };
};

/**
 * Typed-word challenge. Resolves true only when the operator types the exact word.
 *
 * @param {string} expectedWord - The word that confirms.
 * @param {{ ask: Function }} prompter - From `createPrompter`.
 * @returns {Promise<boolean>}
 */
const confirm = async (expectedWord, prompter) => {
    const answer = await prompter.ask(`Type '${expectedWord}' to confirm: `);

    return answer.trim() === expectedWord;
};

/**
 * Numbered-selection prompt. Re-prompts on a bad answer, up to three times.
 *
 * @param {number} count - Number of candidates shown.
 * @param {{ ask: Function, write: Function }} prompter - From `createPrompter`.
 * @returns {Promise<number[] | null>} 0-based indices, or null after three bad answers.
 */
const pick = async (count, prompter) => {
    for (let attempt = 1; attempt <= kCONFIRM_ATTEMPTS; attempt += 1) {
        const answer = await prompter.ask('Select messages to delete (e.g. 1,3-5 or all): ');

        try {
            return parseSelection(answer, count);
        }
        catch (error) {
            prompter.write(`${error.message}\n`);
        }
    }

    return null;
};

module.exports = {
    authorOf,
    confirm,
    createPrompter,
    dayRange,
    formatDate,
    isInteractive,
    keyValue,
    messageWidth,
    oneLine,
    parseSelection,
    pick,
    reservedWidth,
    sanitizeTerminalText,
    table,
};
