'use strict';

/**
 * Messages service: how history is paged and filtered, how single messages
 * are looked up, deleted, and posted. Knows Slack's message semantics; knows
 * nothing about HTTP or the terminal.
 */

const kHISTORY_PAGE_SIZE = 100;
const kPATTERN_LITERAL   = /^\/(.*)\/([a-z]*)$/s;
const kSTATEFUL_FLAGS    = /[gy]/g;

/** A `ts` that is not a top-level message in the channel. */
class MessageNotFoundError extends Error {
    /** @param {string} ts - The timestamp that was not found. */
    constructor(ts) {
        super(`Message not found: ${ts}`);
        this.name = 'MessageNotFoundError';
        this.ts   = ts;
    }
}

/**
 * Build a `RegExp` from an operator's `--pattern` value.
 *
 * `/body/flags` is accepted so a pattern reads as it would in code; a value
 * without surrounding slashes is the body with no flags. The `g` and `y`
 * flags are dropped because they make `test()` stateful across messages.
 *
 * @param {string} expression - The operator's value.
 * @returns {RegExp}
 * @throws {Error} `Invalid pattern: <reason>` when the body does not compile.
 *
 * @example
 * parsePattern('/testmember[0-9]+/i'); // /testmember[0-9]+/i
 * parsePattern('testmember[0-9]+');    // /testmember[0-9]+/
 */
const parsePattern = (expression) => {
    const literal       = kPATTERN_LITERAL.exec(expression);
    const [body, flags] = literal ? [literal[1], literal[2]] : [expression, ''];

    try {
        return new RegExp(body, flags.replace(kSTATEFUL_FLAGS, ''));
    }
    catch (error) {
        throw new Error(`Invalid pattern: ${error.message}`);
    }
};

/**
 * Whether a message satisfies every filter present in the query.
 *
 * @param {object} message - Raw Slack message.
 * @param {{ userId?: string, pattern?: RegExp }} filters
 * @returns {boolean}
 */
const matches = (message, { pattern, userId }) =>
    (!userId || message.user === userId) && (!pattern || pattern.test(message.text ?? ''));

/**
 * The `conversations.history` request body for a query. `inclusive` is sent
 * only when a bound is present.
 *
 * @param {{ channel: string, oldest?: string, latest?: string }} query
 * @returns {object}
 */
const historyArgs = ({ channel, latest, oldest }) => ({
    channel,
    limit : kHISTORY_PAGE_SIZE,
    ...(oldest && { oldest }),
    ...(latest && { latest }),
    ...((oldest || latest) && { inclusive: true }),
});

/**
 * Fetches, deletes, and posts messages in a channel.
 */
class MessagesService {
    #client;

    /** @param {import('./slack').SlackClient} client */
    constructor(client) {
        this.#client = client;
    }

    /**
     * Newest-first messages matching the query, up to `limit`.
     *
     * Pages are consumed only until `limit` matches are found; with no
     * `limit`, every match within the bounds is returned.
     *
     * @param {object} query
     * @param {string} query.channel - Channel ID.
     * @param {number} [query.limit] - Maximum matches; undefined means no cap.
     * @param {string} [query.userId] - Keep only messages by this user.
     * @param {RegExp} [query.pattern] - Keep only messages whose text matches.
     * @param {string} [query.oldest] - Inclusive lower `ts` bound.
     * @param {string} [query.latest] - Inclusive upper `ts` bound.
     * @returns {Promise<object[]>} Raw Slack messages, newest first.
     */
    async fetchMessages(query) {
        const { limit } = query;
        const found     = [];

        for await (const page of this.#client.paginate('conversations.history', historyArgs(query), (body) => body.messages)) {
            for (const message of page) {
                if (!matches(message, query)) {
                    continue;
                }

                found.push(message);

                if (limit !== undefined && found.length >= limit) {
                    return found;
                }
            }
        }

        return found;
    }

    /**
     * Exact messages by `ts`, in the order given. All-or-nothing: a missing
     * `ts` throws and no partial list is returned.
     *
     * @param {{ channel: string, tsList: string[] }} request
     * @returns {Promise<object[]>}
     * @throws {MessageNotFoundError} When a `ts` is not a top-level message in the channel.
     */
    async fetchMessagesByTs({ channel, tsList }) {
        const found = [];

        for (const ts of tsList) {
            const body    = await this.#client.call('conversations.history', { channel, inclusive: true, latest: ts, limit: 1, oldest: ts });
            const message = body.messages[0];

            if (message?.ts !== ts) {
                throw new MessageNotFoundError(ts);
            }

            found.push(message);
        }

        return found;
    }

    /**
     * Delete one message.
     *
     * @param {{ channel: string, ts: string }} target
     * @returns {Promise<void>}
     * @throws {import('./slack').SlackApiError} For example `cant_delete_message`.
     */
    async deleteMessage({ channel, ts }) {
        await this.#client.call('chat.delete', { channel, ts });
    }

    /**
     * Post one message.
     *
     * @param {{ channel: string, text: string }} message
     * @returns {Promise<{ ts: string }>} The new message's `ts`.
     */
    async postMessage({ channel, text }) {
        const body = await this.#client.call('chat.postMessage', { channel, text });

        return { ts: body.ts };
    }
}

module.exports = { MessageNotFoundError, MessagesService, parsePattern };
