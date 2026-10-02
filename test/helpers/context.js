'use strict';

/**
 * Assembles a command context over the fake Slack and the stream helpers, and
 * runs the commander program against it.
 */

const { createProgram } = require('../../bin/slackctl');
const { SlackClient } = require('../../src/slack');
const { createFakeSlack } = require('./fake-slack');
const { capture, scriptedInput } = require('./streams');

const kTOKEN = 'xoxp-test-not-a-real-token';

/**
 * @param {object} [options]
 * @param {object} [options.routes] - Fake Slack routes.
 * @param {string} [options.token]
 * @param {string[]} [options.stdinLines] - What the operator types.
 * @param {boolean} [options.isTTY] - Whether stdin is a terminal.
 * @returns {{ context: object, calls: object[], stdout: object, stderr: object }}
 */
const fakeContext = ({ isTTY = true, routes = {}, stdinLines = [], token = kTOKEN } = {}) => {
    const fake   = createFakeSlack(routes);
    const stdout = capture({ isTTY: false });
    const stderr = capture({ isTTY: false });
    const stdin  = scriptedInput(stdinLines, { isTTY });
    const client = new SlackClient({ fetch: fake.fetch, log: (line) => stderr.write(`${line}\n`), sleep: async () => {}, token });

    return {
        calls   : fake.calls,
        context : { getClient: () => client, getToken: () => token, stderr, stdin, stdout },
        stderr,
        stdout,
    };
};

/**
 * Run `slackctl <argv>` in-process. Resolves with the harness on success;
 * rejects with the thrown error (a CommanderError for usage errors).
 *
 * @param {string[]} argv - Arguments after the program name.
 * @param {object} [options] - Passed to `fakeContext`.
 * @returns {Promise<ReturnType<typeof fakeContext>>}
 */
const runCommand = async (argv, options) => {
    const harness = fakeContext(options);
    const program = createProgram(harness.context);

    await program.parseAsync(['node', 'slackctl', ...argv]);

    return harness;
};

module.exports = { fakeContext, runCommand };
