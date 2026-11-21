// Sample texts used by the tests. Mixed on purpose: essays, narrative, quotes,
// numbers, abbreviations, curly apostrophes, accents, emoji, odd spacing.

export const ESSAY = `The Industrial Revolution was a significant turning point in human history. Although it began in Britain, it quickly spread to the rest of Europe and North America. Factories produced goods at a rapid pace, and many workers moved from farms to cities in order to find employment. However, the conditions in these factories were often difficult and dangerous.

Historians have examined numerous sources to understand the consequences of this shift. The majority of evidence indicates that wages rose slowly, while working hours remained extremely long. Children, in particular, were expected to work in conditions that we would now consider unacceptable. Because there were few laws to protect them, employers could demand almost anything.

In conclusion, the Industrial Revolution demonstrates how technological change can transform a society. It created enormous wealth, but it also generated new problems that governments had to address. Understanding this period is essential for anyone who wants to comprehend the modern economy.`;

export const NARRATIVE = `When I first moved to Providence, I didn't know anyone. The city felt huge, and every street looked the same to me. My roommate, who was from Ohio, seemed just as lost as I was.

During the first week, we walked everywhere together. We found a small café near Thayer Street that sold the best iced coffee I'd ever had. It wasn't fancy, but it became our spot. By October, the baristas knew our orders by heart.

Looking back, those early weeks taught me something important: you don't need a plan to find your people. You just need to show up, again and again, until the strange becomes familiar.`;

export const TECHNICAL = `To install the package, run npm install --save autotype@1.2.3 in your terminal. The CLI requires Node.js 18 or later; earlier versions aren't supported. If you're on Windows, use PowerShell (not cmd.exe) to avoid path issues.

The function returns an object with three fields: id, status, and payload. Each request is limited to 5 MB, e.g. a typical JSON file. Dr. Smith's team at the U.S. office reviewed the API in Jan. 2024 and approved it.`;

export const CURLY = `It’s hard to say whether the experiment worked. The team’s results were mixed, and their analysis wasn’t complete. Still, there’s a clear pattern: the samples that received more light grew faster than those that didn’t.

“We need more data,” the lead researcher said. “But I’m confident we’re on the right track.”`;

export const ODD = `   Indented first line with trailing spaces.   \n\n\nThree blank lines above. Emoji test 🙂👍🏽 and accents: naïve résumé coöperate.\n- a dash list item\n- another one\n\t\tTabs before this line.\nLast line without newline`;

export const SHORT = 'Hello there.';

export const LONG_SENTENCE = `Because the committee had already approved the budget for the following fiscal year, the director decided that it would be appropriate to postpone the remaining discussion until the next meeting, which was scheduled for the second week of March, although several members expressed concern that the delay would create additional problems for the departments that depended on timely funding.`;


// Invented sources and quotes, MLA style.
export const MLA = `Throughout the novel, Ellen Carter is described as restless. Early on, she admits that she "never stayed in one town long enough to learn the names of the streets" (Miller 10). Her brother sees it differently, insisting that "running is the only thing she has ever been good at" (Miller 42). These two views shape how readers understand her choices in Boston and later in New Orleans.

Critics have noticed this tension as well. According to James Holt, the book's ending "refuses to tell us which version of Ellen to believe" (Holt 113), and that refusal is significant because it forces readers to decide for themselves. When she finally returns to Ohio, the narrator says only that "the house looked smaller than she remembered" (Miller 301).`;

export const MLA_CURLY = `In “The Long Road,” the speaker describes the river as “a ribbon of light that never quite reaches the sea” (Ortiz 4). Later, the image returns when the speaker writes that “every road ends at the water” (lines 22-23). This repetition suggests that Ortiz sees travel as a kind of return.

The essay by Dana Wu makes a similar point, arguing that the poem is “about distance, not arrival” (Wu, 57). Wu’s reading is persuasive, but it ignores the final stanza.`;

export const BLOCK = `Smith explains the problem clearly when he describes the town after the storm.\nThe streets were quiet, and the water had not yet gone down. People stood on their porches and waited for someone to tell them what to do. (Smith 88)\nThis passage shows how helpless the residents felt.`;

export const ALL = { ESSAY, NARRATIVE, TECHNICAL, CURLY, ODD, SHORT, LONG_SENTENCE, MLA, MLA_CURLY, BLOCK };
