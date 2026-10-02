'use strict';

/**
 * `slackctl auth`: who the token is, and whether it works.
 */

const { SlackApiError } = require('../slack');
const { keyValue } = require('../output');

/**
 * Classify a Slack token by its prefix.
 *
 * @param {string} token
 * @returns {string} `user`, `bot`, `user (refreshable)`, or `unknown`.
 */
const tokenType = (token) => {
    if (token.startsWith('xoxp-')) {
        return 'user';
    }

    if (token.startsWith('xoxb-')) {
        return 'bot';
    }

    if (token.startsWith('xoxe')) {
        return 'user (refreshable)';
    }

    return 'unknown';
};

/**
 * @param {import('commander').Command} program
 * @param {object} context - See `createContext` in `bin/slackctl.js`.
 */
const register = (program, context) => {
    program
        .command('auth')
        .description('show the workspace and user the token belongs to')
        .action(async () => {
            const type   = tokenType(context.getToken());
            const client = context.getClient();

            try {
                const identity = await client.call('auth.test');

                context.stdout.write(keyValue([
                    ['Workspace', identity.team],
                    ['User', identity.user],
                    ['User ID', identity.user_id],
                    ['Token', type],
                    ['Status', 'authenticated'],
                ]));
            }
            catch (error) {
                if (error instanceof SlackApiError) {
                    context.stdout.write(keyValue([
                        ['Token', type],
                        ['Status', `failed (${error.code})`],
                    ]));
                }

                throw error;
            }
        });
};

module.exports = { register };
