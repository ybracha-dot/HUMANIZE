// Regenerates fixtures/sample/reading-attendance.pdf deterministically. Page 2 carries the 90-second demo evidence.
import fs from 'node:fs';
import { makePdf, wrap } from '../server/pdfgen.ts';

const pages = [
  {
    heading: 'Attendance and Achievement: A Survey of 180 Students',
    lines: wrap(
      'This report summarizes a one-semester survey of students in an introductory policy course. The survey asked how often students attended class and collected final exam scores from the registrar. It was designed to describe patterns in attendance and achievement, not to test an intervention.',
    ),
  },
  {
    lines: wrap(
      'Of the 180 students surveyed, frequent attendees averaged 84 on the final exam. Less frequent attendees averaged 77. Students chose whether to attend.\n\nThe survey did not assign students to groups, and it did not record prior grades.',
    ),
  },
  {
    lines: wrap(
      'Sixty-two percent of respondents said they attended most classes. Students who worked more than twenty hours a week were less likely to attend regularly. The authors note that attendance may be related to motivation, work schedules and course difficulty.',
    ),
  },
];
const bytes = await makePdf(pages, {
  title: 'Attendance and Achievement (sample reading, synthetic)',
  labels: [{ startIndex: 0, style: 'D', start: 13 }],
});
fs.writeFileSync(new URL('../fixtures/sample/reading-attendance.pdf', import.meta.url), bytes);
console.log('wrote reading-attendance.pdf', bytes.length, 'bytes');

// Second, different reading used by the fresh-assignment run (different domain; printed labels are roman numerals v-vii).
const canopy = [
  {
    heading: 'Street Trees and Afternoon Heat: A Neighborhood Comparison',
    lines: wrap(
      'A survey of surface temperatures in 40 city neighborhoods compared city blocks by tree canopy cover on July afternoons. Temperatures were taken from satellite imagery on clear days.',
    ),
  },
  {
    lines: wrap(
      'Blocks with 30% or more canopy averaged 2.1 degrees C cooler afternoon surface temperatures than blocks with under 10% canopy. Trees had been planted unevenly: neighborhoods with higher incomes already had more canopy and more parks, and canopy was not assigned at random.',
    ),
  },
  {
    lines: wrap(
      'The authors note that pavement share, building height and distance to water also differed between neighborhoods. A planting program began in 2021 and no post-planting measurements were taken.',
    ),
  },
];
const cb = await makePdf(canopy, { title: 'Street Trees and Afternoon Heat (synthetic reading)', labels: [{ startIndex: 0, style: 'r', start: 5 }] });
fs.writeFileSync(new URL('../fixtures/fresh/reading-canopy.pdf', import.meta.url), cb);
console.log('wrote reading-canopy.pdf', cb.length, 'bytes');
