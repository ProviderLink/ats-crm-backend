const esc = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The short thank-you sent when someone applies through the careers page.
 * Names the job and our sender name only: the client is never shown to a
 * candidate before they are hired.
 */
export function buildApplicationThanks(input: {
  firstName: string;
  jobTitle: string;
  senderName: string;
}): { subject: string; bodyHtml: string; bodyText: string } {
  const { firstName, jobTitle, senderName } = input;
  const lines = [
    `Hi ${firstName},`,
    `Thank you for applying for the ${jobTitle} position. We have received your application and will be in touch if your profile is a good match.`,
    senderName,
  ];
  return {
    subject: 'Thank you for your application',
    bodyHtml: lines.map(l => `<p>${esc(l)}</p>`).join(''),
    bodyText: lines.join('\n\n'),
  };
}
