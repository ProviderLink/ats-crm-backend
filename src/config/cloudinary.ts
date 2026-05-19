import { v2 as cloudinary } from 'cloudinary';
import { env } from './env';
import { AppError } from '../shared/utils/AppError';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export const uploadToCloudinary = async (
  file: Express.Multer.File,
  folder: 'resumes' | 'avatars' | 'logos'
): Promise<{ url: string; publicId: string }> => {
  const resourceType = folder === 'resumes' ? 'raw' : 'image';
  try {
    const result = await new Promise<{ secure_url: string; public_id: string }>(
      (resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: `arista/${folder}`, resource_type: resourceType },
          (error, result) => {
            if (error || !result) reject(error ?? new Error('No result returned'));
            else resolve(result);
          }
        );
        stream.end(file.buffer);
      }
    );
    return { url: result.secure_url, publicId: result.public_id };
  } catch {
    throw new AppError(500, 'FILE_UPLOAD_FAILED', 'File upload failed');
  }
};

export const deleteFromCloudinary = async (
  publicId: string,
  resourceType: 'raw' | 'image' = 'image'
): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error('Failed to delete file from Cloudinary:', error);
  }
};

export default cloudinary;
