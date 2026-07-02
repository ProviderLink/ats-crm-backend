import type { ICandidateParsedData } from '../../features/candidates/candidate.types';
import { getSettings } from '../../features/settings/settings.service';
import { getAiProvider, parseJsonResponse, withRetry } from './ai/index';
import logger from './logger';

/**
 * Shared AI resume parsing function.
 * Takes raw extracted resume text and returns structured parsed data.
 * Does NOT save to database — pure parse only.
 * Used by both the public parse endpoint and the background resume parsing job.
 */
export async function parseResumeTextWithAI(
  rawText: string
): Promise<ICandidateParsedData | null> {
  if (!rawText || rawText.trim() === '') {
    logger.debug('No resume text to parse');
    return null;
  }

  const settings = await getSettings();
  if (!settings.ai.resumeParsing) {
    logger.debug('Resume parsing disabled in settings');
    return null;
  }

  const prompt = `
You are an expert ATS resume parser with 10+ years of experience analyzing thousands of resumes across all industries and formats. Your job is to extract EVERY piece of information present in the resume — never miss skills, positions, or education.

══════════════════════════════════════
CRITICAL: EXTRACT EVERYTHING — NO LIMITS
══════════════════════════════════════
- Extract ALL skills mentioned anywhere in the resume. DO NOT limit to a subset.
- Extract ALL work positions (including internships, part-time, freelance, research assistant roles).
- Extract ALL education entries (including high school, certifications courses, bootcamps).
- If the resume has 35 skills, extract all 35. If it has 12 positions, extract all 12.

══════════════════════════════════════
SUMMARY
══════════════════════════════════════
- Write a 3-4 sentence professional summary synthesizing the candidate's experience, key skills, industries, and career trajectory.
- Include years of experience, primary domain, and top strengths.
- Base this ONLY on the resume content — do not invent achievements.

══════════════════════════════════════
SKILLS — EXTRACT EVERY SINGLE ONE
══════════════════════════════════════
Look in these resume sections: SKILLS, TECHNICAL SKILLS, CORE COMPETENCIES, TOOLS, SOFTWARE, TECHNOLOGIES, LANGUAGE AND SOFTWARE, PROFICIENCIES, EXPERTISE, KEY SKILLS.

Skills can appear in many formats:
- Pipe-separated: "React | Node.js | Python | AWS"
- Comma-separated: "React, Node.js, Python, AWS"
- Bullet-point lists (each bullet is a skill)
- Table/grid layouts
- Inline mentions within experience descriptions: "Built REST APIs using Node.js and Express"
- Keyword sections at the top of the resume

What counts as a skill:
- Programming languages (Python, JavaScript, Java, C++, Go, Rust, SQL, etc.)
- Frameworks & libraries (React, Angular, Vue, Django, Spring, Express, etc.)
- Tools & platforms (Docker, Kubernetes, Git, Jenkins, AWS, Azure, GCP, etc.)
- Software applications (Excel, Tableau, Salesforce, Jira, Figma, Photoshop, etc.)
- Methodologies (Agile, Scrum, CI/CD, TDD, DevOps, etc.)
- Domain-specific skills (Financial Modeling, SEO, Copywriting, PCB Design, etc.)
- Soft skills IF explicitly listed in a skills section (Leadership, Communication, etc.)

Rules:
- Return each skill as a clean, normalized name (e.g., "Amazon Web Services" → "AWS", "React.js" → "React")
- Remove proficiency levels from skill names (e.g., "Python (Advanced)" → "Python")
- Deduplicate — don't list the same skill twice with different casing
- Sort alphabetically for readability
- If no skills section exists, extract tool/tech mentions from experience descriptions

══════════════════════════════════════
WORK EXPERIENCE — EXTRACT ALL POSITIONS
══════════════════════════════════════
Look in sections: WORK EXPERIENCE, PROFESSIONAL EXPERIENCE, EMPLOYMENT HISTORY, RESEARCH EXPERIENCE, PROJECT EXPERIENCE, INTERNSHIPS, VOLUNTEER WORK.

For EVERY position, extract:
- company: Clean company name (remove legal suffixes like "Inc.", "Ltd", "LLC" unless they're part of the brand). If the company isn't explicitly stated, use "".
- title: Full job title as written (normalize ALL CAPS to Title Case).
- duration: Standardized format. Examples:
  * "Jan 2020 - Dec 2023"
  * "Mar 2018 - Present"
  * "2020 - 2024" (if only years given)
  * Handle merged dates: "March2023uptoJuly2024" → "Mar 2023 - Jul 2024"
- description: 1-3 sentences combining key responsibilities AND measurable achievements. Include technologies used, team size, budget managed, metrics delivered (e.g., "increased revenue by 30%", "managed a team of 5 engineers").

Rules:
- Order by date, most recent first
- Do NOT skip internships, research assistant roles, freelance work, or short-term contracts
- If duration is missing, estimate from context or use ""
- If description is missing, write a brief 1-sentence summary derived from the job title and company context

══════════════════════════════════════
EDUCATION — EXTRACT ALL QUALIFICATIONS
══════════════════════════════════════
Look in sections: EDUCATION, ACADEMIC BACKGROUND, QUALIFICATIONS, CERTIFICATIONS (academic), TRAINING.

For EVERY entry, extract:
- institution: Full institution name (e.g., "Massachusetts Institute of Technology", not "MIT" unless that's how it's written).
- degree: Full degree name (e.g., "Bachelor of Science in Computer Science", "Master of Business Administration").
- field: The field/major of study (e.g., "Computer Science", "Finance", "Mechanical Engineering").
- year: Graduation/completion year or date range. Examples: "2019", "2018 - 2022", "Expected 2025".

Rules:
- Include ALL levels: PhD, Master's, Bachelor's, Associate's, High School, Diploma, Bootcamps
- Include incomplete degrees — mark year as "Expected YYYY" or use the attended range
- Include professional certifications that are academic in nature (PMP, CFA, CPA, etc.)
- Order by most recent first

══════════════════════════════════════
LANGUAGES
══════════════════════════════════════
- Extract spoken/written human languages from the resume (e.g., "English", "Spanish", "Mandarin", "French", "Arabic").
- Look in: LANGUAGES section, personal info header, summary.
- Infer languages from the language the resume is written in (default to "English" if the resume is in English).
- Include proficiency if mentioned (e.g., "Spanish (Native)", "French (B2)") → include as "Spanish" and "French" in the array.

══════════════════════════════════════
CERTIFICATIONS (NON-ACADEMIC)
══════════════════════════════════════
- Extract professional certifications, workshops, training courses, and licenses.
- Look in sections: CERTIFICATIONS, LICENSES, TRAINING, PROFESSIONAL DEVELOPMENT, COURSES.
- Examples: "AWS Solutions Architect", "Google Analytics Certified", "Certified Scrum Master", "Coursera - Machine Learning by Stanford".
- Include the issuing organization if available.

══════════════════════════════════════
IMPORTANT RULES FOR ACCURACY
══════════════════════════════════════
- NEVER fabricate or guess information not present in the resume text.
- If a field is truly not found, use "" for strings, [] for arrays.
- Normalize inconsistent formatting: fix ALL CAPS names, standardize dates, clean up whitespace.
- Do NOT extract names from references, contact persons, supervisors, or example text.
- Do NOT include markdown, code fences, or any text outside the JSON object.

══════════════════════════════════════
RESUME TEXT TO PARSE:
══════════════════════════════════════
${rawText}

══════════════════════════════════════
RESPOND WITH EXACTLY THIS JSON STRUCTURE (no markdown, no code blocks, no extra text):
══════════════════════════════════════
{
  "summary": "3-4 sentence professional summary synthesizing experience, skills, and industry focus",
  "yearsOfExperience": 5,
  "skills": ["Every", "Single", "Skill", "Found"],
  "languages": ["Language1", "Language2"],
  "certifications": ["Certification1", "Certification2"],
  "experience": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "duration": "Jan 2020 - Dec 2023",
      "description": "Key responsibilities and measurable achievements"
    }
  ],
  "education": [
    {
      "institution": "University Full Name",
      "degree": "Bachelor of Science in Computer Science",
      "field": "Computer Science",
      "year": "2019"
    }
  ]
}

CALCULATING yearsOfExperience:
- Sum the duration of ALL work positions listed in the resume.
- Count from the earliest start date to the latest end date (or "Present").
- Round to the nearest whole number.
- If the resume says "3+ years" or "over 3 years", use 3 as the minimum.
- This must be a NUMBER, not a string.
`.trim();

  const provider = await getAiProvider();
  const text = await withRetry(() =>
    provider.generate(prompt, { maxTokens: 4000, prefillAssistant: '{' })
  );

  logger.debug('AI resume parsing response', {
    provider: provider.name,
    responseLength: text.length,
    responsePreview: text.slice(0, 500),
  });

  const result = parseJsonResponse<ICandidateParsedData>(text);

  if (result) {
    logger.info('AI resume parsing completed', {
      skillsCount: result.skills?.length ?? 0,
      provider: provider.name,
    });
  } else {
    logger.error('Failed to parse AI resume parsing response', {
      responsePreview: text.slice(0, 300),
      provider: provider.name,
    });
  }

  return result;
}
