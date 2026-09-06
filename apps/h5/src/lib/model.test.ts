import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterSave, organization, uniqueItems } from './model';

test('organization accepts legacy null and rejects malformed extensions', () => {
  assert.equal(organization(null), null);
  assert.equal(organization({ organization: [] }), null);
  assert.equal(organization({ organization: { reason: 'old' } }), null);
  assert.deepEqual(organization({ extra: true, organization: { taskId: 't', organizedAt: 'date', recordIds: ['r', 1], summary: '变化' } })?.recordIds, ['r']);
});
test('saving preserves text entered during a request', () => {
  assert.equal(afterSave('old', 'old'), '');
  assert.equal(afterSave('old and new', 'old'), 'old and new');
});
test('pages deduplicate IDs and ignore absent pages', () => {
  assert.deepEqual(uniqueItems(undefined), []);
  assert.deepEqual(uniqueItems([{ data: [{ id: 'a' }] }, { data: [{ id: 'a' }, { id: 'b' }] }]), [{ id: 'a' }, { id: 'b' }]);
});
