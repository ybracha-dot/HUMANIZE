// Word lists for the rough draft. Each pair is written original > draft: the
// draft side is what gets typed first, and the revision pass turns it back into
// the original. Flags after ":" block a swap in contexts where it would read
// as nonsense instead of as a believable first-draft choice.
//   np    skip when used as a noun (after a/the/many/...)
//   nt    skip before "that"        nf   skip before "from"
//   nof   skip before "of"          nto  skip before "to"
//   nwith skip before "with"        nart skip after "a"/"an"
//   pass  skip after a form of "be" (passive voice)
//   ndet  skip before a determiner (word is acting as a verb)
//   nprep skip before after/before/upon/... ("right away after" reads badly)
//   nmore skip before more/less/... ("greatly more")
//   noun  skip after to/will/can/... (word is acting as a verb)

export const DETERMINERS = new Set([
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our',
  'their', 'each', 'every', 'some', 'any', 'no', 'another', 'one', 'several', 'many', 'few',
  'various', 'numerous', 'multiple', 'two', 'three', 'four', 'five', 'both', 'all', 'such',
  'whose', 'which', 'what', 'most', 'more', 'other',
]);
export const BE = new Set(['be', 'is', 'are', 'was', 'were', 'been', 'being', 'am']);
export const HAVE = new Set(['have', 'has', 'had', 'having']);
export const MODALS = new Set(['will', 'would', 'can', 'could', 'should', 'must', 'may', 'might', 'shall']);
export const PRONOUNS = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they']);
const PREPS_AFTER = new Set(['after', 'before', 'following', 'upon', 'when', 'as', 'on', 'in', 'at', 'once']);
const COMPARATIVES = new Set(['more', 'less', 'fewer', 'higher', 'lower', 'better', 'worse', 'larger', 'smaller', 'greater', 'faster', 'slower']);

const VERBS = `
demonstrate>show
illustrate>show
indicate>show
reveal>show
depict>show
portray>show
exhibit>show:np
highlight>show:np
utilize>use
utilise>use
obtain>get
acquire>get
receive>get
purchase>buy:np
require>need
possess>have
assist>help
facilitate>help
enable>help
examine>look at
analyze>look at
analyse>look at
evaluate>look at
assess>look at
investigate>look into
explore>look into
observe>see
perceive>see
comprehend>understand
believe>think
inquire>ask
reside>live
commence>start
initiate>start
begin>start
terminate>end
attempt>try:np
endeavor>try:np
ensure>make sure
eliminate>get rid of
remove>get rid of:nf
establish>set up:nt
construct>build
create>make
produce>make
generate>make
enhance>improve
contain>have:pass
discover>find
determine>figure out:pass
encounter>run into:np
select>pick
choose>pick
assert>say
claim>say:np
state>say:np
inform>tell
seek>look for
desire>want:np
persuade>convince
acknowledge>admit
transform>change
modify>change
alter>change
emphasize>stress
emphasise>stress
prohibit>ban
`;

const ADJECTIVES = `
significant>big
substantial>big
considerable>big
enormous>huge
immense>huge
massive>huge
vast>huge
tremendous>huge
various>different
diverse>different
distinct>different
difficult>hard
challenging>hard:ndet
arduous>hard
complex>complicated
intricate>complicated
essential>really important
crucial>really important
vital>really important
critical>really important:nof
fundamental>basic
primary>main
beneficial>good
advantageous>good
favorable>good
favourable>good
excellent>great
outstanding>great
superb>great
exceptional>really good
remarkable>amazing
extraordinary>amazing
detrimental>bad
adverse>bad
severe>bad
inadequate>not good enough:nart
sufficient>enough:nart
adequate>good enough
additional>more:nart
evident>clear
apparent>clear
obvious>clear
accurate>correct
precise>exact
appropriate>right
suitable>right
entire>whole
rapid>fast
swift>fast
minor>small
minimal>small
negligible>tiny
prevalent>common
widespread>common
elderly>old
intelligent>smart
wealthy>rich
affluent>rich
impoverished>poor
fortunate>lucky
incorrect>wrong
inaccurate>wrong
erroneous>wrong
valuable>useful
effective>good
ultimate>final
initial>first
subsequent>later:nto
previous>earlier
contemporary>modern
profound>deep
intense>strong
vibrant>lively
tranquil>calm
serene>calm
meticulous>careful
diligent>hard-working
eager>excited
anxious>nervous
furious>really angry
delighted>really happy:ndet
exhausted>really tired:ndet
terrified>really scared:ndet
astonished>really surprised:ndet
pivotal>key
integral>key
comprehensive>complete
consistent>steady:nwith
notable>important
noteworthy>interesting
fascinating>interesting
intriguing>interesting
peculiar>weird
bizarre>weird
unusual>strange
genuine>real
authentic>real
`;

const NOUNS = `
individuals>people
children>kids
assistance>help
utilization>use
methodology>method
methodologies>methods
residence>home
residences>homes
occupation>job
occupations>jobs
aspect>part
aspects>parts
component>part
components>parts
portion>part
portions>parts
concept>idea
concepts>ideas
notion>idea
notions>ideas
perspective>view
perspectives>views
viewpoint>view
viewpoints>views
outcome>result
outcomes>results
consequence>result
consequences>results
vehicle>car
vehicles>cars
automobile>car
automobiles>cars
beverage>drink
beverages>drinks
dwelling>house
dwellings>houses
physician>doctor
physicians>doctors
difficulty>problem
difficulties>problems
issue>problem:noun
issues>problems:noun
manner>way
`;

const ADVERBS = `
approximately>about
frequently>often
occasionally>sometimes
currently>now
initially>at first
eventually>in the end
immediately>right away:nprep
rapidly>quickly
extremely>really
highly>really
particularly>especially
significantly>greatly:nmore
substantially>greatly:nmore
considerably>much
primarily>mostly
mainly>mostly
largely>mostly
predominantly>mostly
entirely>completely
completely>totally
absolutely>totally
perhaps>maybe
possibly>maybe
certainly>definitely
undoubtedly>definitely
truly>really
genuinely>really
merely>just
simply>just
solely>only
nearly>almost
virtually>almost
typically>usually
generally>usually
subsequently>later
ultimately>in the end
`;

// Multi-word swaps, matched anywhere (case-insensitive).
export const PHRASES = [
  ['the majority of', 'most of'],
  ['a large number of', 'a lot of'],
  ['a great deal of', 'a lot of'],
  ['a significant amount of', 'a lot of'],
  ['a substantial amount of', 'a lot of'],
  ['a significant number of', 'a lot of'],
  ['a number of', 'some'],
  ['due to the fact that', 'because'],
  ['prior to', 'before'],
  ['subsequent to', 'after'],
  ['in addition to', 'along with'],
  ['as well as', 'and'],
  ['such as', 'like'],
  ['with regard to', 'about'],
  ['with respect to', 'about'],
  ['in regard to', 'about'],
  ['regarding', 'about'],
  ['in the event that', 'if'],
  ['at the present time', 'now'],
  ['at this point in time', 'now'],
  ['in spite of', 'despite'],
  ['in the near future', 'soon'],
  ['on a daily basis', 'every day'],
  ['for the purpose of', 'for'],
  ['is able to', 'can'],
  ['are able to', 'can'],
  ['was able to', 'could'],
  ['were able to', 'could'],
  ['has the ability to', 'can'],
  ['have the ability to', 'can'],
  ['a variety of', 'different'],
  ['in order to', 'to'],
];

// Sentence openers (with their comma) and a plainer first-draft version.
export const CONNECTIVES = [
  ['However,', 'But'],
  ['Nevertheless,', 'Still,'],
  ['Nonetheless,', 'Still,'],
  ['Therefore,', 'So'],
  ['Thus,', 'So'],
  ['Hence,', 'So'],
  ['Consequently,', 'So'],
  ['As a result,', 'So'],
  ['Moreover,', 'Also,'],
  ['Furthermore,', 'Also,'],
  ['Additionally,', 'Also,'],
  ['In addition,', 'Also,'],
  ['Similarly,', 'Also,'],
  ['Likewise,', 'Also,'],
  ['In conclusion,', 'Overall,'],
  ['In summary,', 'Overall,'],
  ['To summarize,', 'Overall,'],
  ['Ultimately,', 'In the end,'],
  ['Initially,', 'At first,'],
  ['Currently,', 'Right now,'],
  ['Subsequently,', 'After that,'],
  ['On the other hand,', 'But'],
  ['In contrast,', 'But'],
  ['Conversely,', 'But'],
];

// Original word > a wordier first-draft version.
export const WORDY = new Map([
  ['because', { draft: 'due to the fact that', flags: new Set(['nof']) }],
  ['although', { draft: 'even though', flags: new Set() }],
  ['many', { draft: 'a lot of', flags: new Set(['quant']) }],
  ['numerous', { draft: 'a lot of', flags: new Set(['quant']) }],
]);

export const HOMOPHONES = new Map(Object.entries({
  "its": "it's", "it's": 'its',
  their: 'there', there: 'their', "they're": 'their',
  your: "you're", "you're": 'your',
  then: 'than', than: 'then',
  affect: 'effect', effect: 'affect', affects: 'effects', effects: 'affects',
  lose: 'loose', loose: 'lose',
  whose: "who's", "who's": 'whose',
  too: 'to',
  weather: 'whether', whether: 'weather',
  quite: 'quiet',
  led: 'lead',
  were: "we're",
  where: 'were',
  principle: 'principal',
  accept: 'except',
  advice: 'advise',
  breath: 'breathe',
}));

export const AGREEMENT = new Map(Object.entries({
  is: 'are', are: 'is', was: 'were', were: 'was', has: 'have', have: 'has', does: 'do', do: 'does',
  "doesn't": "don't", "don't": "doesn't", "isn't": "aren't", "aren't": "isn't",
  "wasn't": "weren't", "weren't": "wasn't",
}));

export const DROPPABLE = new Set(['the', 'a', 'to', 'of', 'that', 'is', 'it', 'in', 'for', 'and', 'with', 'on', 'be', 'have']);
export const DOUBLABLE = new Set(['the', 'a', 'to', 'of', 'and', 'in', 'is', 'that', 'it', 'for']);
export const PLURAL_QUANTIFIERS = new Set([
  'many', 'several', 'few', 'these', 'those', 'various', 'numerous', 'multiple', 'two', 'three',
  'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'both', 'all',
]);
export const PREPOSITION_SWAPS = new Map(Object.entries({
  in: { to: 'on' },
  on: { to: 'in' },
  at: { to: 'in' },
  for: { to: 'to', needDet: true },
  to: { to: 'for', needDet: true },
}));

// Adjectives that can take "really"/"very" in front of them.
export const GRADABLE = new Set(`
good bad important clear different hard easy interesting big small strong simple common useful
necessary likely true real obvious successful popular serious huge helpful difficult complex
effective significant large high low long short old fast slow powerful beautiful dangerous
expensive cheap unique rare famous happy sad angry tired excited nervous proud sure aware
confident careful surprising impressive strange unusual valuable meaningful relevant accurate
consistent limited complicated crucial impactful influential harmful beneficial challenging
complex frustrating exciting stressful rewarding memorable personal emotional difficult close
deep different similar hard-working smart rich poor lucky amazing great
`.trim().split(/\s+/));

export const INTENSIFIERS = [['really', 3], ['very', 3], ['pretty', 1], ['quite', 1], ['super', 0.4]];
// "so" and "kind of" only read naturally after a linking verb ("it was so hard").
export const LINKING_INTENSIFIERS = [...INTENSIFIERS, ['so', 0.8], ['kind of', 0.6]];
export const LINKING_VERBS = new Set(['be', 'is', 'are', 'was', 'were', 'been', 'being', 'am', 'seems', 'seemed', 'seem', 'felt', 'feel', 'feels', 'look', 'looks', 'looked', 'sounds', 'sounded', 'got', 'get', 'gets', 'became', 'become', 'becomes']);
// Extreme adjectives take "really"/"so", not "very" ("very huge").
export const EXTREME = new Set(['huge', 'amazing', 'great', 'enormous', 'terrible', 'awful', 'perfect', 'unique', 'essential', 'crucial', 'massive', 'tremendous', 'vast']);
export const NO_FILLER_AFTER = new Set([
  'very', 'really', 'so', 'too', 'quite', 'pretty', 'extremely', 'more', 'most', 'less', 'least',
  'as', 'how', 'super', 'fairly', 'rather', 'incredibly', 'highly', 'truly', 'not', 'somewhat',
  'kind', 'sort', 'especially', 'particularly', 'remarkably', 'increasingly',
]);
export const FILLER_VERBS = new Set(['think', 'believe', 'want', 'need', 'like', 'love', 'hate', 'enjoy', 'understand', 'hope', 'feel', 'wanted', 'needed', 'loved', 'hated', 'enjoyed', 'hoped', 'felt', 'believed', 'thought', 'understood', 'liked']);
export const FILLER_VERB_SUBJECTS = new Set(['i', 'we', 'they', 'you', 'he', 'she', 'to', 'also', 'people']);

export const THAT_VERBS = new Set(`
said says say think thinks thought believe believes believed know knows knew realize realized
realise realised feel feels felt argue argues argued claim claims claimed suggest suggests
suggested show shows showed shown found find finds mean means meant hope hopes hoped noticed
notice notices learned learnt decided agreed admitted explained assumed assume assumes guess
guessed discovered proved proves prove demonstrates demonstrated indicates indicated reveals
revealed
`.trim().split(/\s+/));
export const THAT_NEXT = new Set(`
the a an this these those it they we he she i there many most some people students our their
his her my your its everyone nobody all each every one
`.trim().split(/\s+/));

export const SPLICE_STARTERS = new Set(`
the this that these those it its they their there we our he his she her many some most people
however but so also then still now yet one each every all both another other such in on at for
with as after before when while if because although though since unlike despite overall today
later soon maybe perhaps sometimes often usually even only just instead otherwise meanwhile
eventually finally first second third next lastly what this
`.trim().split(/\s+/));
export const FRAGMENT_WORDS = new Set(['which', 'because', 'although', 'while', 'especially', 'including', 'whereas', 'unless', 'since']);
export const REORDER_OPENERS = new Set(`
because although though while when if since after before unless once as whenever whereas
in on at during for with throughout over by despite unlike without within across under among
until through
`.trim().split(/\s+/));

// ---------------------------------------------------------------------------
// Verb inflection

const IRREGULAR = {
  begin: ['begin', 'begins', 'began', 'begun', 'beginning'],
  choose: ['choose', 'chooses', 'chose', 'chosen', 'choosing'],
  seek: ['seek', 'seeks', 'sought', 'sought', 'seeking'],
  show: ['show', 'shows', 'showed', 'shown', 'showing'],
  get: ['get', 'gets', 'got', 'gotten', 'getting'],
  buy: ['buy', 'buys', 'bought', 'bought', 'buying'],
  have: ['have', 'has', 'had', 'had', 'having'],
  see: ['see', 'sees', 'saw', 'seen', 'seeing'],
  think: ['think', 'thinks', 'thought', 'thought', 'thinking'],
  make: ['make', 'makes', 'made', 'made', 'making'],
  find: ['find', 'finds', 'found', 'found', 'finding'],
  build: ['build', 'builds', 'built', 'built', 'building'],
  set: ['set', 'sets', 'set', 'set', 'setting'],
  run: ['run', 'runs', 'ran', 'run', 'running'],
  say: ['say', 'says', 'said', 'said', 'saying'],
  tell: ['tell', 'tells', 'told', 'told', 'telling'],
  understand: ['understand', 'understands', 'understood', 'understood', 'understanding'],
  ban: ['ban', 'bans', 'banned', 'banned', 'banning'],
  admit: ['admit', 'admits', 'admitted', 'admitted', 'admitting'],
};

function inflect(base) {
  if (IRREGULAR[base]) return IRREGULAR[base];
  let s;
  let ed;
  let ing;
  if (/[^aeiou]y$/.test(base)) {
    s = `${base.slice(0, -1)}ies`;
    ed = `${base.slice(0, -1)}ied`;
    ing = `${base}ing`;
  } else if (/(s|x|z|ch|sh)$/.test(base)) {
    s = `${base}es`;
    ed = `${base}ed`;
    ing = `${base}ing`;
  } else if (/e$/.test(base)) {
    s = `${base}s`;
    ed = `${base}d`;
    ing = /(ee|ye|oe)$/.test(base) ? `${base}ing` : `${base.slice(0, -1)}ing`;
  } else {
    s = `${base}s`;
    ed = `${base}ed`;
    ing = `${base}ing`;
  }
  return [base, s, ed, ed, ing];
}

function inflectPhrase(phrase) {
  const [head, ...rest] = phrase.split(' ');
  const tail = rest.length ? ` ${rest.join(' ')}` : '';
  return inflect(head).map((f) => f + tail);
}

function parsePairs(block) {
  return block.trim().split('\n').map((line) => {
    const [pair, flagStr = ''] = line.split(':');
    const [o, d] = pair.split('>');
    return { o: o.trim(), d: d.trim(), flags: new Set(flagStr.split(',').map((f) => f.trim()).filter(Boolean)) };
  });
}

// word (lowercase) -> list of entries
export const WORD_SWAPS = new Map();
function addSwap(word, entry) {
  if (!WORD_SWAPS.has(word)) WORD_SWAPS.set(word, []);
  WORD_SWAPS.get(word).push(entry);
}

for (const { o, d, flags } of parsePairs(VERBS)) {
  const of = inflect(o);
  const df = inflectPhrase(d);
  const nounish = new Set([...flags, 'np']);
  addSwap(of[0], { kind: 'verb', draft: df[0], flags });
  addSwap(of[1], { kind: 'verb', draft: df[1], flags: nounish });
  if (of[2] === of[3]) {
    addSwap(of[2], { kind: 'verb', past: df[2], pp: df[3], flags: nounish });
  } else {
    addSwap(of[2], { kind: 'verb', draft: df[2], flags: nounish });
    addSwap(of[3], { kind: 'verb', draft: df[3], flags: nounish });
  }
  addSwap(of[4], { kind: 'verb', draft: df[4], flags: nounish });
}
for (const [block, kind] of [[ADJECTIVES, 'adj'], [NOUNS, 'noun'], [ADVERBS, 'adv']]) {
  for (const { o, d, flags } of parsePairs(block)) addSwap(o, { kind, draft: d, flags });
}

// For "second thoughts" while typing: a word the writer might start with
// before settling on the one in the text.
const ALTERNATIVES = new Map();
for (const [word, entries] of WORD_SWAPS) {
  for (const e of entries) {
    const alt = e.draft || e.past;
    if (alt && !alt.includes(' ')) {
      if (!ALTERNATIVES.has(word)) ALTERNATIVES.set(word, alt);
      if (!ALTERNATIVES.has(alt)) ALTERNATIVES.set(alt, word);
    }
  }
}
export function alternativeFor(lw) {
  return ALTERNATIVES.get(lw) || null;
}

export function checkFlags(flags, ctx) {
  const { prev, next, nextGap } = ctx;
  for (const f of flags) {
    if (f === 'np' && prev && DETERMINERS.has(prev.lw)) return false;
    if (f === 'nt' && next?.lw === 'that') return false;
    if (f === 'nf' && next?.lw === 'from') return false;
    if (f === 'nof' && next?.lw === 'of') return false;
    if (f === 'nto' && next?.lw === 'to') return false;
    if (f === 'nwith' && next?.lw === 'with') return false;
    if (f === 'nart' && prev && (prev.lw === 'a' || prev.lw === 'an')) return false;
    if (f === 'pass' && prev && BE.has(prev.lw)) return false;
    if (f === 'ndet' && next && DETERMINERS.has(next.lw)) return false;
    if (f === 'nprep' && next && PREPS_AFTER.has(next.lw)) return false;
    if (f === 'nmore' && next && COMPARATIVES.has(next.lw)) return false;
    if (f === 'noun' && prev && (prev.lw === 'to' || MODALS.has(prev.lw) || PRONOUNS.has(prev.lw))) return false;
    if (f === 'quant') {
      if (!next || nextGap !== ' ' || next.lw === 'of') return false;
      if (prev && (['so', 'too', 'how', 'as', 'very', 'the', 'these', 'those', 'his', 'her', 'their', 'my', 'our', 'your'].includes(prev.lw))) return false;
    }
  }
  return true;
}
