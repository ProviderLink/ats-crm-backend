export const parseJsonResponse = <T>(text: string): T | null => {
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
};
