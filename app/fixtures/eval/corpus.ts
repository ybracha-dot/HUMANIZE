// Evaluation corpus. All text is original and synthetic. `dev` fixtures were used while tuning rules; `heldout` fixtures were written
// after the final rule edit and are never used to change a rule. Misses are recorded (knownMiss), not hidden.
import type { Verdict } from '../../shared/evidence.ts';

export interface Expect {
  claim: string;
  verdict: Verdict;
  gold?: string;
  knownMiss?: string;
}
export interface Fx {
  id: string;
  family: string;
  lang: string;
  split: 'dev' | 'heldout';
  passages: { id: string; text: string }[];
  text: string;
  expect: Expect[];
}
export interface DriftPair {
  id: string;
  family: string;
  split: 'dev' | 'heldout';
  orig: string;
  cand: string;
  material: boolean;
  knownMiss?: string;
}

const ATT = [
  {
    id: 'a_p1',
    text: 'Of the 180 students surveyed, frequent attendees averaged 84 on the final exam. Less frequent attendees averaged 77. Students chose whether to attend.',
  },
];

export const FIXTURES: Fx[] = [
  // ---- dev ----------------------------------------------------------------------------------
  {
    id: 'd01',
    family: 'short_argument',
    lang: 'en',
    split: 'dev',
    passages: ATT,
    text: 'Frequent attendees averaged 84 on the final exam, and attendance raised scores.',
    expect: [
      { claim: 'averaged 84', verdict: 'supported', gold: 'a_p1' },
      { claim: 'attendance raised scores', verdict: 'partial', gold: 'a_p1' },
    ],
  },
  {
    id: 'd02',
    family: 'short_argument',
    lang: 'en',
    split: 'dev',
    passages: ATT,
    text: 'Less frequent attendees averaged 80 on the final exam.',
    expect: [{ claim: 'averaged 80', verdict: 'contradicted', gold: 'a_p1' }],
  },
  {
    id: 'd03',
    family: 'stats',
    lang: 'en',
    split: 'dev',
    passages: [{ id: 's_p1', text: 'The trial did not show a statistically significant increase in pass rates after the intervention.' }],
    text: 'The trial showed an increase in pass rates after the intervention.',
    expect: [{ claim: 'increase in pass rates', verdict: 'contradicted', gold: 's_p1' }],
  },
  {
    id: 'd04',
    family: 'short_argument',
    lang: 'en',
    split: 'dev',
    passages: ATT,
    text: 'Tuition increased across the state over the last decade.',
    expect: [{ claim: 'Tuition', verdict: 'insufficient' }],
  },
  {
    id: 'd05',
    family: 'short_argument',
    lang: 'en',
    split: 'dev',
    passages: [{ id: 'o_p1', text: 'Exam scores were lower among students who skipped class.' }],
    text: 'Exam scores were higher among students who skipped class.',
    expect: [{ claim: 'higher among', verdict: 'contradicted', gold: 'o_p1' }],
  },
  {
    id: 'd06',
    family: 'causal',
    lang: 'en',
    split: 'dev',
    passages: [{ id: 'r_p1', text: 'Students were randomly assigned to tutoring or no tutoring. Tutoring raised exam scores by 7 points.' }],
    text: 'Tutoring raised exam scores by 7 points.',
    expect: [{ claim: 'Tutoring raised', verdict: 'supported', gold: 'r_p1' }],
  },
  {
    id: 'd07',
    family: 'finance_memo',
    lang: 'en',
    split: 'dev',
    passages: [{ id: 'f_p1', text: 'Management projects savings of about $3 million annually after full rollout.' }],
    text: 'The program saves $3 million annually.',
    expect: [{ claim: 'saves $3 million', verdict: 'partial', gold: 'f_p1' }],
  },
  {
    id: 'd08',
    family: 'finance_memo',
    lang: 'en',
    split: 'dev',
    passages: [{ id: 'f_p2', text: 'Operating margin rose from 42% to 48% between fiscal 2022 and fiscal 2023.' }],
    text: 'Operating margin rose 6 percentage points.',
    expect: [{ claim: '6 percentage points', verdict: 'supported', gold: 'f_p2' }],
  },
  {
    id: 'd09',
    family: 'finance_memo',
    lang: 'en',
    split: 'dev',
    passages: [{ id: 'f_p2', text: 'Operating margin rose from 42% to 48% between fiscal 2022 and fiscal 2023.' }],
    text: 'Operating margin rose 6% between fiscal 2022 and fiscal 2023.',
    expect: [{ claim: 'rose 6%', verdict: 'partial', gold: 'f_p2' }],
  },
  {
    id: 'd10',
    family: 'history_cited',
    lang: 'en',
    split: 'dev',
    passages: [{ id: 'h_p1', text: 'The Reform Act of 1832 extended the vote to roughly one in five adult men in England and Wales (Smith 45).' }],
    text: 'The Reform Act of 1832 extended the vote to about one in five adult men (Smith 45).',
    expect: [{ claim: 'Reform Act of 1832', verdict: 'supported', gold: 'h_p1' }],
  },
  {
    id: 'd11',
    family: 'history_cited',
    lang: 'en',
    split: 'dev',
    passages: [{ id: 'h_p1', text: 'The Reform Act of 1832 extended the vote to roughly one in five adult men in England and Wales (Smith 45).' }],
    text: 'The Reform Act of 1842 extended the vote to about one in five adult men (Smith 45).',
    expect: [{ claim: 'Reform Act of 1842', verdict: 'contradicted', gold: 'h_p1' }],
  },
  {
    id: 'd12',
    family: 'spanish_intro',
    lang: 'es',
    split: 'dev',
    passages: [{ id: 'e_p1', text: 'El 62% de los estudiantes asistió a la mayoría de las clases durante el semestre.' }],
    text: 'El 62% de los estudiantes asistió a la mayoría de las clases.',
    expect: [{ claim: '62%', verdict: 'supported', gold: 'e_p1' }],
  },
  {
    id: 'd13',
    family: 'spanish_intro',
    lang: 'es',
    split: 'dev',
    passages: [{ id: 'e_p1', text: 'El 62% de los estudiantes asistió a la mayoría de las clases durante el semestre.' }],
    text: 'El 70% de los estudiantes asistió a la mayoría de las clases.',
    expect: [{ claim: '70%', verdict: 'contradicted', gold: 'e_p1' }],
  },
  {
    id: 'd14',
    family: 'ocr_error',
    lang: 'en',
    split: 'dev',
    passages: [{ id: 'c_p1', text: 'Tbe survey of 180 students found that attendanee was linked to higher scores.' }],
    text: 'The survey of 180 students found that attendance was linked to higher scores.',
    expect: [{ claim: 'survey of 180', verdict: 'supported', gold: 'c_p1' }],
  },
  // ---- held-out (written after the final rule edit; never used to tune) ----------------------------
  {
    id: 'h01',
    family: 'hebrew',
    lang: 'he',
    split: 'heldout',
    passages: [{ id: 'he_p1', text: 'כ-62% מהסטודנטים השתתפו ברוב השיעורים במהלך הסמסטר.' }],
    text: 'כ-62% מהסטודנטים השתתפו ברוב השיעורים.',
    expect: [{ claim: '62%', verdict: 'supported', gold: 'he_p1' }],
  },
  {
    id: 'h02',
    family: 'hebrew',
    lang: 'he',
    split: 'heldout',
    passages: [{ id: 'he_p1', text: 'כ-62% מהסטודנטים השתתפו ברוב השיעורים במהלך הסמסטר.' }],
    text: 'כ-80% מהסטודנטים השתתפו ברוב השיעורים.',
    expect: [{ claim: '80%', verdict: 'contradicted', gold: 'he_p1' }],
  },
  {
    id: 'h03',
    family: 'ocr_error',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'c_p2', text: 'Frequent attendees averaged B4 on the final exam; the others averaged 77.' }],
    text: 'Frequent attendees averaged 84 on the final exam.',
    expect: [
      {
        claim: 'averaged 84',
        verdict: 'insufficient',
        gold: 'c_p2',
        knownMiss:
          'OCR digit error (B4 for 84): the safe answer is insufficient/unreadable. The verifier instead reports contradicted, citing the other figure (77) in the same sentence. Wrong reason, though not an unsafe pass.',
      },
    ],
  },
  {
    id: 'h04',
    family: 'bilingual',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'e_p1', text: 'El 62% de los estudiantes asistió a la mayoría de las clases durante el semestre.' }],
    text: '62% of students attended most classes during the semester.',
    expect: [
      {
        claim: '62% of students',
        verdict: 'supported',
        gold: 'e_p1',
        knownMiss:
          'Cross-language support: the lexical baseline matches only the figure and answers partial. It cannot read the Spanish wording. Needs multilingual retrieval.',
      },
    ],
  },
  {
    id: 'h05',
    family: 'paraphrase',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'p_p1', text: 'Pupils who turned up regularly scored higher in the end-of-year test.' }],
    text: 'Students who attended frequently performed better on the final exam.',
    expect: [
      {
        claim: 'attended frequently',
        verdict: 'supported',
        gold: 'p_p1',
        knownMiss: 'No shared vocabulary: lexical retrieval misses a true paraphrase (insufficient). Embeddings are the candidate fix once measured.',
      },
    ],
  },
  {
    id: 'h06',
    family: 'causal',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'k_p1', text: 'The authors conclude that the tutoring program caused the gains in reading scores.' }],
    text: 'The tutoring program caused the gains in reading scores.',
    expect: [{ claim: 'tutoring program caused', verdict: 'supported', gold: 'k_p1' }],
  },
  {
    id: 'h07',
    family: 'causal',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'k_p2', text: 'Reading scores may be related to hours of sleep, though the data cannot show why.' }],
    text: 'Lack of sleep causes lower reading scores.',
    expect: [
      {
        claim: 'Lack of sleep',
        verdict: 'partial',
        gold: 'k_p2',
        knownMiss:
          'Reports contradicted: the passage negates ("cannot show") and the claim does not, and the negation check does not know the negation is about a different clause. A negation-scope limitation.',
      },
    ],
  },
  {
    id: 'h08',
    family: 'stats',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 's_p2', text: 'On average, students in the treatment group gained 4 points; the difference was not statistically significant.' }],
    text: 'Students in the treatment group gained 4 points.',
    expect: [
      {
        claim: 'gained 4 points',
        verdict: 'partial',
        gold: 's_p2',
        knownMiss: 'Baseline-only miss, fixed by the revised rules. Reported contradicted for the same negation-scope reason ("not statistically significant" negates the difference, not the gain).',
      },
    ],
  },
  {
    id: 'h09',
    family: 'cited_history',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'h_p2', text: 'Parliament passed the Corn Laws in 1815 to protect domestic grain prices (Jones 12). Repeal came in 1846.' }],
    text: 'Parliament passed the Corn Laws in 1815 and repealed them in 1846 (Jones 12).',
    expect: [{ claim: 'Corn Laws in 1815', verdict: 'supported', gold: 'h_p2' }],
  },
  {
    id: 'h10',
    family: 'cited_history',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'h_p2', text: 'Parliament passed the Corn Laws in 1815 to protect domestic grain prices (Jones 12). Repeal came in 1846.' }],
    text: 'Parliament passed the Corn Laws in 1825 to protect domestic grain prices (Jones 12).',
    expect: [{ claim: 'Corn Laws in 1825', verdict: 'contradicted', gold: 'h_p2' }],
  },
  {
    id: 'h11',
    family: 'finance_memo',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'f_p3', text: 'Revenue grew 12% year over year to $48 million, driven by the new subscription tier.' }],
    text: 'Revenue grew 12% year over year to $48 million.',
    expect: [{ claim: 'Revenue grew 12%', verdict: 'supported', gold: 'f_p3' }],
  },
  {
    id: 'h12',
    family: 'finance_memo',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'f_p3', text: 'Revenue grew 12% year over year to $48 million, driven by the new subscription tier.' }],
    text: 'Revenue grew 12% year over year to $52 million.',
    expect: [{ claim: '$52 million', verdict: 'contradicted', gold: 'f_p3' }],
  },
  {
    id: 'h13',
    family: 'compound',
    lang: 'en',
    split: 'heldout',
    passages: [{ id: 'f_p3', text: 'Revenue grew 12% year over year to $48 million, driven by the new subscription tier.' }],
    text: 'Revenue grew 12% year over year, and headcount doubled over the same period.',
    expect: [
      { claim: 'Revenue grew 12%', verdict: 'supported', gold: 'f_p3' },
      { claim: 'headcount doubled', verdict: 'insufficient' },
    ],
  },
  {
    id: 'h14',
    family: 'conflicting_sources',
    lang: 'en',
    split: 'heldout',
    passages: [
      { id: 'x_p1', text: 'Frequent attendees averaged 84 on the final exam (first edition, p. 14).' },
      { id: 'x_p2', text: 'Frequent attendees averaged 82 on the final exam (second edition, p. 16).' },
    ],
    text: 'Frequent attendees averaged 84 on the final exam.',
    expect: [
      {
        claim: 'averaged 84',
        verdict: 'supported',
        gold: 'x_p1',
        knownMiss: 'Two editions disagree; the verdict is supported by one edition and the app must show both. The verdict alone cannot express the conflict.',
      },
    ],
  },
  {
    id: 'h15',
    family: 'duplicate_reading',
    lang: 'en',
    split: 'heldout',
    passages: [
      { id: 'dup_p1', text: 'Frequent attendees averaged 84 on the final exam.' },
      { id: 'dup_p2', text: 'Frequent attendees averaged 84 on the final exam.' },
    ],
    text: 'Frequent attendees averaged 84 on the final exam.',
    expect: [{ claim: 'averaged 84', verdict: 'supported' }],
  },
  {
    id: 'h16',
    family: 'long_work',
    lang: 'en',
    split: 'heldout',
    passages: [
      { id: 'l_p1', text: 'The district opened four new libraries between 2015 and 2019.' },
      { id: 'l_p2', text: 'Circulation rose to 1.2 million items in 2019.' },
      { id: 'l_p3', text: 'Weekend hours were extended at nine branches in 2018.' },
      { id: 'l_p4', text: 'Volunteer tutors served 640 students in the first year.' },
      { id: 'l_p5', text: "The budget for children's programming was $310,000 in 2019." },
      { id: 'l_p6', text: 'Survey respondents rated the new branches 4.6 out of 5.' },
    ],
    text: "The district opened four new libraries between 2015 and 2019. Circulation rose to 1.2 million items in 2019. Weekend hours were extended at nine branches in 2018. Volunteer tutors served 640 students in the first year. The budget for children's programming was $310,000 in 2019. Survey respondents rated the new branches 4.6 out of 5.",
    expect: [
      { claim: 'four new libraries', verdict: 'supported', gold: 'l_p1' },
      { claim: '1.2 million', verdict: 'supported', gold: 'l_p2' },
      { claim: 'nine branches', verdict: 'supported', gold: 'l_p3' },
      { claim: '640 students', verdict: 'supported', gold: 'l_p4' },
      { claim: '$310,000', verdict: 'supported', gold: 'l_p5' },
      { claim: '4.6 out of 5', verdict: 'supported', gold: 'l_p6' },
    ],
  },
];

export const DRIFT: DriftPair[] = [
  // material drift (must be flagged)
  { id: 'm01', family: 'finance_memo', split: 'dev', orig: 'Margin rose from 42% to 48%.', cand: 'Margin was up 6%.', material: true },
  {
    id: 'm02',
    family: 'stats',
    split: 'dev',
    orig: 'The sample did not show a statistically significant increase.',
    cand: 'There was no increase.',
    material: true,
  },
  {
    id: 'm03',
    family: 'finance_memo',
    split: 'dev',
    orig: 'The filing projects savings after rollout.',
    cand: 'The program realized savings.',
    material: true,
  },
  {
    id: 'm04',
    family: 'finance_memo',
    split: 'dev',
    orig: 'Management expects the program to save about $3 million annually after full rollout.',
    cand: 'The program saves $3 million a year.',
    material: true,
  },
  { id: 'm05', family: 'short_argument', split: 'dev', orig: 'Attendance and scores were higher together.', cand: 'Attendance raised scores.', material: true },
  { id: 'm06', family: 'history_cited', split: 'dev', orig: 'Rates fell (Smith 2020).', cand: 'Rates fell.', material: true },
  { id: 'h_m01', family: 'finance_memo', split: 'heldout', orig: 'Revenue grew 12% to $48 million.', cand: 'Revenue grew 12% to $84 million.', material: true },
  {
    id: 'h_m02',
    family: 'short_argument',
    split: 'heldout',
    orig: 'Students did not improve after the program.',
    cand: 'Students improved after the program.',
    material: true,
  },
  { id: 'h_m03', family: 'history_cited', split: 'heldout', orig: 'The author argues that the law failed.', cand: 'The law failed.', material: true },
  {
    id: 'h_m04',
    family: 'history_cited',
    split: 'heldout',
    orig: 'She called the policy "a quiet failure" (Jones 12).',
    cand: 'She called the policy a silent failure (Jones 12).',
    material: true,
  },
  {
    id: 'h_m05',
    family: 'finance_memo',
    split: 'heldout',
    orig: 'Costs may fall by roughly 5% next year.',
    cand: 'Costs fall by 5% next year.',
    material: true,
  },
  {
    id: 'h_m06',
    family: 'short_argument',
    split: 'heldout',
    orig: 'Attendance was linked to higher scores when students chose to attend.',
    cand: 'Attendance was linked to higher scores.',
    material: true,
  },
  {
    id: 'h_m07',
    family: 'short_argument',
    split: 'heldout',
    orig: 'Scores rose by two points among the volunteers.',
    cand: 'Scores rose among the volunteers.',
    material: true,
    knownMiss: 'Spelled-out numbers ("two") are not extracted, so the dropped figure is missed. Digits only.',
  },
  { id: 'h_m08', family: 'spanish_intro', split: 'heldout', orig: 'Mi abuela me enseñó a leer.', cand: 'Mi abuela me enseno a leer.', material: true },
  // clean edits (must not be flagged)
  {
    id: 'c01',
    family: 'finance_memo',
    split: 'dev',
    orig: 'Management expects the program to save about $3 million annually after full rollout.',
    cand: 'Management expects annual savings of about $3 million once the program is fully in place.',
    material: false,
  },
  { id: 'c02', family: 'style', split: 'dev', orig: 'Moreover, the results were good.', cand: 'The results were good.', material: false },
  { id: 'c03', family: 'style', split: 'dev', orig: 'We utilize data in order to learn.', cand: 'We use data to learn.', material: false },
  {
    id: 'c04',
    family: 'short_argument',
    split: 'dev',
    orig: 'The policy raised attendance.',
    cand: 'Attendance rose after the policy began.',
    material: false,
  },
  {
    id: 'h_c01',
    family: 'finance_memo',
    split: 'heldout',
    orig: 'Revenue grew 12% year over year to $48 million.',
    cand: 'Year over year, revenue grew 12% to $48 million.',
    material: false,
  },
  {
    id: 'h_c02',
    family: 'history_cited',
    split: 'heldout',
    orig: 'Parliament passed the Corn Laws in 1815 (Jones 12).',
    cand: 'In 1815 Parliament passed the Corn Laws (Jones 12).',
    material: false,
  },
  {
    id: 'h_c03',
    family: 'short_argument',
    split: 'heldout',
    orig: 'It is important to note that attendance varied widely among students.',
    cand: 'Attendance varied widely among students.',
    material: false,
  },
  {
    id: 'h_c04',
    family: 'style',
    split: 'heldout',
    orig: 'Due to the fact that scores fell, the college acted.',
    cand: 'Because scores fell, the college acted.',
    material: false,
  },
  {
    id: 'h_c05',
    family: 'spanish_intro',
    split: 'heldout',
    orig: 'La educación es importante para mi familia.',
    cand: 'La educación es importante para mi familia.',
    material: false,
  },
  { id: 'h_c06', family: 'hebrew', split: 'heldout', orig: 'שלום עולם, זה טקסט לדוגמה.', cand: 'שלום עולם, זה טקסט לדוגמה.', material: false },
  {
    id: 'h_c07',
    family: 'finance_memo',
    split: 'heldout',
    orig: 'Operating costs were $2.4 million in 2022.',
    cand: 'In 2022, operating costs were $2.4 million.',
    material: false,
  },
];
