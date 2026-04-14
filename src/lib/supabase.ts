import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = 'post-videos';

// Ensure the bucket exists (called once at startup)
export async function ensureVideoBucket(): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error) throw new Error(`Failed to create storage bucket: ${error.message}`);
  }
}

// Download a video from a public URL and return as Buffer + content type
export async function downloadVideoFromUrl(
  url: string
): Promise<{ buffer: Buffer; contentType: string; sizeBytes: number }> {
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 60000,
    maxContentLength: 500 * 1024 * 1024, // 500 MB max
  });
  const buffer = Buffer.from(res.data);
  const contentType = (res.headers['content-type'] as string) || 'video/mp4';
  return { buffer, contentType, sizeBytes: buffer.length };
}

// Upload a video buffer to Supabase Storage and return the storage path + public URL
export async function uploadVideoToStorage(
  buffer: Buffer,
  contentType: string,
  userId: string
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = contentType.includes('mp4') ? 'mp4'
    : contentType.includes('mov') ? 'mov'
    : contentType.includes('avi') ? 'avi'
    : contentType.includes('webm') ? 'webm'
    : 'mp4';

  const storagePath = `${userId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: false });

  if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return { storagePath, publicUrl: data.publicUrl };
}

// Build a public URL from a storage path for preview/playback in UI
export function getVideoPublicUrl(storagePath: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

// Download a video from Supabase Storage by its storage path
export async function downloadVideoFromStorage(storagePath: string): Promise<{ buffer: Buffer; contentType: string; sizeBytes: number }> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) throw new Error(`Supabase Storage download failed: ${error.message}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  // Infer content type from path extension
  const ext = storagePath.split('.').pop() || 'mp4';
  const contentType = ext === 'mov' ? 'video/quicktime'
    : ext === 'avi' ? 'video/avi'
    : ext === 'webm' ? 'video/webm'
    : 'video/mp4';
  return { buffer, contentType, sizeBytes: buffer.length };
}

// Delete a video from Supabase Storage (cleanup after publishing)
export async function deleteVideoFromStorage(storagePath: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([storagePath]);
}
 