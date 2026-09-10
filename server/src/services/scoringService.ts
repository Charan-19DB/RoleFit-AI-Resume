import {
  CandidateEvidence,
  JDRequirement,
  MatchStatus,
  StructuredJDProfile,
  ReviewObject,
} from '../types/index.js';

export class ScoringService {
  /**
   * Match multiplier value map
   */
  private static readonly MATCH_VALUES: Record<MatchStatus, number> = {
    STRONG_MATCH: 1.0,
    GOOD_MATCH: 0.8,
    PARTIAL_MATCH: 0.5,
    WEAK_MATCH: 0.25,
    MISSING: 0.0,
    CRITICAL_GAP: 0.0,
  };

  /**
   * Calculates deterministic weighted score based strictly on the frozen JD profile.
   */
  static calculateScore(
    profile: StructuredJDProfile,
    evidenceList: CandidateEvidence[]
  ): {
    score: number;
    verdict: ReviewObject['roleFit']['verdict'];
    hasCriticalGap: boolean;
    criticalGapMessage?: string;
    subscores: ReviewObject['subscores'];
  } {
    const evidenceMap = new Map<string, CandidateEvidence>();
    for (const ev of evidenceList) {
      evidenceMap.set(ev.requirementId, ev);
    }

    let totalWeight = 0;
    let earnedWeight = 0;
    let hasCriticalGap = false;
    const criticalGaps: string[] = [];

    // Subscore accumulators
    let skillsWeight = 0;
    let skillsEarned = 0;
    let expWeight = 0;
    let expEarned = 0;
    let keywordWeight = 0;
    let keywordEarned = 0;

    for (const req of profile.requirements) {
      const weight = req.weight > 0 ? req.weight : this.getDefaultWeight(req.priority);
      totalWeight += weight;

      const ev = evidenceMap.get(req.id);
      const status: MatchStatus = ev ? ev.status : 'MISSING';
      const multiplier = this.MATCH_VALUES[status] ?? 0;
      earnedWeight += weight * multiplier;

      // Check critical requirement failures
      if (req.priority === 'CRITICAL' || req.isPrimary) {
        if (status === 'MISSING' || status === 'CRITICAL_GAP' || status === 'WEAK_MATCH') {
          hasCriticalGap = true;
          criticalGaps.push(req.name);
        }
      }

      // Categorize into subscores
      if (['LANGUAGE', 'FRAMEWORK', 'DATABASE', 'CLOUD', 'DEVOPS', 'TOOL'].includes(req.type)) {
        skillsWeight += weight;
        skillsEarned += weight * multiplier;
      }
      if (['EXPERIENCE', 'RESPONSIBILITY'].includes(req.type)) {
        expWeight += weight;
        expEarned += weight * multiplier;
      }
      keywordWeight += weight;
      keywordEarned += weight * (multiplier > 0 ? 1 : 0);
    }

    if (totalWeight === 0) totalWeight = 1;

    let rawScore = Math.round((earnedWeight / totalWeight) * 100);

    // Critical penalty gate:
    // If a candidate misses a primary/critical requirement, apply penalty cap
    if (hasCriticalGap) {
      // Missing a core requirement caps raw score at 65% and reduces proportionally
      rawScore = Math.min(rawScore, 65);
    }

    const finalScore = Math.max(0, Math.min(100, rawScore));

    // Determine verdict
    let verdict: ReviewObject['roleFit']['verdict'] = 'Poor Match';
    if (finalScore >= 90 && !hasCriticalGap) {
      verdict = 'Excellent Match';
    } else if (finalScore >= 75 && !hasCriticalGap) {
      verdict = 'Strong Match';
    } else if (finalScore >= 60) {
      verdict = 'Good Match';
    } else if (finalScore >= 45) {
      verdict = 'Moderate Match';
    } else if (finalScore >= 30) {
      verdict = 'Weak Match';
    } else {
      verdict = 'Poor Match';
    }

    const criticalGapMessage = hasCriticalGap
      ? `Critical core gap in: ${criticalGaps.join(', ')}. Core role requirements are not adequately demonstrated.`
      : undefined;

    const skillsScore = skillsWeight > 0 ? Math.round((skillsEarned / skillsWeight) * 100) : finalScore;
    const expScore = expWeight > 0 ? Math.round((expEarned / expWeight) * 100) : finalScore;
    const kwScore = keywordWeight > 0 ? Math.round((keywordEarned / keywordWeight) * 100) : finalScore;

    return {
      score: finalScore,
      verdict,
      hasCriticalGap,
      criticalGapMessage,
      subscores: {
        skills: skillsScore,
        experience: expScore,
        keywords: kwScore,
        formatting: 90, // Baseline clean formatting
      },
    };
  }

  static getDefaultWeight(priority: JDRequirement['priority']): number {
    switch (priority) {
      case 'CRITICAL':
        return 10;
      case 'HIGH':
        return 7;
      case 'MEDIUM':
        return 4;
      case 'LOW':
        return 2;
      default:
        return 5;
    }
  }
}
