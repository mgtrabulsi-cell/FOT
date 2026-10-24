export const postMediaExtensions: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
export const angleMediaAccept = Object.keys(postMediaExtensions).join(',');
export const isPostVideo = (path: string) => /\.(mp4|webm|mov)$/i.test(path);
export const isVideoFile = (file: Pick<File, 'type'>) => file.type.startsWith('video/');
export function angleMediaError(file: Pick<File, 'type' | 'size'>): string {
  if (!postMediaExtensions[file.type]) return 'Use JPG, PNG, WebP, GIF, MP4, WebM, or MOV attachments.';
  if (!file.size) return 'This attachment is empty. Choose another file.';
  const limit = isVideoFile(file) ? 50 : 5;
  if (file.size > limit * 1024 * 1024) return `${isVideoFile(file) ? 'Videos' : 'Photos'} must be ${limit} MB or smaller.`;
  return '';
}
