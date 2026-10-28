const MAX_SIDE = 1600;
const KEEP_AS_IS_BYTES = 1_500_000;
const SERVER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Phone photos are often large or in formats the server doesn't accept (avif, bmp, jfif variants).
// Re-encode them in the browser as a compact JPEG so uploads are small and always accepted.
export async function prepareImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error(`"${file.name}" is not an image.`);
  }
  if (SERVER_TYPES.includes(file.type) && file.size <= KEEP_AS_IS_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Can't read "${file.name}". Please choose a JPG or PNG photo (iPhone HEIC photos need converting first).`);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process this photo.');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) throw new Error(`Could not prepare "${file.name}".`);
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`, { type: 'image/jpeg' });
}
