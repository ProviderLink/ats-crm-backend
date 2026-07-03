import EmailTemplate from '../features/email-templates/emailTemplate.model';

const defaultTemplates = [
  {
    name: 'Application Confirmation',
    type: 'application_confirmation' as const,
    subject: 'We received your application for {{jobTitle}}',
    bodyHtml: `<p>Dear {{candidateName}},</p>
<p>Thank you for applying for the <strong>{{jobTitle}}</strong> position at <strong>{{clientName}}</strong>.</p>
<p>We have received your application and our team will review it shortly. We will be in touch if your profile matches our requirements.</p>
<p>Best regards,<br/>{{senderName}}<br/>{{companyName}}</p>`,
    bodyText: `Dear {{candidateName}},\n\nThank you for applying for the {{jobTitle}} position at {{clientName}}.\n\nWe have received your application and our team will review it shortly. We will be in touch if your profile matches our requirements.\n\nBest regards,\n{{senderName}}\n{{companyName}}`,
    variables: [
      'candidateName',
      'jobTitle',
      'clientName',
      'senderName',
      'companyName',
    ] as const,
    isDefault: true,
    isActive: true,
  },
];

export async function seedEmailTemplates(): Promise<void> {
  for (const tpl of defaultTemplates) {
    const exists = await EmailTemplate.findOne({
      type: tpl.type,
      isDefault: true,
    });
    if (!exists) {
      await EmailTemplate.create(tpl);
    }
  }
}
