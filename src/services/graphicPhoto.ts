// Manual photo uploads for the graphic builders. The site no longer auto-fills
// player faces or team logos into graphics; admins attach their own artwork.

const maxEdge = 700;
const maxEncodedLength = 900_000;

export const isUploadedPhoto = (value: unknown): value is string =>
  typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= maxEncodedLength;

// Reads, validates and downscales an uploaded image into a bounded data URL so
// drafts and published graphics stay reasonably sized.
export async function readGraphicPhoto(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image under 10 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('The selected image could not be read. Choose another file.'));
      element.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('The selected image is empty. Choose another file.');
    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not process the image. Retry.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // PNG keeps transparency for logos; fall back to JPEG when PNG is too large.
    const png = canvas.toDataURL('image/png');
    const encoded = png.length <= maxEncodedLength ? png : canvas.toDataURL('image/jpeg', 0.82);
    if (!isUploadedPhoto(encoded)) throw new Error('The image is too large even after resizing. Choose a smaller image.');
    return encoded;
  } finally {
    URL.revokeObjectURL(url);
  }
}
