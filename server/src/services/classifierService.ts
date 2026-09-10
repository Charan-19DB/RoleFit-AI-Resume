export interface ClassifierContext {
  hasActiveJD?: boolean;
  hasPendingResumes?: boolean;
}

export class ClassifierService {
  /**
   * Intelligently detects whether incoming text or document is a RESUME or a JOB DESCRIPTION.
   * Handles random input order and ambiguous inputs using textual cues, header analysis, and session context.
   */
  static classify(text: string, filename?: string, context?: ClassifierContext): 'RESUME' | 'JD' {
    const fn = (filename || '').toLowerCase();
    
    // Explicit filename indicators
    if (/(resume|cv|curriculum|biodata|applicant|candidate)/i.test(fn)) {
      return 'RESUME';
    }
    if (/(jd|job[-_]description|job[-_]spec|job[-_]req|role[-_]spec|jobdescription|requisition)/i.test(fn)) {
      return 'JD';
    }

    const lower = text.toLowerCase();

    // Strong Resume indicators
    let resumeScore = 0;

    // Contact details & links (very common in resumes, rare in JDs)
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) resumeScore += 4;
    if (/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text)) resumeScore += 3;
    if (/(github\.com|linkedin\.com\/in|portfolio|leetcode\.com|hackerrank\.com)/i.test(lower)) resumeScore += 4;

    // Academic & Education
    if (/\b(education|bachelor|b\.tech|b\.e\.|m\.tech|m\.s\.|b\.s\.|computer science and engineering|university|college|gpa|cgpa|graduated|academic background|coursework)\b/i.test(lower)) {
      resumeScore += 4;
    }

    // Professional Experience & Sections
    if (/\b(work experience|professional experience|employment history|experience:|technical skills|key skills|personal projects|academic projects|certifications|awards)\b/i.test(lower)) {
      resumeScore += 4;
    }

    // Past-tense action verbs (common in resume bullet points)
    if (/\b(developed|built|engineered|architected|collaborated|responsible for|maintained|spearheaded|implemented|optimized|designed|led|reduced by|increased by)\b/i.test(lower)) {
      resumeScore += 3;
    }

    // Strong JD indicators
    let jdScore = 0;

    // Hiring & Role announcements
    if (/\b(we are hiring|we are looking for|about the role|about the company|about us|join our team|who we are|our mission|company overview)\b/i.test(lower)) {
      jdScore += 5;
    }

    // Requirements & Responsibilities headers
    if (/\b(responsibilities:|key responsibilities|what you will do|what you'll do|duties:|requirements:|minimum qualifications|basic qualifications|preferred qualifications|nice to have|qualifications:)\b/i.test(lower)) {
      jdScore += 4;
    }

    // Candidate specification from employer perspective
    if (/\b(the ideal candidate|the successful candidate|candidate should have|must have \d+\+? years|years of experience required|minimum \d+ years|seeking a)\b/i.test(lower)) {
      jdScore += 4;
    }

    // Job specs & compensation
    if (/\b(apply now|equal opportunity employer|position type|job type:|full-time|part-time|reports to:|competitive salary|benefits:|perks & benefits|what we offer)\b/i.test(lower)) {
      jdScore += 3;
    }

    // Check first lines
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      const firstLine = lines[0];
      if (/^(role:|job title:|hiring:|position:|job description)/i.test(firstLine)) {
        jdScore += 4;
      }
      if (/^(curriculum vitae|resume|profile|summary of qualifications)/i.test(firstLine)) {
        resumeScore += 4;
      }
    }

    // Contextual tie-breaker / nudging based on current session state
    if (context) {
      if (context.hasPendingResumes && !context.hasActiveJD) {
        // We already have a resume pending! Incoming input is most likely the JD
        jdScore += 2;
      } else if (context.hasActiveJD && !context.hasPendingResumes) {
        // We already have an active JD! Incoming input is most likely a candidate resume
        resumeScore += 2;
      }
    }

    return resumeScore > jdScore ? 'RESUME' : 'JD';
  }

  /**
   * Identifies whether text is a short conversational question rather than a document.
   */
  static isChatMessage(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 50) return true;
    if (trimmed.endsWith('?')) return true;
    const lower = trimmed.toLowerCase();
    return /^(why|how|what|which|who|where|when|can\s+you|could\s+you|please\s+explain|tell\s+me|give\s+me|help\s+me|explain)\b/i.test(lower);
  }
}

