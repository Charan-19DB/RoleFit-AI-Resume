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

const API_BASE = 'http://localhost:3001/api';
let sessionId = localStorage.getItem('rolefit_wa_session') || `wa-${Date.now()}`;
localStorage.setItem('rolefit_wa_session', sessionId);

let activeJD: StructuredJDProfile | null = null;
let analyzedCandidates: ReviewObject[] = [];

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <div class="app-container">
    <!-- WhatsApp / Meta AI Header -->
    <header class="chat-header">
      <div class="header-left">
        <div class="meta-logo">
          <svg viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
          </svg>
        </div>
        <div class="header-info">
          <h1 id="header-title">RoleFit AI</h1>
          <p id="header-status">online · Recruiter & Career Reviewer</p>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn-new-chat" id="btn-new-session">🔄 New Session</button>
      </div>
    </header>

    <!-- Chat Message Canvas -->
    <main class="chat-canvas" id="chat-canvas">
      <div class="date-pill">Today</div>

      <!-- Welcome Message -->
      <div class="msg-row incoming">
        <div class="bubble">
          <p>👋 <strong>Welcome to RoleFit AI</strong></p>
          <p style="margin-top: 6px; color: var(--wa-text-secondary);">
            <em>"Your resume. Their requirements. One honest review."</em>
          </p>
          <p style="margin-top: 10px;">
            I am your recruitment intelligence mentor. To get started, send me a <strong>Job Description</strong>:
          </p>
          <ul style="margin: 8px 0 8px 20px; font-size: 13.5px; color: var(--wa-text-primary);">
            <li>📝 <strong>Paste JD text</strong> directly into the message box</li>
            <li>📎 Or <strong>attach a PDF/DOCX</strong> using the paperclip icon</li>
          </ul>
          <div class="timestamp">${getCurrentTime()}</div>
        </div>
      </div>
    </main>

    <!-- Suggestion Chips Bar -->
    <div class="suggestion-bar" id="suggestion-bar">
      <button class="chip" data-fill="We are hiring a Senior Java Developer with Spring Boot, SQL, REST APIs, and Docker. Python is a plus.">📝 Load Sample Java JD</button>
      <button class="chip" data-fill="Why did I get this score?">❓ Why this score?</button>
      <button class="chip" data-fill="How can I add testing evidence honestly?">🧪 Add testing honestly?</button>
      <button class="chip" data-fill="What should I learn next for this role?">📚 What to learn?</button>
    </div>

    <!-- WhatsApp Input Bar -->
    <footer class="chat-footer">
      <button class="icon-btn" id="btn-attach" title="Attach JD or Resume (PDF/DOCX)">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
        </svg>
      </button>
      <input type="file" id="file-input" class="hidden" accept=".pdf,.docx,.doc,.txt" multiple />

      <div class="input-wrapper">
        <input
          type="text"
          class="chat-input"
          id="chat-input"
          placeholder="Type a message or paste a Job Description / Resume..."
          autocomplete="off"
        />
      </div>

      <button class="send-btn" id="btn-send" title="Send message">
        <svg viewBox="0 0 24 24">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </footer>
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
          <small>Document uploaded</small>
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

// 1. Process Job Description
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
      document.querySelector('#header-title')!.textContent = `RoleFit · ${activeJD?.jobTitle}`;

      const critical = activeJD?.requirements.filter((r) => r.priority === 'CRITICAL').length || 0;
      const high = activeJD?.requirements.filter((r) => r.priority === 'HIGH').length || 0;
      const low = activeJD?.requirements.filter((r) => r.priority === 'LOW').length || 0;

      appendBotMessage(`
        <p>✅ <strong>Job Description Received & Analyzed</strong></p>
        <p style="margin-top: 4px; color: var(--wa-accent); font-weight: 600;">${activeJD?.jobTitle}</p>
        <p style="font-size: 13px; color: var(--wa-text-secondary); margin-top: 4px;">
          Primary Tech: <strong>${activeJD?.primaryTechnologies.join(', ')}</strong>
        </p>

        <div style="display: flex; gap: 8px; margin: 10px 0; font-size: 12px;">
          <span style="background: rgba(239, 68, 68, 0.2); color: #f87171; padding: 2px 8px; border-radius: 4px;">🔴 ${critical} Critical</span>
          <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; padding: 2px 8px; border-radius: 4px;">🟠 ${high} Important</span>
          <span style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; padding: 2px 8px; border-radius: 4px;">🟡 ${low} Preferred</span>
        </div>

        <p style="margin-top: 10px;">
          👉 <strong>Now upload one or more resumes</strong> (PDF/DOCX) using the paperclip 📎 or paste resume text below to see an honest recruiter review!
        </p>
      `);
    } else {
      appendBotMessage(`⚠️ Could not analyze Job Description. Please make sure the backend server is running.`);
    }
  } catch (err: any) {
    removeTypingIndicator(typing);
    appendBotMessage(`⚠️ Connection error: ${err.message}. Please check that the server is running at ${API_BASE}.`);
  }
}

// 2. Process Resume(s)
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
      renderCandidateReviewBubble(review);
    } else {
      appendBotMessage(`⚠️ Failed to analyze resume. Please make sure a Job Description is active first.`);
    }
  } catch (err: any) {
    removeTypingIndicator(typing);
    appendBotMessage(`⚠️ Error analyzing resume: ${err.message}`);
  }
}

// Render Complete Humanized Recruiter Review with Graphical Meter
function renderCandidateReviewBubble(review: ReviewObject) {
  const circum = 2 * Math.PI * 28; // r=28
  const score = review.roleFit.score;
  const strokeOffset = circum - (score / 100) * circum;

  const html = `
    <!-- Graphical Representation Header -->
    <div class="chart-widget">
      <div class="role-fit-header">
        <div class="role-fit-details">
          <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--wa-accent); font-weight: 700;">
            Role Fit Review · ${review.candidateName}
          </span>
          <h3 style="margin-top: 2px;">${review.roleFit.verdict} — ${score}%</h3>
          <p>${review.roleFit.summary}</p>
        </div>

        <!-- Inline Radial Meter -->
        <div class="radial-container">
          <svg class="radial-svg" viewBox="0 0 72 72">
            <circle class="radial-bg" cx="36" cy="36" r="28" fill="none" stroke-width="5" />
            <circle class="radial-meter" cx="36" cy="36" r="28" fill="none" stroke-width="5"
              stroke-dasharray="${circum}" stroke-dashoffset="${strokeOffset}" />
          </svg>
          <div class="radial-text">${score}<small>%</small></div>
        </div>
      </div>

      <!-- Subscore Progress Bars -->
      <div class="subscores-row">
        <div class="subscore-item">
          <span>Skills Match <strong>${review.subscores.skills}%</strong></span>
          <div class="subscore-bar"><div class="subscore-fill" style="width: ${review.subscores.skills}%"></div></div>
        </div>
        <div class="subscore-item">
          <span>Experience Match <strong>${review.subscores.experience}%</strong></span>
          <div class="subscore-bar"><div class="subscore-fill" style="width: ${review.subscores.experience}%"></div></div>
        </div>
      </div>
    </div>

    <!-- Recruiter's Eye Section -->
    <div class="bubble-section">
      <div class="bubble-section-title">👀 Recruiter’s Eye</div>
      <div class="recruiter-eye-box notice">
        <strong>I’d Notice First:</strong>
        ${review.recruitersEye.noticeFirst.join(' · ')}
      </div>
      <div class="recruiter-eye-box question">
        <strong>I’d Question / Look For:</strong>
        ${review.recruitersEye.question.join(' · ')}
      </div>
    </div>

    <!-- Resume ↔ Role Evidence Map -->
    <div class="bubble-section">
      <div class="bubble-section-title">📍 Grounded Evidence Map</div>
      ${review.evidenceMap
        .slice(0, 4)
        .map((ev) => {
          const badgeClass =
            ev.status === 'STRONG_MATCH' || ev.status === 'GOOD_MATCH'
              ? 'strong'
              : ev.status === 'PARTIAL_MATCH'
              ? 'partial'
              : 'missing';
          const label =
            ev.status === 'STRONG_MATCH'
              ? 'Strong Match'
              : ev.status === 'GOOD_MATCH'
              ? 'Good Match'
              : ev.status === 'PARTIAL_MATCH'
              ? 'Partial Match'
              : 'Missing Evidence';
          return `
            <div class="evidence-item">
              <span class="evidence-badge ${badgeClass}">${label}</span>
              <div>
                <strong>${ev.requirementName}</strong>
                <p style="color: var(--wa-text-secondary); font-size: 12px; margin-top: 2px;">${ev.evidenceSnippet}</p>
              </div>
            </div>
          `;
        })
        .join('')}
    </div>

    <!-- What I'd change before applying -->
    <div class="bubble-section">
      <div class="bubble-section-title">✏️ What I’d Change Before Applying</div>
      ${review.whatToChangeBeforeApplying
        .slice(0, 2)
        .map(
          (item, i) => `
        <div style="margin-bottom: 8px; font-size: 13px;">
          <strong>${i + 1}. ${item.title}</strong>
          <p style="color: var(--wa-text-secondary); margin-top: 2px;">${item.reason} — <em>${item.action}</em></p>
          <small style="color: var(--wa-warning); display: block; margin-top: 2px;">⚠️ Honesty: ${item.honestyNote}</small>
        </div>
      `
        )
        .join('')}
    </div>

    <!-- Suggested Wording (Truth-First) -->
    ${
      review.suggestedWording.length > 0
        ? `
      <div class="bubble-section">
        <div class="bubble-section-title">📝 Suggested Truthful Rewrite</div>
        <div class="rewrite-card">
          <strong style="color: var(--wa-accent);">Before:</strong> "${review.suggestedWording[0].before}"<br>
          <strong style="color: var(--wa-accent); display: inline-block; margin-top: 4px;">Suggested Direction:</strong> "${review.suggestedWording[0].after}"
          <small>ℹ️ ${review.suggestedWording[0].guidance}</small>
        </div>
      </div>
    `
        : ''
    }

    <!-- Top Learning Plan -->
    ${
      review.learningPlan.length > 0
        ? `
      <div class="bubble-section">
        <div class="bubble-section-title">📚 What to Learn Next (Role Priority)</div>
        <p style="font-size: 13px;">
          1. <strong>${review.learningPlan[0].topic}</strong> (${review.learningPlan[0].priority} Priority)<br>
          <span style="color: var(--wa-text-secondary); font-size: 12px;">${review.learningPlan[0].reason}</span>
        </p>
      </div>
    `
        : ''
    }

    <!-- Interactive Action Buttons Inside Bubble -->
    <div class="action-btn-row">
      <button class="chat-action-btn" data-ask="Which project bullet should I rewrite first?">📝 Rewrite Bullets</button>
      <button class="chat-action-btn" data-ask="What is my full learning plan for this role?">📚 Full Learning Plan</button>
      <button class="chat-action-btn" data-ask="How can I add unstated testing evidence honestly?">🧪 Add Testing</button>
    </div>
  `;

  appendBotMessage(html);
}

// 3. Conversational Follow-up Q&A
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
      appendBotMessage(`<p>I’m keeping this grounded in your resume. Focus on making your strongest project sound like ownership with measurable outcomes.</p>`);
    }
  } catch (err: any) {
    removeTypingIndicator(typing);
    appendBotMessage(`<p>I’m keeping this grounded in your resume. Focus on making your strongest project sound like ownership with measurable outcomes.</p>`);
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
  sessionId = `wa-${Date.now()}`;
  localStorage.setItem('rolefit_wa_session', sessionId);
  activeJD = null;
  analyzedCandidates = [];
  document.querySelector('#header-title')!.textContent = 'RoleFit AI';
  canvas.innerHTML = `
    <div class="date-pill">Today</div>
    <div class="msg-row incoming">
      <div class="bubble">
        <p>🔄 <strong>Fresh session started.</strong></p>
        <p style="margin-top: 6px;">Send me a Job Description (paste text or attach PDF/DOCX) to begin.</p>
        <div class="timestamp">${getCurrentTime()}</div>
      </div>
    </div>
  `;
});

// Dynamic chip click handlers
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('chip')) {
    const text = target.dataset.fill;
    if (text) {
      input.value = text;
      btnSend.click();
    }
  } else if (target.classList.contains('chat-action-btn')) {
    const question = target.dataset.ask;
    if (question) {
      handleChat(question);
    }
  }
});
