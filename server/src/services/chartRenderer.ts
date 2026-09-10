import { Resvg } from '@resvg/resvg-js';
import { ReviewObject, CandidateRankingItem } from '../types/index.js';

export class ChartRenderer {
  /**
   * Generates a sleek Cartesian Coordinate Bar Graph PNG (Y-axis 0-100%, X-axis parameters)
   * exactly matching the requested coordinate diagram format.
   */
  static generateScoreBarChartPNG(review: ReviewObject, jdTitle: string): Buffer {
    const overallScore = review.roleFit.score;
    const verdict = review.roleFit.verdict;
    const skills = review.subscores.skills;
    const exp = review.subscores.experience;
    const kw = review.subscores.keywords;
    const format = review.subscores.formatting;
    const metrics = review.subscores.metrics ?? Math.max(35, Math.round(overallScore * 0.85));

    // Data series for the 6 vertical bars
    const categories = [
      { name: 'Overall', score: overallScore, color: '#10b981', grad: 'gradOverall' },
      { name: 'Skills', score: skills, color: '#38bdf8', grad: 'gradSkills' },
      { name: 'Experience', score: exp, color: '#818cf8', grad: 'gradExp' },
      { name: 'Keywords', score: kw, color: '#c084fc', grad: 'gradKw' },
      { name: 'Metrics', score: metrics, color: '#fbbf24', grad: 'gradMetrics' },
      { name: 'ATS Format', score: format, color: '#34d399', grad: 'gradFormat' },
    ];

    // Coordinate system geometry
    const originX = 110;
    const originY = 410;
    const plotHeight = 250;
    const plotWidth = 630;
    const yAxisTop = originY - plotHeight; // 160
    const xAxisEnd = originX + plotWidth;  // 740

    // Y ticks: 100, 80, 60, 40, 20, 0
    const yTicks = [0, 20, 40, 60, 80, 100];
    const gridLinesSvg = yTicks.map((val) => {
      const y = originY - (val / 100) * plotHeight;
      return `
        <line x1="${originX}" y1="${y}" x2="${xAxisEnd}" y2="${y}" stroke="#1e293b" stroke-width="1" stroke-dasharray="${val === 0 ? '0' : '4 4'}"/>
        <line x1="${originX - 6}" y1="${y}" x2="${originX}" y2="${y}" stroke="#64748b" stroke-width="1.5"/>
        <text x="${originX - 12}" y="${y + 4}" text-anchor="end" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="600">${val}%</text>
      `;
    }).join('');

    // Bar rendering
    const barWidth = 52;
    const barSpacing = (plotWidth - 40) / categories.length; // ~98px
    const startBarX = originX + 30;

    const barsSvg = categories.map((cat, idx) => {
      const bx = startBarX + idx * barSpacing;
      const bHeight = Math.max(4, Math.round((cat.score / 100) * plotHeight));
      const by = originY - bHeight;

      return `
        <!-- Bar: ${cat.name} (${cat.score}%) -->
        <g>
          <!-- Score Value on Top of Bar -->
          <text x="${bx + barWidth / 2}" y="${by - 10}" text-anchor="middle" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="15" font-weight="800">${cat.score}%</text>
          
          <!-- Vertical Bar with rounded top -->
          <rect x="${bx}" y="${by}" width="${barWidth}" height="${bHeight}" rx="6" fill="url(#${cat.grad})" filter="url(#barGlow)"/>
          
          <!-- Subtle top highlight line -->
          <line x1="${bx + 4}" y1="${by + 1}" x2="${bx + barWidth - 4}" y2="${by + 1}" stroke="rgba(255,255,255,0.4)" stroke-width="2" stroke-linecap="round"/>

          <!-- Category Label Below X-Axis -->
          <text x="${bx + barWidth / 2}" y="${originY + 28}" text-anchor="middle" fill="#cbd5e1" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="600">${cat.name}</text>
        </g>
      `;
    }).join('');

    let verdictColor = '#10b981';
    if (overallScore < 50) verdictColor = '#f87171';
    else if (overallScore < 74) verdictColor = '#fbbf24';

    const svg = `
      <svg width="820" height="510" viewBox="0 0 820 510" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#0b1329"/>
            <stop offset="100%" stop-color="#0f172a"/>
          </linearGradient>

          <linearGradient id="gradOverall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#34d399"/>
            <stop offset="100%" stop-color="#059669"/>
          </linearGradient>
          <linearGradient id="gradSkills" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8"/>
            <stop offset="100%" stop-color="#0284c7"/>
          </linearGradient>
          <linearGradient id="gradExp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#a78bfa"/>
            <stop offset="100%" stop-color="#6d28d9"/>
          </linearGradient>
          <linearGradient id="gradKw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#c084fc"/>
            <stop offset="100%" stop-color="#9333ea"/>
          </linearGradient>
          <linearGradient id="gradMetrics" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#fcd34d"/>
            <stop offset="100%" stop-color="#d97706"/>
          </linearGradient>
          <linearGradient id="gradFormat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2dd4bf"/>
            <stop offset="100%" stop-color="#0f766e"/>
          </linearGradient>

          <filter id="barGlow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.4"/>
          </filter>

          <!-- Arrow markers -->
          <marker id="arrowUp" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M1,7 L4,1 L7,7 Z" fill="#94a3b8"/>
          </marker>
          <marker id="arrowRight" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M1,1 L7,4 L1,7 Z" fill="#94a3b8"/>
          </marker>
        </defs>

        <!-- Card Base -->
        <rect width="820" height="510" rx="18" fill="url(#bgGrad)" stroke="#1e293b" stroke-width="1.5"/>

        <!-- Header -->
        <g transform="translate(44, 42)">
          <text x="0" y="0" fill="#10b981" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" letter-spacing="1.5">ROLEFIT ATS BAR GRAPH ANALYSIS</text>
          <text x="0" y="28" fill="#ffffff" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="22" font-weight="800">${this.escapeXml(review.candidateName)}</text>
          <text x="0" y="52" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="500">Target Role: ${this.escapeXml(jdTitle.slice(0, 40))}</text>
          <line x1="0" y1="68" x2="732" y2="68" stroke="#1e293b" stroke-width="1.5"/>
        </g>

        <!-- Verdict Badge in Top Right -->
        <g transform="translate(620, 48)">
          <rect x="0" y="0" width="156" height="34" rx="8" fill="${verdictColor}22" stroke="${verdictColor}" stroke-width="1.5"/>
          <text x="78" y="22" text-anchor="middle" fill="${verdictColor}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="800">${this.escapeXml(verdict.toUpperCase())}</text>
        </g>

        <!-- Y-Axis Gridlines & Ticks -->
        ${gridLinesSvg}

        <!-- Cartesian Y-Axis with Arrow -->
        <line x1="${originX}" y1="${originY}" x2="${originX}" y2="${yAxisTop - 24}" stroke="#94a3b8" stroke-width="2" marker-end="url(#arrowUp)"/>
        <text x="${originX}" y="${yAxisTop - 34}" text-anchor="middle" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700">Y</text>

        <!-- Cartesian X-Axis with Arrow -->
        <line x1="${originX}" y1="${originY}" x2="${xAxisEnd + 24}" y2="${originY}" stroke="#94a3b8" stroke-width="2" marker-end="url(#arrowRight)"/>
        <text x="${xAxisEnd + 36}" y="${originY + 5}" text-anchor="start" fill="#94a3b8" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700">X</text>

        <!-- Origin Label O -->
        <text x="${originX - 16}" y="${originY + 18}" fill="#64748b" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="13" font-weight="700">O</text>

        <!-- Vertical Bars -->
        ${barsSvg}

        <!-- Footer -->
        <g transform="translate(44, 488)">
          <text x="0" y="0" fill="#64748b" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="500">Recruiter Intelligence · Multi-Factor ATS Precision · Generated by RoleFit AI</text>
        </g>
      </svg>
    `;

    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 820 } });
    return resvg.render().asPng();
  }

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

    // Color based on verdict
    let strokeColor = '#00a884'; // green
    if (score < 50) {
      strokeColor = '#f87171'; // red
    } else if (score < 75) {
      strokeColor = '#fbbf24'; // yellow
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
          <circle cx="0" cy="0" r="96" fill="none" stroke="#1f2c34" stroke-width="2" stroke-dasharray="4 4"/>
          <circle cx="0" cy="0" r="80" fill="none" stroke="#1f2c34" stroke-width="16"/>
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
          
          <g transform="translate(0, 24)">
            <text x="0" y="14" fill="#e9edef" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600">Skills Alignment</text>
            <text x="390" y="14" text-anchor="end" fill="#00a884" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700">${skills}%</text>
            <rect x="0" y="24" width="390" height="8" rx="4" fill="#1f2c34"/>
            <rect x="0" y="24" width="${Math.round(390 * (skills / 100))}" height="8" rx="4" fill="#00a884"/>
          </g>

          <g transform="translate(0, 72)">
            <text x="0" y="14" fill="#e9edef" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600">Experience Match</text>
            <text x="390" y="14" text-anchor="end" fill="#53bdeb" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700">${exp}%</text>
            <rect x="0" y="24" width="390" height="8" rx="4" fill="#1f2c34"/>
            <rect x="0" y="24" width="${Math.round(390 * (exp / 100))}" height="8" rx="4" fill="#53bdeb"/>
          </g>

          <g transform="translate(0, 120)">
            <text x="0" y="14" fill="#e9edef" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600">Keyword Evidence</text>
            <text x="390" y="14" text-anchor="end" fill="#a855f7" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700">${kw}%</text>
            <rect x="0" y="24" width="390" height="8" rx="4" fill="#1f2c34"/>
            <rect x="0" y="24" width="${Math.round(390 * (kw / 100))}" height="8" rx="4" fill="#a855f7"/>
          </g>

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
