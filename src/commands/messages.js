'use strict';

/**
 * `slackctl messages`: list messages in a channel. Also owns the row
 * rendering and the candidate query that `delete` shares, so the two commands
 * always agree on what a set of options selects.
 */

const { ConversationsService } = require('../conversations');
const { MessagesService } = require('../messages');
const { authorOf, formatDate, messageWidth, oneLine, table } = require('../output');
const {
    channelArgument,
    dateOption,
    effectiveBounds,
    effectiveLimit,
    limitOption,
    mineOption,
    patternOption,
    tsFromOption,
    tsToOption,
    validateRange,
} = require('./options');

const kCOLUMNS = [
    { header: 'Date', key: 'date' },
    { header: 'TS', key: 'ts' },
    { header: 'User', key: 'user' },
    { header: 'Message', key: 'message' },
];
const kNUMBER_COLUMN = { header: '#', key: 'number' };
const kDATE_WIDTH    = 'YYYY-MM-DD HH:mm'.length;
const kTS_WIDTH      = '1790879520.000100'.length;
const kGUTTER_WIDTH  = 2;

/**
 * Render messages as the DATE / TS / USER / MESSAGE table, optionally with a
 * leading `#` column for interactive selection.
 *
 * @param {object[]} messages - Raw Slack messages, newest first.
 * @param {NodeJS.WriteStream} stdout - Decides the MESSAGE column width.
 * @param {{ numbered?: boolean }} [options]
 * @returns {string}
 */
const messageTable = (messages, stdout, { numbered = false } = {}) => {
    const authors     = messages.map(authorOf);
    const userWidth   = Math.max('USER'.length, ...authors.map((author) => author.length));
    const numberWidth = numbered ? String(messages.length).length + kGUTTER_WIDTH : 0;
    const reserved    = numberWidth + kDATE_WIDTH + kTS_WIDTH + userWidth + (kGUTTER_WIDTH * 3);
    const width       = messageWidth(stdout, reserved);
    const columns     = numbered ? [kNUMBER_COLUMN, ...kCOLUMNS] : kCOLUMNS;

    const rows = messages.map((message, index) => ({
        date    : formatDate(message.ts),
        message : oneLine(message.text ?? '', width),
        number  : String(index + 1),
        ts      : message.ts,
        user    : authors[index],
    }));

    return table(columns, rows);
};

/**
 * The messages a set of `messages`/`delete` options selects, newest first.
 *
 * @param {object} params
 * @param {import('../slack').SlackClient} params.client - Used for `auth.test` when `--mine` is set.
 * @param {MessagesService} params.messages
 * @param {{ id: string }} params.channel - Resolved channel.
 * @param {object} params.options - Parsed commander options.
 * @returns {Promise<object[]>}
 */
const queryMessages = async ({ channel, client, messages, options }) => {
    const userId = options.mine ? (await client.call('auth.test')).user_id : undefined;

    return messages.fetchMessages({
        channel : channel.id,
        limit   : effectiveLimit(options),
        pattern : options.pattern,
        userId,
        ...effectiveBounds(options),
    });
};

/**
 * @param {import('commander').Command} program
 * @param {object} context - See `createContext` in `bin/slackctl.js`.
 */
const register = (program, context) => {
    program
        .command('messages')
        .description('list messages in a channel, newest first')
        .addArgument(channelArgument())
        .addOption(mineOption())
        .addOption(patternOption())
        .addOption(limitOption())
        .addOption(dateOption())
        .addOption(tsFromOption())
        .addOption(tsToOption())
        .action(async (channelRef, options, command) => {
            validateRange(options, command);

            const client        = context.getClient();
            const conversations = new ConversationsService(client);
            const messages      = new MessagesService(client);
            const channel       = await conversations.resolveChannel(channelRef);
            const found         = await queryMessages({ channel, client, messages, options });

            if (found.length === 0) {
                context.stdout.write('No messages matched.\n');
                return;
            }

            context.stdout.write(messageTable(found, context.stdout));
        });
};

module.exports = { messageTable, queryMessages, register };
