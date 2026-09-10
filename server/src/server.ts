import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { GeminiService } from './services/geminiService.js';
import { DocumentParser } from './parsers/documentParser.js';
import { RankingService } from './services/rankingService.js';
import { SessionStore, initMongo } from './services/sessionStore.js';
import { setupTelegramBot } from './telegram/telegramBot.js';
import { ReviewObject } from './types/index.js';
import { ClassifierService } from './services/classifierService.js';
import { setupDiscordBot } from './discord/discordBot.js';

import path from 'path';
import fs from 'fs';

const envPath = fs.existsSync(path.resolve(process.cwd(), '.env'))
  ? path.resolve(process.cwd(), '.env')
  : path.resolve(process.cwd(), 'server/.env');
dotenv.config({ path: envPath });

console.log(`📡 Environment loaded from: ${envPath}`);
console.log(`🤖 Telegram bot token configured: ${!!process.env.TELEGRAM_BOT_TOKEN}`);

const app = express();
const PORT: number = parseInt(process.env.PORT || '3001', 10);

// Middlewares
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Multer in-memory upload handler
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['pdf', 'docx', 'doc', 'txt'];
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext && allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: .${ext}. Only PDF, DOCX, and TXT files are supported.`));
    }
  },
});

// Initialize Services
const geminiService = new GeminiService(process.env.GEMINI_API_KEY);

// Health check endpoint (mandatory per spec)
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// Smart Universal Input Handler: Handles JD first, Resume first, or any random order!
app.post('/api/process-input', upload.single('file'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = (req.body.sessionId as string) || `sess-${Date.now()}`;
    let text = (req.body.text as string) || '';
    const filename = req.file?.originalname;

    if (req.file) {
      text = await DocumentParser.extractText(req.file.buffer, req.file.mimetype, req.file.originalname);
    }

    if (!text || text.trim().length < 20) {
      res.status(400).json({ success: false, error: 'Document or text is empty or too short.' });
      return;
    }

    const session = await SessionStore.getSession(sessionId);
    const candidateList = Object.values(session.candidates);

    // If text message with no file, and candidates exist, check if it's a follow-up question
    if (!req.file && candidateList.length > 0 && ClassifierService.isChatMessage(text)) {
      const targetCandidate = candidateList[candidateList.length - 1];
      await SessionStore.addMessage(sessionId, 'user', text);
      const reply = await geminiService.answerFollowUp(
        session.jdProfile!,
        targetCandidate,
        text,
        session.messages.map((m) => ({ role: m.role, content: m.content }))
      );
      await SessionStore.addMessage(sessionId, 'assistant', reply);
      res.json({
        success: true,
        type: 'CHAT_REPLY',
        reply,
        candidateName: targetCandidate.candidateName,
      });
      return;
    }

    const classification = ClassifierService.classify(text, filename, {
      hasActiveJD: !!session.jdProfile,
      hasPendingResumes: (session.pendingResumes?.length || 0) > 0,
    });

    if (classification === 'RESUME') {
      const candidateName = (filename || 'Candidate').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

      if (session.jdProfile) {
        // JD already exists! Evaluate immediately
        const review = await geminiService.analyzeCandidateResume(session.jdProfile, text, candidateName, filename);
        await SessionStore.addCandidateReview(sessionId, review);
        res.json({
          success: true,
          type: 'REVIEW_COMPLETE',
          classification: 'RESUME',
          review,
          message: `Analyzed ${candidateName} against ${session.jdProfile.jobTitle}`,
        });
      } else {
        // No JD yet! Save resume into pendingResumes
        if (!session.pendingResumes) session.pendingResumes = [];
        session.pendingResumes.push({ text, filename: filename || 'resume.txt', candidateName });
        await SessionStore.saveSession(session);
        res.json({
          success: true,
          type: 'RESUME_SAVED_PENDING_JD',
          classification: 'RESUME',
          candidateName,
          message: `📄 Resume received for ${candidateName}. Now please send or paste the Job Description to match against!`,
        });
      }
    } else {
      // Classification is 'JD'
      const profile = await geminiService.analyzeJobDescription(text);
      await SessionStore.setJDProfile(sessionId, profile);

      // Check if there are pending resumes!
      if (session.pendingResumes && session.pendingResumes.length > 0) {
        const reviews = [];
        for (const pending of session.pendingResumes) {
          const review = await geminiService.analyzeCandidateResume(profile, pending.text, pending.candidateName, pending.filename);
          await SessionStore.addCandidateReview(sessionId, review);
          reviews.push(review);
        }
        session.pendingResumes = [];
        await SessionStore.saveSession(session);

        res.json({
          success: true,
          type: 'JD_AND_PENDING_REVIEWS',
          classification: 'JD',
          profile,
          reviews,
          message: `✅ Job Description received for ${profile.jobTitle}. Evaluated your previously submitted resume!`,
        });
      } else {
        res.json({
          success: true,
          type: 'JD_SAVED_PENDING_RESUME',
          classification: 'JD',
          profile,
          message: `✅ Job Description received for ${profile.jobTitle}. Now send your candidate resume!`,
        });
      }
    }
  } catch (err: any) {
    next(err);
  }
});

// 1. Process Job Description (Text or File)
app.post('/api/jd', upload.single('file'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = (req.body.sessionId as string) || `sess-${Date.now()}`;
    let jdText = (req.body.text as string) || '';

    if (req.file) {
      jdText = await DocumentParser.extractText(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
    }

    if (!jdText || jdText.trim().length < 40) {
      res.status(400).json({
        success: false,
        error: 'Job Description is too short or empty. Please provide at least 40 characters.',
      });
      return;
    }

    // Generate frozen structured JD profile
    const profile = await geminiService.analyzeJobDescription(jdText);
    const session = await SessionStore.setJDProfile(sessionId, profile);

    res.json({
      success: true,
      sessionId: session.sessionId,
      profile,
    });
  } catch (err: any) {
    next(err);
  }
});

// 2. Analyze Single Candidate Resume
app.post('/api/analyze-resume', upload.single('file'), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = req.body.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'sessionId is required.' });
      return;
    }

    const session = await SessionStore.getSession(sessionId);
    if (!session.jdProfile) {
      res.status(400).json({
        success: false,
        error: 'No Job Description found for this session. Please submit a JD first.',
      });
      return;
    }

    let resumeText = (req.body.resumeText as string) || '';
    let filename = req.file?.originalname || 'resume.txt';
    let candidateName = (req.body.candidateName as string) || filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    if (req.file) {
      resumeText = await DocumentParser.extractText(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname
      );
    }

    if (!resumeText || resumeText.trim().length < 30) {
      res.status(400).json({
        success: false,
        error: 'Resume text is empty or unreadable.',
      });
      return;
    }

    const review = await geminiService.analyzeCandidateResume(
      session.jdProfile,
      resumeText,
      candidateName,
      filename
    );

    await SessionStore.addCandidateReview(sessionId, review);

    res.json({
      success: true,
      sessionId,
      review,
    });
  } catch (err: any) {
    next(err);
  }
});

// 3. Analyze Multiple Candidate Resumes
app.post('/api/analyze-multiple', upload.array('files', 10), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = req.body.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'sessionId is required.' });
      return;
    }

    const session = await SessionStore.getSession(sessionId);
    if (!session.jdProfile) {
      res.status(400).json({
        success: false,
        error: 'No Job Description found for this session. Please submit a JD first.',
      });
      return;
    }

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ success: false, error: 'No files were uploaded.' });
      return;
    }

    const reviews: ReviewObject[] = [];
    const errors: { filename: string; error: string }[] = [];

    // Process with controlled concurrency to prevent API or memory spikes
    for (const file of files) {
      try {
        const text = await DocumentParser.extractText(file.buffer, file.mimetype, file.originalname);
        const name = file.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        const review = await geminiService.analyzeCandidateResume(
          session.jdProfile,
          text,
          name,
          file.originalname
        );
        await SessionStore.addCandidateReview(sessionId, review);
        reviews.push(review);
      } catch (err: any) {
        errors.push({
          filename: file.originalname,
          error: err.message || 'Processing failed',
        });
      }
    }

    // Update rankings
    const allCandidates = Object.values((await SessionStore.getSession(sessionId)).candidates);
    const rankings = RankingService.rankCandidates(session.jdProfile, allCandidates);

    res.json({
      success: true,
      sessionId,
      totalUploaded: files.length,
      successful: reviews.length,
      failed: errors.length,
      reviews,
      rankings,
      summary: RankingService.formatComparativeSummary(rankings),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    next(err);
  }
});

// 4. Candidate Ranking Endpoint
app.post('/api/rank', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessionId = req.body.sessionId as string;
    if (!sessionId) {
      res.status(400).json({ success: false, error: 'sessionId is required.' });
      return;
    }

    const session = await SessionStore.getSession(sessionId);
    if (!session.jdProfile) {
      res.status(400).json({ success: false, error: 'No Job Description found in session.' });
      return;
    }

    const candidates = Object.values(session.candidates);
    if (candidates.length === 0) {
      res.status(400).json({ success: false, error: 'No candidate resumes analyzed yet.' });
      return;
    }

    const rankings = RankingService.rankCandidates(session.jdProfile, candidates);
    const summary = RankingService.formatComparativeSummary(rankings);

    res.json({
      success: true,
      rankings,
      summary,
    });
  } catch (err: any) {
    next(err);
  }
});

// 5. Contextual Conversational Follow-up Q&A
app.post('/api/chat', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { sessionId, message, candidateId } = req.body;
    if (!sessionId || !message) {
      res.status(400).json({ success: false, error: 'sessionId and message are required.' });
      return;
    }

    const session = await SessionStore.getSession(sessionId);
    if (!session.jdProfile) {
      res.status(400).json({ success: false, error: 'No Job Description found in session.' });
      return;
    }

    const candidates = Object.values(session.candidates);
    let targetCandidate = candidates.find((c) => c.candidateId === candidateId);
    if (!targetCandidate && candidates.length > 0) {
      targetCandidate = candidates[candidates.length - 1];
    }

    if (!targetCandidate) {
      res.status(400).json({ success: false, error: 'Please analyze a resume before asking questions.' });
      return;
    }

    await SessionStore.addMessage(sessionId, 'user', message);

    const reply = await geminiService.answerFollowUp(
      session.jdProfile,
      targetCandidate,
      message,
      session.messages.map((m) => ({ role: m.role, content: m.content }))
    );

    await SessionStore.addMessage(sessionId, 'assistant', reply);

    res.json({
      success: true,
      reply,
      candidateName: targetCandidate.candidateName,
    });
  } catch (err: any) {
    next(err);
  }
});

// 6. WhatsApp Cloud API Webhook Verification (Meta for Developers)
app.get('/webhook/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'rolefit_whatsapp_token';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ WhatsApp Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Verification failed');
  }
});

// 7. WhatsApp Cloud API Message Receiver
app.post('/webhook/whatsapp', async (req: Request, res: Response): Promise<void> => {
  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (message) {
      const from = message.from; // User's WhatsApp phone number
      const sessionId = `wa-${from}`;
      const text = message.text?.body?.trim() || '';

      console.log(`📱 Incoming WhatsApp message from ${from}: "${text}"`);
      // Acknowledge Meta immediately
      res.status(200).json({ status: 'received' });

      // Processing in background
      const session = await SessionStore.getSession(sessionId);
      if (!session.jdProfile && text.length >= 60) {
        const profile = await geminiService.analyzeJobDescription(text);
        await SessionStore.setJDProfile(sessionId, profile);
      }
    } else {
      res.status(200).json({ status: 'ignored' });
    }
  } catch (err: any) {
    console.warn(`⚠️ WhatsApp webhook error: ${err.message}`);
    res.status(200).json({ status: 'error' });
  }
});

// 8. Twilio WhatsApp Webhook Receiver
app.post('/webhook/twilio-whatsapp', async (req: Request, res: Response): Promise<void> => {
  try {
    const from = req.body.From || 'user';
    const body = (req.body.Body || '').trim();
    const sessionId = `tw-${from.replace(/[^0-9]/g, '')}`;

    const session = await SessionStore.getSession(sessionId);
    let reply = '';

    if (body.length >= 60) {
      const classification = ClassifierService.classify(body, undefined, {
        hasActiveJD: !!session.jdProfile,
        hasPendingResumes: (session.pendingResumes?.length || 0) > 0,
      });

      if (classification === 'RESUME') {
        if (session.jdProfile) {
          const review = await geminiService.analyzeCandidateResume(session.jdProfile, body, 'Candidate');
          await SessionStore.addCandidateReview(sessionId, review);
          reply = `🎯 *Role Fit: ${review.roleFit.score}% · ${review.roleFit.verdict}*\n\n` +
            `🟢 *Strengths:* ${review.recruitersEye.noticeFirst.slice(0, 2).join(' · ')}\n` +
            `🔴 *Key Gap:* ${review.whatToChangeBeforeApplying[0]?.title || 'Missing unstated testing metrics'}\n` +
            `🎓 *Next to Learn:* ${review.learningPlan[0]?.topic || 'None'}`;
        } else {
          if (!session.pendingResumes) session.pendingResumes = [];
          session.pendingResumes.push({ text: body, filename: 'resume.txt', candidateName: 'Candidate' });
          await SessionStore.saveSession(session);
          reply = `📄 *Resume received!*\n\n👉 Now please send the *Job Description* (paste text or send document) to match against.`;
        }
      } else {
        // Classification is JD
        const profile = await geminiService.analyzeJobDescription(body);
        await SessionStore.setJDProfile(sessionId, profile);

        if (session.pendingResumes && session.pendingResumes.length > 0) {
          const reviewReplies: string[] = [];
          for (const pending of session.pendingResumes) {
            const review = await geminiService.analyzeCandidateResume(profile, pending.text, pending.candidateName, pending.filename);
            await SessionStore.addCandidateReview(sessionId, review);
            reviewReplies.push(
              `🎯 *${pending.candidateName}: ${review.roleFit.score}% · ${review.roleFit.verdict}*\n` +
              `🟢 *Strengths:* ${review.recruitersEye.noticeFirst.slice(0, 2).join(' · ')}\n` +
              `🔴 *Key Gap:* ${review.whatToChangeBeforeApplying[0]?.title || 'Missing unstated testing metrics'}\n` +
              `🎓 *Next to Learn:* ${review.learningPlan[0]?.topic || 'None'}`
            );
          }
          session.pendingResumes = [];
          await SessionStore.saveSession(session);
          reply = `✅ *Job Description received for ${profile.jobTitle}!*\n\n` + reviewReplies.join('\n\n');
        } else {
          reply = `✅ Job Description received for *${profile.jobTitle}* (Primary: ${profile.primaryTechnologies.join(', ')}).\n\nNow send your candidate resume!`;
        }
      }
    } else {
      const candidates = Object.values(session.candidates);
      if (session.jdProfile && candidates.length > 0) {
        const latestCandidate = candidates[candidates.length - 1];
        reply = await geminiService.answerFollowUp(
          session.jdProfile,
          latestCandidate,
          body,
          session.messages.map((m) => ({ role: m.role, content: m.content }))
        );
      } else {
        reply = `👋 Welcome to RoleFit AI on WhatsApp! Send me either a Job Description or a Resume to begin reviewing.`;
      }
    }

    res.type('text/xml').send(`<Response><Message>${reply}</Message></Response>`);
  } catch (err: any) {
    res.type('text/xml').send(`<Response><Message>Error processing request: ${err.message}</Message></Response>`);
  }
});

// 9. Slack Slash Command Receiver (/rolefit [text or file])
app.post('/webhook/slack/command', async (req: Request, res: Response): Promise<void> => {
  try {
    const text = (req.body.text || '').trim();
    const userId = req.body.user_id || 'slack-user';
    const sessionId = `slack-${userId}`;

    if (!text) {
      res.json({
        response_type: 'ephemeral',
        text: '👋 *RoleFit AI on Slack*\nUsage: `/rolefit [Job Description text or Candidate Resume text]`\nWorks in any order!',
      });
      return;
    }

    const session = await SessionStore.getSession(sessionId);
    const classification = ClassifierService.classify(text, undefined, {
      hasActiveJD: !!session.jdProfile,
      hasPendingResumes: (session.pendingResumes?.length || 0) > 0,
    });

    if (classification === 'RESUME') {
      if (session.jdProfile) {
        const review = await geminiService.analyzeCandidateResume(session.jdProfile, text, 'Candidate');
        await SessionStore.addCandidateReview(sessionId, review);
        res.json({
          response_type: 'in_channel',
          text: `🎯 *RoleFit Review for ${session.jdProfile.jobTitle}*\n*Score:* ${review.roleFit.score}% — ${review.roleFit.verdict}\n• *Strengths:* ${review.recruitersEye.noticeFirst.slice(0, 2).join(' · ')}\n• *Key Gap:* ${review.whatToChangeBeforeApplying[0]?.title || 'None'}\n• *Next to Learn:* ${review.learningPlan[0]?.topic || 'None'}`,
        });
      } else {
        if (!session.pendingResumes) session.pendingResumes = [];
        session.pendingResumes.push({ text, filename: 'resume.txt', candidateName: 'Candidate' });
        await SessionStore.saveSession(session);
        res.json({
          response_type: 'ephemeral',
          text: '📄 *Resume received!* Now run `/rolefit [paste Job Description]` to evaluate.',
        });
      }
    } else {
      const profile = await geminiService.analyzeJobDescription(text);
      await SessionStore.setJDProfile(sessionId, profile);

      if (session.pendingResumes && session.pendingResumes.length > 0) {
        const reviewTexts: string[] = [];
        for (const pending of session.pendingResumes) {
          const review = await geminiService.analyzeCandidateResume(profile, pending.text, pending.candidateName, pending.filename);
          await SessionStore.addCandidateReview(sessionId, review);
          reviewTexts.push(`🎯 *${pending.candidateName}:* ${review.roleFit.score}% — ${review.roleFit.verdict}`);
        }
        session.pendingResumes = [];
        await SessionStore.saveSession(session);
        res.json({
          response_type: 'in_channel',
          text: `✅ *Job Description Received:* ${profile.jobTitle}\nEvaluated against your previously submitted resume:\n` + reviewTexts.join('\n'),
        });
      } else {
        res.json({
          response_type: 'ephemeral',
          text: `✅ *Job Description Received for ${profile.jobTitle}*\nNow run /rolefit [paste Resume] to review candidates!`,
        });
      }
    }
  } catch (err: any) {
    res.json({ response_type: 'ephemeral', text: `⚠️ Error: ${err.message}` });
  }
});

// 10. Slack URL verification challenge for Events API
app.post('/webhook/slack/events', (req: Request, res: Response) => {
  if (req.body.challenge) {
    return res.json({ challenge: req.body.challenge });
  }
  res.json({ ok: true });
});

// 11. Facebook Messenger Webhook Verification (Meta for Developers)
app.get('/webhook/facebook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = process.env.FACEBOOK_VERIFY_TOKEN || 'rolefit_facebook_token';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ Facebook Messenger Webhook verified successfully.');
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Verification failed');
  }
});

// 12. Facebook Messenger Message Receiver
app.post('/webhook/facebook', async (req: Request, res: Response): Promise<void> => {
  try {
    const entry = req.body.entry?.[0];
    const messaging = entry?.messaging?.[0];
    const senderId = messaging?.sender?.id;
    const text = (messaging?.message?.text || '').trim();

    if (senderId && text) {
      const sessionId = `fb-${senderId}`;
      const session = await SessionStore.getSession(sessionId);

      if (text.length >= 50) {
        const classification = ClassifierService.classify(text, undefined, {
          hasActiveJD: !!session.jdProfile,
          hasPendingResumes: (session.pendingResumes?.length || 0) > 0,
        });

        if (classification === 'RESUME') {
          if (session.jdProfile) {
            const review = await geminiService.analyzeCandidateResume(session.jdProfile, text, 'Candidate');
            await SessionStore.addCandidateReview(sessionId, review);
          } else {
            if (!session.pendingResumes) session.pendingResumes = [];
            session.pendingResumes.push({ text, filename: 'resume.txt', candidateName: 'Candidate' });
            await SessionStore.saveSession(session);
          }
        } else {
          const profile = await geminiService.analyzeJobDescription(text);
          await SessionStore.setJDProfile(sessionId, profile);
          if (session.pendingResumes && session.pendingResumes.length > 0) {
            for (const pending of session.pendingResumes) {
              const review = await geminiService.analyzeCandidateResume(profile, pending.text, pending.candidateName, pending.filename);
              await SessionStore.addCandidateReview(sessionId, review);
            }
            session.pendingResumes = [];
            await SessionStore.saveSession(session);
          }
        }
      }
    }
    res.status(200).json({ status: 'EVENT_RECEIVED' });
  } catch (err: any) {
    res.status(200).json({ status: 'error', error: err.message });
  }
});

// 6. Get Current Session State
app.get('/api/session/:id', async (req: Request, res: Response): Promise<void> => {
  const paramId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const session = await SessionStore.getSession(paramId);
  res.json({ success: true, session });
});

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
  });
});

// Serve Frontend in Production (Render.com All-In-One Deployment)

const distPath = fs.existsSync(path.resolve(process.cwd(), 'dist'))
  ? path.resolve(process.cwd(), 'dist')
  : path.resolve(process.cwd(), '../dist');

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/webhook') || req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Startup sequence
async function start() {
  await initMongo(process.env.MONGODB_URI);
  setupTelegramBot(process.env.TELEGRAM_BOT_TOKEN, geminiService);
  setupDiscordBot(process.env.DISCORD_BOT_TOKEN, geminiService);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 RoleFit Server running at http://0.0.0.0:${PORT} (accessible via localhost and LAN IP)`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
  });
}

start();
