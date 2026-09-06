import { expect, test, type Page } from '@playwright/test';

const record = {
  id: 'record-1', userId: 'default-user', source: 'home',
  content: '先写清楚输入和输出，再让 Agent 修改复杂接口。', status: 'organized',
  createdAt: '2026-09-05T15:00:00+08:00', updatedAt: '2026-09-05T15:05:00+08:00',
  extData: { organization: { taskId: 'task-1', organizedAt: '2026-09-05T15:05:00+08:00', action: 'merge_record', reason: '补充了可执行的验收方法。' } },
  topics: [{ id: 'topic-1', title: 'AI 协作与可靠工作流', status: 'active' }],
};
const topic = {
  id: 'topic-1', userId: 'default-user', sessionId: 'topic-session-1', status: 'active',
  title: 'AI 协作与可靠工作流', summary: '持续沉淀让 AI 协作更稳定、可验证的方法。',
  content: '# 核心判断\n\n清晰的输入输出和验收标准能减少执行偏差。\n\n| 方法 | 作用 |\n|---|---|\n| 输入输出样例 | 明确边界 |\n\n```ts\nconst expected = true\n```',
  tags: ['AI Coding', '工作流'], pendingActions: '[]', createdAt: '2026-09-05T14:00:00+08:00', updatedAt: '2026-09-05T15:05:00+08:00',
  extData: { organization: { taskId: 'task-1', organizedAt: '2026-09-05T15:05:00+08:00', summary: '补充了接口验收方法。', recordIds: ['record-1'] } },
};

async function mockApi(page: Page) {
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let result: unknown;
    if (url.pathname === '/api/records') result = { data: [record], nextCursor: null, hasMore: false, total: 0, pageSize: 20 };
    else if (url.pathname === '/api/records/record-1') result = record;
    else if (url.pathname === '/api/topics') result = { data: [topic], nextCursor: null, hasMore: false, total: 0, pageSize: 20 };
    else if (url.pathname === '/api/topics/topic-1') result = topic;
    else if (url.pathname === '/api/contemplate') result = { taskId: 'task-1', pendingCount: 1, topicCount: 1, summary: 'done', eventCount: 1 };
    else return route.fulfill({ status: 404, json: { success: false, errorMsg: 'not found' } });
    return route.fulfill({ status: 200, json: { result, success: true, errorCode: null, errorMsg: null } });
  });
}

test.beforeEach(async ({ page }) => mockApi(page));

test('capture, records and topic traceability work', async ({ page }) => {
  await page.goto('/#/capture');
  await expect(page.getByRole('heading', { name: '捕获' })).toBeVisible();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '记录' }).click();
  await expect(page.getByText(record.content)).toBeVisible();
  await page.getByText(record.content).click();
  await expect(page.getByText('补充了可执行的验收方法。')).toBeVisible();
  await page.getByRole('button', { name: topic.title }).click();
  await expect(page.getByRole('heading', { name: '核心判断' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '相关原始记录' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.related-record-row .status, .related-record-row .topic-links')).toHaveCount(0);
  await expect(page.locator('.related-scroll')).toHaveCSS('height', '170px');
  await expect(page.locator('.detail-summary')).toHaveCSS('background-color', 'rgb(238, 244, 240)');
  expect(await page.locator('.detail-summary').evaluate(summary => summary.nextElementSibling?.id === 'related-records')).toBe(true);
});

test('capture draft survives navigation', async ({ page }) => {
  await page.goto('/#/capture');
  const input = page.getByLabel('此刻，想记下什么？');
  await input.fill('还没有整理完的草稿');
  await page.getByRole('button', { name: '回声' }).click();
  await page.getByRole('button', { name: '捕获' }).click();
  await expect(page.getByLabel('此刻，想记下什么？')).toHaveValue('还没有整理完的草稿');
});

const ok = (result: unknown) => ({ success: true, result });

test('all organization states and topic links survive pagination', async ({ page }) => {
  const statuses = ['pending', 'processing', 'organized', 'skipped', 'updated'];
  await page.route('**/api/records?*', route => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor');
    return route.fulfill({ json: ok({
      data: cursor ? [{ ...record, id: 'last', content: '下一页原始记录' }] : statuses.map((status, i) => ({ ...record, id: `state-${i}`, status, content: `状态记录 ${i}`, topics: i === 2 ? record.topics : [] })),
      hasMore: !cursor, nextCursor: cursor ? null : 'opaque+/cursor=',
    }) });
  });
  await page.goto('/#/records');
  for (const label of ['待整理', '整理中', '已整理', '暂未归入话题', '内容已修改，待重新整理']) await expect(page.getByText(label, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '加载更多' }).click();
  await expect(page.getByText('下一页原始记录')).toBeVisible();
  await expect(page.getByRole('button', { name: '加载更多' })).toHaveCount(0);
  const firstRow = page.locator('.record-row').first();
  await expect(firstRow.locator('.record-content')).toBeVisible();
  await expect(firstRow.locator('.record-content')).toHaveCSS('-webkit-line-clamp', '2');
  await expect(firstRow.locator('.record-meta time')).toBeVisible();
  await expect(firstRow.locator('.record-meta .status')).toBeVisible();
  await page.getByRole('button', { name: topic.title }).first().click();
  await expect(page).toHaveURL(/topic-detail\?id=topic-1/);
  await page.getByRole('button', { name: '记录', exact: true }).click();
  await expect(page).toHaveURL(/#\/records$/);
});

test('create saves once and preserves text typed during the request', async ({ page }) => {
  let writes = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/records', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ content: '第一条想法', source: 'home' });
    writes++;
    await pending;
    await route.fulfill({ json: ok({ ...record, status: 'pending' }) });
  });
  await page.goto('/#/capture');
  const input = page.getByLabel('此刻，想记下什么？');
  await input.fill('第一条想法');
  await page.getByRole('button', { name: '记录', exact: true }).first().click();
  await expect(page.getByRole('button', { name: '保存中…' })).toBeDisabled();
  await input.fill('请求期间的新想法');
  release();
  await expect(page.getByRole('status')).toContainText('已记录');
  await expect(input).toHaveValue('请求期间的新想法');
  expect(writes).toBe(1);
  await page.reload();
  await expect(input).toHaveValue('请求期间的新想法');
});

test('edit updates original content and state; processing disables editing', async ({ page }) => {
  let edited = { ...record };
  await page.route('**/api/records/record-1', async route => {
    if (route.request().method() === 'PATCH') edited = { ...edited, content: route.request().postDataJSON().content, status: 'updated' };
    return route.fulfill({ json: ok(edited) });
  });
  await page.goto('/#/record-detail?id=record-1');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('编辑原始记录').fill('修改后的原始想法');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByText('修改后的原始想法', { exact: true })).toBeVisible();
  await expect(page.getByText('内容已修改，待重新整理')).toBeVisible();
  await expect(page.getByRole('heading', { name: '上次整理' })).toBeVisible();
  edited.status = 'processing';
  await page.reload();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeDisabled();
});

test('uncertain writes keep the draft and never retry automatically', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/records', route => { writes++; return route.abort('failed'); });
  await page.goto('/#/capture');
  await page.getByLabel('此刻，想记下什么？').fill('不要丢失这条记录');
  await page.getByRole('button', { name: '记录', exact: true }).first().click();
  await expect(page.getByRole('alert')).toContainText('未确认是否保存');
  await expect(page.getByLabel('此刻，想记下什么？')).toHaveValue('不要丢失这条记录');
  expect(writes).toBe(1);
});

test('empty, missing and error pages have recovery actions', async ({ page }) => {
  await page.route('**/api/records?*', route => route.fulfill({ json: ok({ data: [], nextCursor: null, hasMore: false }) }));
  await page.goto('/#/records');
  await expect(page.getByText('还没有记录')).toBeVisible();
  await page.goto('/#/topic-detail?id=missing');
  await expect(page.getByRole('alert')).toContainText('内容不存在');
  await page.getByRole('button', { name: '回声', exact: true }).click();
  await expect(page).toHaveURL(/#\/topics$/);
  await page.goto('/#/topic-detail');
  await expect(page.getByRole('heading', { name: '缺少内容编号' })).toBeVisible();
});

test('topic renders safe Markdown and related memories without a chat runtime', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/topics/topic-1', route => route.fulfill({ json: ok({ ...topic, content: `${topic.content}\n\n<script>window.hacked = true</script>\n\n[危险链接](javascript:alert(1))` }) }));
  await page.goto('/#/topic-detail?id=topic-1');
  await expect(page.getByRole('heading', { name: '核心判断' })).toBeVisible();
  await page.getByRole('button', { name: '相关原始记录' }).click();
  await expect(page.getByText(record.content)).not.toBeVisible();
  await page.getByRole('button', { name: '相关原始记录' }).click();
  await expect(page.getByText(record.content)).toBeVisible();
  expect(await page.locator('.markdown script, .markdown a[href^="javascript:"]').count()).toBe(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('topic.png'), fullPage: true });
});

test('capture and records fit the viewport', async ({ page }, testInfo) => {
  for (const route of ['capture', 'records', 'topics']) {
    await page.goto(`/#/${route}`);
    if (route === 'records') await expect(page.getByText(record.content)).toBeVisible();
    if (route === 'topics') await expect(page.getByRole('button', { name: topic.title })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${route}.png`), fullPage: true });
  }
});
