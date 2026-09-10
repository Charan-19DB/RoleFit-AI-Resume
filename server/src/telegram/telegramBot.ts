import { Telegraf, Markup } from 'telegraf';
import { GeminiService } from '../services/geminiService.js';
import { DocumentParser } from '../parsers/documentParser.js';
import { RankingService } from '../services/rankingService.js';
import { ReviewObject, SessionData } from '../types/index.js';
import { SessionStore } from '../services/sessionStore.js';

export function setupTelegramBot(
  token: string | undefined,
  geminiService: GeminiService
): Telegraf | null {
  if (!token || token.trim().length === 0) {
    console.log('ℹ️ No TELEGRAM_BOT_TOKEN provided. Telegram bot runner is inactive.');
    return null;
  }

  const bot = new Telegraf(token);

  // In-memory chat to session mapping
  const chatSessions = new Map<number, string>();

  function getSessionId(chatId: number): string {
    let sId = chatSessions.get(chatId);
    if (!sId) {
      sId = `tg-${chatId}-${Date.now()}`;
      chatSessions.set(chatId, sId);
    }
    return sId;
  }

  // /start command
  bot.command('start', async (ctx) => {
    const sessionId = `tg-${ctx.chat.id}-${Date.now()}`;
    chatSessions.set(ctx.chat.id, sessionId);

    await ctx.reply(
      `👋 *Welcome to RoleFit — Your Recruiter & Career Reviewer*\n\n` +
      `"Your resume. Their requirements. One honest review."\n\n` +
      `To begin, send me the *Job Description*:\n` +
      `📝 Paste the JD as text\n` +
      `📄 Or upload a PDF / DOCX file`,
      {
        parse_mode: 'Markdown',
        ...Markup.keyboard([
          ['📝 Paste JD Text', '📄 Upload JD File'],
          ['🔄 Start New Review'],
        ]).resize(),
      }
    );
  });

  // /new command
  bot.command('new', async (ctx) => {
    const sessionId = `tg-${ctx.chat.id}-${Date.now()}`;
    chatSessions.set(ctx.chat.id, sessionId);
    await ctx.reply('🔄 *New session started.* Send me a Job Description (text or PDF/DOCX) to begin.', {
      parse_mode: 'Markdown',
    });
  });

  // Handle document uploads (JD or Resume)
  bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    const chatId = ctx.chat.id;
    const sessionId = getSessionId(chatId);

    const statusMsg = await ctx.reply('📄 Downloading and reading document...');

    try {
      const fileUrl = await ctx.telegram.getFileLink(doc.file_id);
      const response = await fetch(fileUrl.href);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = doc.mime_type || 'application/octet-stream';
      const filename = doc.file_name || 'document.pdf';

      const extractedText = await DocumentParser.extractText(buffer, mimeType, filename);

      const session = await SessionStore.getSession(sessionId);

      // If no JD profile exists yet, treat this document as the JD
      if (!session.jdProfile) {
        await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, '🧠 Understanding the role and core technologies...');
        const profile = await geminiService.analyzeJobDescription(extractedText);
        await SessionStore.setJDProfile(sessionId, profile);

        const criticalCount = profile.requirements.filter((r) => r.priority === 'CRITICAL').length;
        const highCount = profile.requirements.filter((r) => r.priority === 'HIGH').length;
        const lowCount = profile.requirements.filter((r) => r.priority === 'LOW').length;

        await ctx.telegram.editMessageText(
          chatId,
          statusMsg.message_id,
          undefined,
          `✅ *Job Description Received*\n\n` +
          `📌 *Role:* ${profile.jobTitle}\n` +
          `⚡ *Primary Technology:* ${profile.primaryTechnologies.join(', ') || 'Not specified'}\n\n` +
          `🔴 *Critical requirements:* ${criticalCount}\n` +
          `🟠 *Important requirements:* ${highCount}\n` +
          `🟡 *Preferred requirements:* ${lowCount}\n\n` +
          `👉 *Now upload one or more resumes (PDF or DOCX)* to analyze candidate fit.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // If JD profile already exists, treat document as candidate resume
      await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, `🔍 Analyzing candidate evidence against "${session.jdProfile.jobTitle}"...`);

      const candidateName = filename.replace(/\.(pdf|docx|txt)$/i, '').replace(/[-_]/g, ' ');
      const review = await geminiService.analyzeCandidateResume(session.jdProfile, extractedText, candidateName, filename);

      await SessionStore.addCandidateReview(sessionId, review);

      await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, '✅ Analysis complete!');

      // Send formatted human review
      await sendReviewMessage(ctx, review, session);
    } catch (err: any) {
      await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, `⚠️ Error processing document: ${err.message}`);
    }
  });

  // Handle plain text messages (JD input or conversational follow-up)
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;
    const sessionId = getSessionId(chatId);

    if (text === '🔄 Start New Review') {
      chatSessions.set(chatId, `tg-${chatId}-${Date.now()}`);
      return ctx.reply('🔄 Fresh review started. Please send the Job Description text or upload a file.');
    }
    if (text === '📝 Paste JD Text' || text === '📄 Upload JD File') {
      return ctx.reply('Please paste the Job Description text directly into chat, or send a PDF/DOCX file.');
    }

    const session = await SessionStore.getSession(sessionId);

    // If no JD yet, treat incoming text (> 80 characters) as JD
    if (!session.jdProfile && text.length >= 80) {
      const statusMsg = await ctx.reply('🧠 Reading and analyzing Job Description...');
      try {
        const profile = await geminiService.analyzeJobDescription(text);
        await SessionStore.setJDProfile(sessionId, profile);

        const criticalCount = profile.requirements.filter((r) => r.priority === 'CRITICAL').length;
        const highCount = profile.requirements.filter((r) => r.priority === 'HIGH').length;
        const lowCount = profile.requirements.filter((r) => r.priority === 'LOW').length;

        await ctx.telegram.editMessageText(
          chatId,
          statusMsg.message_id,
          undefined,
          `✅ *Job Description Received*\n\n` +
          `📌 *Role:* ${profile.jobTitle}\n` +
          `⚡ *Primary Technology:* ${profile.primaryTechnologies.join(', ') || 'Not specified'}\n\n` +
          `🔴 *Critical requirements:* ${criticalCount}\n` +
          `🟠 *Important requirements:* ${highCount}\n` +
          `🟡 *Preferred requirements:* ${lowCount}\n\n` +
          `👉 *Now upload one or more resumes (PDF or DOCX)* to analyze candidate fit.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err: any) {
        await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, `⚠️ Error analyzing JD: ${err.message}`);
      }
      return;
    }

    // If candidate review already exists, treat as conversational follow-up
    const candidateList = Object.values(session.candidates);
    if (session.jdProfile && candidateList.length > 0) {
      const latestCandidate = candidateList[candidateList.length - 1];
      const typingMsg = await ctx.reply('💭 Reviewing your application context...');

      const reply = await geminiService.answerFollowUp(
        session.jdProfile,
        latestCandidate,
        text,
        session.messages.map((m) => ({ role: m.role, content: m.content }))
      );

      await ctx.telegram.editMessageText(chatId, typingMsg.message_id, undefined, reply);
      return;
    }

    // Default guidance
    if (!session.jdProfile) {
      await ctx.reply(
        'Please send a Job Description first (paste at least 80 characters of text or upload a PDF/DOCX) so we can evaluate resumes accurately.'
      );
    } else {
      await ctx.reply(
        `I have the JD for *${session.jdProfile.jobTitle}*. Please upload a candidate resume (PDF or DOCX) to get an honest review.`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // Action callbacks
  bot.action('action_rewrites', async (ctx) => {
    await ctx.answerCbQuery();
    const sessionId = getSessionId(ctx.chat!.id);
    const session = await SessionStore.getSession(sessionId);
    const candidates = Object.values(session.candidates);
    if (candidates.length === 0) return ctx.reply('No candidate analyzed yet.');

    const c = candidates[candidates.length - 1];
    const rewrites = c.suggestedWording;
    if (rewrites.length === 0) return ctx.reply('No bullet rewrites available.');

    const msg = [
      '📝 *Suggested Bullet Rewrites (Truth-First)*',
      '',
      ...rewrites.map(
        (r) => `*Before:*\n"${r.before}"\n\n*Suggested:*\n"${r.after}"\n\n_${r.guidance}_\n`
      ),
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.action('action_learning', async (ctx) => {
    await ctx.answerCbQuery();
    const sessionId = getSessionId(ctx.chat!.id);
    const session = await SessionStore.getSession(sessionId);
    const candidates = Object.values(session.candidates);
    if (candidates.length === 0) return ctx.reply('No candidate analyzed yet.');

    const c = candidates[candidates.length - 1];
    const learning = c.learningPlan;
    if (learning.length === 0) return ctx.reply('No urgent learning gaps found!');

    const msg = [
      '📚 *What to Learn Next (Ordered by Role Priority)*',
      '',
      ...learning.map((l, i) => `${i + 1}. *${l.topic}* [${l.priority} Priority]\n   ${l.reason}\n`),
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });

  bot.action('action_compare', async (ctx) => {
    await ctx.answerCbQuery();
    const sessionId = getSessionId(ctx.chat!.id);
    const session = await SessionStore.getSession(sessionId);
    const candidates = Object.values(session.candidates);
    if (candidates.length < 2) {
      return ctx.reply(`Upload another resume to compare candidates. Current candidates analyzed: ${candidates.length}.`);
    }

    const rankings = RankingService.rankCandidates(session.jdProfile!, candidates);
    const summary = RankingService.formatComparativeSummary(rankings);
    await ctx.reply(summary);
  });

  async function sendReviewMessage(ctx: any, review: ReviewObject, session: SessionData) {
    const lines = [
      `🧭 *RESUME REVIEW · ${review.candidateName}*`,
      '',
      `*Role Fit:* ${review.roleFit.verdict} — *${review.roleFit.score}%*`,
      `${review.roleFit.summary}`,
      '',
      '────────────────────────────',
      '👀 *RECRUITER’S EYE*',
      `• *I’d notice first:* ${review.recruitersEye.noticeFirst.join(', ')}`,
      `• *I’d question:* ${review.recruitersEye.question.join(', ')}`,
      `• *I’d skip over:* ${review.recruitersEye.skipOver.join(', ')}`,
      '',
      '────────────────────────────',
      '✏️ *WHAT I’D CHANGE BEFORE APPLYING*',
      ...review.whatToChangeBeforeApplying.slice(0, 3).map((e, idx) => {
        return `${idx + 1}. *${e.title}* [${e.priority} Priority]\n   • Why: ${e.reason}\n   • Action: ${e.action}\n   • _Honesty check: ${e.honestyNote}_`;
      }),
      '',
      '────────────────────────────',
      '📚 *TOP LEARNING PRIORITY*',
      review.learningPlan.length > 0
        ? `1. *${review.learningPlan[0].topic}* [${review.learningPlan[0].priority} Priority]\n   ${review.learningPlan[0].reason}`
        : 'No critical technical gaps identified.',
      '',
      '💬 *What would you like to do next?*',
    ];

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('📝 Review Rewrites', 'action_rewrites'),
          Markup.button.callback('📚 Learning Plan', 'action_learning'),
        ],
        [
          Markup.button.callback('🏆 Compare Candidates', 'action_compare'),
        ],
      ]),
    });
  }

  // Launch bot
  bot.launch().then(() => {
    console.log('🤖 Telegram bot is running in long-polling mode.');
  }).catch((err) => {
    console.warn(`⚠️ Telegram bot launch error: ${err.message}`);
  });

  return bot;
}
