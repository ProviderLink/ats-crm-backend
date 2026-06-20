import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI!);

  const { default: User } = await import('../features/users/user.model');
  const { default: Client } = await import('../features/clients/client.model');
  const { default: PipelineTemplate } =
    await import('../features/pipeline-templates/pipelineTemplate.model');
  const { default: Job } = await import('../features/jobs/job.model');
  const { default: Candidate } =
    await import('../features/candidates/candidate.model');
  const { default: Application } =
    await import('../features/applications/application.model');

  const admin = await User.findOne({
    email: 'admin@arista.com',
  });
  if (!admin) {
    console.error('Run seed:admin first');
    process.exit(1);
  }

  // Client
  const client = await Client.create({
    companyName: 'Acme Healthcare',
    email: 'contact@acme.com',
    phone: '+1 555 0100',
    industry: 'healthcare',
    companySize: '51-200',
    status: 'active',
    description: 'Healthcare company',
    address: {
      city: 'New York',
      country: 'USA',
      street: '',
      state: 'NY',
      postalCode: '',
    },
    contacts: [
      {
        name: 'John Smith',
        email: 'john@acme.com',
        phone: '+1 555 0101',
        position: 'HR Manager',
        isPrimary: true,
      },
    ],
    createdBy: admin._id,
  });
  console.log('✅ Client created');

  // Pipeline template
  const template = await PipelineTemplate.create({
    name: 'Standard VA Pipeline',
    description: 'Default pipeline for VA hiring',
    isDefault: true,
    isActive: true,
    stages: [
      {
        name: 'Screening',
        color: '#3b82f6',
        order: 1,
        isActive: true,
        icon: 'FileSearch',
      },
      {
        name: 'Interview',
        color: '#f59e0b',
        order: 2,
        isActive: true,
        icon: 'Video',
      },
      {
        name: 'Assessment',
        color: '#8b5cf6',
        order: 3,
        isActive: true,
        icon: 'ClipboardCheck',
      },
      {
        name: 'Offer',
        color: '#10b981',
        order: 4,
        isActive: true,
        icon: 'Handshake',
      },
    ],
    createdBy: admin._id,
  });
  console.log('✅ Pipeline template created');

  // Job with pipeline assigned
  const job = await Job.create({
    title: 'Virtual Assistant',
    description: 'Looking for an experienced VA.',
    clientId: client._id,
    status: 'open',
    jobType: 'full_time',
    locationType: 'remote',
    location: 'Remote',
    experienceLevel: 'mid',
    priority: 'high',
    openings: 3,
    skills: ['Communication', 'MS Office', 'Scheduling'],
    requirements: [
      'At least 2 years VA experience',
      'Excellent English communication',
    ],
    pipeline: {
      templateId: template._id,
      stages: template.stages.map(
        (s: {
          _id: mongoose.Types.ObjectId;
          name: string;
          color: string;
          order: number;
          isActive: boolean;
          icon: string;
        }) => ({
          _id: new mongoose.Types.ObjectId(),
          name: s.name,
          color: s.color,
          order: s.order,
          isActive: s.isActive,
          icon: s.icon,
        })
      ),
    },
    createdBy: admin._id,
  });
  console.log('✅ Job created');

  // Candidates + Applications
  const candidates = [
    {
      firstName: 'Sarah',
      lastName: 'Johnson',
      email: 'sarah@example.com',
      phone: '+1 555 0201',
    },
    {
      firstName: 'Mike',
      lastName: 'Chen',
      email: 'mike@example.com',
      phone: '+1 555 0202',
    },
    {
      firstName: 'Emma',
      lastName: 'Davis',
      email: 'emma@example.com',
      phone: '+1 555 0203',
    },
  ];

  const firstStage = job.pipeline!.stages.sort(
    (a: { order: number }, b: { order: number }) => a.order - b.order
  )[0];

  for (const c of candidates) {
    const candidate = await Candidate.create({
      ...c,
      resumeUrl: 'https://example.com/resume.pdf',
      resumeOriginalName: 'resume.pdf',
      source: 'internal_upload',
      status: 'approved',
      yearsOfExperience: 2,
      createdBy: admin._id,
    });

    await Application.create({
      candidateId: candidate._id,
      jobId: job._id,
      clientId: client._id,
      phase: 'approved',
      source: 'internal_upload',
      currentStage: {
        stageId: firstStage._id,
        stageName: firstStage.name,
        assignedAt: new Date(),
        assignedBy: admin._id,
      },
      appliedAt: new Date(),
      approvedAt: new Date(),
      approvedBy: admin._id,
      createdBy: admin._id,
    });
  }
  console.log('✅ 3 candidates + applications created');

  console.log('\n🎉 Demo data seeded successfully');
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
