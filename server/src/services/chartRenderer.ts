import { Resvg } from '@resvg/resvg-js';
import { ReviewObject, CandidateRankingItem } from '../types/index.js';

export class ChartRenderer {
  /**
   * Generates a sleek, compact Radial Score Gauge PNG image for 1 Resume vs 1 JD
   */
  static generateScoreGaugePNG(review: ReviewObject, jdTitle: string): Buffer {
    const score = review.roleFit.score;
    const verdict = review.roleFit.verdict;
    const skills = review.subscores.skills;
    const exp = review.subscores.experience;
    const kw = review.subscores.keywords;
    const format = review.subscores.formatting;

    // SVG arc calculations (r = 75, circumference = 2 * PI * 75 = 471.24)
    const circum = 2 * Math.PI * 75;
    const strokeOffset = circum - (score / 100) * circum;

    // Color based on verdict
    let strokeColor = '#00a884'; // green
    let glowColor = 'rgba(0, 168, 132, 0.25)';
    if (score < 50) {
      strokeColor = '#f87171'; // red
      glowColor = 'rgba(248, 113, 113, 0.25)';
    } else if (score < 75) {
      strokeColor = '#fbbf24'; // yellow
      glowColor = 'rgba(251, 191, 36, 0.25)';
    }

    const svg = `
      <svg width="800" height="460" viewBox="0 0 800 460" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0b141a"/>
            <stop offset="100%" stop-color="#111b21"/>
          </linearGradient>
          <linearGradient id="meterGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${strokeColor}"/>
            <stop offset="100%" stop-color="${strokeColor}dd"/>
          </linearGradient>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="${strokeColor}" flood-opacity="0.35"/>
          </filter>
        </defs>

        <!-- Card Background -->
        <rect width="800" height="460" rx="20" fill="url(#bgGrad)" stroke="#222e35" stroke-width="1.5"/>
        
        <!-- Header -->
        <g transform="translate(44, 46)">
          <text x="0" y="0" fill="#00a884" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" letter-spacing="1.5">ROLEFIT ATS INTELLIGENCE</text>
          <text x="0" y="28" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800">${this.escapeXml(review.candidateName)}</text>
          <text x="0" y="52" fill="#8696a0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="500">Target Role: ${this.escapeXml(jdTitle.slice(0, 42))}</text>
          <line x1="0" y1="70" x2="712" y2="70" stroke="#222e35" stroke-width="1.5"/>
        </g>

        <!-- Left: Radial Gauge Meter -->
        <g transform="translate(180, 275)">
          <!-- Outer subtle ring -->
          <circle cx="0" cy="0" r="96" fill="none" stroke="#1f2c34" stroke-width="2" stroke-dasharray="4 4"/>
          <!-- Background track -->
          <circle cx="0" cy="0" r="80" fill="none" stroke="#1f2c34" stroke-width="16"/>
          <!-- Active fill -->
          <circle cx="0" cy="0" r="80" fill="none" stroke="url(#meterGrad)" stroke-width="16"
            stroke-dasharray="${(2 * Math.PI * 80).toFixed(1)}"
            stroke-dashoffset="${((2 * Math.PI * 80) - (score / 100) * (2 * Math.PI * 80)).toFixed(1)}"
            stroke-linecap="round" transform="rotate(-90)" filter="url(#glow)"/>
          
          <text x="0" y="10" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="44" font-weight="800">${score}%</text>
          <text x="0" y="38" text-anchor="middle" fill="${strokeColor}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700" letter-spacing="0.5">${this.escapeXml(verdict.toUpperCase())}</text>
        </g>

        <!-- Right: 4 ATS Parameter Progress Bars -->
        <g transform="translate(360, 155)">
          <text x="0" y="0" fill="#8696a0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" letter-spacing="1">ATS MATCH PARAMETERS</text>
          
          <!-- Skills Bar -->
          <g transform="translate(0, 24)">
            <text x="0" y="14" fill="#e9edef" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600">Skills Alignment</text>
            <text x="390" y="14" text-anchor="end" fill="#00a884" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700">${skills}%</text>
            <rect x="0" y="24" width="390" height="8" rx="4" fill="#1f2c34"/>
            <rect x="0" y="24" width="${Math.round(390 * (skills / 100))}" height="8" rx="4" fill="#00a884"/>
          </g>

          <!-- Experience Bar -->
          <g transform="translate(0, 72)">
            <text x="0" y="14" fill="#e9edef" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600">Experience Match</text>
            <text x="390" y="14" text-anchor="end" fill="#53bdeb" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700">${exp}%</text>
            <rect x="0" y="24" width="390" height="8" rx="4" fill="#1f2c34"/>
            <rect x="0" y="24" width="${Math.round(390 * (exp / 100))}" height="8" rx="4" fill="#53bdeb"/>
          </g>

          <!-- Keywords Bar -->
          <g transform="translate(0, 120)">
            <text x="0" y="14" fill="#e9edef" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600">Keyword Evidence</text>
            <text x="390" y="14" text-anchor="end" fill="#a855f7" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700">${kw}%</text>
            <rect x="0" y="24" width="390" height="8" rx="4" fill="#1f2c34"/>
            <rect x="0" y="24" width="${Math.round(390 * (kw / 100))}" height="8" rx="4" fill="#a855f7"/>
          </g>

          <!-- ATS Formatting Bar -->
          <g transform="translate(0, 168)">
            <text x="0" y="14" fill="#e9edef" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600">ATS Parseability</text>
            <text x="390" y="14" text-anchor="end" fill="#34d399" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700">${format}%</text>
            <rect x="0" y="24" width="390" height="8" rx="4" fill="#1f2c34"/>
            <rect x="0" y="24" width="${Math.round(390 * (format / 100))}" height="8" rx="4" fill="#34d399"/>
          </g>
        </g>

        <!-- Footer watermark -->
        <g transform="translate(44, 430)">
          <text x="0" y="0" fill="#667781" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="500">Recruiter Intelligence · Truth-First Review · Generated by RoleFit AI</text>
        </g>
      </svg>
    `;

    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 800 } });
    return resvg.render().asPng();
  }

  /**
   * Generates a Bar Chart PNG comparing N Resumes vs 1 JD
   */
  static generateComparisonBarChartPNG(rankings: CandidateRankingItem[], jdTitle: string): Buffer {
    const height = Math.max(340, 140 + rankings.length * 54);
    const maxBarWidth = 340;

    const barsSvg = rankings.map((c, i) => {
      const y = 130 + i * 54;
      const barWidth = Math.max(10, Math.round(maxBarWidth * (c.score / 100)));
      const medal = i === 0 ? '1' : i === 1 ? '2' : i === 2 ? '3' : `${i + 1}`;
      const medalColor = i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#d97706' : '#64748b';
      const barColor = i === 0 ? '#00a884' : c.score >= 70 ? '#53bdeb' : '#f59e0b';

      return `
        <g transform="translate(32, ${y})">
          <!-- Rank Circle -->
          <circle cx="14" cy="14" r="12" fill="${medalColor}"/>
          <text x="14" y="18" text-anchor="middle" fill="#121b22" font-family="-apple-system, sans-serif" font-size="12" font-weight="800">#${medal}</text>

          <!-- Candidate Name -->
          <text x="36" y="18" fill="#e9edef" font-family="-apple-system, sans-serif" font-size="14" font-weight="600">${this.escapeXml(c.candidateName.slice(0, 18))}</text>
          
          <!-- Bar Track & Fill -->
          <rect x="180" y="6" width="${maxBarWidth}" height="18" rx="4" fill="#222e35"/>
          <rect x="180" y="6" width="${barWidth}" height="18" rx="4" fill="${barColor}"/>
          
          <!-- Score Text -->
          <text x="${190 + barWidth}" y="20" fill="#e9edef" font-family="-apple-system, sans-serif" font-size="13" font-weight="700">${c.score}%</text>
        </g>
      `;
    }).join('');

    const svg = `
      <svg width="600" height="${height}" viewBox="0 0 600 ${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="600" height="${height}" rx="16" fill="#121b22"/>
        
        <!-- Header -->
        <text x="32" y="42" fill="#8696a0" font-family="-apple-system, sans-serif" font-size="13" font-weight="600" letter-spacing="1">CANDIDATE RANKING COMPARISON</text>
        <text x="32" y="70" fill="#e9edef" font-family="-apple-system, sans-serif" font-size="18" font-weight="700">${this.escapeXml(jdTitle.slice(0, 36))}</text>
        <line x1="32" y1="88" x2="568" y2="88" stroke="#2a3942" stroke-width="1"/>

        <!-- Candidate Bars -->
        ${barsSvg}

        <!-- Footer -->
        <text x="32" y="${height - 20}" fill="#667781" font-family="-apple-system, sans-serif" font-size="11">Generated by RoleFit AI · Fair Multi-Candidate Ranking</text>
      </svg>
    `;

    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 600 } });
    return resvg.render().asPng();
  }

  private static escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
