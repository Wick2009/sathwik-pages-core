import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// The announcement and lesson chats talk to Spring through the Messages system's modules
// (published to assets/js/projects/messages/) instead of keeping their own copies.
const CHATS = ['announcement_chat.html', 'lesson_chat.html'];
const MESSAGES_IMPORT = /import\s*\{([^}]+)\}\s*from\s*'\{\{site\.baseurl\}\}\/assets\/js\/projects\/messages\/([\w-]+\.js)'/g;

const source = name => readFileSync(new URL(`../_includes/${name}`, import.meta.url), 'utf8');

for (const name of CHATS) {
  test(`${name} uses the Messages socket, Spring requests and message shape`, () => {
    const files = [...source(name).matchAll(MESSAGES_IMPORT)].map(match => match[2]);
    assert.deepEqual(files.sort(), ['chat-socket.js', 'messages-api.js', 'messages-model.js']);
  });

  test(`${name} has no socket code or port of its own`, () => {
    const text = source(name);
    assert.doesNotMatch(text, /8589/);
    assert.doesNotMatch(text, /new SockJS|Stomp\.over|sockjs\.min\.js/);
    assert.doesNotMatch(text, /backboneGroupId/);
  });

  test(`everything ${name} imports from Messages exists there`, async () => {
    for (const [, names, file] of source(name).matchAll(MESSAGES_IMPORT)) {
      const module = await import(new URL(`../../messages/js/${file}`, import.meta.url));
      for (const imported of names.split(',').map(part => part.trim()).filter(Boolean)) {
        assert.equal(typeof module[imported], 'function', `${file} exports ${imported}`);
      }
    }
  });
}
