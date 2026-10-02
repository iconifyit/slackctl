'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createFakeSlack } = require('./helpers/fake-slack');

test('fake Slack rejects a body that is not form-encoded, so an encoding regression fails instead of hanging', async () => {
    // Scenario: the transport is accidentally reverted to JSON bodies.
    const { fetch } = createFakeSlack({ 'auth.test': { body: { ok: true } } });

    await assert.rejects(
        fetch('https://slack.com/api/auth.test', { body: JSON.stringify({ a: 1 }), headers: { 'Content-Type': 'application/json' }, method: 'POST' }),
        { message: /expects a form-encoded body/ },
    );
});

test('fake Slack decodes only the known numeric and boolean fields; other values stay the strings they were sent as', async () => {
    // Scenario: a message text that looks numeric and a numeric-looking cursor must not be coerced.
    const { fetch, calls } = createFakeSlack({ 'chat.postMessage': { body: { ok: true } } });

    await fetch('https://slack.com/api/chat.postMessage', {
        body    : new URLSearchParams({ channel: 'C01234ABC', cursor: '200', inclusive: 'true', limit: '100', text: '00123' }),
        headers : { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
        method  : 'POST',
    });

    assert.deepEqual(calls[0].args, { channel: 'C01234ABC', cursor: '200', inclusive: true, limit: 100, text: '00123' });
});
