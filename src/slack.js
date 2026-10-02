'use strict';

/**
 * Slack Web API transport.
 *
 * Owns everything about speaking to Slack over HTTP: the bearer header, the
 * `ok:false` envelope, HTTP 429 with `Retry-After`, and cursor pagination.
 * Nothing above this module knows about HTTP; nothing in this module knows
 * what a channel or a message means.
 */

const kSLACK_API_BASE              = 'https://slack.com/api/';
const kMAX_ATTEMPTS                = 5;
const kDEFAULT_RETRY_AFTER_SECONDS = 1;
const kHTTP_TOO_MANY_REQUESTS      = 429;
const kMILLISECONDS_PER_SECOND     = 1000;

/**
 * A Slack Web API call that returned `ok: false`.
 *
 * `method` is the API method that failed (for example `chat.delete`) and
 * `code` is Slack's `error` string (for example `cant_delete_message`).
 */
class SlackApiError extends Error {
    /**
     * @param {string} method - Slack API method name.
     * @param {string} code - Slack's `error` field.
     */
    constructor(method, code) {
        super(`${method}: ${code}`);
        this.name   = 'SlackApiError';
        this.method = method;
        this.code   = code;
    }
}

/**
 * Resolve after `ms` milliseconds. Replaced in tests so retries do not wait.
 *
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>}
 */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Seconds Slack asked us to wait on a 429: the header's whole non-negative
 * integer (zero included), or the default when it is absent or malformed, so
 * the retry loop always terminates by attempt count.
 *
 * @param {Response} response - The 429 response.
 * @returns {number} Whole seconds to wait.
 */
const retryAfterSeconds = (response) => {
    const header = response.headers.get('retry-after') ?? '';

    return /^\d+$/.test(header) ? Number(header) : kDEFAULT_RETRY_AFTER_SECONDS;
};

/**
 * Turn a non-429 response into its body, or throw.
 *
 * @param {string} method - Slack API method name, for error messages.
 * @param {Response} response - The HTTP response.
 * @returns {Promise<object>} The parsed body when `ok` is true.
 * @throws {Error} When the HTTP status is not 2xx.
 * @throws {SlackApiError} When the body carries `ok: false`.
 */
const parseResponse = async (method, response) => {
    if (!response.ok) {
        throw new Error(`${method}: HTTP ${response.status}`);
    }

    const body = await response.json();

    if (!body.ok) {
        throw new SlackApiError(method, body.error);
    }

    return body;
};

/**
 * A Slack Web API client bound to one token.
 *
 * `fetch`, `sleep`, and `log` are injected so the transport is testable
 * without a network or real time. All collaborators are private; nothing
 * outside the class can read the token.
 *
 * @example
 * const client = new SlackClient({ token: process.env.SLACK_ADMIN_TOKEN });
 * const { user_id } = await client.call('auth.test');
 */
class SlackClient {
    #token;
    #fetch;
    #sleep;
    #log;

    /**
     * @param {object} options
     * @param {string} options.token - Slack token sent as a bearer credential.
     * @param {typeof fetch} [options.fetch] - HTTP implementation; defaults to the global `fetch`.
     * @param {(ms: number) => Promise<void>} [options.sleep] - Wait implementation used on 429.
     * @param {(line: string) => void} [options.log] - Where rate-limit waits are reported; defaults to stderr.
     */
    constructor({ token, fetch = globalThis.fetch, sleep = defaultSleep, log = console.error }) {
        this.#token = token;
        this.#fetch = fetch;
        this.#sleep = sleep;
        this.#log   = log;
    }

    /**
     * Call one Slack Web API method.
     *
     * On HTTP 429 the call waits for `Retry-After` seconds (default 1), logs
     * the wait, and retries, up to `kMAX_ATTEMPTS` attempts in total. No wait
     * is inserted between successful calls.
     *
     * @param {string} method - Slack API method name, for example `conversations.history`.
     * @param {object} [args] - JSON body for the request.
     * @returns {Promise<object>} The response body (`ok: true`).
     * @throws {SlackApiError} On `ok: false`, or with code `ratelimited` when every attempt was a 429.
     * @throws {Error} On any other non-2xx HTTP status.
     */
    async call(method, args = {}) {
        let attempt = 0;

        while (true) {
            attempt += 1;
            const response = await this.#post(method, args);

            if (response.status !== kHTTP_TOO_MANY_REQUESTS) {
                return parseResponse(method, response);
            }

            if (attempt >= kMAX_ATTEMPTS) {
                throw new SlackApiError(method, 'ratelimited');
            }

            const seconds = retryAfterSeconds(response);
            this.#log(`Rate limited by Slack; waiting ${seconds}s...`);
            await this.#sleep(seconds * kMILLISECONDS_PER_SECOND);
        }
    }

    /**
     * Iterate a cursor-paginated method one page at a time.
     *
     * The first request carries no `cursor`; each later request carries the
     * previous page's `response_metadata.next_cursor`; iteration ends when
     * that value is empty. Pages are fetched lazily, so a consumer that stops
     * early causes no further requests.
     *
     * @param {string} method - Slack API method name.
     * @param {object} args - Request body shared by every page.
     * @param {(body: object) => Array} pluck - Extracts the page's items from the body.
     * @yields {Array} One page of items.
     */
    async *paginate(method, args, pluck) {
        let cursor;

        do {
            const body = await this.call(method, cursor ? { ...args, cursor } : args);
            yield pluck(body);
            cursor = body.response_metadata?.next_cursor;
        }
        while (cursor);
    }

    /**
     * Send one JSON POST with the bearer header.
     *
     * @param {string} method - Slack API method name.
     * @param {object} args - JSON body.
     * @returns {Promise<Response>}
     */
    #post(method, args) {
        const send = this.#fetch;

        return send(`${kSLACK_API_BASE}${method}`, {
            body    : JSON.stringify(args),
            headers : {
                Authorization  : `Bearer ${this.#token}`,
                'Content-Type' : 'application/json',
            },
            method  : 'POST',
        });
    }
}

module.exports = { SlackApiError, SlackClient };
