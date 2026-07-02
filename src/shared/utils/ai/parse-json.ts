export const parseJsonResponse = <T>(text: string): T | null => {
  try {
    let cleaned = text.trim();

    // 1. Try to extract JSON from markdown code fences: ```json ... ``` or ``` ... ```
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    // 2. If no fence was found, try to find the first JSON object/array boundary
    //    and strip any text before it (e.g., "Here's the result:\n{...}")
    if (!fenceMatch) {
      const jsonStart = cleaned.search(/[\{\[]/);
      if (jsonStart > 0) {
        cleaned = cleaned.slice(jsonStart);
      }
    }

    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
};
