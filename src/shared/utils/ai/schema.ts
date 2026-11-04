const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const string = { type: 'string' };
const number = { type: 'number' };
const strings = { type: 'array', items: string };

/** Reply shapes for structured AI output. Claude is held to these exactly. */
export const VALIDATION_SCHEMA = object({
  isValid: { type: 'boolean' },
  score: number,
  reason: string,
});

export const CANDIDATE_SCORE_SCHEMA = object({
  score: number,
  recommendation: {
    type: 'string',
    enum: ['poor_fit', 'moderate_fit', 'good_fit', 'strong_fit'],
  },
  summary: string,
  strengths: strings,
  concerns: strings,
});

export const PARSED_RESUME_SCHEMA = object({
  summary: string,
  yearsOfExperience: number,
  skills: strings,
  languages: strings,
  certifications: strings,
  experience: {
    type: 'array',
    items: object({
      company: string,
      title: string,
      duration: string,
      description: string,
    }),
  },
  education: {
    type: 'array',
    items: object({
      institution: string,
      degree: string,
      field: string,
      year: string,
    }),
  },
});
