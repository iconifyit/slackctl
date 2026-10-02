'use strict';

/**
 * `slackctl delete`: remove messages after a preview and a typed `delete`.
 *
 * Three ways to build the candidate set (newest-N, explicit --ts, a range or
 * --date), two filters (--mine, --pattern), an optional interactive pick, and
 * one deletion path for all of them.
 */

const { ConversationsService } = require('../conversations');
const { MessagesService } = require('../messages');
const { confirm, createPrompter, isInteractive, pick } = require('../output');
const { messageTable, queryMessages } = require('./messages');
const {
    channelArgument,
    dateOption,
    dryRunOption,
    limitOption,
    mineOption,
    patternOption,
    selectOption,
    tsFromOption,
    tsOption,
    tsToOption,
    validateRange,
} = require('./options');

const kCONFIRM_WORD = 'delete';
const kABORTED      = 'Aborted. Nothing deleted.\n';

/** A prompt was required but stdin is not a terminal. */
class NonInteractiveError extends Error {
    constructor() {
        super('Confirmation requires an interactive terminal; use --dry-run to preview.');
        this.name = 'NonInteractiveError';
    }
}

/**
 * @param {number} count
 * @returns {string} `1 message` or `N messages`.
 */
const pluralize = (count) => `${count} message${count === 1 ? '' : 's'}`;

/**
 * The messages the options select: explicit `--ts`, or a query.
 *
 * @param {object} params
 * @param {import('../slack').SlackClient} params.client
 * @param {MessagesService} params.messages
 * @param {{ id: string }} params.channel
 * @param {object} params.options
 * @returns {Promise<object[]>}
 */
const buildCandidates = ({ channel, client, messages, options }) => {
    if (options.ts) {
        return messages.fetchMessagesByTs({ channel: channel.id, tsList: options.ts });
    }

    return queryMessages({ channel, client, messages, options });
};

/**
 * Delete the chosen messages one at a time, newest first, stopping at the
 * first failure with a report of how far it got.
 *
 * @param {object} params
 * @param {MessagesService} params.messages
 * @param {{ id: string }} params.channel
 * @param {object[]} params.chosen - Messages to delete, in order.
 * @param {object} params.context - Command context (streams).
 * @returns {Promise<void>}
 */
const runDeletion = async ({ channel, chosen, context, messages }) => {
    for (const [index, message] of chosen.entries()) {
        try {
            await messages.deleteMessage({ channel: channel.id, ts: message.ts });
        }
        catch (error) {
            context.stderr.write(`Deleted ${index} of ${chosen.length}. Failed on ${message.ts}: ${error.code ?? error.message}\n`);
            throw error;
        }

        context.stderr.write(`Deleted ${index + 1}/${chosen.length}: ${message.ts}\n`);
    }

    context.stdout.write(`Deletion successful. ${pluralize(chosen.length)} deleted.\n`);
};

/**
 * @param {import('commander').Command} program
 * @param {object} context - See `createContext` in `bin/slackctl.js`.
 */
const register = (program, context) => {
    program
        .command('delete')
        .description('delete messages after a preview and a typed confirmation')
        .addArgument(channelArgument())
        .addOption(mineOption())
        .addOption(patternOption())
        .addOption(limitOption())
        .addOption(dateOption())
        .addOption(tsOption())
        .addOption(tsFromOption())
        .addOption(tsToOption())
        .addOption(selectOption())
        .addOption(dryRunOption())
        .action(async (channelRef, options, command) => {
            validateRange(options, command);

            const client        = context.getClient();
            const conversations = new ConversationsService(client);
            const messages      = new MessagesService(client);
            const channel       = await conversations.resolveChannel(channelRef);
            const candidates    = await buildCandidates({ channel, client, messages, options });

            if (candidates.length === 0) {
                context.stdout.write('No messages matched.\n');
                return;
            }

            context.stdout.write('The following messages will be deleted:\n\n');
            context.stdout.write(messageTable(candidates, context.stdout, { numbered: Boolean(options.select) }));

            const needsTerminal = options.select || !options.dryRun;

            if (needsTerminal && !isInteractive(context.stdin)) {
                throw new NonInteractiveError();
            }

            const prompter = createPrompter({ input: context.stdin, output: context.stderr });

            try {
                let chosen = candidates;

                if (options.select) {
                    const indices = await pick(candidates.length, prompter);

                    if (indices === null) {
                        context.stdout.write(kABORTED);
                        return;
                    }

                    chosen = indices.map((index) => candidates[index]);
                    context.stdout.write('\nSelected:\n\n');
                    context.stdout.write(messageTable(chosen, context.stdout));
                }

                if (options.dryRun) {
                    context.stdout.write('Dry run. Nothing deleted.\n');
                    return;
                }

                context.stdout.write('\n');

                if (!(await confirm(kCONFIRM_WORD, prompter))) {
                    context.stdout.write(kABORTED);
                    return;
                }

                await runDeletion({ channel, chosen, context, messages });
            }
            finally {
                prompter.close();
            }
        });
};

module.exports = { NonInteractiveError, register };
