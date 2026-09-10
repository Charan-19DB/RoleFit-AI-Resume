import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  CandidateEvidence,
  EvidenceStrength,
  JDRequirement,
  MatchStatus,
  RecruiterEye,
  RequirementPriority,
  RequirementType,
  ResumeEdit,
  ReviewObject,
  StructuredJDProfile,
  SuggestedWording,
} from '../types/index.js';
import { ScoringService } from './scoringService.js';
import { CourseService } from './courseService.js';

export class GeminiService {
  private genAI: GoogleGenerativeAI | null = null;
  private modelName: string;

  constructor(apiKey?: string, modelName: string = process.env.GEMINI_MODEL || 'gemini-2.5-flash') {
    if (apiKey && apiKey.trim().length > 0) {
      this.genAI = new GoogleGenerativeAI(apiKey.trim());
    }
    this.modelName = modelName;
  }

  /**
   * Analyzes raw Job Description text and returns a frozen StructuredJDProfile.
   */
  async analyzeJobDescription(rawText: string): Promise<StructuredJDProfile> {
    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: this.modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        });

        const prompt = `
You are an expert technical recruitment intelligence system.
Analyze this Job Description with deep context understanding.
Do NOT treat it as a flat keyword list. Understand what technology is primary vs secondary/preferred.

Rules:
1. Detect the Job Title and Primary Role.
2. Identify Primary/Core Technologies (the languages/tools absolutely central to this role).
3. Classify each requirement's Priority:
   - CRITICAL: mandatory, core, primary, must-have, minimum experience, non-negotiable.
   - HIGH: important required skills/responsibilities.
   - MEDIUM: relevant supporting skills that improve fit.
   - LOW: preferred, nice-to-have, plus, bonus, familiarity, exposure.
4. Assign weights (CRITICAL: 10, HIGH: 7, MEDIUM: 4, LOW: 2).
5. Extract experience requirements (e.g. minimum years).

JD Text:
${rawText}

Return strictly JSON matching this structure:
{
  "jobTitle": string,
  "primaryRole": string,
  "primaryTechnologies": string[],
  "summary": string,
  "experienceYearsMin": number,
  "requirements": [
    {
      "id": string (unique like req-1, req-2),
      "name": string (concise skill/requirement name),
      "type": "LANGUAGE" | "FRAMEWORK" | "DATABASE" | "CLOUD" | "DEVOPS" | "TOOL" | "EXPERIENCE" | "EDUCATION" | "RESPONSIBILITY" | "DOMAIN",
      "priority": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "weight": number,
      "isPrimary": boolean,
      "reason": string (contextual explanation of why it has this priority)
    }
  ]
}
`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const parsed = JSON.parse(responseText);

        return {
          id: `jd-${Date.now()}`,
          jobTitle: parsed.jobTitle || 'Technical Role',
          primaryRole: parsed.primaryRole || parsed.jobTitle || 'Engineer',
          primaryTechnologies: parsed.primaryTechnologies || [],
          summary: parsed.summary || '',
          experienceYearsMin: parsed.experienceYearsMin || 0,
          requirements: (parsed.requirements || []).map((r: any, idx: number) => ({
            id: r.id || `req-${idx + 1}`,
            name: r.name,
            type: r.type || 'LANGUAGE',
            priority: r.priority || 'MEDIUM',
            weight: r.weight || ScoringService.getDefaultWeight(r.priority),
            isPrimary: !!r.isPrimary,
            reason: r.reason || '',
          })),
          rawText,
          createdAt: new Date().toISOString(),
        };
      } catch (err: any) {
        console.warn(`⚠️ Gemini JD analysis failed (${err.message}). Using contextual semantic parser.`);
      }
    }

    return this.fallbackJDAnalysis(rawText);
  }

  /**
   * Analyzes Candidate Resume against the FROZEN JD Profile.
   */
  async analyzeCandidateResume(
    profile: StructuredJDProfile,
    resumeText: string,
    candidateName: string = 'Candidate',
    filename?: string
  ): Promise<ReviewObject> {
    let evidenceList: CandidateEvidence[] = [];
    let recruitersEye: RecruiterEye | null = null;
    let wordingRewrites: SuggestedWording[] = [];
    let customEdits: ResumeEdit[] = [];

    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: this.modelName,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        });

        const prompt = `
You are an expert technical recruiter and career mentor conducting an honest, human resume review.
You are evaluating a candidate's resume against a FROZEN Job Description profile.

CRITICAL NON-NEGOTIABLE RULES:
1. Ground every claim strictly in evidence from the resume. NEVER hallucinate skills, metrics, or years.
2. If a skill/requirement is absent, say EXACTLY: "No evidence was identified in the provided resume." Never assume absence means lack of knowledge, but do not grant match.
3. Differentiate professional experience from academic/coursework:
   - Real production/job experience with measurable scope -> STRONG_MATCH or GOOD_MATCH
   - Completed a course or academic project -> WEAK_MATCH or PARTIAL_MATCH
   - Mentioning interest or no proof -> WEAK_MATCH or MISSING
4. Produce a Recruiter's Eye review:
   - What would a human recruiter notice first?
   - What would they question or worry about?
   - What generic filler would they skip over?
5. Provide truth-first bullet rewrites:
   - Suggest before/after bullet improvements grounded ONLY in facts already present in the resume.
   - Use bracketed placeholders (e.g. [actual users / metrics]) with instructions to only use if true.
   - Never tell the user to keyword-stuff. Missing genuine skills belong in the learning plan, not the resume!

FROZEN JD REQUIREMENTS:
${JSON.stringify(profile.requirements, null, 2)}

CANDIDATE RESUME:
${resumeText}

Return strictly JSON matching this structure:
{
  "evidenceMap": [
    {
      "requirementId": string,
      "requirementName": string,
      "priority": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "status": "STRONG_MATCH" | "GOOD_MATCH" | "PARTIAL_MATCH" | "WEAK_MATCH" | "MISSING" | "CRITICAL_GAP",
      "evidenceSnippet": string (verbatim quote or "No evidence was identified in the provided resume."),
      "evidenceStrength": "STRONG" | "MODERATE" | "WEAK" | "NO_EVIDENCE",
      "explanation": string
    }
  ],
  "recruitersEye": {
    "noticeFirst": string[] (3 items),
    "question": string[] (3 items),
    "skipOver": string[] (2 items)
  },
  "whatToChangeBeforeApplying": [
    {
      "priority": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "targetSection": string,
      "title": string,
      "reason": string,
      "action": string,
      "honestyNote": string
    }
  ],
  "suggestedWording": [
    {
      "section": string,
      "before": string,
      "after": string,
      "guidance": string
    }
  ]
}
`;

        const result = await model.generateContent(prompt);
        const parsed = JSON.parse(result.response.text());

        evidenceList = parsed.evidenceMap || [];
        recruitersEye = parsed.recruitersEye || null;
        wordingRewrites = parsed.suggestedWording || [];
        customEdits = parsed.whatToChangeBeforeApplying || [];
      } catch (err: any) {
        console.warn(`⚠️ Gemini resume analysis failed (${err.message}). Using semantic evidence parser.`);
      }
    }

    // If Gemini wasn't available or failed, run high-precision semantic evidence extractor
    if (!evidenceList || evidenceList.length === 0) {
      const fallback = this.fallbackResumeAnalysis(profile, resumeText, candidateName);
      evidenceList = fallback.evidenceList;
      recruitersEye = fallback.recruitersEye;
      wordingRewrites = fallback.suggestedWording;
      customEdits = fallback.customEdits;
    }

    // Deterministic mathematical scoring
    const scoringResult = ScoringService.calculateScore(profile, evidenceList);

    // Prioritized learning recommendations based strictly on JD priorities
    const learningPlan = CourseService.generateRecommendations(profile.requirements, evidenceList);

    // Dynamic checklist
    const checklist = [
      'Quantified key project bullets with verified results or scale',
      'Confirmed all technical tools mentioned can be comfortably defended in technical interviews',
      'Kept resume focused on relevant backend/engineering achievements without fluff',
      'Exported as a clean, ATS-parseable single-column PDF or DOCX',
    ];

    const nextActions = [
      'Review suggested bullet rewrites',
      'Document unstated testing or deployment evidence (if true)',
      'Compare against another resume version',
      'Begin high-priority learning plan',
    ];

    const candidateId = `cand-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    return {
      candidateId,
      candidateName,
      filename,
      roleFit: {
        score: scoringResult.score,
        verdict: scoringResult.verdict,
        summary: scoringResult.hasCriticalGap
          ? `You have relevant experience, but critical role requirements (${scoringResult.criticalGapMessage}) are not sufficiently demonstrated.`
          : `Strong technical alignment with the primary expectations of this role. A few targeted edits will make your application stand out.`,
      },
      subscores: scoringResult.subscores,
      recruitersEye: recruitersEye || {
        noticeFirst: profile.primaryTechnologies.map((t) => `${t} core experience`),
        question: ['Lack of measurable business impact or scale metrics', 'Testing ownership not explicitly stated'],
        skipOver: ['Generic objective summary', 'Long unorganized list of tools'],
      },
      evidenceMap: evidenceList,
      whatToChangeBeforeApplying: customEdits,
      suggestedWording: wordingRewrites,
      learningPlan,
      checklist,
      nextActions,
      hasCriticalGap: scoringResult.hasCriticalGap,
      criticalGapMessage: scoringResult.criticalGapMessage,
    };
  }

  /**
   * Follow-up conversational Q&A grounded strictly in the session context.
   */
  async answerFollowUp(
    profile: StructuredJDProfile,
    review: ReviewObject,
    userQuestion: string,
    history: { role: string; content: string }[]
  ): Promise<string> {
    if (this.genAI) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: this.modelName,
          generationConfig: { temperature: 0.3 },
        });

        const prompt = `
You are the RoleFit Career Reviewer. You are having an honest, supportive conversation with a job applicant.
Tone: Human recruiter/career mentor. Direct, encouraging, grounded in facts, never robotic, never using generic AI jargon like "As an AI model" or "ATS semantic score".

Role: ${profile.jobTitle}
Role Fit Score: ${review.roleFit.score}% (${review.roleFit.verdict})
Summary: ${review.roleFit.summary}
Evidence Summary:
${review.evidenceMap.map((e) => `- ${e.requirementName}: ${e.status} (${e.evidenceSnippet})`).join('\n')}

User Question:
"${userQuestion}"

Provide a concise, helpful, mentor-like answer that explains the decision or suggests exact truthful improvements.
`;

        const result = await model.generateContent(prompt);
        return result.response.text().trim();
      } catch (err: any) {
        console.warn(`⚠️ Gemini chat follow-up failed: ${err.message}`);
      }
    }

    // Conversational heuristic fallback
    const qLower = userQuestion.toLowerCase();
    if (qLower.includes('why') && (qLower.includes('score') || qLower.includes('%') || qLower.includes('fit'))) {
      if (review.hasCriticalGap) {
        return `Your role fit is ${review.roleFit.score}% primarily because ${review.criticalGapMessage}. While other technologies show promise, recruiters for ${profile.jobTitle} prioritize core requirements above all else. Addressing that gap is the fastest way to improve your standing.`;
      }
      return `Your role fit is ${review.roleFit.score}% (${review.roleFit.verdict}). Your core background in ${profile.primaryTechnologies.join(' and ')} is strong. The remaining points were deducted because important secondary areas (like testing or infrastructure scale) weren't clearly evidenced with concrete outcomes.`;
    }

    if (qLower.includes('bullet') || qLower.includes('rewrite')) {
      const suggested = review.suggestedWording[0];
      if (suggested) {
        return `I’d start with this project bullet:\n\nBefore: "${suggested.before}"\n\nSuggested rewrite: "${suggested.after}"\n\n${suggested.guidance}`;
      }
      return `Focus on your strongest project. Change descriptions of what you did into what you achieved—mentioning the problem, the tools you used, and the measurable outcome.`;
    }

    if (qLower.includes('learn') || qLower.includes('gap')) {
      const topLearning = review.learningPlan.slice(0, 2);
      if (topLearning.length > 0) {
        return `For this ${profile.jobTitle} role, here is your prioritized learning plan:\n\n` +
          topLearning.map((l, i) => `${i + 1}. **${l.topic}** (${l.priority} Priority)\n   Why: ${l.reason}`).join('\n\n') +
          `\n\nRemember: Don't put tools on your resume until you've built real projects with them!`;
      }
    }

    return `I went through your application carefully against the ${profile.jobTitle} role. Your strongest foundation is in ${profile.primaryTechnologies.join(', ')}. To strengthen your submission, focus on making your project bullets sound like ownership with measurable outcomes, and make sure any unstated testing experience is clearly documented.`;
  }

  // --- Contextual Semantic Parsers (Zero-Dependency High-Fidelity Fallback) ---

  private fallbackJDAnalysis(rawText: string): StructuredJDProfile {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    let jobTitle = 'Software Engineer';
    const primaryTechs: string[] = [];
    const requirements: JDRequirement[] = [];

    // Detect job title
    for (const line of lines.slice(0, 5)) {
      if (/title|role|position|hiring|we are looking for/i.test(line)) {
        jobTitle = line.replace(/^(job\s*title|role|position):\s*/i, '').trim();
        break;
      }
    }
    if (jobTitle === 'Software Engineer' && lines.length > 0) {
      jobTitle = lines[0].replace(/^(we are hiring|seeking|wanted):\s*/i, '').trim();
    }

    // Technology bank
    const techCatalog: { name: string; type: RequirementType; regex: RegExp }[] = [
      { name: 'Java', type: 'LANGUAGE', regex: /\bJava\b(?!script)/i },
      { name: 'Python', type: 'LANGUAGE', regex: /\bPython\b/i },
      { name: 'JavaScript', type: 'LANGUAGE', regex: /\bJavaScript\b|\bJS\b/i },
      { name: 'TypeScript', type: 'LANGUAGE', regex: /\bTypeScript\b|\bTS\b/i },
      { name: 'Spring Boot', type: 'FRAMEWORK', regex: /\bSpring\s*Boot\b|\bSpring\s*Framework\b/i },
      { name: 'Django', type: 'FRAMEWORK', regex: /\bDjango\b/i },
      { name: 'Node.js', type: 'FRAMEWORK', regex: /\bNode(?:\.js)?\b|\bExpress(?:\.js)?\b/i },
      { name: 'React', type: 'FRAMEWORK', regex: /\bReact(?:\.js)?\b/i },
      { name: 'SQL', type: 'DATABASE', regex: /\bSQL\b|\bPostgreSQL\b|\bMySQL\b|\bRelational Database\b/i },
      { name: 'MongoDB', type: 'DATABASE', regex: /\bMongoDB\b|\bNoSQL\b/i },
      { name: 'REST APIs', type: 'FRAMEWORK', regex: /\bREST(?:ful)?\s*API[s]?\b|\bMicroservices\b/i },
      { name: 'Docker', type: 'DEVOPS', regex: /\bDocker\b|\bContainers?\b/i },
      { name: 'Kubernetes', type: 'DEVOPS', regex: /\bKubernetes\b|\bK8s\b/i },
      { name: 'AWS', type: 'CLOUD', regex: /\bAWS\b|\bAmazon\s*Web\s*Services\b/i },
      { name: 'Azure', type: 'CLOUD', regex: /\bAzure\b/i },
      { name: 'GCP', type: 'CLOUD', regex: /\bGCP\b|\bGoogle\s*Cloud\b/i },
      { name: 'Automated Testing', type: 'TOOL', regex: /\bTesting\b|\bJUnit\b|\bTest-driven\b|\bQA\b/i },
      { name: 'Git', type: 'TOOL', regex: /\bGit\b|\bGitHub\b|\bCI\/CD\b/i },
    ];

    // Priority signals
    const criticalSignals = /\b(primary|mandatory|must\s*have|required|essential|minimum|core|strong\s*experience)\b/i;
    const lowSignals = /\b(preferred|nice\s*to\s*have|plus|bonus|exposure|familiarity|beneficial|knowledge)\b/i;

    const titleLower = jobTitle.toLowerCase();
    let reqIndex = 1;

    for (const tech of techCatalog) {
      if (tech.regex.test(rawText)) {
        let isPrimary = false;
        let priority: RequirementPriority = 'MEDIUM';

        // Check if primary in title or first lines
        if (tech.regex.test(jobTitle) || (tech.name === 'Java' && titleLower.includes('java')) || (tech.name === 'Python' && titleLower.includes('python'))) {
          isPrimary = true;
          priority = 'CRITICAL';
          primaryTechs.push(tech.name);
        } else {
          // Contextual priority based on sentence matching
          for (const line of lines) {
            if (tech.regex.test(line)) {
              if (criticalSignals.test(line)) {
                priority = 'CRITICAL';
                if (!primaryTechs.includes(tech.name) && tech.type === 'LANGUAGE') {
                  primaryTechs.push(tech.name);
                }
              } else if (lowSignals.test(line)) {
                priority = 'LOW';
              } else if (priority !== 'CRITICAL') {
                priority = 'HIGH';
              }
            }
          }
        }

        requirements.push({
          id: `req-${reqIndex++}`,
          name: tech.name,
          type: tech.type,
          priority,
          weight: ScoringService.getDefaultWeight(priority),
          isPrimary,
          reason: isPrimary
            ? `${tech.name} is the primary development technology for the ${jobTitle} role.`
            : priority === 'CRITICAL'
            ? `${tech.name} is explicitly stated as a mandatory/core requirement.`
            : priority === 'LOW'
            ? `${tech.name} is listed as preferred/nice-to-have.`
            : `${tech.name} is an important required technical skill.`,
        });
      }
    }

    // Default primary tech if none caught
    if (primaryTechs.length === 0 && requirements.length > 0) {
      requirements[0].isPrimary = true;
      requirements[0].priority = 'CRITICAL';
      requirements[0].weight = 10;
      primaryTechs.push(requirements[0].name);
    }

    return {
      id: `jd-${Date.now()}`,
      jobTitle,
      primaryRole: jobTitle,
      primaryTechnologies: primaryTechs,
      summary: `Hiring for ${jobTitle} requiring proficiency in ${primaryTechs.join(', ')}.`,
      experienceYearsMin: 2,
      requirements,
      rawText,
      createdAt: new Date().toISOString(),
    };
  }

  private fallbackResumeAnalysis(
    profile: StructuredJDProfile,
    resumeText: string,
    candidateName: string
  ): {
    evidenceList: CandidateEvidence[];
    recruitersEye: RecruiterEye;
    suggestedWording: SuggestedWording[];
    customEdits: ResumeEdit[];
  } {
    const evidenceList: CandidateEvidence[] = [];
    const noticed: string[] = [];
    const questioned: string[] = [];
    const lines = resumeText.split('\n').map((l) => l.trim()).filter(Boolean);

    for (const req of profile.requirements) {
      const regex = new RegExp(`\\b${req.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      let foundSnippet = '';
      let strength: EvidenceStrength = 'NO_EVIDENCE';
      let status: MatchStatus = 'MISSING';

      for (const line of lines) {
        if (regex.test(line)) {
          foundSnippet = line;
          const isCourseOnly = /\b(completed|course|certificate|learned|tutorial|academic|college\s*project|student)\b/i.test(line);
          const isProfessional = /\b(built|architected|developed|engineered|production|years|reduced|scaled|deployed)\b/i.test(line);

          if (isCourseOnly && !isProfessional) {
            strength = 'WEAK';
            status = 'WEAK_MATCH';
          } else if (isProfessional) {
            strength = 'STRONG';
            status = 'STRONG_MATCH';
          } else {
            strength = 'MODERATE';
            status = 'GOOD_MATCH';
          }
          break;
        }
      }

      if (!foundSnippet) {
        foundSnippet = 'No evidence was identified in the provided resume.';
        status = req.priority === 'CRITICAL' ? 'CRITICAL_GAP' : 'MISSING';
        strength = 'NO_EVIDENCE';
        if (req.priority === 'CRITICAL' || req.priority === 'HIGH') {
          questioned.push(`${req.name} appears in the JD requirements, but has no verifiable evidence in the resume.`);
        }
      } else {
        if (status === 'STRONG_MATCH' || status === 'GOOD_MATCH') {
          noticed.push(`${req.name} demonstrated in project or professional background.`);
        }
      }

      evidenceList.push({
        requirementId: req.id,
        requirementName: req.name,
        priority: req.priority,
        status,
        evidenceSnippet: foundSnippet,
        evidenceStrength: strength,
        explanation:
          status === 'MISSING' || status === 'CRITICAL_GAP'
            ? `No evidence was identified in the provided resume for ${req.name}.`
            : status === 'WEAK_MATCH'
            ? `Evidence for ${req.name} appears limited to coursework/academic exposure rather than production experience.`
            : `Evidence confirms relevant experience with ${req.name}.`,
      });
    }

    const recruitersEye: RecruiterEye = {
      noticeFirst: noticed.slice(0, 3).length > 0 ? noticed.slice(0, 3) : ['Technical keywords present'],
      question:
        questioned.slice(0, 3).length > 0
          ? questioned.slice(0, 3)
          : ['Projects lack measurable scale or business metrics', 'Testing ownership not explicitly demonstrated'],
      skipOver: ['Generic objective summary', 'Long unorganized tool lists in header'],
    };

    // Find best candidate project bullet to suggest rewrite for
    let sampleBullet = 'Built backend microservices and connected to relational database.';
    for (const l of lines) {
      if (/\b(built|developed|created|worked on)\b/i.test(l) && l.length > 25 && l.length < 120) {
        sampleBullet = l;
        break;
      }
    }

    const suggestedWording: SuggestedWording[] = [
      {
        section: 'Project Achievements',
        before: sampleBullet,
        after: `Architected backend endpoints for [actual use case/platform], processing [actual metric, e.g. 10k+ requests/day] and reducing response time by [actual metric, e.g. 20%].`,
        guidance: 'Only fill in the bracketed metrics if they reflect truthful, verifiable work you performed.',
      },
    ];

    const customEdits: ResumeEdit[] = [
      {
        priority: 'HIGH',
        targetSection: 'Experience & Projects',
        title: 'Quantify your primary project with measurable results',
        reason: 'Recruiters want to see the scale, business outcome, and ownership of what you built.',
        action: 'Rewrite project bullets to highlight throughput, users served, or latency improvements.',
        honestyNote: 'Only state numbers and metrics you personally witnessed or measured.',
      },
      {
        priority: 'HIGH',
        targetSection: 'Quality & Testing',
        title: 'Add automated testing evidence if you wrote tests',
        reason: 'Automated testing and code quality are key expectations for backend engineering roles.',
        action: 'Specify test frameworks (JUnit, Mockito, pytest) and coverage you maintained.',
        honestyNote: 'If you did not write automated tests, do not add them. Put testing on your learning plan.',
      },
    ];

    return {
      evidenceList,
      recruitersEye,
      suggestedWording,
      customEdits,
    };
  }
}
