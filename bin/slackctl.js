#!/usr/bin/env node
'use strict';

/**
 * slackctl entry point: wires commander, builds the command context, and maps
 * errors to exit codes. Data goes to stdout; progress and errors to stderr.
 */

const { Command, CommanderError } = require('commander');

const pkg = require('../package.json');
const { SlackApiError, SlackClient } = require('../src/slack');
const { AmbiguousChannelError, ChannelNotFoundError } = require('../src/conversations');
const { MessageNotFoundError } = require('../src/messages');
const auth = require('../src/commands/auth');
const channels = require('../src/commands/channels');
const messages = require('../src/commands/messages');

const kEXIT_RUNTIME_ERROR = 1;
const kEXIT_USAGE_ERROR   = 2;

/** Slack error codes with an actionable explanation. */
const kFRIENDLY_ERRORS = {
    account_inactive    : 'The token\'s user or workspace is inactive (account_inactive).',
    cant_delete_message : 'Slack refused to delete the message (cant_delete_message). Only the author, or an admin where workspace settings allow it, can delete it.',
    channel_not_found   : 'Slack reports that channel does not exist or the token cannot see it (channel_not_found).',
    invalid_auth        : 'Slack rejected the token (invalid_auth). Check SLACK_ADMIN_TOKEN.',
    message_not_found   : 'Slack reports the message no longer exists (message_not_found).',
    not_authed          : 'No valid token was sent (not_authed). Check SLACK_ADMIN_TOKEN.',
    not_in_channel      : 'The token\'s user is not a member of that channel (not_in_channel). Join it first.',
    ratelimited         : 'Slack kept rate limiting after five attempts (ratelimited). Wait a minute and try again.',
    token_revoked       : 'The token has been revoked (token_revoked). Issue a new one.',
};

const kDOMAIN_ERRORS = [AmbiguousChannelError, ChannelNotFoundError, MessageNotFoundError];

/** `SLACK_ADMIN_TOKEN` is absent or empty. */
class MissingTokenError extends Error {
    constructor() {
        super('SLACK_ADMIN_TOKEN is not set.');
        this.name = 'MissingTokenError';
    }
}

/**
 * Build the context commands run in. The token is read, and the client built,
 * on first use, so `help` and usage errors never need a token while every
 * real command fails before any network call.
 *
 * @param {object} [options]
 * @param {object} [options.env] - Environment; defaults to `process.env`.
 * @param {NodeJS.ReadStream} [options.stdin]
 * @param {NodeJS.WriteStream} [options.stdout]
 * @param {NodeJS.WriteStream} [options.stderr]
 * @returns {{ getClient: () => SlackClient, getToken: () => string, stdin: object, stdout: object, stderr: object }}
 */
const createContext = ({ env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) => {
    let client;

    const getToken = () => {
        const token = env.SLACK_ADMIN_TOKEN;

        if (!token) {
            throw new MissingTokenError();
        }

        return token;
    };

    const getClient = () => {
        client ??= new SlackClient({ log: (line) => stderr.write(`${line}\n`), token: getToken() });

        return client;
    };

    return { getClient, getToken, stderr, stdin, stdout };
};

/**
 * Build the commander program with every command registered.
 *
 * Commander never calls `process.exit` here: every usage error, help display,
 * and version display is thrown as a CommanderError for `run` to map. Usage
 * errors are normalized to exit 2 (commander's own default is 1) so that
 * runtime failures (1) and usage mistakes (2) are distinguishable to scripts.
 * The override is installed before the subcommands are created so they
 * inherit it.
 *
 * @param {ReturnType<typeof createContext>} context
 * @returns {Command}
 */
const createProgram = (context) => {
    const program = new Command();

    program
        .exitOverride((error) => {
            if (error.exitCode === 0) {
                throw error;
            }

            throw new CommanderError(kEXIT_USAGE_ERROR, error.code, error.message);
        })
        .name('slackctl')
        .description(pkg.description)
        .version(pkg.version)
        .configureOutput({
            writeErr : (text) => context.stderr.write(text),
            writeOut : (text) => context.stdout.write(text),
        });

    for (const { register } of [auth, channels, messages]) {
        register(program, context);
    }

    return program;
};

/**
 * The message to print for a runtime error.
 *
 * @param {Error} error
 * @returns {string}
 */
const describeError = (error) => {
    if (error instanceof SlackApiError) {
        return kFRIENDLY_ERRORS[error.code] ?? `slackctl: ${error.method} failed: ${error.code}`;
    }

    if (error instanceof MissingTokenError || kDOMAIN_ERRORS.some((type) => error instanceof type)) {
        return error.message;
    }

    return `slackctl: ${error.message}`;
};

/**
 * Run the CLI. Usage errors exit 2 (commander has already written its
 * message); help and version exit 0; runtime errors exit 1 with a message.
 *
 * @param {string[]} argv - Usually `process.argv`.
 * @returns {Promise<void>}
 */
const run = async (argv) => {
    const context = createContext();

    try {
        await createProgram(context).parseAsync(argv);
    }
    catch (error) {
        if (error instanceof CommanderError) {
            process.exitCode = error.exitCode;
            return;
        }

        context.stderr.write(`${describeError(error)}\n`);
        process.exitCode = kEXIT_RUNTIME_ERROR;
    }
};

if (require.main === module) {
    run(process.argv);
}

module.exports = { MissingTokenError, createContext, createProgram, describeError };
