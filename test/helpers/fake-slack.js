'use strict';

/**
 * In-memory stand-in for Slack's Web API, served through a `fetch`-shaped
 * function so the real transport can be exercised without a network.
 */

const kSLACK_API_BASE = 'https://slack.com/api/';

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
 * Create a fake Slack API.
 *
 * `routes` maps a method name to either one response entry, returned for
 * every request to that method, or an array of entries consumed in order
 * (pagination, 429 sequences). A request to an unrouted method, or past the
 * end of an array, throws so an unexpected call fails the test loudly.
 *
 * @param {Object<string, object|object[]>} routes
 * @returns {{ fetch: Function, calls: Array<{ method: string, args: object, headers: object }> }}
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
        calls.push({ args: JSON.parse(init.body), headers: init.headers, method });

        const route = routes[method];

        if (route === undefined) {
            throw new Error(`Unrouted Slack method: ${method}`);
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

module.exports = { createFakeSlack };
