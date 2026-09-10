import { GeminiService } from '../services/geminiService.js';
import { ScoringService } from '../services/scoringService.js';
import { CourseService } from '../services/courseService.js';
import { RankingService } from '../services/rankingService.js';

async function runTests() {
  console.log('🧪 Starting RoleFit Verification & Mandatory Prompt Tests...\n');
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

  const gemini = new GeminiService();

  // -------------------------------------------------------------
  // Test 1: Java vs. Python Priority & Course Recommendation Order
  // -------------------------------------------------------------
  console.log('--- TEST 1: Java vs. Python Priority ---');
  const jd1 = `
Role: Java Backend Developer.
Java is the primary programming language.
Strong Java and Spring Boot experience is required.
SQL and REST API experience is required.
Python knowledge is preferred.
AWS exposure is a plus.
`;
  const profile1 = await gemini.analyzeJobDescription(jd1);
  const javaReq = profile1.requirements.find((r) => r.name.toLowerCase().includes('java') && !r.name.toLowerCase().includes('script'));
  const springReq = profile1.requirements.find((r) => r.name.toLowerCase().includes('spring'));
  const pythonReq = profile1.requirements.find((r) => r.name.toLowerCase().includes('python'));

  assert(
    !!javaReq && (javaReq.priority === 'CRITICAL' || javaReq.isPrimary),
    'Test 1.1: Java is recognized as PRIMARY / CRITICAL',
    `Found Java priority: ${javaReq?.priority}, isPrimary: ${javaReq?.isPrimary}`
  );
  assert(
    !!springReq && springReq.priority === 'CRITICAL',
    'Test 1.2: Spring Boot is recognized as CRITICAL',
    `Found Spring Boot priority: ${springReq?.priority}`
  );
  assert(
    !!pythonReq && (pythonReq.priority === 'LOW' || pythonReq.priority === 'MEDIUM'),
    'Test 1.3: Python is recognized as PREFERRED / LOW',
    `Found Python priority: ${pythonReq?.priority}`
  );

  // Candidate with Java and SQL, but missing Spring Boot, Python, AWS
  const resume1 = `
John Doe
Software Developer
Experience:
- Developed Java backend services and REST APIs for 3 years.
- Designed SQL database schemas and optimized queries.
`;
  const review1 = await gemini.analyzeCandidateResume(profile1, resume1, 'John Doe');
  const recommendations1 = review1.learningPlan;

  const springRecIdx = recommendations1.findIndex((r) => r.jdRequirement.toLowerCase().includes('spring'));
  const pythonRecIdx = recommendations1.findIndex((r) => r.jdRequirement.toLowerCase().includes('python'));

  assert(
    springRecIdx !== -1 && (pythonRecIdx === -1 || springRecIdx < pythonRecIdx),
    'Test 1.4: Spring Boot is recommended before Python',
    `Spring Boot recommendation index: ${springRecIdx}, Python index: ${pythonRecIdx}`
  );

  // -------------------------------------------------------------
  // Test 2: Opposite Case (Python Primary, Java Plus)
  // -------------------------------------------------------------
  console.log('\n--- TEST 2: Opposite Case (Python Primary) ---');
  const jd2 = `
Role: Python Developer
Python is the primary development language.
Strong Python and Django experience is mandatory.
Java knowledge is a plus.
`;
  const profile2 = await gemini.analyzeJobDescription(jd2);
  const pythonReq2 = profile2.requirements.find((r) => r.name.toLowerCase().includes('python'));
  const djangoReq2 = profile2.requirements.find((r) => r.name.toLowerCase().includes('django'));
  const javaReq2 = profile2.requirements.find((r) => r.name.toLowerCase().includes('java') && !r.name.toLowerCase().includes('script'));

  assert(
    !!pythonReq2 && (pythonReq2.priority === 'CRITICAL' || pythonReq2.isPrimary),
    'Test 2.1: Python is dynamically recognized as CRITICAL / PRIMARY',
    `Found Python priority: ${pythonReq2?.priority}`
  );
  assert(
    !!djangoReq2 && djangoReq2.priority === 'CRITICAL',
    'Test 2.2: Django is recognized as CRITICAL',
    `Found Django priority: ${djangoReq2?.priority}`
  );
  assert(
    !!javaReq2 && javaReq2.priority === 'LOW',
    'Test 2.3: Java is recognized as LOW / PREFERRED in this JD',
    `Found Java priority: ${javaReq2?.priority}`
  );

  // -------------------------------------------------------------
  // Test 3: Course-Only Experience
  // -------------------------------------------------------------
  console.log('\n--- TEST 3: Course-Only Experience ---');
  const jd3 = `
Role: Python Backend Engineer
3 years professional Python development required.
`;
  const profile3 = await gemini.analyzeJobDescription(jd3);
  const resume3 = `
Candidate Jane
Education:
- Completed a Python course online.
`;
  const review3 = await gemini.analyzeCandidateResume(profile3, resume3, 'Candidate Jane');
  const pythonEv = review3.evidenceMap.find((e) => e.requirementName.toLowerCase().includes('python'));

  assert(
    !!pythonEv && pythonEv.status === 'WEAK_MATCH',
    'Test 3.1: Course-only experience evaluated as WEAK_MATCH (not Strong Match)',
    `Status was: ${pythonEv?.status}, Strength: ${pythonEv?.evidenceStrength}`
  );

  // -------------------------------------------------------------
  // Test 4: Missing Skill Evidence (Zero Hallucination)
  // -------------------------------------------------------------
  console.log('\n--- TEST 4: Missing Skill Evidence (No Hallucination) ---');
  const jd4 = `
Role: Java Developer
AWS experience required.
Java experience required.
`;
  const profile4 = await gemini.analyzeJobDescription(jd4);
  const resume4 = `
Experienced Developer
- Java backend microservices for 4 years.
- Spring Boot and SQL.
`;
  const review4 = await gemini.analyzeCandidateResume(profile4, resume4, 'Developer 4');
  const awsEv = review4.evidenceMap.find((e) => e.requirementName.toLowerCase().includes('aws'));

  assert(
    !!awsEv && (awsEv.status === 'MISSING' || awsEv.status === 'CRITICAL_GAP'),
    'Test 4.1: Missing skill identified as MISSING',
    `Status was: ${awsEv?.status}`
  );
  assert(
    awsEv?.evidenceSnippet.includes('No evidence was identified in the provided resume') || false,
    'Test 4.2: Evidence snippet explicitly states no evidence was identified',
    `Snippet was: "${awsEv?.evidenceSnippet}"`
  );

  // -------------------------------------------------------------
  // Test 5: Multiple Candidate Ranking
  // -------------------------------------------------------------
  console.log('\n--- TEST 5: Multiple Candidate Ranking ---');
  const jd5 = `
Role: Java Backend Developer
Java is the primary programming language.
Strong Java and Spring Boot experience is required.
SQL experience is required.
Python is preferred.
AWS is preferred.
`;
  const profile5 = await gemini.analyzeJobDescription(jd5);

  // Candidate A: Strong Java, Strong Spring Boot, Strong SQL
  const candA = await gemini.analyzeCandidateResume(
    profile5,
    `Built production Java backend applications with Spring Boot and PostgreSQL for 4 years. Developed high throughput REST services.`,
    'Candidate A'
  );

  // Candidate B: Strong Python, Strong AWS, Weak Java, No Spring Boot
  const candB = await gemini.analyzeCandidateResume(
    profile5,
    `5 years of Python development with AWS Lambda and DynamoDB. Completed an introductory Java course in college.`,
    'Candidate B'
  );

  // Candidate C: Strong Java, Moderate Spring Boot, Strong SQL
  const candC = await gemini.analyzeCandidateResume(
    profile5,
    `Java developer for 2 years with PostgreSQL. Used Spring Boot in departmental tools.`,
    'Candidate C'
  );

  const rankings = RankingService.rankCandidates(profile5, [candA, candB, candC]);

  assert(
    rankings[0].candidateName === 'Candidate A',
    'Test 5.1: Candidate A ranks #1 (core requirements met)',
    `Rank 1 was: ${rankings[0].candidateName} (${rankings[0].score}%)`
  );
  assert(
    rankings[rankings.length - 1].candidateName === 'Candidate B',
    'Test 5.2: Candidate B ranks last (missing core Spring Boot and weak Java for a Java role)',
    `Rank ${rankings.length} was: ${rankings[rankings.length - 1].candidateName} (${rankings[rankings.length - 1].score}%)`
  );
  assert(
    rankings[0].score > rankings[rankings.length - 1].score,
    'Test 5.3: Candidate A has a higher score than Candidate B despite B having Python & AWS',
    `Candidate A: ${rankings[0].score}% vs Candidate B: ${rankings[rankings.length - 1].score}%`
  );

  console.log(`\n📊 Final Results: ${passed} / ${total} tests passed.`);
  if (passed === total) {
    console.log('🎉 ALL MANDATORY PROMPT TESTS PASSED SUCCESSFULLY!');
  } else {
    console.error('❌ Some tests failed. Please review the output above.');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
