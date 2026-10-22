/**
 * Disposable PDF looker (`attachments/readers/pdf.ts`): bytes in on stdin, one JSON line out. It
 * counts the pages, measures each one's text and draws the ones with little
 * or none (a scan, a chart, a photo) as JPEGs. pdf.js parses the file in
 * JavaScript; only its drawing reaches `@napi-rs/canvas`, which is why this
 * worker, alone, may load a native addon. It still can't write, spawn or see
 * the environment, and `worker.ts` gives it a deadline and a small heap.
 */
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const bytes = Buffer.from(input.data, 'base64');

const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

try {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc;
  try {
    doc = await getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
      useWorkerFetch: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
  } catch (error) {
    out(error && error.name === 'PasswordException' ? { locked: true } : { error: 'unreadable' });
    process.exit(0);
  }
  const pages = doc.numPages;
  const look = Math.min(pages, input.lookPages);
  const chars = [];
  const rendered = [];
  let pixels = input.pixelBudget;
  let drawable = true;
  for (let n = 1; n <= look; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    const count = text.replace(/\s+/g, '').length;
    chars.push(count);
    if (!input.draw || !drawable || count >= input.threshold) continue;
    if (rendered.length >= input.drawPages || pixels <= 0) continue;
    try {
      const base = page.getViewport({ scale: 1 });
      // The long edge at most `maxEdge`, and never more pixels than are left to share.
      const edge = input.maxEdge / Math.max(base.width, base.height);
      const area = Math.sqrt(
        Math.min(pixels, input.maxEdge * input.maxEdge) / (base.width * base.height),
      );
      const scale = Math.max(0.1, Math.min(edge, area, 4));
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      const { canvas, context } = doc.canvasFactory.create(width, height);
      // Paper is white: a page with no background of its own isn't drawn on black.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const jpeg = canvas.toBuffer('image/jpeg', 82);
      pixels -= width * height;
      rendered.push({ page: n, width, height, data: jpeg.toString('base64') });
      doc.canvasFactory.destroy({ canvas, context });
    } catch {
      // No canvas on this computer, or a page it can't draw: the counts still stand.
      drawable = false;
    }
    page.cleanup();
  }
  out({ pages, chars, rendered, ...(!drawable && { undrawn: true }) });
} catch (error) {
  out({ error: error instanceof Error ? error.message.slice(0, 200) : 'failed' });
}
