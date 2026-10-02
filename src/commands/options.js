'use strict';

/**
 * Option and argument definitions shared by the message commands, so that
 * `messages` and `delete` cannot drift apart in what their options mean.
 * Every parser throws commander's InvalidArgumentError, which commander turns
 * into a usage error (exit 2).
 */

const { Argument, InvalidArgumentError, Option } = require('commander');

const { parsePattern } = require('../messages');
const { dayRange } = require('../output');

const kTS_PATTERN    = /^\d+\.\d{6}$/;
const kDEFAULT_LIMIT = 20;

/**
 * @param {string} value - Raw option value.
 * @returns {number}
 * @throws {InvalidArgumentError}
 */
const parsePositiveInteger = (value) => {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new InvalidArgumentError('must be a positive integer');
    }

    return parsed;
};

/**
 * @param {string} value - Raw option value.
 * @returns {string} The same value, validated as a Slack `ts`.
 * @throws {InvalidArgumentError}
 */
const parseTs = (value) => {
    if (!kTS_PATTERN.test(value)) {
        throw new InvalidArgumentError('must be a Slack timestamp such as 1790879520.000100');
    }

    return value;
};

/**
 * Accumulator for the variadic `--ts` option.
 *
 * @param {string} value - One raw value.
 * @param {string[]} [previous] - Values parsed so far.
 * @returns {string[]}
 */
const collectTs = (value, previous = []) => {
    const ts = parseTs(value);

    if (previous.includes(ts)) {
        throw new InvalidArgumentError(`duplicate timestamp ${ts}`);
    }

    return [...previous, ts];
};

/**
 * @param {string} value - `YYYY-MM-DD`.
 * @returns {{ oldest: string, latest: string }}
 * @throws {InvalidArgumentError}
 */
const parseDate = (value) => {
    try {
        return dayRange(value);
    }
    catch (error) {
        throw new InvalidArgumentError(error.message);
    }
};

/**
 * @param {string} value - Regular expression, `/body/flags` or bare body.
 * @returns {RegExp}
 * @throws {InvalidArgumentError}
 */
const parsePatternOption = (value) => {
    try {
        return parsePattern(value);
    }
    catch (error) {
        throw new InvalidArgumentError(error.message);
    }
};

/** @returns {Argument} The `<channel>` argument shared by every channel command. */
const channelArgument = () => new Argument('<channel>', 'channel name or ID (see `slackctl channels`)');

/** @returns {Option} `--limit <n>`, a positive integer with no commander default (see `effectiveLimit`). */
const limitOption = () => new Option('--limit <n>', `maximum messages (default ${kDEFAULT_LIMIT}; no default inside a range or date)`).argParser(parsePositiveInteger);

/** @returns {Option} `--mine`, restricting a query to the authenticated user's messages. */
const mineOption = () => new Option('--mine', 'only messages posted by the authenticated user');

/** @returns {Option} `--pattern <regex>`, parsed into a `RegExp`. */
const patternOption = () => new Option('--pattern <regex>', 'only messages whose text matches, e.g. \'/testmember[0-9]+/i\'').argParser(parsePatternOption);

/** @returns {Option} `--date <YYYY-MM-DD>`, parsed into a local-day ts range; conflicts with explicit bounds. */
const dateOption = () => new Option('--date <YYYY-MM-DD>', 'only messages posted on that local calendar day').argParser(parseDate).conflicts(['tsFrom', 'tsTo']);

/** @returns {Option} `--ts-from <ts>`, the inclusive lower bound. */
const tsFromOption = () => new Option('--ts-from <ts>', 'inclusive lower bound (ts from the TS column)').argParser(parseTs);

/** @returns {Option} `--ts-to <ts>`, the inclusive upper bound. */
const tsToOption = () => new Option('--ts-to <ts>', 'inclusive upper bound (ts from the TS column)').argParser(parseTs);

/** @returns {Option} `--ts <ts...>`, exact messages by timestamp; conflicts with every other selector. */
const tsOption = () => new Option('--ts <ts...>', 'exact messages by ts; cannot be combined with other selectors')
    .argParser(collectTs)
    .conflicts(['date', 'limit', 'mine', 'pattern', 'select', 'tsFrom', 'tsTo']);

/** @returns {Option} `--select`, the interactive pick before confirmation. */
const selectOption = () => new Option('--select', 'pick messages from a numbered list before confirming');

/** @returns {Option} `--dry-run`, preview only. */
const dryRunOption = () => new Option('--dry-run', 'preview only; perform no changes');

/**
 * Reject a reversed range as a usage error. Commander cannot express this
 * relation between two options, so it is checked once parsing is done.
 *
 * @param {{ tsFrom?: string, tsTo?: string }} options
 * @param {import('commander').Command} command - The command being run.
 */
const validateRange = ({ tsFrom, tsTo }, command) => {
    if (tsFrom && tsTo && Number(tsFrom) > Number(tsTo)) {
        command.error('error: --ts-from must not be later than --ts-to', { exitCode: 2 });
    }
};

/**
 * The limit a message query should use: the explicit `--limit`, else the
 * default in newest-N mode, else no cap when a range or date bounds the query.
 *
 * @param {{ limit?: number, date?: object, tsFrom?: string, tsTo?: string }} options
 * @returns {number | undefined}
 */
const effectiveLimit = ({ date, limit, tsFrom, tsTo }) => {
    if (limit !== undefined) {
        return limit;
    }

    return date || tsFrom || tsTo ? undefined : kDEFAULT_LIMIT;
};

/**
 * The `oldest`/`latest` bounds a message query should use, from `--date` or
 * `--ts-from`/`--ts-to`.
 *
 * @param {{ date?: { oldest: string, latest: string }, tsFrom?: string, tsTo?: string }} options
 * @returns {{ oldest?: string, latest?: string }}
 */
const effectiveBounds = ({ date, tsFrom, tsTo }) => {
    if (date) {
        return date;
    }

    return {
        ...(tsFrom && { oldest: tsFrom }),
        ...(tsTo && { latest: tsTo }),
    };
};

module.exports = {
    channelArgument,
    dateOption,
    dryRunOption,
    effectiveBounds,
    effectiveLimit,
    limitOption,
    mineOption,
    patternOption,
    selectOption,
    tsFromOption,
    tsOption,
    tsToOption,
    validateRange,
};
