import { RequestHandler } from 'express';
import multer from 'multer';
import { AppError } from '../utils/AppError';

const storage = multer.memoryStorage();

export const uploadResume: RequestHandler = (req, res, next) => {
  multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new AppError(
            400,
            'FILE_INVALID_TYPE',
            'Only PDF and DOCX files are allowed'
          ) as any
        );
      }
    },
  }).fields([
    { name: 'resume', maxCount: 1 },
    { name: 'file', maxCount: 1 },
  ])(req, res, err => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(400, 'FILE_TOO_LARGE', 'File size must not exceed 5MB')
        );
      }
    }
    if (err) return next(err);

    // Normalize to req.file for backward compatibility
    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;
    if (files) {
      const file = files.resume?.[0] || files.file?.[0];
      if (file) {
        req.file = file;
      }
    }

    next();
  });
};

export const uploadAvatar: RequestHandler = (req, res, next) => {
  multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png'];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new AppError(
            400,
            'FILE_INVALID_TYPE',
            'Only JPEG and PNG files are allowed'
          ) as any
        );
      }
    },
  }).single('avatar')(req, res, err => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(400, 'FILE_TOO_LARGE', 'File size must not exceed 2MB')
        );
      }
    }
    if (err) return next(err);
    next();
  });
};

export const uploadLogo: RequestHandler = (req, res, next) => {
  multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png'];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new AppError(
            400,
            'FILE_INVALID_TYPE',
            'Only JPEG and PNG files are allowed'
          ) as any
        );
      }
    },
  }).single('logo')(req, res, err => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(400, 'FILE_TOO_LARGE', 'File size must not exceed 2MB')
        );
      }
    }
    if (err) return next(err);
    next();
  });
};
