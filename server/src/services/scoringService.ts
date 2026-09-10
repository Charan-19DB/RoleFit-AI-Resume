import {
  CandidateEvidence,
  JDRequirement,
  MatchStatus,
  StructuredJDProfile,
  ReviewObject,
} from '../types/index.js';

export class ScoringService {
  /**
   * Refined match multiplier map for granular ATS scoring
   */
  private static readonly MATCH_VALUES: Record<MatchStatus, number> = {
    STRONG_MATCH: 1.0,
    GOOD_MATCH: 0.86,
    PARTIAL_MATCH: 0.54,
    WEAK_MATCH: 0.28,
    MISSING: 0.0,
    CRITICAL_GAP: 0.0,
  };

  /**
   * Calculates deterministic, granular, multi-factor ATS score based on:
   * 1. Core Technical Requirements Match (weighted)
   * 2. Experience Alignment
   * 3. Keyword Distribution
   * 4. Quantifiable Impact & Metrics (%, numbers, scale)
   * 5. ATS Readability & Formatting Quality
   */
  static calculateScore(
    profile: StructuredJDProfile,
    evidenceList: CandidateEvidence[],
    resumeText?: string
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

    let baseSkillsScore = skillsWeight > 0 ? Math.round((skillsEarned / skillsWeight) * 100) : Math.round((earnedWeight / totalWeight) * 100);
    let baseExpScore = expWeight > 0 ? Math.round((expEarned / expWeight) * 100) : baseSkillsScore;
    let baseKwScore = keywordWeight > 0 ? Math.round((keywordEarned / keywordWeight) * 100) : baseSkillsScore;

    // Granular content analysis from resumeText if available
    let metricsScore = 65; // baseline
    let formatScore = 88;  // baseline
    let experienceBonus = 0;

    if (resumeText && resumeText.trim().length > 0) {
      const text = resumeText;

      // 1. Quantifiable Metric Markers (%, numbers, scale, throughput, speed, cost)
      const metricMatches = text.match(/\b(\d+(?:\.\d+)?%|\d+\s*(?:k|m|million|billion|users|req\/s|rps|ms|seconds|x\b)|reduced\s+by|increased\s+by|\$\d+)\b/gi) || [];
      const metricCount = metricMatches.length;
      if (metricCount >= 5) {
        metricsScore = Math.min(96, 85 + metricCount * 2);
      } else if (metricCount >= 2) {
        metricsScore = 70 + metricCount * 5;
      } else if (metricCount === 1) {
        metricsScore = 55;
      } else {
        metricsScore = 38; // Passive bullet without measurable metrics
      }

      // 2. ATS Formatting & Structure Scoring
      let formatPoints = 50;
      if (/education/i.test(text)) formatPoints += 10;
      if (/experience|work history/i.test(text)) formatPoints += 12;
      if (/skills|technical/i.test(text)) formatPoints += 10;
      if (/projects/i.test(text)) formatPoints += 8;
      if (/[\w.-]+@[\w.-]+\.\w+/.test(text)) formatPoints += 5; // email
      if (/\+?\d[\d\s-]{8,}\d/.test(text)) formatPoints += 5;   // phone
      const wordCount = text.split(/\s+/).length;
      if (wordCount >= 250 && wordCount <= 1200) {
        formatPoints += 4;
      }
      formatScore = Math.min(96, Math.max(55, formatPoints));

      // 3. Experience alignment check
      const expMatches = text.match(/(\d+)\+?\s*(?:years|yrs)\s*(?:of)?\s*exp/i);
      if (expMatches && expMatches[1]) {
        const candidateYears = parseInt(expMatches[1], 10);
        const requiredYears = profile.experienceYearsMin || 2;
        if (candidateYears >= requiredYears) {
          experienceBonus = Math.min(8, (candidateYears - requiredYears) * 2);
        } else {
          experienceBonus = -Math.min(12, (requiredYears - candidateYears) * 4);
        }
      }
    }

    baseExpScore = Math.max(10, Math.min(100, baseExpScore + experienceBonus));

    // Weighted composite calculation:
    // Core Requirements: 55%, Experience Alignment: 20%, Keywords: 12%, Metrics: 8%, Format: 5%
    const rawReqPercent = (earnedWeight / totalWeight) * 100;
    let compositeScore = 
      (rawReqPercent * 0.55) +
      (baseExpScore * 0.20) +
      (baseKwScore * 0.12) +
      (metricsScore * 0.08) +
      (formatScore * 0.05);

    let rawScore = Math.round(compositeScore);

    // Proportional Critical Gap Penalty (Avoids artificial cliff to 65 while penalizing core gaps)
    if (hasCriticalGap) {
      const penaltyFactor = Math.min(0.35, criticalGaps.length * 0.14);
      rawScore = Math.round(rawScore * (1 - penaltyFactor));
      rawScore = Math.min(rawScore, 72); // Cap at 72% for critical gap
    }

    const finalScore = Math.max(0, Math.min(100, rawScore));

    // Determine verdict
    let verdict: ReviewObject['roleFit']['verdict'] = 'Poor Match';
    if (finalScore >= 88 && !hasCriticalGap) {
      verdict = 'Excellent Match';
    } else if (finalScore >= 74 && !hasCriticalGap) {
      verdict = 'Strong Match';
    } else if (finalScore >= 60) {
      verdict = 'Good Match';
    } else if (finalScore >= 45) {
      verdict = 'Moderate Match';
    } else if (finalScore >= 28) {
      verdict = 'Weak Match';
    } else {
      verdict = 'Poor Match';
    }

    const criticalGapMessage = hasCriticalGap
      ? `Critical core gap in: ${criticalGaps.join(', ')}. Core role requirements are not adequately demonstrated.`
      : undefined;

    return {
      score: finalScore,
      verdict,
      hasCriticalGap,
      criticalGapMessage,
      subscores: {
        skills: baseSkillsScore,
        experience: baseExpScore,
        keywords: baseKwScore,
        formatting: formatScore,
        metrics: metricsScore,
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
