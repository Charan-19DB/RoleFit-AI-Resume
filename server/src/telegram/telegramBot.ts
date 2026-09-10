import { Telegraf, Markup } from 'telegraf';
import { GeminiService } from '../services/geminiService.js';
import { DocumentParser } from '../parsers/documentParser.js';
import { RankingService } from '../services/rankingService.js';
import { ReviewObject, SessionData } from '../types/index.js';
import { SessionStore } from '../services/sessionStore.js';
import { ChartRenderer } from '../services/chartRenderer.js';
import { ClassifierService } from '../services/classifierService.js';

function escapeHtml(text?: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderProgressBar(score: number): string {
  const filled = Math.min(10, Math.max(0, Math.round(score / 10)));
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function getScoreBadge(score: number): string {
  if (score >= 80) return '🟢';
  if (score >= 60) return '🟡';
  return '🔴';
}

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

    const welcome = [
      `👋 <b>Welcome to RoleFit AI — Recruiter & Career Intelligence</b>`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `<i>"Your resume. Their requirements. One honest review."</i>`,
      ``,
      `🎯 <b>How it works:</b>`,
      `You can give input in <b>ANY order</b>:`,
      `• Send your <b>Resume</b> first, then the <b>JD</b>`,
      `• Or send the <b>JD</b> first, then your <b>Resume</b>`,
      ``,
      `📁 <b>Accepted formats:</b>`,
      `• PDF or DOCX file attachments`,
      `• Or paste text directly into chat`,
      ``,
      `👉 Send your first document or text below to begin!`,
    ].join('\n');

    await ctx.reply(welcome, {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        ['📄 Send Resume', '📝 Send Job Description'],
        ['🔄 Start Fresh Review'],
      ]).resize(),
    });
  });

  // /new command
  bot.command('new', async (ctx) => {
    const sessionId = `tg-${ctx.chat.id}-${Date.now()}`;
    chatSessions.set(ctx.chat.id, sessionId);
    await ctx.reply(
      `🔄 <b>Fresh Review Session Started</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPlease send a <b>Resume</b> or a <b>Job Description</b> (file or text) to begin.`,
      { parse_mode: 'HTML' }
    );
  });

  // Handle document uploads (PDF, DOCX, etc.)
  bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    const chatId = ctx.chat.id;
    const sessionId = getSessionId(chatId);

    const statusMsg = await ctx.reply('⏳ <i>Downloading and parsing document...</i>', { parse_mode: 'HTML' });

    try {
      const fileUrl = await ctx.telegram.getFileLink(doc.file_id);
      const response = await fetch(fileUrl.href);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = doc.mime_type || 'application/octet-stream';
      const filename = doc.file_name || 'document.pdf';

      const extractedText = await DocumentParser.extractText(buffer, mimeType, filename);
      const session = await SessionStore.getSession(sessionId);

      const classification = ClassifierService.classify(extractedText, filename, {
        hasActiveJD: !!session.jdProfile,
        hasPendingResumes: (session.pendingResumes?.length || 0) > 0,
      });

      if (classification === 'RESUME') {
        const candidateName = filename.replace(/\.(pdf|docx|txt)$/i, '').replace(/[-_]/g, ' ');

        if (session.jdProfile) {
          await ctx.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            `🔍 <i>Evaluating <b>${escapeHtml(candidateName)}</b> against <b>${escapeHtml(session.jdProfile.jobTitle)}</b>...</i>`,
            { parse_mode: 'HTML' }
          );
          const review = await geminiService.analyzeCandidateResume(session.jdProfile, extractedText, candidateName, filename);
          await SessionStore.addCandidateReview(sessionId, review);
          await ctx.telegram.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
          await sendReviewMessage(ctx, review, session);
        } else {
          if (!session.pendingResumes) session.pendingResumes = [];
          session.pendingResumes.push({ text: extractedText, filename, candidateName });
          await SessionStore.saveSession(session);

          const msg = [
            `📄 <b>Resume Received: ${escapeHtml(candidateName)}</b>`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `✅ Successfully parsed candidate resume.`,
            ``,
            `👉 <b>Next Step:</b> Now send or paste the <b>Job Description</b> to match against this resume!`,
          ].join('\n');

          await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, msg, { parse_mode: 'HTML' });
        }
        return;
      }

      // If document is a JD
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        '🧠 <i>Extracting role requirements & core tech stack...</i>',
        { parse_mode: 'HTML' }
      );
      const profile = await geminiService.analyzeJobDescription(extractedText);
      await SessionStore.setJDProfile(sessionId, profile);

      if (session.pendingResumes && session.pendingResumes.length > 0) {
        await ctx.telegram.editMessageText(
          chatId,
          statusMsg.message_id,
          undefined,
          `✅ <b>Job Description Analyzed: ${escapeHtml(profile.jobTitle)}</b>\n🔍 <i>Matching your previously uploaded resume...</i>`,
          { parse_mode: 'HTML' }
        );
        for (const pending of session.pendingResumes) {
          const review = await geminiService.analyzeCandidateResume(profile, pending.text, pending.candidateName, pending.filename);
          await SessionStore.addCandidateReview(sessionId, review);
          await sendReviewMessage(ctx, review, session);
        }
        session.pendingResumes = [];
        await SessionStore.saveSession(session);
      } else {
        const msg = [
          `📋 <b>Job Description Analyzed</b>`,
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          `🎯 <b>Role:</b> <b>${escapeHtml(profile.jobTitle)}</b>`,
          `🛠️ <b>Primary Stack:</b> ${escapeHtml(profile.primaryTechnologies.join(', '))}`,
          ``,
          `👉 <b>Next Step:</b> Now upload your <b>Candidate Resume</b> (PDF or DOCX file)!`,
        ].join('\n');

        await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, msg, { parse_mode: 'HTML' });
      }
    } catch (err: any) {
      await ctx.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        `⚠️ <b>Error processing document:</b> ${escapeHtml(err.message)}`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Handle plain text messages (JD input, Resume paste, or conversational follow-up)
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;
    const sessionId = getSessionId(chatId);

    if (text === '🔄 Start Fresh Review') {
      chatSessions.set(chatId, `tg-${chatId}-${Date.now()}`);
      return ctx.reply(
        `🔄 <b>Fresh Review Started</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPlease send either a <b>Resume</b> or a <b>Job Description</b> (paste text or attach file).`,
        { parse_mode: 'HTML' }
      );
    }
    if (text === '📄 Send Resume' || text === '📝 Send Job Description') {
      return ctx.reply(
        `📎 <b>Ready for your input</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nYou can attach a PDF/DOCX file directly or paste the text in chat!`,
        { parse_mode: 'HTML' }
      );
    }

    const session = await SessionStore.getSession(sessionId);
    const candidateList = Object.values(session.candidates);

    // If candidate review exists and text looks like a question, treat as conversational follow-up
    if (session.jdProfile && candidateList.length > 0 && ClassifierService.isChatMessage(text)) {
      const latestCandidate = candidateList[candidateList.length - 1];
      const typingMsg = await ctx.reply('💭 <i>Consulting recruiter intelligence...</i>', { parse_mode: 'HTML' });

      const reply = await geminiService.answerFollowUp(
        session.jdProfile,
        latestCandidate,
        text,
        session.messages.map((m) => ({ role: m.role, content: m.content }))
      );

      const formattedReply = [
        `💡 <b>Recruiter Guidance</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        escapeHtml(reply),
      ].join('\n');

      await ctx.telegram.editMessageText(chatId, typingMsg.message_id, undefined, formattedReply, { parse_mode: 'HTML' });
      return;
    }

    // Substantive text (> 50 chars)
    if (text.length >= 50) {
      const classification = ClassifierService.classify(text, undefined, {
        hasActiveJD: !!session.jdProfile,
        hasPendingResumes: (session.pendingResumes?.length || 0) > 0,
      });

      if (classification === 'RESUME') {
        if (session.jdProfile) {
          const statusMsg = await ctx.reply('🔍 <i>Evaluating resume against active Job Description...</i>', { parse_mode: 'HTML' });
          const review = await geminiService.analyzeCandidateResume(session.jdProfile, text, 'Candidate');
          await SessionStore.addCandidateReview(sessionId, review);
          await ctx.telegram.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
          await sendReviewMessage(ctx, review, session);
          return;
        } else {
          if (!session.pendingResumes) session.pendingResumes = [];
          session.pendingResumes.push({ text, filename: 'resume.txt', candidateName: 'Candidate' });
          await SessionStore.saveSession(session);

          const msg = [
            `📄 <b>Resume Text Received</b>`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `✅ Successfully saved candidate resume.`,
            ``,
            `👉 <b>Next Step:</b> Now paste or upload the <b>Job Description</b> to match against!`,
          ].join('\n');
          return ctx.reply(msg, { parse_mode: 'HTML' });
        }
      } else {
        // Text is a JD
        const statusMsg = await ctx.reply('🧠 <i>Reading and analyzing Job Description...</i>', { parse_mode: 'HTML' });
        const profile = await geminiService.analyzeJobDescription(text);
        await SessionStore.setJDProfile(sessionId, profile);

        if (session.pendingResumes && session.pendingResumes.length > 0) {
          await ctx.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            `✅ <b>Job Description Analyzed: ${escapeHtml(profile.jobTitle)}</b>\n🔍 <i>Matching your previously submitted resume...</i>`,
            { parse_mode: 'HTML' }
          );
          for (const pending of session.pendingResumes) {
            const review = await geminiService.analyzeCandidateResume(profile, pending.text, pending.candidateName, pending.filename);
            await SessionStore.addCandidateReview(sessionId, review);
            await sendReviewMessage(ctx, review, session);
          }
          session.pendingResumes = [];
          await SessionStore.saveSession(session);
          return;
        } else {
          const msg = [
            `📋 <b>Job Description Analyzed</b>`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `🎯 <b>Role:</b> <b>${escapeHtml(profile.jobTitle)}</b>`,
            `🛠️ <b>Primary Stack:</b> ${escapeHtml(profile.primaryTechnologies.join(', '))}`,
            ``,
            `👉 <b>Next Step:</b> Now send or paste your <b>Candidate Resume</b>!`,
          ].join('\n');

          await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, msg, { parse_mode: 'HTML' });
          return;
        }
      }
    }

    // Default guidance for short or ambiguous input
    if (!session.jdProfile) {
      await ctx.reply(
        `👋 <b>Ready for Review</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPlease send a <b>Job Description</b> or a <b>Resume</b> (file attachment or paste text).`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(
        `🎯 Active Role: <b>${escapeHtml(session.jdProfile.jobTitle)}</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\nPlease upload or paste a <b>Candidate Resume</b> to get an instant review!`,
        { parse_mode: 'HTML' }
      );
    }
  });

  // Action callback: Detailed Bullet Rewrites
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
      `📝 <b>Suggested Bullet Rewrites:</b>`,
      ``,
      ...rewrites.slice(0, 2).map((r, i) => [
        `<b>${i + 1}. Before:</b> <i>"${escapeHtml(r.before)}"</i>`,
        `👉 <b>Rewrite:</b> <i>"${escapeHtml(r.after)}"</i>`,
        `💡 <i>${escapeHtml(r.guidance)}</i>`,
        ``,
      ].join('\n')),
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  // Action callback: Complete Learning Roadmap
  bot.action('action_learning', async (ctx) => {
    await ctx.answerCbQuery();
    const sessionId = getSessionId(ctx.chat!.id);
    const session = await SessionStore.getSession(sessionId);
    const candidates = Object.values(session.candidates);
    if (candidates.length === 0) return ctx.reply('No candidate analyzed yet.');

    const c = candidates[candidates.length - 1];
    const learning = c.learningPlan;
    if (learning.length === 0) return ctx.reply('No urgent learning gaps found for this role!');

    const msg = [
      `📚 <b>Top Skills to Learn Next:</b>`,
      ``,
      ...learning.slice(0, 3).map((l, i) => {
        const badge = l.priority === 'CRITICAL' ? '🔴 [Critical]' : l.priority === 'HIGH' ? '🟠 [High]' : '🟡 [Medium]';
        return `• <b>${escapeHtml(l.topic)}</b> ${badge}\n  <i>${escapeHtml(l.reason)}</i>\n`;
      }),
    ].join('\n');

    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  // Action callback: Compare Candidates Bar Chart
  bot.action('action_compare', async (ctx) => {
    await ctx.answerCbQuery();
    const sessionId = getSessionId(ctx.chat!.id);
    const session = await SessionStore.getSession(sessionId);
    const candidates = Object.values(session.candidates);
    if (candidates.length < 2) {
      return ctx.reply(
        `⚠️ Need at least 2 candidates to compare.\nCurrently analyzed: <b>${candidates.length}</b>.\n\nPlease upload another resume file (PDF or DOCX)!`,
        { parse_mode: 'HTML' }
      );
    }

    const rankings = RankingService.rankCandidates(session.jdProfile!, candidates);
    const barChartBuffer = ChartRenderer.generateComparisonBarChartPNG(rankings, session.jdProfile!.jobTitle);
    const lines = rankings.map((c, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
      return `${medal} <b>${escapeHtml(c.candidateName)}:</b> <b>${c.score}%</b> — <i>${escapeHtml(c.verdict)}</i>`;
    });

    await ctx.replyWithPhoto(
      { source: barChartBuffer },
      {
        caption: `🏆 <b>Candidate Leaderboard: ${escapeHtml(session.jdProfile!.jobTitle)}</b>`,
        parse_mode: 'HTML',
      }
    );

    const compareText = [
      `🏆 <b>CANDIDATE RANKING SUMMARY</b>`,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `💼 <b>Target Role:</b> ${escapeHtml(session.jdProfile!.jobTitle)}`,
      ``,
      ...lines,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `💡 <b>Why #1 Ranks First:</b>`,
      `<i>${escapeHtml(rankings[0].summaryReason)}</i>`,
    ].join('\n');

    await ctx.reply(compareText, { parse_mode: 'HTML' });
  });

  // Clean, Simple & Precise Review Formatter (Single Photo Message with Bar Graph)
  async function sendReviewMessage(ctx: any, review: ReviewObject, session: SessionData) {
    const score = review.roleFit.score;
    const jdTitle = session.jdProfile?.jobTitle || 'Target Role';
    const topStrength = review.recruitersEye.noticeFirst[0] || 'Core technical foundation demonstrated.';
    const topGap = review.whatToChangeBeforeApplying[0]
      ? `${review.whatToChangeBeforeApplying[0].title}: ${review.whatToChangeBeforeApplying[0].action}`
      : review.hasCriticalGap && review.criticalGapMessage
      ? review.criticalGapMessage
      : 'Missing quantifiable production metrics & test coverage.';
    const topRewrite = review.suggestedWording[0];

    const cleanCaption = [
      `🎯 <b>ATS Match: ${score}/100</b> · <b>${escapeHtml(review.roleFit.verdict)}</b>`,
      `👤 <b>Candidate:</b> <code>${escapeHtml(review.candidateName)}</code>`,
      `💼 <b>Target Role:</b> <b>${escapeHtml(jdTitle)}</b>`,
      ``,
      `🟢 <b>Top Strength:</b>`,
      `• ${escapeHtml(topStrength)}`,
      ``,
      `🔴 <b>Key Gap to Fix:</b>`,
      `• ${escapeHtml(topGap)}`,
      ...(topRewrite
        ? [
            ``,
            `✍️ <b>Suggested Rewrite:</b>`,
            `<i>"${escapeHtml(topRewrite.after)}"</i>`,
          ]
        : []),
    ].join('\n');

    const inlineKeyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📝 Rewrites', 'action_rewrites'),
        Markup.button.callback('🎓 Learn Skill', 'action_learning'),
        Markup.button.callback('🏆 Compare', 'action_compare'),
      ],
    ]);

    try {
      const chartBuffer = ChartRenderer.generateScoreBarChartPNG(review, jdTitle);
      await ctx.replyWithPhoto(
        { source: chartBuffer },
        {
          caption: cleanCaption,
          parse_mode: 'HTML',
          ...inlineKeyboard,
        }
      );
    } catch (err: any) {
      console.warn(`Chart photo send warning: ${err.message}`);
      await ctx.reply(cleanCaption, {
        parse_mode: 'HTML',
        ...inlineKeyboard,
      });
    }
  }

  // Launch bot
  bot.launch().then(() => {
    console.log('🤖 Telegram bot is running in long-polling mode.');
  }).catch((err) => {
    console.warn(`⚠️ Telegram bot launch error: ${err.message}`);
  });

  return bot;
}
