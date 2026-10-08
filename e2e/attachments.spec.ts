import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

/**
 * Long pastes fold into cards, files attach from the picker, a drop or the
 * clipboard, and everything reaches the model and the transcript (ADR 0017).
 */
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { onboarded: true, profile: { name: 'Ada' } } });
});

/** 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Paste the way a browser does: a ClipboardEvent on the focused field. */
async function paste(page: Page, text: string, shift = false) {
  const field = page.getByRole('textbox', { name: /Message/ });
  await field.focus();
  if (shift) await page.keyboard.down('Shift');
  await field.evaluate(
    (el, { text, shift }) => {
      if (shift) {
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'V',
            metaKey: true,
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
          }),
        );
      }
      const data = new DataTransfer();
      data.setData('text/plain', text);
      const event = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      // A real paste inserts the text when nothing takes it.
      if (el.dispatchEvent(event)) document.execCommand('insertText', false, text);
    },
    { text, shift },
  );
  if (shift) await page.keyboard.up('Shift');
}

test('a long paste becomes a card you can open, edit and send', async ({ page }) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });

  // Short pastes stay in the box.
  await paste(page, 'just a line');
  await expect(composer).toHaveValue('just a line');
  await composer.fill('');

  const log = Array.from({ length: 40 }, (_, i) => `line ${i + 1}: charge failed`).join('\n');
  await paste(page, log);
  await expect(composer).toHaveValue('');
  const card = page.getByRole('button', { name: /Pasted text, 40 lines/ });
  await expect(card).toBeVisible();

  // Open it, edit it: the card follows.
  await card.click();
  const dialog = page.getByRole('dialog', { name: 'Pasted text' });
  await expect(dialog.getByRole('textbox')).toHaveValue(log);
  await dialog.getByRole('textbox').fill('line 1 only');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: /Pasted text, 1 line\b/ })).toBeVisible();

  // Send with nothing typed once it's uploaded.
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  await composer.press('Enter');
  await expect(page).toHaveURL(/\/c\/c_/);
  await expect(page.getByText('You attached one thing: Pasted text (pasted text).')).toBeVisible();
  // The transcript keeps the card, not the wall of text.
  await expect(
    page.getByRole('list', { name: 'Attached' }).getByRole('button', { name: /Pasted text/ }),
  ).toBeVisible();
});

test('Shift+paste keeps a long paste inline, and "Paste into message" undoes a card', async ({
  page,
}) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });
  const long = 'x'.repeat(1500);
  await paste(page, long, true);
  await expect(composer).toHaveValue(long);
  await composer.fill('Look:');

  await paste(page, long);
  await page.getByRole('button', { name: /^Pasted text,/ }).click();
  await page.getByRole('button', { name: 'Paste into message' }).click();
  await expect(composer).toHaveValue(`Look:\n\n${long}`);
  await expect(page.getByRole('button', { name: /^Pasted text,/ })).toHaveCount(0);
});

test('files attach from the picker and a drop, show previews, and survive a reload', async ({
  page,
}) => {
  await page.goto('/');
  const composer = page.getByRole('textbox', { name: /Message/ });

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files' }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
    {
      name: 'team.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,team\nAda,Platform\nGrace,Compilers\n'),
    },
  ]);
  await expect(page.getByRole('button', { name: /team\.csv, CSV, 3 lines/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /dot\.png, PNG, 1 × 1/ })).toBeVisible();

  // Dropping a file anywhere on the chat attaches it; a folder is refused kindly.
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['%PDF-1.7\n'], 'report.pdf', { type: 'application/pdf' }));
    const target = document.querySelector('textarea') ?? document.body;
    for (const type of ['dragenter', 'dragover', 'drop'])
      target.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }),
      );
  });
  const pdf = page.getByRole('button', { name: /report\.pdf, PDF/ });
  await expect(pdf).toBeVisible();

  // The same file twice is attached once.
  const again = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files' }).click();
  await (await again).setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('button', { name: /^dot\.png,/ })).toHaveCount(1);
  await expect(page.getByText('Already attached')).toBeVisible();

  // Delete on a focused card takes it off.
  await pdf.focus();
  await page.keyboard.press('Delete');
  await expect(pdf).toHaveCount(0);

  // The CSV previews as a table.
  await page.getByRole('button', { name: /^team\.csv,/ }).click();
  const table = page.getByRole('dialog', { name: 'team.csv' }).getByRole('table');
  await expect(table.getByRole('columnheader', { name: 'team' })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Compilers' })).toBeVisible();
  await page.keyboard.press('Escape');

  await composer.fill('What are these?');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  await composer.press('Enter');
  await expect(
    page.getByText(/You attached 2 things: dot\.png \(image\/png\), team\.csv \(text\/csv\)/),
  ).toBeVisible();
  await expect(page.getByText('I can see the image.')).toBeVisible();

  await page.reload();
  const attached = page.getByRole('list', { name: 'Attached' });
  await expect(attached.getByRole('button', { name: /^dot\.png,/ })).toBeVisible();
  await attached.getByRole('button', { name: /^dot\.png,/ }).click();
  const preview = page.getByRole('dialog', { name: 'dot.png' });
  await expect(preview.getByRole('img', { name: 'dot.png' })).toBeVisible();
  await expect(preview.getByText('1 of 2')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'team.csv' })).toBeVisible();
});

test('a 12 MP phone photo reaches the model fitted, and the one you sent stays whole', async ({
  page,
}) => {
  await page.goto('/');
  // A phone photo, 4032 × 3024 of detail that doesn't compress away, dropped on the chat.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4032;
    canvas.height = 3024;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i++)
      pixels.data[i] = i % 4 === 3 ? 255 : (i * 2654435761) >>> 24;
    context.putImageData(pixels, 0, 0);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.92));
    if (!blob) throw new Error('no photo');
    const data = new DataTransfer();
    data.items.add(new File([blob], 'IMG_0001.jpg', { type: 'image/jpeg' }));
    const target = document.querySelector('textarea') ?? document.body;
    for (const type of ['dragenter', 'dragover', 'drop'])
      target.dispatchEvent(
        new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }),
      );
  });
  await expect(
    page.getByRole('button', { name: /IMG_0001\.jpg, JPE?G, 4032 × 3024/ }),
  ).toBeVisible();
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('What is this?');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  await composer.press('Enter');
  await expect(page.getByText('I can see the image.')).toBeVisible();
  await expect(page.getByText('IMG_0001.jpg came 2000 × 1500.')).toBeVisible();
});

test('a pasted screenshot attaches as a picture', async ({ page }) => {
  await page.goto('/');
  const field = page.getByRole('textbox', { name: /Message/ });
  await field.focus();
  await field.evaluate((el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, PNG.toString('base64'));
  await expect(page.getByRole('button', { name: /image\.png, PNG/ })).toBeVisible();
});

test('reads an Office attachment through the shared tool and returns a durable download', async ({
  page,
}) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files' }).click();
  const bytes = await readFile(new URL('./fixtures/everyday.docx', import.meta.url));
  await (
    await chooser
  ).setFiles({
    name: 'everyday.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: bytes,
  });
  await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  const composer = page.getByRole('textbox', { name: /Message/ });
  await composer.fill('Read and publish this document');
  await composer.press('Enter');
  await expect(page.getByText('The document says: A document read by Conch.')).toBeVisible();
  // Drawn as its file's card, with its own Look closer.
  const file = page
    .getByRole('figure', { name: 'Finished document.docx' })
    .getByRole('button', { name: 'Look closer', exact: true });
  await expect(file).toBeVisible();
  await page.reload();
  await expect(file).toBeVisible();
  await file.click();
  const preview = page.getByRole('dialog', { name: 'Finished document.docx' });
  const download = page.waitForEvent('download');
  await preview.getByRole('link', { name: /Download/ }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('Finished document.docx');
  const path = await saved.path();
  expect(path).toBeTruthy();
  expect(await readFile(path!)).toEqual(bytes);
});
