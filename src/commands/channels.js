'use strict';

/**
 * `slackctl channels`: every channel's name and ID, so IDs are discoverable.
 */

const { ConversationsService } = require('../conversations');
const { table } = require('../output');

const kCOLUMNS = [
    { header: 'Name', key: 'name' },
    { header: 'ID', key: 'id' },
    { header: 'Type', key: 'type' },
    { header: 'Member', key: 'member' },
];

/**
 * @param {object} channel - Raw Slack channel.
 * @returns {{ name: string, id: string, type: string, member: string }}
 */
const toChannelRow = (channel) => ({
    id     : channel.id,
    member : channel.is_member ? 'yes' : 'no',
    name   : channel.name,
    type   : channel.is_private ? 'private' : 'public',
});

/**
 * @param {import('commander').Command} program
 * @param {object} context - See `createContext` in `bin/slackctl.js`.
 */
const register = (program, context) => {
    program
        .command('channels')
        .description('list channels with their IDs')
        .action(async () => {
            const conversations = new ConversationsService(context.getClient());
            const rows = (await conversations.listChannels())
                .map(toChannelRow)
                .sort((left, right) => left.name.localeCompare(right.name));

            context.stdout.write(table(kCOLUMNS, rows));
        });
};

module.exports = { register };
