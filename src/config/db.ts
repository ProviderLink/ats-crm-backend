import mongoose from 'mongoose';
import { env } from './env';
import logger from '../shared/utils/logger';

export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI);
    logger.info('MongoDB connected');
  } catch (error) {
    logger.error('MongoDB connection error', { error });
    process.exit(1);
  }
}
