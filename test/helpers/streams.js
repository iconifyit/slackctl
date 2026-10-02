'use strict';

/**
 * Stream stand-ins for stdin and stdout/stderr in command tests.
 */

const { Readable, Writable } = require('node:stream');

/**
 * A readable that delivers the given lines as ONE chunk, the way a terminal
 * paste or a shell pipe commonly does, so tests exercise the shared-chunk case.
 *
 * @param {string[]} lines - Lines the operator "types".
 * @param {{ isTTY?: boolean }} [options]
 * @returns {Readable}
 */
const scriptedInput = (lines, { isTTY = true } = {}) => {
    const chunk  = lines.length === 0 ? [] : [`${lines.join('\n')}\n`];
    const stream = Readable.from(chunk);

    stream.isTTY = isTTY;

    return stream;
};

/**
 * A writable that collects everything written to it in `.text`.
 *
 * @param {{ isTTY?: boolean, columns?: number }} [options] - Terminal shape to report.
 * @returns {Writable & { text: string }}
 */
const capture = ({ isTTY = false, columns = 80 } = {}) => {
    const chunks = [];
    const stream = new Writable({
        write(chunk, encoding, callback) {
            chunks.push(String(chunk));
            callback();
        },
    });

    stream.isTTY   = isTTY;
    stream.columns = columns;
    Object.defineProperty(stream, 'text', { get: () => chunks.join('') });

    return stream;
};

module.exports = { capture, scriptedInput };
