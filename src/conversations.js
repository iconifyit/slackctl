'use strict';

/**
 * Conversations service: what a channel reference means and how channels
 * are listed. Knows Slack's channel semantics; knows nothing about HTTP.
 */

const kCHANNEL_ID_PATTERN = /^[CDG][A-Z0-9]{8,}$/;
const kLIST_PAGE_SIZE     = 200;
const kLIST_TYPES         = 'public_channel,private_channel';

/** A channel name that matched nothing in the workspace. */
class ChannelNotFoundError extends Error {
    /** @param {string} name - The unmatched reference. */
    constructor(name) {
        super(`Channel not found: ${name}`);
        this.name = 'ChannelNotFoundError';
        this.channelName = name;
    }
}

/** A channel name that matched more than one channel. */
class AmbiguousChannelError extends Error {
    /**
     * @param {string} name - The reference.
     * @param {number} count - How many channels carry that name.
     */
    constructor(name, count) {
        super(`Channel name '${name}' matches ${count} channels; pass the ID`);
        this.name        = 'AmbiguousChannelError';
        this.channelName = name;
        this.count       = count;
    }
}

/**
 * Trim and strip one leading `#` so `#development` and `development` agree.
 *
 * @param {string} ref - Operator-supplied channel reference.
 * @returns {string}
 */
const normalizeReference = (ref) => ref.trim().replace(/^#/, '');

/**
 * Lists channels and resolves operator-supplied channel references.
 */
class ConversationsService {
    #client;

    /** @param {import('./slack').SlackClient} client */
    constructor(client) {
        this.#client = client;
    }

    /**
     * Every non-archived public and private channel, across all pages.
     *
     * @returns {Promise<object[]>} Raw Slack channel objects.
     */
    async listChannels() {
        const channels = [];
        const args     = { exclude_archived: true, limit: kLIST_PAGE_SIZE, types: kLIST_TYPES };

        for await (const page of this.#client.paginate('conversations.list', args, (body) => body.channels)) {
            channels.push(...page);
        }

        return channels;
    }

    /**
     * Resolve a channel name or ID to `{ id, name }`.
     *
     * An ID-shaped reference is returned as-is without a request; the
     * `channels` command exists to make IDs discoverable. A name is matched
     * exactly against the channel list.
     *
     * @param {string} ref - Channel name (with or without `#`) or ID.
     * @returns {Promise<{ id: string, name: string }>}
     * @throws {ChannelNotFoundError} When no channel has that name.
     * @throws {AmbiguousChannelError} When more than one channel has that name.
     */
    async resolveChannel(ref) {
        const name = normalizeReference(ref);

        if (kCHANNEL_ID_PATTERN.test(name)) {
            return { id: name, name };
        }

        const matches = (await this.listChannels()).filter((channel) => channel.name === name);

        if (matches.length === 0) {
            throw new ChannelNotFoundError(name);
        }

        if (matches.length > 1) {
            throw new AmbiguousChannelError(name, matches.length);
        }

        return { id: matches[0].id, name: matches[0].name };
    }
}

module.exports = { AmbiguousChannelError, ChannelNotFoundError, ConversationsService };
