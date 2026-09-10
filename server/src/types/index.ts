export type RequirementPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type RequirementType =
  | 'LANGUAGE'
  | 'FRAMEWORK'
  | 'DATABASE'
  | 'CLOUD'
  | 'DEVOPS'
  | 'TOOL'
  | 'EXPERIENCE'
  | 'EDUCATION'
  | 'RESPONSIBILITY'
  | 'DOMAIN'
  | 'SOFT_SKILL';

export type EvidenceStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NO_EVIDENCE';

export type MatchStatus =
  | 'STRONG_MATCH'
  | 'GOOD_MATCH'
  | 'PARTIAL_MATCH'
  | 'WEAK_MATCH'
  | 'MISSING'
  | 'CRITICAL_GAP';

export interface JDRequirement {
  id: string;
  name: string;
  type: RequirementType;
  priority: RequirementPriority;
  weight: number;
  isPrimary: boolean;
  reason: string;
}

export interface StructuredJDProfile {
  id: string;
  jobTitle: string;
  company?: string;
  primaryRole: string;
  primaryTechnologies: string[];
  summary: string;
  experienceYearsMin?: number;
  requirements: JDRequirement[];
  rawText: string;
  createdAt: string;
}

export interface CandidateEvidence {
  requirementId: string;
  requirementName: string;
  priority: RequirementPriority;
  status: MatchStatus;
  evidenceSnippet: string;
  evidenceStrength: EvidenceStrength;
  explanation: string;
}

export interface RecruiterEye {
  noticeFirst: string[];
  question: string[];
  skipOver: string[];
}

export interface ResumeEdit {
  priority: RequirementPriority;
  targetSection: string;
  title: string;
  reason: string;
  action: string;
  honestyNote: string;
}

export interface SuggestedWording {
  section: string;
  before: string;
  after: string;
  guidance: string;
}

export interface LearningItem {
  topic: string;
  priority: RequirementPriority;
  jdRequirement: string;
  reason: string;
}

export interface ReviewObject {
  candidateId: string;
  candidateName: string;
  filename?: string;
  roleFit: {
    score: number;
    verdict: 'Excellent Match' | 'Strong Match' | 'Good Match' | 'Moderate Match' | 'Weak Match' | 'Poor Match';
    summary: string;
  };
  subscores: {
    skills: number;
    experience: number;
    keywords: number;
    formatting: number;
  };
  recruitersEye: RecruiterEye;
  evidenceMap: CandidateEvidence[];
  whatToChangeBeforeApplying: ResumeEdit[];
  suggestedWording: SuggestedWording[];
  learningPlan: LearningItem[];
  checklist: string[];
  nextActions: string[];
  hasCriticalGap: boolean;
  criticalGapMessage?: string;
}

export interface CandidateRankingItem {
  rank: number;
  candidateId: string;
  candidateName: string;
  filename?: string;
  score: number;
  verdict: string;
  meetsCriticalRequirements: boolean;
  keyStrengths: string[];
  primaryGaps: string[];
  summaryReason: string;
}

export interface SessionData {
  sessionId: string;
  jdProfile?: StructuredJDProfile;
  pendingResumes?: { text: string; filename: string; candidateName: string }[];
  candidates: Record<string, ReviewObject>;
  rankings?: CandidateRankingItem[];
  messages: {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }[];
  createdAt: string;
  updatedAt: string;
}
