import { ClassifierService } from '../services/classifierService.js';
import { SessionStore } from '../services/sessionStore.js';
import { StructuredJDProfile } from '../types/index.js';

async function runOrderTests() {
  console.log('🧪 Starting Random Input Order & Classifier Verification...\n');
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (detail) console.error(`   Details: ${detail}`);
    }
  }

  const sampleResumeText = `
    Alex Morgan | alex.morgan@email.com | github.com/alexm
    Education:
    B.Tech Computer Science and Engineering, 2024. GPA: 3.8/4.0
    Work Experience:
    Junior Software Engineer at TechCorp (2024 - Present)
    - Developed REST APIs in Java with Spring Boot and PostgreSQL.
    - Built responsive frontend views and reduced database query latency by 25%.
    - Collaborated with QA team to write automated unit tests.
    Technical Skills:
    Java, Spring Boot, SQL, PostgreSQL, REST APIs, Git, Docker.
  `;

  const sampleJDText = `
    We are hiring a Senior Java Backend Developer to join our core infrastructure team.
    About the Role:
    You will architect and scale high-throughput payment microservices.
    Key Responsibilities:
    - Design and implement resilient REST and gRPC endpoints.
    - Write robust unit and integration tests.
    - Optimize SQL queries and PostgreSQL database schemas.
    Requirements:
    - 3+ years of experience with Java and Spring Boot.
    - Strong database fundamentals (SQL, PostgreSQL).
    - Nice to have: Docker, Kubernetes, AWS.
    What We Offer:
    Competitive salary, health benefits, and remote flexibility.
  `;

  console.log('--- 1. Document & Input Classification ---');
  const resumeType = ClassifierService.classify(sampleResumeText);
  assert(resumeType === 'RESUME', 'Classifier detects resume text as RESUME');

  const jdType = ClassifierService.classify(sampleJDText);
  assert(jdType === 'JD', 'Classifier detects job description text as JD');

  assert(ClassifierService.classify('Short text', 'john_doe_cv.pdf') === 'RESUME', 'Filename with CV classifies as RESUME');
  assert(ClassifierService.classify('Short text', 'software_engineer_jd.docx') === 'JD', 'Filename with JD classifies as JD');
  assert(ClassifierService.classify('Short text', 'My_Resume_2026.pdf') === 'RESUME', 'Filename with resume classifies as RESUME');

  console.log('--- 2. Contextual Disambiguation ---');
  const ambiguous = 'We require Java and Spring Boot proficiency. 2 years experience with microservices and databases.';
  const withPendingResume = ClassifierService.classify(ambiguous, undefined, {
    hasActiveJD: false,
    hasPendingResumes: true,
  });
  assert(withPendingResume === 'JD', 'Ambiguous input classified as JD when session is waiting for JD');

  const withActiveJD = ClassifierService.classify(ambiguous, undefined, {
    hasActiveJD: true,
    hasPendingResumes: false,
  });
  assert(withActiveJD === 'RESUME', 'Ambiguous input classified as RESUME when session has active JD');

  console.log('--- 3. Conversational Chat Detection ---');
  assert(ClassifierService.isChatMessage('Why did I get this score?'), 'Chat detector recognizes "Why did I get this score?"');
  assert(ClassifierService.isChatMessage('How can I improve my bullets?'), 'Chat detector recognizes "How can I improve..."');
  assert(ClassifierService.isChatMessage('What should I learn next?'), 'Chat detector recognizes "What should I learn next?"');
  assert(!ClassifierService.isChatMessage(sampleResumeText), 'Resume document is NOT flagged as chat');
  assert(!ClassifierService.isChatMessage(sampleJDText), 'JD document is NOT flagged as chat');

  console.log('--- 4. Order Flow A: JD First, Then Resume Second ---');
  const sessA = `test-order-a-${Date.now()}`;
  const mockProfileA: StructuredJDProfile = {
    id: 'jd-a',
    jobTitle: 'Java Backend Developer',
    primaryRole: 'Java Backend',
    primaryTechnologies: ['Java', 'Spring Boot'],
    summary: 'Java backend role',
    requirements: [],
    rawText: sampleJDText,
    createdAt: new Date().toISOString(),
  };
  await SessionStore.setJDProfile(sessA, mockProfileA);
  const checkSessA = await SessionStore.getSession(sessA);
  assert(checkSessA.jdProfile?.jobTitle === 'Java Backend Developer', 'Flow A: JD stored successfully in session');
  assert((checkSessA.pendingResumes?.length || 0) === 0, 'Flow A: No pending resumes buffered when JD sent first');

  console.log('--- 5. Order Flow B: Resume First, Then JD Second ---');
  const sessB = `test-order-b-${Date.now()}`;
  const initialSessB = await SessionStore.getSession(sessB);
  assert(!initialSessB.jdProfile, 'Flow B: No JD initially');

  // Step 1: Buffer resume
  if (!initialSessB.pendingResumes) initialSessB.pendingResumes = [];
  initialSessB.pendingResumes.push({
    text: sampleResumeText,
    filename: 'alex_resume.pdf',
    candidateName: 'Alex Morgan',
  });
  await SessionStore.saveSession(initialSessB);

  const reloadedB = await SessionStore.getSession(sessB);
  assert(reloadedB.pendingResumes?.length === 1, 'Flow B: Resume successfully buffered in pending queue');
  assert(reloadedB.pendingResumes![0].candidateName === 'Alex Morgan', 'Flow B: Candidate name preserved');

  // Step 2: JD arrives second
  await SessionStore.setJDProfile(sessB, mockProfileA);
  const afterJdB = await SessionStore.getSession(sessB);
  assert(afterJdB.jdProfile?.jobTitle === 'Java Backend Developer', 'Flow B: JD set successfully');
  assert(afterJdB.pendingResumes?.length === 1, 'Flow B: Pending resume intact after JD set (ready for auto-matching)');

  console.log('--- 6. Multiple Resumes Buffered Before JD ---');
  const sessC = `test-order-c-${Date.now()}`;
  const sessObjC = await SessionStore.getSession(sessC);
  sessObjC.pendingResumes = [
    { text: 'Candidate 1', filename: 'c1.pdf', candidateName: 'Candidate One' },
    { text: 'Candidate 2', filename: 'c2.pdf', candidateName: 'Candidate Two' },
  ];
  await SessionStore.saveSession(sessObjC);
  const checkC = await SessionStore.getSession(sessC);
  assert(checkC.pendingResumes?.length === 2, 'Multiple resumes buffered prior to JD');

  console.log(`\n📊 Order Test Results: ${passed} / ${total} tests passed.`);
  if (passed === total) {
    console.log('🎉 ALL RANDOM INPUT ORDER TESTS PASSED SUCCESSFULLY!');
  } else {
    process.exit(1);
  }
}

runOrderTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
