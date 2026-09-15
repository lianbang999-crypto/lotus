// Run with playwright-cli run-code --filename tests/browser/chat-flow.js.
// Requires the isolated chat-ui-vite config on 5181 and local SSE fixture on 5182.
async (page) => {
  const origin = 'http://127.0.0.1:5181';
  const run = `聊天回归-${Date.now()}`;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({width: 1280, height: 800});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto(`${origin}/#chat`);
  const input = page.getByRole('textbox', {name: '发送给莲花'});
  const rows = async () => (await (await page.request.get(`${origin}/api/entries`)).json()).entries;
  const ownRows = async () => (await rows()).filter(entry => entry.content.includes(run));
  const openSpace = () => page.getByRole('button', {name: '打开我的空间', exact: true}).click();
  const healthy = async () => {
    const visibleErrors = await page.locator('.error-text:visible, [role="alert"]:visible').allTextContents();
    if (visibleErrors.length || errors.length) throw new Error(JSON.stringify({visibleErrors, errors}));
  };
  await input.fill(`${run}：请记录这条开发验收笔记。`);
  if (await page.getByRole('link', {name: '我的记录', exact: true}).isVisible()) throw new Error('record navigation should be tucked away');
  await openSpace();
  await page.getByRole('dialog', {name: '我的空间', exact: true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', {name: '我的空间', exact: true}).waitFor({state: 'hidden'});
  if (!(await page.getByRole('button', {name: '打开我的空间'}).evaluate(el => el === document.activeElement))) throw new Error('drawer did not restore focus');
  await openSpace();
  await page.getByRole('link', {name: '我的记录', exact: true}).click();
  await page.getByRole('link', {name: '回到莲花对话'}).click();
  if (!(await input.inputValue()).includes(run)) throw new Error('draft lost on navigation');
  await page.getByRole('button', {name: '发送消息', exact: true}).click();
  await page.getByRole('button', {name: '确认保存', exact: true}).waitFor({timeout: 30000});
  if ((await ownRows()).length) throw new Error('saved before approval');
  await input.fill('等待确认时保留的新草稿');
  if (await page.getByRole('button', {name: '发送消息', exact: true}).isEnabled()) throw new Error('new message can bypass pending approval');
  await page.reload();
  await page.getByRole('button', {name: '确认保存', exact: true}).waitFor();
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: '确认保存', exact: true}).click();
  await page.getByText('记录已经保存。需要时，可以从我的空间再查看。', {exact: true}).last().waitFor({timeout: 30000});
  await page.getByRole('button', {name: '停止回复', exact: true}).waitFor({state: 'hidden'});
  if ((await ownRows()).length !== 1) throw new Error('approval must save exactly once');
  await healthy();
  await input.fill(`${run}：请记录另一条，用于取消测试。`);
  await page.getByRole('button', {name: '发送消息', exact: true}).click();
  await page.getByRole('button', {name: '取消', exact: true}).waitFor();
  await page.getByRole('button', {name: '取消', exact: true}).click();
  await page.getByText('已取消，没有保存这条记录。你可以继续调整，也可以先放一放。', {exact: true}).last().waitFor({timeout: 30000});
  await page.getByRole('button', {name: '停止回复', exact: true}).waitFor({state: 'hidden'});
  if ((await ownRows()).length !== 1) throw new Error('cancel wrote a record');
  await healthy();
  await input.fill(`${run}：请记录第三条，用于不刷新确认测试。`);
  await page.getByRole('button', {name: '发送消息', exact: true}).click();
  await page.getByRole('button', {name: '确认保存', exact: true}).waitFor();
  await page.getByRole('button', {name: '确认保存', exact: true}).click();
  await page.waitForFunction(async (run) => {
    const {entries} = await (await fetch('/api/entries')).json();
    return entries.some(entry => entry.content.includes(run) && entry.content.includes('用于不刷新确认测试'));
  }, run);
  await page.locator('.message-assistant').last().getByText('记录已经保存。需要时，可以从我的空间再查看。', {exact: true}).waitFor();
  await page.getByRole('button', {name: '停止回复', exact: true}).waitFor({state: 'hidden', timeout: 30000});
  if ((await ownRows()).length !== 2) throw new Error('direct approval must save exactly once');
  await healthy();
  await page.reload();
  await input.waitFor();
  await healthy();
  if (await page.getByRole('button', {name: '确认保存', exact: true}).count()) throw new Error('resolved approval returned after reload');
  const history = await (await page.request.get(`${origin}/api/agent/get-messages`)).json();
  const tools = history.flatMap(message => message.parts).filter(part => part.input?.content?.includes(run));
  if (tools.length !== 3 || tools.filter(part => part.state === 'output-available').length !== 2 || tools.filter(part => part.state === 'output-denied').length !== 1) throw new Error('tool cards were lost or reverted after reload');
  // Clean only synthetic records created by this run through normal proposals.
  for (const entry of await ownRows()) {
    const headers = {Origin: origin};
    const response = await page.request.post(`${origin}/api/proposals`, {headers, data: {action: 'delete', entryId: entry.id, expectedVersion: entry.version}});
    const {proposal} = await response.json();
    const result = await page.request.post(`${origin}/api/proposals/${proposal.id}/approve`, {headers, data: {}});
    if (!result.ok()) throw new Error('fixture cleanup failed');
  }
  if ((await ownRows()).length) throw new Error('fixture record remains');
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('mobile horizontal overflow');
  console.log(JSON.stringify({ok: true, checks: ['drawer focus and draft retention', 'tool-only approval', 'refresh pending', 'approve and continue without UI errors', 'cancel without write', 'direct approval', 'resolved state after reload', 'mobile overflow', 'synthetic record cleanup']}));
}
