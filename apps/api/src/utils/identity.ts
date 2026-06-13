/**
 * Identity Preservation Utility
 * Fixes model hallucinations in identifiers (emails, IDs).
 * Compares model output with literal user input to preserve character-perfect accuracy.
 */
export function preservedLiteralEmail(modelEmail: string, userInput: string): string {
  if (!modelEmail) return modelEmail;
  
  // Match email-like strings in userInput
  const emailsInInput = userInput.match(/[a-zA-Z0-9.+_-]+@[a-zA-Z0-9._-]+\.[a-zA-Z]{1,}/g) || [];
  
  for (const inputEmail of emailsInInput) {
    // Exact match (case ignored)
    if (inputEmail.toLowerCase() === modelEmail.toLowerCase()) return inputEmail;
    
    // Fuzzy match: if model omitted a character (like 'e') from the actual input
    const leanInput = inputEmail.toLowerCase().replace(/[^a-z0-9]/gi, '');
    const leanModel = modelEmail.toLowerCase().replace(/[^a-z0-9]/gi, '');
    
    if (leanInput.includes(leanModel) || leanModel.includes(leanInput)) {
      // Prioritize the user's literal version if it's longer/more specific
      return inputEmail;
    }
  }
  return modelEmail;
}
