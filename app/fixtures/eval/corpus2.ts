// Second-pass evaluation data. Grouped by SOURCE DOCUMENT: every claim about a document is in the same split as that document.
// 'dev2' documents may be used to revise rules. 'unseen' documents were written BEFORE the revised rules and are run once, never tuned on.
// All text is original and synthetic. Labels: supported | partial | contradicted | insufficient (insufficient = the passages do not establish it).
import type { Verdict } from '../../shared/evidence.ts';

export interface Claim2 {
  text: string;
  expected: Verdict;
  tag: string;
  gold?: string;
  note?: string;
}
export interface Doc2 {
  docId: string;
  title: string;
  lang: string;
  split: 'dev2' | 'unseen';
  passages: { id: string; text: string }[];
  claims: Claim2[];
}

export const DOCS2: Doc2[] = [
  // ------------------------------------------------ development (may be used to revise rules)
  {
    docId: 'D1',
    title: 'Committee minutes',
    lang: 'en',
    split: 'dev2',
    passages: [{ id: 'D1_p1', text: 'The committee approved the budget, though it did not approve the travel fund.' }],
    claims: [
      { text: 'The committee approved the budget.', expected: 'supported', tag: 'negation_scope', gold: 'D1_p1' },
      { text: 'The committee approved the travel fund.', expected: 'contradicted', tag: 'plain', gold: 'D1_p1' },
    ],
  },
  {
    docId: 'D2',
    title: 'Scanned enrollment table',
    lang: 'en',
    split: 'dev2',
    passages: [{ id: 'D2_p1', text: 'Enrollment was 1O5 students in 2020; staff numbered 40.' }],
    claims: [
      {
        text: 'Enrollment was 105 students in 2020.',
        expected: 'insufficient',
        tag: 'ocr_digit',
        gold: 'D2_p1',
        note: 'OCR letter O inside a number: the source is not reliably readable.',
      },
      { text: 'Staff numbered 40.', expected: 'supported', tag: 'plain', gold: 'D2_p1' },
    ],
  },
  {
    docId: 'D3',
    title: 'Informe de matrícula',
    lang: 'es',
    split: 'dev2',
    passages: [{ id: 'D3_p1', text: 'La matrícula fue de 320 estudiantes en 2021.' }],
    claims: [
      {
        text: 'Enrollment was 320 students in 2021.',
        expected: 'supported',
        tag: 'cross_language',
        gold: 'D3_p1',
        note: 'Translated claim; a lexical checker cannot read the Spanish wording.',
      },
      { text: 'Enrollment was 400 students in 2021.', expected: 'contradicted', tag: 'cross_language', gold: 'D3_p1' },
    ],
  },
  {
    docId: 'D4',
    title: 'Analyst note',
    lang: 'en',
    split: 'dev2',
    passages: [{ id: 'D4_p1', text: 'Sales rose 4%, but analysts say the trend is not sustainable.' }],
    claims: [
      { text: 'Sales rose 4%.', expected: 'supported', tag: 'negation_scope', gold: 'D4_p1' },
      { text: 'The trend is sustainable.', expected: 'contradicted', tag: 'plain', gold: 'D4_p1' },
    ],
  },
  {
    docId: 'D5',
    title: 'Agency outlook',
    lang: 'en',
    split: 'dev2',
    passages: [{ id: 'D5_p1', text: 'The agency forecasts that emissions will fall 12% by 2030.' }],
    claims: [{ text: 'Emissions fell 12% by 2030.', expected: 'partial', tag: 'projection', gold: 'D5_p1' }],
  },

  // ------------------------------------------------ unseen evaluation split
  {
    docId: 'U1',
    title: 'Walking program pilot',
    lang: 'en',
    split: 'unseen',
    passages: [
      {
        id: 'U1_p1',
        text: 'In the pilot, 214 adults joined a twelve-week walking program. Participants walked an average of 7,400 steps per day, up from 5,100 at enrollment.',
      },
      {
        id: 'U1_p2',
        text: 'Resting heart rate fell by 3 beats per minute on average, but the change was not statistically significant. The study had no comparison group.',
      },
      { id: 'U1_p3', text: 'Retention was 81% at twelve weeks.' },
    ],
    claims: [
      { text: '214 adults joined the walking program.', expected: 'supported', tag: 'plain', gold: 'U1_p1' },
      { text: 'Participants averaged 7,400 steps per day.', expected: 'supported', tag: 'plain', gold: 'U1_p1' },
      { text: "The walking program lowered participants' resting heart rate.", expected: 'partial', tag: 'causal', gold: 'U1_p2' },
      { text: 'Resting heart rate fell by 3 beats per minute.', expected: 'partial', tag: 'qualifier_negation_scope', gold: 'U1_p2' },
      { text: 'Retention was 85% at twelve weeks.', expected: 'contradicted', tag: 'plain', gold: 'U1_p3' },
      { text: 'The pilot included a comparison group.', expected: 'contradicted', tag: 'plain', gold: 'U1_p2' },
    ],
  },
  {
    docId: 'U2',
    title: 'Informe sobre bibliotecas',
    lang: 'es',
    split: 'unseen',
    passages: [
      { id: 'U2_p1', text: 'En 2019 la ciudad abrió cuatro bibliotecas nuevas en barrios periféricos.' },
      { id: 'U2_p2', text: 'El préstamo de libros aumentó un 18% entre 2018 y 2019, aunque no se observó un aumento en la asistencia a talleres.' },
      { id: 'U2_p3', text: 'El presupuesto anual fue de 2,5 millones de euros.' },
    ],
    claims: [
      { text: 'La ciudad abrió cuatro bibliotecas nuevas en 2019.', expected: 'supported', tag: 'plain', gold: 'U2_p1' },
      { text: 'El préstamo de libros aumentó un 18%.', expected: 'supported', tag: 'negation_scope', gold: 'U2_p2' },
      { text: 'La asistencia a talleres aumentó.', expected: 'contradicted', tag: 'spanish_negation', gold: 'U2_p2' },
      { text: 'El presupuesto anual fue de 3,5 millones de euros.', expected: 'contradicted', tag: 'plain', gold: 'U2_p3' },
    ],
  },
  {
    docId: 'U3',
    title: 'סקר סטודנטים',
    lang: 'he',
    split: 'unseen',
    passages: [
      { id: 'U3_p1', text: 'בסקר השתתפו 180 סטודנטים.' },
      { id: 'U3_p2', text: 'ממוצע הציונים של המשתתפים הקבועים היה 84 לעומת 77 אצל האחרים. הסטודנטים בחרו בעצמם אם להגיע.' },
    ],
    claims: [
      { text: 'בסקר השתתפו 180 סטודנטים.', expected: 'supported', tag: 'plain', gold: 'U3_p1' },
      { text: 'ממוצע הציונים של המשתתפים הקבועים היה 90.', expected: 'contradicted', tag: 'plain', gold: 'U3_p2' },
      { text: 'ההשתתפות הקבועה גרמה לעלייה בציונים.', expected: 'partial', tag: 'hebrew_causal', gold: 'U3_p2' },
    ],
  },
  {
    docId: 'U4',
    title: 'Scanned labour-history chapter',
    lang: 'en',
    split: 'unseen',
    passages: [
      { id: 'U4_p1', text: 'Tbe Factory Act of 1847 limitecl women and young persons to ten hours of work per day.' },
      { id: 'U4_p2', text: 'By 1851, aboLit 1.8 million workers were employed in cotton mills (Smith 31).' },
    ],
    claims: [
      { text: 'The Factory Act of 1847 limited women and young persons to ten hours of work per day.', expected: 'supported', tag: 'ocr_word', gold: 'U4_p1' },
      { text: 'By 1851, about 1.8 million workers were employed in cotton mills (Smith 31).', expected: 'supported', tag: 'ocr_word', gold: 'U4_p2' },
      { text: 'By 1851, about 2.8 million workers were employed in cotton mills (Smith 31).', expected: 'contradicted', tag: 'plain', gold: 'U4_p2' },
    ],
  },
  {
    docId: 'U5',
    title: 'Annual report excerpt',
    lang: 'en',
    split: 'unseen',
    passages: [
      { id: 'U5_p1', text: 'Net sales increased 9% to $120 million, reflecting higher volumes.' },
      { id: 'U5_p2', text: 'Management expects capital expenditures of approximately $15 million in fiscal 2025, subject to board approval.' },
      { id: 'U5_p3', text: 'Gross margin was 38.1% compared with 36.4% in the prior year.' },
    ],
    claims: [
      { text: 'Net sales increased 9% to $120 million.', expected: 'supported', tag: 'plain', gold: 'U5_p1' },
      { text: 'Capital expenditures will be $15 million in fiscal 2025.', expected: 'partial', tag: 'projection', gold: 'U5_p2' },
      { text: 'Gross margin improved by 1.7 percentage points.', expected: 'supported', tag: 'derived_pct', gold: 'U5_p3' },
      { text: 'Gross margin improved 1.7%.', expected: 'partial', tag: 'derived_pct', gold: 'U5_p3' },
      { text: 'Net sales increased because of higher prices.', expected: 'insufficient', tag: 'unsupported_cause', gold: 'U5_p1' },
    ],
  },
  {
    docId: 'U6',
    title: 'Reading program trial',
    lang: 'en',
    split: 'unseen',
    passages: [
      { id: 'U6_p1', text: 'Schools were randomly assigned to adopt the reading program or continue current practice.' },
      { id: 'U6_p2', text: 'After one year, program schools gained 0.21 standard deviations more in reading than comparison schools.' },
    ],
    claims: [
      { text: 'The reading program raised reading scores by 0.21 standard deviations.', expected: 'supported', tag: 'causal_randomized', gold: 'U6_p2' },
      { text: 'Reading scores rose 0.12 standard deviations.', expected: 'contradicted', tag: 'plain', gold: 'U6_p2' },
      { text: 'The program improved math scores.', expected: 'insufficient', tag: 'unrelated', gold: undefined },
    ],
  },
  {
    docId: 'U7',
    title: 'Commuting and class-size notes',
    lang: 'en',
    split: 'unseen',
    passages: [
      { id: 'U7_p1', text: 'Commuters who cycle to work reported lower stress than those who drive.' },
      { id: 'U7_p2', text: 'Pupils in smaller classes scored higher in the end-of-year test.' },
    ],
    claims: [
      { text: 'Cyclists felt less stressed than drivers.', expected: 'supported', tag: 'paraphrase', gold: 'U7_p1' },
      { text: 'Students in small classes performed better on the final exam.', expected: 'supported', tag: 'paraphrase', gold: 'U7_p2' },
      { text: 'Drivers reported lower stress than cyclists.', expected: 'contradicted', tag: 'direction', gold: 'U7_p1' },
    ],
  },
  {
    docId: 'U8',
    title: 'Encuesta de hogares',
    lang: 'es',
    split: 'unseen',
    passages: [{ id: 'U8_p1', text: 'El 45% de los hogares encuestados tenía acceso a internet de banda ancha.' }],
    claims: [
      { text: '45% of surveyed households had broadband internet access.', expected: 'supported', tag: 'cross_language', gold: 'U8_p1' },
      { text: '60% of surveyed households had broadband internet access.', expected: 'contradicted', tag: 'cross_language', gold: 'U8_p1' },
    ],
  },
];
