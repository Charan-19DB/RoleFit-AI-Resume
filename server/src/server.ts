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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

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

// Startup sequence
async function start() {
  await initMongo(process.env.MONGODB_URI);
  setupTelegramBot(process.env.TELEGRAM_BOT_TOKEN, geminiService);

  app.listen(PORT, () => {
    console.log(`🚀 RoleFit Server running at http://localhost:${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
  });
}

start();
