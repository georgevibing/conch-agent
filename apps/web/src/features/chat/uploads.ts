import { type Attachment, UploadedAttachment } from '@conch/protocol';

import { ApiError, SIGNED_OUT_EVENT } from '../../api/client';

/** Where an attachment can be loaded from (a picture, a PDF) or downloaded. */
export const attachmentUrl = (id: string, download = false) =>
  `/api/attachments/${encodeURIComponent(id)}${download ? '?download=1' : ''}`;

/**
 * Upload one file's raw bytes (ADR 0017), reporting progress. XHR rather than
 * fetch because fetch still can't report upload progress everywhere.
 */
export function uploadAttachment(
  body: Blob,
  options: {
    name: string;
    pasted?: boolean;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  },
): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/attachments');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-conch-name', encodeURIComponent(options.name));
    if (body.type) xhr.setRequestHeader('x-conch-type', body.type.slice(0, 255));
    if (options.pasted) xhr.setRequestHeader('x-conch-pasted', '1');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let json: unknown;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        json = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = UploadedAttachment.safeParse(json);
        if (parsed.success) return resolve(parsed.data.attachment);
        return reject(new ApiError(xhr.status, 'bad-response', 'Conch sent back something odd.'));
      }
      if (xhr.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
      const body = (json ?? {}) as { error?: string; message?: string };
      reject(new ApiError(xhr.status, body.error ?? 'error', body.message ?? 'Couldn’t upload.'));
    };
    xhr.onerror = () =>
      reject(new ApiError(0, 'offline', 'Couldn’t reach Conch. Check the connection.'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** Take an unsent upload off the gateway. Failing is fine: unsent uploads are swept anyway. */
export function discardAttachment(id: string): void {
  void fetch(attachmentUrl(id), { method: 'DELETE' }).catch(() => undefined);
}

/** The text of a text attachment. */
export async function attachmentText(id: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(attachmentUrl(id), { signal });
  if (!response.ok) throw new ApiError(response.status, 'error', 'That attachment is gone.');
  return response.text();
}

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Models take images up to about this; bigger ones are scaled down before they're sent. */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MAX_EDGE = 8000;
const IMAGE_TARGET_EDGE = 4096;

/**
 * A picture too big for the models is quietly scaled down (and kept if that
 * fails): nobody should have to resize a phone photo by hand. GIFs keep their
 * animation, so they're left alone.
 */
export async function fitImage(file: File): Promise<File> {
  if (!IMAGE_TYPES.has(file.type) || file.type === 'image/gif') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const edge = Math.max(bitmap.width, bitmap.height);
    if (file.size <= IMAGE_MAX_BYTES && edge <= IMAGE_MAX_EDGE) {
      bitmap.close();
      return file;
    }
    const scale = Math.min(1, IMAGE_TARGET_EDGE / edge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
