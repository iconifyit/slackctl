#!/usr/bin/env node

const TOKEN = process.env.SLACK_ADMIN_TOKEN;

if (!TOKEN) {
    console.error("SLACK_ADMIN_TOKEN is not set.");
    process.exit(1);
}

const channel = process.argv[2];
const maxDelete = Number(process.argv[3] || 200);

if (!channel) {
    console.error("Usage: node slack-delete.js CHANNEL_ID [MAX_MESSAGES]");
    process.exit(1);
}

async function slack(method, body = {}) {
    const response = await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    const result = await response.json();

    if (!result.ok) {
        throw new Error(`${method}: ${result.error}`);
    }

    return result;
}

async function main() {
    // Find out who the token belongs to.
    const auth = await slack("auth.test");
    const myUserId = auth.user_id;

    console.log(`Authenticated as ${auth.user} (${myUserId})`);

    let cursor;
    const messages = [];

    // Find our messages, newest first.
    while (messages.length < maxDelete) {
        const result = await slack("conversations.history", {
            channel,
            limit: 15,
            ...(cursor ? { cursor } : {}),
        });

        for (const message of result.messages) {
            if (message.user === myUserId) {
                messages.push(message);

                if (messages.length >= maxDelete) {
                    break;
                }
            }
        }

        cursor = result.response_metadata?.next_cursor;

        if (!cursor) {
            break;
        }

        // conversations.history may be heavily rate limited
        // for newly created non-Marketplace apps.
        if (messages.length < maxDelete) {
            await new Promise(resolve => setTimeout(resolve, 61_000));
        }
    }

    console.log(`Found ${messages.length} messages to delete.`);

    // SAFETY: Preview before doing anything destructive.
    for (const message of messages) {
        const date = new Date(Number(message.ts) * 1000);

        console.log(
            `${date.toISOString()}  ${message.text?.slice(0, 100) || "[no text]"}`
        );
    }

    if (process.env.DELETE !== "YES") {
        console.log("\nDRY RUN — nothing deleted.");
        console.log(
            `To actually delete these messages:\n\n` +
            `DELETE=YES node slack-delete.js ${channel} ${maxDelete}`
        );
        return;
    }

    for (let i = 0; i < messages.length; i++) {
        const message = messages[i];

        await slack("chat.delete", {
            channel,
            ts: message.ts,
        });

        console.log(`Deleted ${i + 1}/${messages.length}: ${message.ts}`);

        // Be polite to Slack's API.
        await new Promise(resolve => setTimeout(resolve, 1250));
    }

    console.log(`Done. Deleted ${messages.length} messages.`);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});