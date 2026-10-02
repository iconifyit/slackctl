'use strict';

/**
 * In-memory stand-in for Slack's Web API, served through a `fetch`-shaped
 * function so the real transport can be exercised without a network.
 */

const kSLACK_API_BASE = 'https://slack.com/api/';

/**
 * Decode a form-encoded request body into the argument object the service
 * sent, undoing the transport's stringification: whole numbers become
 * numbers, `true`/`false` become booleans, everything else (including Slack
 * `ts` values, which carry a decimal point) stays a string.
 *
 * @param {URLSearchParams | string} body
 * @returns {object}
 */
const decodeArguments = (body) => Object.fromEntries(
    [...new URLSearchParams(String(body)).entries()].map(([key, value]) => {
        if (value === 'true' || value === 'false') {
            return [key, value === 'true'];
        }

        return [key, /^\d+$/.test(value) ? Number(value) : value];
    }),
);

/**
 * Build a minimal `Response`-like object from a route entry.
 *
 * @param {{ status?: number, headers?: object, body?: object }} entry
 * @returns {{ ok: boolean, status: number, headers: Headers, json: () => Promise<object> }}
 */
const toResponse = ({ status = 200, headers = {}, body = {} }) => ({
    headers : new Headers(headers),
    json    : async () => body,
    ok      : status >= 200 && status < 300,
    status,
});

/**
 * A route for `conversations.history` that behaves like Slack: newest first,
 * honors `oldest`, `latest`, `inclusive`, and `limit`, and pages with an
 * opaque cursor. Lets tests assert on what the service does with bounds and
 * limits rather than on what a canned page happens to contain.
 *
 * @param {object[]} messages - Every message in the channel, any order.
 * @param {{ maxPageSize?: number }} [options] - Cap on items per page, as Slack's restricted tier imposes.
 * @returns {(args: object) => { body: object }}
 */
const historyRoute = (messages, { maxPageSize = 1000 } = {}) => {
    const newestFirst = [...messages].sort((left, right) => Number(right.ts) - Number(left.ts));

    return ({ cursor, inclusive = false, latest, limit = 100, oldest }) => {
        const pageSize = Math.min(limit, maxPageSize);
        const inRange = newestFirst.filter(({ ts }) => {
            const value = Number(ts);
            const aboveOldest = oldest === undefined || (inclusive ? value >= Number(oldest) : value > Number(oldest));
            const belowLatest = latest === undefined || (inclusive ? value <= Number(latest) : value < Number(latest));
            return aboveOldest && belowLatest;
        });
        const offset = cursor ? Number(cursor) : 0;
        const page   = inRange.slice(offset, offset + pageSize);
        const next   = offset + pageSize < inRange.length ? String(offset + pageSize) : '';

        return { body: { messages: page, ok: true, response_metadata: { next_cursor: next } } };
    };
};

/**
 * Create a fake Slack API.
 *
 * `routes` maps a method name to one of: a response entry, returned for every
 * request to that method; an array of entries consumed in order (pagination,
 * 429 sequences); or a function of the request args returning an entry. A
 * request to an unrouted method, or past the end of an array, throws so an
 * unexpected call fails the test loudly.
 *
 * @param {Object<string, object|object[]>} routes
 * @returns {{ fetch: Function, calls: Array<{ method: string, args: object, headers: object, rawBody: string }> }}
 */
const createFakeSlack = (routes) => {
    const calls  = [];
    const queues = Object.fromEntries(
        Object.entries(routes)
            .filter(([, entries]) => Array.isArray(entries))
            .map(([method, entries]) => [method, [...entries]]),
    );

    const fetch = async (url, init) => {
        const method = url.slice(kSLACK_API_BASE.length);
        calls.push({ args: decodeArguments(init.body), headers: init.headers, method, rawBody: String(init.body) });

        const route = routes[method];

        if (route === undefined) {
            throw new Error(`Unrouted Slack method: ${method}`);
        }

        if (typeof route === 'function') {
            return toResponse(route(decodeArguments(init.body)));
        }

        if (!Array.isArray(route)) {
            return toResponse(route);
        }

        const next = queues[method].shift();

        if (next === undefined) {
            throw new Error(`No more responses routed for ${method}`);
        }

        return toResponse(next);
    };

    return { calls, fetch };
};

module.exports = { createFakeSlack, historyRoute };
