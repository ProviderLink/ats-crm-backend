import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

async function seedAdmin() {
  await mongoose.connect(process.env.MONGODB_URI!);

  const { default: User } = await import('../features/users/user.model');

  const existing = await User.findOne({
    email: 'admin@arista.com',
  });

  if (existing) {
    console.log('Admin user already exists');
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash('Admin@123', 12);

  await User.create({
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@arista.com',
    passwordHash,
    roles: ['admin'],
    appAccess: ['ats', 'crm'],
    permissions: {
      candidates: { read: true, write: true, manage: true },
      jobs: { read: true, write: true, manage: true },
      interviews: { read: true, write: true, schedule: true },
      clients: { read: true, write: true, manage: true },
      team: { read: true, write: true, manage: true },
      analytics: { read: true },
      assignments: { read: true, write: true, manage: true },
      reports: { read: true, write: true, manage: true },
      eod: { read: true, write: true, approve: true },
      performanceReview: { read: true, write: true, approve: true },
    },
    isActive: true,
    emailVerified: true,
    isInviteAccepted: true,
  });

  console.log('✅ Admin user created');
  console.log('   Email: admin@arista.com');
  console.log('   Password: Admin@123');
  process.exit(0);
}

seedAdmin().catch(err => {
  console.error(err);
  process.exit(1);
});
