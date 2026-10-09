import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalUrl, createRunId, assertImageBounds, targetPath } from '../../src/capture/helpers.js';

test('navigation guards reject remote redirects and credentials', () => {
  for (const value of ['http://localhost/path', 'https://example-site.ddev.site/path', 'http://127.0.0.2/', 'http://[::1]/']) assert.equal(isLocalUrl(value), true);
  for (const value of ['https://example.com/', 'http://localhost.example.com/', 'http://user:password@localhost/', 'file:///tmp/test', 'data:text/html,test', 'not a URL']) assert.equal(isLocalUrl(value), false);
});

test('run identity preserves timestamp, process and revision grammar', () => {
  assert.equal(createRunId(new Date('2026-10-09T10:20:30.123Z'), 123, 'abcdef123456'), '2026-10-09T10-20-30-123Z-123-abcdef123456');
  assert.throws(() => createRunId(new Date(), 1, '../unsafe'));
  assert.throws(() => createRunId(new Date('invalid'), 1, 'abcdef1'));
});

test('image bounds apply to physical pixels and long pages', () => {
  assert.doesNotThrow(() => assertImageBounds(1280, 1000, 2));
  for (const dimensions of [[1280, 30001, 1], [4096, 4096, 2], [1, Infinity, 1], [0, 100, 1]]) assert.throws(() => assertImageBounds(...dimensions));
});

test('per-side paths do not use inherited object properties', () => {
  assert.equal(targetPath({ path: '/', paths: { local: '/local' } }, 'local'), '/local');
  assert.equal(targetPath({ path: '/', paths: {} }, 'constructor'), '/');
});
