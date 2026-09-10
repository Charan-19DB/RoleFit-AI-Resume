import './style.css';

interface ReviewObject {
  candidateId: string;
  candidateName: string;
  filename?: string;
  roleFit: {
    score: number;
    verdict: string;
    summary: string;
  };
  subscores: {
    skills: number;
    experience: number;
    keywords: number;
    formatting: number;
  };
  recruitersEye: {
    noticeFirst: string[];
    question: string[];
    skipOver: string[];
  };
  evidenceMap: {
    requirementName: string;
    priority: string;
    status: string;
    evidenceSnippet: string;
  }[];
  whatToChangeBeforeApplying: {
    priority: string;
    title: string;
    reason: string;
    action: string;
    honestyNote: string;
  }[];
  suggestedWording: {
    section: string;
    before: string;
    after: string;
    guidance: string;
  }[];
  learningPlan: {
    topic: string;
    priority: string;
    jdRequirement: string;
    reason: string;
  }[];
  hasCriticalGap: boolean;
  criticalGapMessage?: string;
}

interface StructuredJDProfile {
  jobTitle: string;
  primaryRole: string;
  primaryTechnologies: string[];
  summary: string;
  requirements: { name: string; priority: string; weight: number }[];
}

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:3001/api'
  : `http://${window.location.hostname}:3001/api`;
let sessionId = localStorage.getItem('rolefit_mobile_sess') || `mob-${Date.now()}`;
localStorage.setItem('rolefit_mobile_sess', sessionId);

let activeJD: StructuredJDProfile | null = null;
let analyzedCandidates: ReviewObject[] = [];

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="app-shell">
    <div class="app-container">
      <!-- WhatsApp / Meta AI Mobile Header -->
      <header class="chat-header">
        <div class="header-left">
          <div class="meta-logo">
            <svg viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
            </svg>
          </div>
          <div class="header-info">
            <h1 id="header-title">RoleFit AI</h1>
            <p id="header-status">online</p>
          </div>
        </div>
        <div class="header-actions">
          <button class="btn-new-chat" id="btn-new-session">+ New Role</button>
        </div>
      </header>

      <!-- Chat Canvas (Scrollable Thread) -->
      <main class="chat-canvas" id="chat-canvas">
        <div class="date-pill">Today</div>

        <!-- Welcome Message -->
        <div class="msg-row incoming">
          <div class="bubble">
            <p>👋 <strong>RoleFit AI Career Reviewer</strong></p>
            <p style="margin-top: 4px; color: var(--wa-text-secondary); font-size: 12.5px;">
              Send a <strong>Job Description</strong> to start:
            </p>
            <p style="margin-top: 6px; font-size: 13px;">
              • 📝 Paste JD text<br>
              • 📎 Or attach a PDF/DOCX file
            </p>
            <div class="timestamp">${getCurrentTime()}</div>
          </div>
        </div>
      </main>

      <!-- Quick Suggestion Strip -->
      <div class="suggestion-strip" id="suggestion-strip">
        <button class="strip-chip" data-fill="We are hiring a Java Backend Developer with Spring Boot, SQL, and REST APIs. Python is preferred.">📝 Java Backend JD</button>
        <button class="strip-chip" data-fill="Why did I get this score?">❓ Why this score?</button>
        <button class="strip-chip" data-fill="Which bullet should I rewrite first?">✏️ Best rewrite</button>
        <button class="strip-chip" data-fill="What should I learn next?">🎓 What to learn</button>
      </div>

      <!-- Mobile Input Bar -->
      <footer class="chat-footer">
        <button class="icon-btn" id="btn-attach" title="Attach PDF/DOCX file">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
          </svg>
        </button>
        <input type="file" id="file-input" class="hidden" accept=".pdf,.docx,.doc,.txt" multiple />

        <div class="input-wrapper">
          <input
            type="text"
            class="chat-input"
            id="chat-input"
            placeholder="Type a message..."
            autocomplete="off"
          />
        </div>

        <button class="send-btn" id="btn-send" title="Send">
          <svg viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </footer>
    </div>
  </div>
`;

const canvas = document.querySelector<HTMLDivElement>('#chat-canvas')!;
const input = document.querySelector<HTMLInputElement>('#chat-input')!;
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
const btnAttach = document.querySelector<HTMLButtonElement>('#btn-attach')!;
const btnSend = document.querySelector<HTMLButtonElement>('#btn-send')!;
const btnNewSession = document.querySelector<HTMLButtonElement>('#btn-new-session')!;

function getCurrentTime(): string {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function scrollToBottom() {
  canvas.scrollTop = canvas.scrollHeight;
}

function showTypingIndicator(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'msg-row incoming typing-row';
  row.innerHTML = `
    <div class="typing-bubble">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  canvas.appendChild(row);
  scrollToBottom();
  return row;
}

function removeTypingIndicator(el: HTMLElement) {
  el.remove();
}

function appendUserMessage(text: string, filename?: string) {
  const row = document.createElement('div');
  row.className = 'msg-row outgoing';
  let fileCardHtml = '';
  if (filename) {
    const ext = filename.split('.').pop()?.toUpperCase() || 'DOC';
    fileCardHtml = `
      <div class="file-card">
        <div class="file-icon ${ext === 'DOCX' ? 'docx' : ''}">${ext}</div>
        <div class="file-meta">
          <strong>${filename}</strong>
          <small>Uploaded document</small>
        </div>
      </div>
    `;
  }

  row.innerHTML = `
    <div class="bubble">
      ${fileCardHtml}
      ${text ? `<p>${text}</p>` : ''}
      <div class="timestamp">${getCurrentTime()} <span class="checkmarks">✓✓</span></div>
    </div>
  `;
  canvas.appendChild(row);
  scrollToBottom();
}

function appendBotMessage(htmlContent: string) {
  const row = document.createElement('div');
  row.className = 'msg-row incoming';
  row.innerHTML = `
    <div class="bubble">
      ${htmlContent}
      <div class="timestamp">${getCurrentTime()}</div>
    </div>
  `;
  canvas.appendChild(row);
  scrollToBottom();
}

// 1. Process Job Description (Simple & Precise)
async function handleJobDescription(text?: string, file?: File) {
  const typing = showTypingIndicator();
  try {
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    if (text) formData.append('text', text);
    if (file) formData.append('file', file);

    const res = await fetch(`${API_BASE}/jd`, { method: 'POST', body: formData });
    removeTypingIndicator(typing);

    if (res.ok) {
      const data = await res.json();
      activeJD = data.profile;
      document.querySelector('#header-title')!.textContent = activeJD?.jobTitle.slice(0, 24) || 'RoleFit AI';

      const crit = activeJD?.requirements.filter((r) => r.priority === 'CRITICAL').length || 0;
      const high = activeJD?.requirements.filter((r) => r.priority === 'HIGH').length || 0;
      const low = activeJD?.requirements.filter((r) => r.priority === 'LOW').length || 0;

      appendBotMessage(`
        <p>✅ <strong>Role Analyzed:</strong> ${activeJD?.jobTitle}</p>
        <p style="font-size: 12.5px; color: var(--wa-accent); margin-top: 3px;">
          Primary Stack: <strong>${activeJD?.primaryTechnologies.join(', ')}</strong>
        </p>
        <div style="display: flex; gap: 6px; margin: 8px 0; font-size: 11px;">
          <span style="background: rgba(248, 113, 113, 0.2); color: #f87171; padding: 2px 6px; border-radius: 4px;">🔴 ${crit} Critical</span>
          <span style="background: rgba(251, 191, 36, 0.2); color: #fbbf24; padding: 2px 6px; border-radius: 4px;">🟠 ${high} High</span>
          <span style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 2px 6px; border-radius: 4px;">🟡 ${low} Preferred</span>
        </div>
        <p style="font-size: 12.5px; color: var(--wa-text-secondary);">
          👉 Attach or paste a <strong>Resume</strong> to get the match score.
        </p>
      `);
    } else {
      appendBotMessage(`⚠️ Could not analyze JD. Please check your backend connection.`);
    }
  } catch (err: any) {
    removeTypingIndicator(typing);
    appendBotMessage(`⚠️ Error: ${err.message}`);
  }
}

// 2. Process Resume (Simple & Precise Score Parameters)
async function handleResume(file?: File, text?: string) {
  const typing = showTypingIndicator();
  try {
    const formData = new FormData();
    formData.append('sessionId', sessionId);
    if (file) formData.append('file', file);
    if (text) formData.append('resumeText', text);

    const res = await fetch(`${API_BASE}/analyze-resume`, { method: 'POST', body: formData });
    removeTypingIndicator(typing);

    if (res.ok) {
      const data = await res.json();
      const review: ReviewObject = data.review;
      analyzedCandidates.push(review);
      renderPreciseScoreBubble(review);
    } else {
      appendBotMessage(`⚠️ Please submit a Job Description first.`);
    }
  } catch (err: any) {
    removeTypingIndicator(typing);
    appendBotMessage(`⚠️ Error analyzing resume: ${err.message}`);
  }
}

// Render Simple & Precise Score Card
function renderPreciseScoreBubble(review: ReviewObject) {
  const circum = 2 * Math.PI * 24; // r=24
  const score = review.roleFit.score;
  const strokeOffset = circum - (score / 100) * circum;

  const topStrength = review.recruitersEye.noticeFirst.slice(0, 2).join(' · ');
  const topGap = review.whatToChangeBeforeApplying.length > 0
    ? review.whatToChangeBeforeApplying[0].title
    : (review.hasCriticalGap ? review.criticalGapMessage : 'Missing unstated testing metrics');

  const rewrite = review.suggestedWording[0];
  const nextSkill = review.learningPlan[0];

  const html = `
    <!-- Simple & Precise Score Card -->
    <div class="score-card">
      <div class="score-header-row">
        <div class="score-title-group">
          <span style="font-size: 11px; text-transform: uppercase; color: var(--wa-text-muted); font-weight: 600;">
            ${review.candidateName}
          </span>
          <h3>${review.roleFit.verdict}</h3>
          <p>${review.roleFit.summary}</p>
        </div>

        <!-- Radial Score Meter -->
        <div class="radial-ring">
          <svg class="radial-svg" viewBox="0 0 58 58">
            <circle class="radial-bg" cx="29" cy="29" r="24" fill="none" stroke-width="4.5" />
            <circle class="radial-fill" cx="29" cy="29" r="24" fill="none" stroke-width="4.5"
              stroke-dasharray="${circum}" stroke-dashoffset="${strokeOffset}" />
          </svg>
          <div class="radial-val">${score}<small>%</small></div>
        </div>
      </div>

      <!-- 4 Score Parameters -->
      <div class="param-grid">
        <div class="param-box">
          <span>Skills <strong>${review.subscores.skills}%</strong></span>
          <div class="param-bar"><div class="param-fill" style="width: ${review.subscores.skills}%"></div></div>
        </div>
        <div class="param-box">
          <span>Experience <strong>${review.subscores.experience}%</strong></span>
          <div class="param-bar"><div class="param-fill" style="width: ${review.subscores.experience}%"></div></div>
        </div>
        <div class="param-box">
          <span>Keywords <strong>${review.subscores.keywords}%</strong></span>
          <div class="param-bar"><div class="param-fill" style="width: ${review.subscores.keywords}%"></div></div>
        </div>
        <div class="param-box">
          <span>ATS Format <strong>${review.subscores.formatting}%</strong></span>
          <div class="param-bar"><div class="param-fill" style="width: ${review.subscores.formatting}%"></div></div>
        </div>
      </div>

      <!-- Precise Highlights -->
      <div class="precise-section">
        <span class="section-label green">🟢 What Stands Out</span>
        <p>${topStrength || 'Demonstrated foundational technical skills'}</p>
      </div>

      <div class="precise-section">
        <span class="section-label red">🔴 Key Gap</span>
        <p>${topGap}</p>
      </div>

      ${
        rewrite
          ? `
        <div class="precise-section">
          <span class="section-label blue">✏️ Quick Rewrite</span>
          <div class="rewrite-snippet">
            <strong>Before:</strong> "${rewrite.before}"<br>
            <strong>Direction:</strong> "${rewrite.after}"
          </div>
        </div>
      `
          : ''
      }

      ${
        nextSkill
          ? `
        <div class="precise-section">
          <span class="section-label" style="color: var(--wa-accent);">🎓 Next to Learn</span>
          <p><strong>${nextSkill.topic}</strong> (${nextSkill.priority} Priority)</p>
        </div>
      `
          : ''
      }

      <!-- Fast Action Buttons -->
      <div class="chip-row">
        <button class="mini-chip" data-ask="Which project bullet should I rewrite first?">✏️ Rewrites</button>
        <button class="mini-chip" data-ask="Why did I get this score?">❓ Explain Score</button>
        <button class="mini-chip" data-ask="What is my top learning priority?">📚 Learn</button>
      </div>
    </div>
  `;

  appendBotMessage(html);
}

// 3. Conversational Follow-up (Concise & Helpful)
async function handleChat(question: string) {
  appendUserMessage(question);
  const typing = showTypingIndicator();

  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        message: question,
      }),
    });

    removeTypingIndicator(typing);
    if (res.ok) {
      const data = await res.json();
      appendBotMessage(`<p>${data.reply}</p>`);
    } else {
      appendBotMessage(`<p>Focus on adding verifiable metrics to your strongest project and clarifying automated testing tools.</p>`);
    }
  } catch (err: any) {
    removeTypingIndicator(typing);
    appendBotMessage(`<p>Focus on adding verifiable metrics to your strongest project and clarifying automated testing tools.</p>`);
  }
}

// Event Listeners
btnSend.addEventListener('click', () => {
  const val = input.value.trim();
  if (!val) return;
  input.value = '';

  if (!activeJD) {
    appendUserMessage(val);
    handleJobDescription(val);
  } else {
    handleChat(val);
  }
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnSend.click();
  }
});

btnAttach.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  if (!fileInput.files || fileInput.files.length === 0) return;
  const files = Array.from(fileInput.files);

  for (const file of files) {
    appendUserMessage('', file.name);

    if (!activeJD) {
      await handleJobDescription(undefined, file);
    } else {
      await handleResume(file);
    }
  }

  fileInput.value = '';
});

btnNewSession.addEventListener('click', () => {
  sessionId = `mob-${Date.now()}`;
  localStorage.setItem('rolefit_mobile_sess', sessionId);
  activeJD = null;
  analyzedCandidates = [];
  document.querySelector('#header-title')!.textContent = 'RoleFit AI';
  canvas.innerHTML = `
    <div class="date-pill">Today</div>
    <div class="msg-row incoming">
      <div class="bubble">
        <p>🔄 <strong>Fresh session started.</strong></p>
        <p style="margin-top: 4px; font-size: 13px;">Send me a Job Description (paste text or attach PDF/DOCX) to begin.</p>
        <div class="timestamp">${getCurrentTime()}</div>
      </div>
    </div>
  `;
});

// Dynamic chip click handlers
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('strip-chip')) {
    const text = target.dataset.fill;
    if (text) {
      input.value = text;
      btnSend.click();
    }
  } else if (target.classList.contains('mini-chip')) {
    const question = target.dataset.ask;
    if (question) {
      handleChat(question);
    }
  }
});
