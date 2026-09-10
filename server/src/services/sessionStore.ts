import mongoose, { Schema, Document } from 'mongoose';
import { SessionData, StructuredJDProfile, ReviewObject, CandidateRankingItem } from '../types/index.js';

interface ISessionDoc extends Document {
  sessionId: string;
  jdProfile?: StructuredJDProfile;
  pendingResumes?: { text: string; filename: string; candidateName: string }[];
  candidates: Record<string, ReviewObject>;
  rankings?: CandidateRankingItem[];
  messages: { role: 'user' | 'assistant'; content: string; timestamp: string }[];
  updatedAt: Date;
}

const SessionSchema = new Schema<ISessionDoc>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    jdProfile: { type: Schema.Types.Mixed, default: null },
    pendingResumes: { type: [Schema.Types.Mixed], default: [] },
    candidates: { type: Schema.Types.Mixed, default: {} },
    rankings: { type: [Schema.Types.Mixed], default: [] },
    messages: [
      {
        role: { type: String, enum: ['user', 'assistant'] },
        content: { type: String },
        timestamp: { type: String },
      },
    ],
  },
  { timestamps: true }
);

let MongoSessionModel: mongoose.Model<ISessionDoc> | null = null;
let isMongoConnected = false;

export async function initMongo(uri?: string): Promise<boolean> {
  if (!uri) {
    console.log('ℹ️ No MONGODB_URI provided. Running with in-memory session store.');
    return false;
  }
  try {
    await mongoose.connect(uri);
    MongoSessionModel = mongoose.model<ISessionDoc>('Session', SessionSchema);
    isMongoConnected = true;
    console.log('✅ Connected to MongoDB successfully.');
    return true;
  } catch (err: any) {
    console.warn(`⚠️ Failed to connect to MongoDB: ${err.message}. Falling back to in-memory store.`);
    isMongoConnected = false;
    return false;
  }
}

// In-memory cache fallback
const memorySessions = new Map<string, SessionData>();

export class SessionStore {
  static async getSession(sessionId: string): Promise<SessionData> {
    if (isMongoConnected && MongoSessionModel) {
      const doc = await MongoSessionModel.findOne({ sessionId }).lean();
      if (doc) {
        return {
          sessionId: doc.sessionId,
          jdProfile: doc.jdProfile,
          pendingResumes: doc.pendingResumes || [],
          candidates: doc.candidates || {},
          rankings: doc.rankings || [],
          messages: doc.messages || [],
          createdAt: (doc as any).createdAt?.toISOString() || new Date().toISOString(),
          updatedAt: (doc as any).updatedAt?.toISOString() || new Date().toISOString(),
        };
      }
    }

    let session = memorySessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        pendingResumes: [],
        candidates: {},
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memorySessions.set(sessionId, session);
    }
    if (!session.pendingResumes) {
      session.pendingResumes = [];
    }
    return session;
  }

  static async saveSession(session: SessionData): Promise<void> {
    session.updatedAt = new Date().toISOString();
    memorySessions.set(session.sessionId, session);

    if (isMongoConnected && MongoSessionModel) {
      try {
        await MongoSessionModel.findOneAndUpdate(
          { sessionId: session.sessionId },
          {
            sessionId: session.sessionId,
            jdProfile: session.jdProfile,
            pendingResumes: session.pendingResumes || [],
            candidates: session.candidates,
            rankings: session.rankings,
            messages: session.messages,
          },
          { upsert: true, new: true }
        );
      } catch (err: any) {
        console.warn(`⚠️ Failed to persist session to MongoDB: ${err.message}`);
      }
    }
  }

  static async setJDProfile(sessionId: string, profile: StructuredJDProfile): Promise<SessionData> {
    const session = await this.getSession(sessionId);
    session.jdProfile = profile;
    session.candidates = {};
    session.rankings = [];
    // Note: Do NOT clear pendingResumes here because the caller will process them against the new JD profile!
    await this.saveSession(session);
    return session;
  }

  static async addCandidateReview(
    sessionId: string,
    review: ReviewObject
  ): Promise<SessionData> {
    const session = await this.getSession(sessionId);
    session.candidates[review.candidateId] = review;
    await this.saveSession(session);
    return session;
  }

  static async addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<SessionData> {
    const session = await this.getSession(sessionId);
    session.messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    await this.saveSession(session);
    return session;
  }
}
