import { CandidateRankingItem, ReviewObject, StructuredJDProfile } from '../types/index.js';

export class RankingService {
  /**
   * Ranks candidates deterministically based on their ReviewObjects evaluated against the same JD.
   */
  static rankCandidates(
    profile: StructuredJDProfile,
    reviews: ReviewObject[]
  ): CandidateRankingItem[] {
    // Sort candidates:
    // 1. First priority: Candidates who meet all critical requirements (!hasCriticalGap)
    // 2. Second priority: Highest deterministic weighted score
    const sorted = [...reviews].sort((a, b) => {
      if (!a.hasCriticalGap && b.hasCriticalGap) return -1;
      if (a.hasCriticalGap && !b.hasCriticalGap) return 1;
      return b.roleFit.score - a.roleFit.score;
    });

    return sorted.map((review, index) => {
      const rank = index + 1;
      const keyStrengths = review.recruitersEye.noticeFirst.slice(0, 3);
      const primaryGaps = review.whatToChangeBeforeApplying.map((a) => a.title).slice(0, 2);

      let summaryReason = '';
      if (rank === 1) {
        if (!review.hasCriticalGap) {
          summaryReason = `Ranks #1 because they meet all critical role requirements (${profile.primaryTechnologies.join(', ')}) with strong demonstrable evidence and consistent technical alignment.`;
        } else {
          summaryReason = `Ranks highest among evaluated candidates, though has key gaps to address before applying.`;
        }
      } else {
        const top = sorted[0];
        if (top && !top.hasCriticalGap && review.hasCriticalGap) {
          summaryReason = `Ranks below ${top.candidateName} primarily due to critical requirement gaps (${review.criticalGapMessage || 'missing core technology'}).`;
        } else {
          summaryReason = `Ranks at #${rank} with solid foundational fit, but with less comprehensive evidence on key technical requirements compared to higher-ranked candidates.`;
        }
      }

      return {
        rank,
        candidateId: review.candidateId,
        candidateName: review.candidateName,
        filename: review.filename,
        score: review.roleFit.score,
        verdict: review.roleFit.verdict,
        meetsCriticalRequirements: !review.hasCriticalGap,
        keyStrengths,
        primaryGaps,
        summaryReason,
      };
    });
  }

  /**
   * Formats multi-candidate comparison into a humanized explanation.
   */
  static formatComparativeSummary(rankings: CandidateRankingItem[]): string {
    if (rankings.length === 0) return 'No candidates analyzed yet.';
    if (rankings.length === 1) {
      const c = rankings[0];
      return `Evaluated 1 candidate: ${c.candidateName} (${c.score}% · ${c.verdict}). ${c.summaryReason}`;
    }

    const top = rankings[0];
    const lines = [
      `🏆 Candidate Ranking Comparison (${rankings.length} candidates)`,
      '',
      ...rankings.map((c) => {
        const medal = c.rank === 1 ? '🥇' : c.rank === 2 ? '🥈' : c.rank === 3 ? '🥉' : `${c.rank}️⃣`;
        return `${medal} ${c.candidateName} — ${c.score}% (${c.verdict})`;
      }),
      '',
      `Why ${top.candidateName} ranks first:`,
      `• ${top.summaryReason}`,
      ...top.keyStrengths.map((s) => `• Strength: ${s}`),
    ];

    return lines.join('\n');
  }
}
