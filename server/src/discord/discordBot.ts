import {
  Client,
  GatewayIntentBits,
  Partials,
  AttachmentBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
} from 'discord.js';
import { GeminiService } from '../services/geminiService.js';
import { DocumentParser } from '../parsers/documentParser.js';
import { SessionStore } from '../services/sessionStore.js';
import { ChartRenderer } from '../services/chartRenderer.js';
import { ClassifierService } from '../services/classifierService.js';
import { RankingService } from '../services/rankingService.js';

export function setupDiscordBot(
  token: string | undefined,
  geminiService: GeminiService
): Client | null {
  if (!token || token.trim().length === 0) {
    console.log('ℹ️ No DISCORD_BOT_TOKEN provided. Discord bot runner is inactive.');
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once(Events.ClientReady, () => {
    console.log(`🤖 Discord bot logged in as ${client.user?.tag}!`);
  });

  client.on('messageCreate', async (message) => {
    // Ignore bot's own messages
    if (message.author.bot) return;

    const sessionId = `dc-${message.author.id}`;
    const text = message.content.trim();
    const attachment = message.attachments.first();

    try {
      let documentText = '';
      let filename = '';

      if (attachment) {
        filename = attachment.name;
        const res = await fetch(attachment.url);
        const arrayBuffer = await res.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mime = attachment.contentType || 'application/octet-stream';
        documentText = await DocumentParser.extractText(buffer, mime, filename);
      } else if (text) {
        documentText = text;
      }

      if (!documentText || documentText.trim().length < 20) {
        return;
      }

      const session = await SessionStore.getSession(sessionId);
      const candidateList = Object.values(session.candidates);

      // Conversational follow-up question
      if (!attachment && candidateList.length > 0 && ClassifierService.isChatMessage(text)) {
        const targetCandidate = candidateList[candidateList.length - 1];
        await message.channel.sendTyping();
        const reply = await geminiService.answerFollowUp(
          session.jdProfile!,
          targetCandidate,
          text,
          session.messages.map((m) => ({ role: m.role, content: m.content }))
        );
        await message.reply(reply);
        return;
      }

      const classification = ClassifierService.classify(documentText, filename, {
        hasActiveJD: !!session.jdProfile,
        hasPendingResumes: (session.pendingResumes?.length || 0) > 0,
      });

      if (classification === 'RESUME') {
        const candidateName = (filename || 'Candidate').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

        if (session.jdProfile) {
          await message.channel.sendTyping();
          const review = await geminiService.analyzeCandidateResume(session.jdProfile, documentText, candidateName, filename);
          await SessionStore.addCandidateReview(sessionId, review);
          await sendDiscordReview(message, review, session.jdProfile.jobTitle);
        } else {
          if (!session.pendingResumes) session.pendingResumes = [];
          session.pendingResumes.push({ text: documentText, filename: filename || 'resume.txt', candidateName });
          await SessionStore.saveSession(session);

          const embed = new EmbedBuilder()
            .setTitle(`📄 Resume Received for ${candidateName}`)
            .setDescription(`Saved! Now send or paste the **Job Description** to match this resume against.`)
            .setColor(0x00a884);
          await message.reply({ embeds: [embed] });
        }
      } else {
        // Classification is JD
        await message.channel.sendTyping();
        const profile = await geminiService.analyzeJobDescription(documentText);
        await SessionStore.setJDProfile(sessionId, profile);

        if (session.pendingResumes && session.pendingResumes.length > 0) {
          const embed = new EmbedBuilder()
            .setTitle(`✅ Job Description Received: ${profile.jobTitle}`)
            .setDescription(`Automatically evaluating your previously submitted resume...`)
            .setColor(0x00a884);
          await message.reply({ embeds: [embed] });

          for (const pending of session.pendingResumes) {
            const review = await geminiService.analyzeCandidateResume(profile, pending.text, pending.candidateName, pending.filename);
            await SessionStore.addCandidateReview(sessionId, review);
            await sendDiscordReview(message, review, profile.jobTitle);
          }
          session.pendingResumes = [];
          await SessionStore.saveSession(session);
        } else {
          const embed = new EmbedBuilder()
            .setTitle(`✅ Role Analyzed: ${profile.jobTitle}`)
            .setDescription(`Primary Technologies: **${profile.primaryTechnologies.join(', ')}**\n\n👉 Now upload or paste your **Candidate Resume** (PDF, DOCX, or text) to get your match score!`)
            .setColor(0x00a884);
          await message.reply({ embeds: [embed] });
        }
      }
    } catch (err: any) {
      await message.reply(`⚠️ Error: ${err.message || 'Something went wrong.'}`);
    }
  });

  async function sendDiscordReview(message: any, review: any, jobTitle: string) {
    const score = review.roleFit.score;
    const color = score >= 75 ? 0x25d366 : score >= 50 ? 0xffbc00 : 0xff3b30;
    const metricsScore = review.subscores.metrics ?? Math.max(35, Math.round(score * 0.85));

    const strengths = review.recruitersEye.noticeFirst.slice(0, 2);
    const rawGaps = review.whatToChangeBeforeApplying.slice(0, 2);
    const gapsText = rawGaps.length > 0
      ? rawGaps.map((g: any) => `• **${g.title}:** ${g.action || g.reason}`).join('\n')
      : review.hasCriticalGap && review.criticalGapMessage
      ? `• **Critical Gap:** ${review.criticalGapMessage}`
      : '• **Metrics:** Add quantifiable production outcomes and scale.\n• **Testing:** Explicitly mention testing & CI/CD tools used.';

    const topRewrite = review.suggestedWording[0];

    const fields: any[] = [
      { name: '📊 Skills', value: `${review.subscores.skills}%`, inline: true },
      { name: '💼 Experience', value: `${review.subscores.experience}%`, inline: true },
      { name: '🔑 Keywords', value: `${review.subscores.keywords}%`, inline: true },
      { name: '📈 Metrics', value: `${metricsScore}%`, inline: true },
      { name: '📄 ATS Format', value: `${review.subscores.formatting}%`, inline: true },
      {
        name: '🟢 Strengths',
        value: strengths.length > 0 ? strengths.map((s: string) => `• ${s}`).join('\n') : '• Core technical foundation demonstrated.',
      },
      {
        name: '🔴 Points to Improve (Weak Points)',
        value: gapsText,
      },
    ];

    if (topRewrite) {
      fields.push({
        name: '✍️ Suggested Bullet Rewrite',
        value: `*Before:* "${topRewrite.before}"\n*After:* **"${topRewrite.after}"**`,
      });
    }

    if (review.learningPlan && review.learningPlan.length > 0) {
      fields.push({
        name: '🎓 Next to Learn',
        value: `**${review.learningPlan[0].topic}** (${review.learningPlan[0].priority} Priority) — ${review.learningPlan[0].reason}`,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`🎯 ${review.candidateName} — ${score}% · ${review.roleFit.verdict}`)
      .setDescription(`**Target Role:** ${jobTitle}\n\n${review.roleFit.summary}`)
      .addFields(fields)
      .setColor(color)
      .setImage('attachment://score-barchart.png');

    const chartBuffer = ChartRenderer.generateScoreBarChartPNG(review, jobTitle);
    const attachment = new AttachmentBuilder(chartBuffer, { name: 'score-barchart.png' });

    await message.reply({ embeds: [embed], files: [attachment] });
  }

  client.login(token).catch((err) => {
    console.warn(`⚠️ Discord bot login error: ${err.message}`);
  });

  return client;
}
