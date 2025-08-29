import fs from 'fs';
import path from 'path';


async function renderVeedSync(page, serverUrl, width, height, presetName, audioData, frames, seed = 12345, presetType = 'js') {
  const veedSyncPath = path.join(process.cwd(), 'dist/veed-sync.js');
  const veedSyncMinPath = path.join(process.cwd(), 'dist/veed-sync.min.js');
  if (!fs.existsSync(veedSyncPath) && !fs.existsSync(veedSyncMinPath)) {
    throw new Error(
      'Veed Sync build not found!\n' +
      'Please build Veed Sync first:\n' +
      '  yarn build\n'
    );
  }

  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  await page.goto(`${serverUrl}/test-${presetType}.html`, { waitUntil: 'domcontentloaded' });

  const startTime = Date.now();

  await page.evaluate(async (params) => {
    await window.startVisualization(params);
  }, { width, height, presetName, audioData, frames, seed });

  try {
    await page.waitForFunction(() => window.renderComplete === true, {
      timeout: 30000
    });
  } catch (error) {
    // Get any console errors for debugging
    const logs = await page.evaluate(() => window.consoleLogs || []);
    throw new Error(`Rendering timeout after 30s. Console logs: ${JSON.stringify(logs)}`);
  }

  const renderTime = Date.now() - startTime;
  if (process.env.VERBOSE_TEST || process.env.CI) {
    console.log(`Rendered ${presetName} (${presetType.toUpperCase()}) in ${renderTime}ms`);
  }

  const screenshot = await page.screenshot({
    type: 'png',
    fullPage: false,
    omitBackground: true
  });
  return screenshot;
}

export {
  renderVeedSync
};
