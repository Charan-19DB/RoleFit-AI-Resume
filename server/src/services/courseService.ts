import {
  CandidateEvidence,
  JDRequirement,
  LearningItem,
  RequirementPriority,
} from '../types/index.js';

export class CourseService {
  /**
   * Generates prioritized learning recommendations.
   * Priority strictly mirrors the JD Requirement priority:
   * Critical gap -> HIGH learning priority
   * High gap -> MEDIUM/HIGH learning priority
   * Medium gap -> MEDIUM learning priority
   * Low / Preferred gap -> LOW learning priority
   */
  static generateRecommendations(
    requirements: JDRequirement[],
    evidenceList: CandidateEvidence[]
  ): LearningItem[] {
    const evidenceMap = new Map<string, CandidateEvidence>();
    for (const ev of evidenceList) {
      evidenceMap.set(ev.requirementId, ev);
    }

    const recommendations: LearningItem[] = [];

    // Filter requirements where evidence is MISSING, CRITICAL_GAP, or WEAK_MATCH
    for (const req of requirements) {
      const ev = evidenceMap.get(req.id);
      const isGap = !ev || ev.status === 'MISSING' || ev.status === 'CRITICAL_GAP' || ev.status === 'WEAK_MATCH';

      if (isGap) {
        let learningPriority: RequirementPriority = 'LOW';
        if (req.priority === 'CRITICAL' || req.isPrimary) {
          learningPriority = 'CRITICAL';
        } else if (req.priority === 'HIGH') {
          learningPriority = 'HIGH';
        } else if (req.priority === 'MEDIUM') {
          learningPriority = 'MEDIUM';
        } else {
          learningPriority = 'LOW';
        }

        const topic = this.formatTopic(req.name, req.type);
        const reason = this.formatReason(req, ev);

        recommendations.push({
          topic,
          priority: learningPriority,
          jdRequirement: `${req.name} (${req.priority} JD Requirement)`,
          reason,
        });
      }
    }

    // Sort strictly by priority weight: CRITICAL (4) > HIGH (3) > MEDIUM (2) > LOW (1)
    const priorityWeight: Record<RequirementPriority, number> = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    recommendations.sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority]);

    return recommendations;
  }

  private static formatTopic(name: string, type: string): string {
    if (type === 'LANGUAGE') return `${name} Language Mastery & Core Concepts`;
    if (type === 'FRAMEWORK') return `${name} Backend Development & Best Practices`;
    if (type === 'DATABASE') return `${name} Schema Design, Indexing & Query Optimization`;
    if (type === 'CLOUD' || type === 'DEVOPS') return `${name} Architecture, Deployment & Tooling`;
    if (type === 'TOOL') return `Hands-on ${name} Workflow & Pipeline Integration`;
    return `${name} Fundamentals & Application`;
  }

  private static formatReason(req: JDRequirement, ev?: CandidateEvidence): string {
    if (req.priority === 'CRITICAL' || req.isPrimary) {
      return `${req.name} is a core requirement for this role and sufficient evidence was not identified in the candidate's resume.`;
    }
    if (req.priority === 'HIGH') {
      return `${req.name} is an important engineering requirement that will significantly improve role suitability.`;
    }
    return `${req.name} is a preferred/nice-to-have requirement. Learning it will provide extra advantage for the team.`;
  }
}
