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

/**
 * Resume + optional portfolio attachment.
 *
 * Same contract as `uploadResume` (the resume is still surfaced as `req.file`),
 * plus an optional `portfolioFile` part. The portfolio accepts PDF and common
 * image formats because a designer's work samples are not always a PDF.
 * `resume` and `file` are kept as aliases so existing clients keep working.
 */
export const uploadResumeWithPortfolio: RequestHandler = (req, res, next) => {
  const resumeTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  const portfolioTypes = [
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ];

  multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 2 },
    fileFilter: (_req, file, cb) => {
      const allowed =
        file.fieldname === 'portfolioFile' ? portfolioTypes : resumeTypes;
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new AppError(
            400,
            'FILE_INVALID_TYPE',
            file.fieldname === 'portfolioFile'
              ? 'Portfolio must be a PDF, ZIP, or image file'
              : 'Only PDF and DOCX files are allowed'
          ) as any
        );
      }
    },
  }).fields([
    { name: 'resume', maxCount: 1 },
    { name: 'file', maxCount: 1 },
    { name: 'portfolioFile', maxCount: 1 },
  ])(req, res, err => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(400, 'FILE_TOO_LARGE', 'File size must not exceed 10MB')
        );
      }
    }
    if (err) return next(err);

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;
    if (files) {
      const file = files.resume?.[0] || files.file?.[0];
      if (file) req.file = file;
      const portfolio = files.portfolioFile?.[0];
      if (portfolio) req.portfolioFile = portfolio;
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

export const uploadUserAvatarFile: RequestHandler = (req, res, next) => {
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
  }).single('file')(req, res, err => {
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

export const uploadEmailAttachment: RequestHandler = (req, res, next) => {
  multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg',
        'image/png',
        'text/plain',
      ];
      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new AppError(
            400,
            'FILE_INVALID_TYPE',
            'Only PDF, Word, Excel, JPEG, PNG and text files are allowed'
          ) as any
        );
      }
    },
  }).single('file')(req, res, err => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(400, 'FILE_TOO_LARGE', 'File size must not exceed 10MB')
        );
      }
    }
    if (err) return next(err);
    next();
  });
};
