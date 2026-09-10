import test from 'node:test';
import assert from 'node:assert/strict';
import { bindFilePickers } from '../file-picker.js';

function fixture(storage = new Map()) {
  const input = new EventTarget();
  const page = Object.assign(new EventTarget(), { hidden: false });
  const host = Object.assign(new EventTarget(), {
    location: { pathname: '/viewer/' },
    sessionStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
  });
  const calls = [];
  const picker = bindFilePickers([input], {
    suspend: () => calls.push('pause'), resume: () => calls.push('resume'),
    interrupted: () => calls.push('interrupted'),
  }, page, host);
  return { input, page, host, calls, picker };
}

test('focus and early foreground events cannot resume a still-open native picker', () => {
  const { input, page, host, calls, picker } = fixture();
  const click = new Event('click', { cancelable: true });
  input.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
  assert.equal(picker.blocked, true);
  page.hidden = true;
  page.dispatchEvent(new Event('visibilitychange'));
  page.hidden = false;
  page.dispatchEvent(new Event('visibilitychange'));
  host.dispatchEvent(new Event('focus'));
  host.dispatchEvent(new Event('pageshow'));
  assert.ok(calls.every(call => call === 'pause'));
  assert.equal(picker.blocked, true);
});

test('file processing starts before resuming, and cancel also releases the pause', async () => {
  const { input, calls, picker } = fixture();
  input.addEventListener('change', () => calls.push('process'));
  input.dispatchEvent(new Event('click'));
  input.dispatchEvent(new Event('change'));
  assert.equal(picker.blocked, false);
  assert.deepEqual(calls, ['pause', 'process']);
  await Promise.resolve();
  assert.deepEqual(calls, ['pause', 'process', 'resume']);
  input.dispatchEvent(new Event('click'));
  input.dispatchEvent(new Event('cancel'));
  await Promise.resolve();
  assert.equal(picker.blocked, false);
  assert.deepEqual(calls.slice(-2), ['pause', 'resume']);
});

test('background selection waits for foreground; interrupted selection is detected without file data', async () => {
  const storage = new Map();
  const first = fixture(storage);
  first.input.dispatchEvent(new Event('click'));
  assert.deepEqual([...storage.values()], ['open']);
  const recovered = fixture(storage);
  assert.deepEqual(recovered.calls, ['interrupted']);
  assert.equal(storage.size, 0);
  recovered.input.dispatchEvent(new Event('click'));
  recovered.page.hidden = true;
  recovered.input.dispatchEvent(new Event('change'));
  await Promise.resolve();
  assert.equal(recovered.picker.blocked, true);
  assert.ok(!recovered.calls.includes('resume'));
  recovered.page.hidden = false;
  recovered.page.dispatchEvent(new Event('visibilitychange'));
  assert.equal(recovered.picker.blocked, false);
  assert.equal(recovered.calls.at(-1), 'resume');
});
