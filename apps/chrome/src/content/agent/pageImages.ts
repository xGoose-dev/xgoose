import {prepareImageParts} from '../../shared/imageParts';

/** Copy a decoded page image; this does not initiate a network request. */
export async function readPageImage(url: string, budget = 3) {
  if (typeof document === 'undefined') return null;
  const image = Array.from(document.images).find(img =>
    (img.currentSrc || img.src) === url && img.complete && img.naturalWidth > 0);
  if (!image) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('Image pixels unavailable')), 'image/png'));
    return {url, images: await prepareImageParts(new Uint8Array(await blob.arrayBuffer()), blob.type, budget)};
  } catch { return null; } // Cross-origin canvases can be displayed but not exported.
}
