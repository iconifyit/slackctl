'use strict';

/**
 * `slackctl send`: post one message to a channel, with a dry run.
 */

const { ConversationsService } = require('../conversations');
const { MessagesService } = require('../messages');
const { channelArgument, dryRunOption } = require('./options');

/**
 * @param {import('commander').Command} program
 * @param {object} context - See `createContext` in `bin/slackctl.js`.
 */
const register = (program, context) => {
    program
        .command('send')
        .description('send a message to a channel')
        .addArgument(channelArgument())
        .argument('<text>', 'message text')
        .addOption(dryRunOption())
        .action(async (channelRef, text, options) => {
            const client        = context.getClient();
            const conversations = new ConversationsService(client);
            const channel       = await conversations.resolveChannel(channelRef);

            if (options.dryRun) {
                context.stdout.write(`Dry run. Would send to #${channel.name} (${channel.id}):\n${text}\n`);
                return;
            }

            const { ts } = await new MessagesService(client).postMessage({ channel: channel.id, text });

            context.stdout.write(`Sent to #${channel.name} (${channel.id}) at ${ts}.\n`);
        });
};

module.exports = { register };
