import { onObjectFinalized } from 'firebase-functions/v2/storage';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import sharp from 'sharp';

const db = admin.firestore();
const storage = admin.storage();

/**
 * Trigger: onImageUpload
 * Fires when an image is uploaded to /gallery/** or /blogs/**
 *
 * Responsibilities:
 * - Convert images to WebP format (quality 85)
 * - Generate 200x200 thumbnail
 * - Update Firestore with processed URLs
 */
export const onImageUpload = onObjectFinalized({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 120,
}, async (event) => {
  const filePath = event.data.name;
  const contentType = event.data.contentType;
  const bucket = storage.bucket(event.data.bucket);

  // Only process images
  if (!contentType?.startsWith('image/')) {
    console.log('Not an image, skipping:', filePath);
    return;
  }

  // Skip if already processed (webp or thumbnail)
  if (filePath.includes('_thumb') || filePath.endsWith('.webp')) {
    console.log('Already processed, skipping:', filePath);
    return;
  }

  // Determine the type based on path
  const isGallery = filePath.startsWith('gallery/');
  const isBlog = filePath.startsWith('blogs/');
  const isWebsite = filePath.startsWith('website/');

  if (!isGallery && !isBlog && !isWebsite) {
    console.log('Not in gallery, blogs, or website path, skipping:', filePath);
    return;
  }

  console.log(`Processing image: ${filePath}`);

  const fileName = path.basename(filePath);
  const fileNameWithoutExt = path.parse(fileName).name;
  const fileDir = path.dirname(filePath);

  // Create temp file paths
  const tempLocalFile = path.join(os.tmpdir(), fileName);
  const tempWebpFile = path.join(os.tmpdir(), `${fileNameWithoutExt}.webp`);
  const tempThumbFile = path.join(os.tmpdir(), `${fileNameWithoutExt}_thumb.webp`);

  try {
    // Download original file
    await bucket.file(filePath).download({ destination: tempLocalFile });
    console.log('Downloaded to:', tempLocalFile);

    // Convert to WebP
    await sharp(tempLocalFile)
      .webp({ quality: 85 })
      .toFile(tempWebpFile);
    console.log('Created WebP:', tempWebpFile);

    // Generate thumbnail (200x200, cover mode)
    await sharp(tempLocalFile)
      .resize(200, 200, { fit: 'cover' })
      .webp({ quality: 80 })
      .toFile(tempThumbFile);
    console.log('Created thumbnail:', tempThumbFile);

    // Upload WebP version
    const webpPath = `${fileDir}/${fileNameWithoutExt}.webp`;
    await bucket.upload(tempWebpFile, {
      destination: webpPath,
      metadata: {
        contentType: 'image/webp',
        metadata: {
          processedFrom: fileName,
          processedAt: new Date().toISOString(),
        },
      },
    });
    console.log('Uploaded WebP to:', webpPath);

    // Upload thumbnail
    const thumbPath = `${fileDir}/${fileNameWithoutExt}_thumb.webp`;
    await bucket.upload(tempThumbFile, {
      destination: thumbPath,
      metadata: {
        contentType: 'image/webp',
        metadata: {
          processedFrom: fileName,
          processedAt: new Date().toISOString(),
        },
      },
    });
    console.log('Uploaded thumbnail to:', thumbPath);

    // Get download URLs
    const [webpUrl] = await bucket.file(webpPath).getSignedUrl({
      action: 'read',
      expires: '03-01-2500',
    });
    const [thumbUrl] = await bucket.file(thumbPath).getSignedUrl({
      action: 'read',
      expires: '03-01-2500',
    });

    // Update Firestore based on path type
    if (isGallery) {
      await updateGalleryImage(filePath, webpUrl, thumbUrl);
    } else if (isBlog) {
      await updateBlogImage(filePath, webpUrl);
    }
    // Website hero images don't need Firestore updates as they use the original URL

    console.log('Successfully processed:', filePath);
  } catch (error) {
    console.error('Error processing image:', error);
    throw error;
  } finally {
    // Cleanup temp files
    [tempLocalFile, tempWebpFile, tempThumbFile].forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
  }
});

/**
 * Update gallery album with processed image URLs
 */
async function updateGalleryImage(
  filePath: string,
  webpUrl: string,
  thumbUrl: string
): Promise<void> {
  // Path format: gallery/{albumId}/{filename}
  const pathParts = filePath.split('/');
  if (pathParts.length < 3) return;

  const albumId = pathParts[1];
  const originalFileName = pathParts[2];

  const albumRef = db.collection('gallery').doc(albumId);
  const albumDoc = await albumRef.get();

  if (!albumDoc.exists) {
    console.log('Album not found:', albumId);
    return;
  }

  const albumData = albumDoc.data();
  if (!albumData) return;

  const images = albumData.images || [];
  let updated = false;
  let shouldUpdateThumbnail = false;

  // Find and update the image with matching original URL
  const updatedImages = images.map((img: Record<string, unknown>, index: number) => {
    const originalUrl = img.originalUrl as string;
    // Match by filename in the URL
    if (originalUrl && originalUrl.includes(encodeURIComponent(originalFileName.split('.')[0]))) {
      updated = true;
      // If this is the first image, use as thumbnail
      if (index === 0) {
        shouldUpdateThumbnail = true;
      }
      return {
        ...img,
        webpUrl: webpUrl,
      };
    }
    return img;
  });

  if (updated) {
    const updateData: Record<string, unknown> = {
      images: updatedImages,
      updatedAt: Date.now(),
    };

    // Set thumbnail if this is the first image or no thumbnail exists
    if (shouldUpdateThumbnail || !albumData.thumbnail) {
      updateData.thumbnail = thumbUrl;
    }

    await albumRef.update(updateData);
    console.log('Updated gallery album:', albumId);
  }
}

/**
 * Update blog post with processed cover image URL
 */
async function updateBlogImage(
  filePath: string,
  webpUrl: string
): Promise<void> {
  // Path format: blogs/{blog-slug-id-date}/{filename}
  const pathParts = filePath.split('/');
  if (pathParts.length < 3) return;

  const folderName = pathParts[1];

  // Extract blog ID from folder name (format: slug-{id}-date)
  // The ID is the second-to-last segment when split by dash
  const folderParts = folderName.split('-');
  if (folderParts.length < 3) {
    console.log('Invalid blog folder name format:', folderName);
    return;
  }

  // Blog ID is between the slug and the date
  // Find it by looking for the part that looks like a Firestore ID (20 chars)
  let blogId: string | null = null;
  for (const part of folderParts) {
    if (part.length >= 20) {
      blogId = part;
      break;
    }
  }

  if (!blogId) {
    console.log('Could not extract blog ID from folder:', folderName);
    return;
  }

  const blogRef = db.collection('blogs').doc(blogId);
  const blogDoc = await blogRef.get();

  if (!blogDoc.exists) {
    console.log('Blog not found:', blogId);
    return;
  }

  // Update cover image to WebP version
  await blogRef.update({
    coverImage: webpUrl,
    updatedAt: Date.now(),
  });
  console.log('Updated blog cover image:', blogId);
}
