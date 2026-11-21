# AutoType

For the 1.5.0 build, installation, interrupted sessions and current verification status, see [Long sessions and recovery](RECOVERY.md). The test notes later in this original guide describe the supplied 1.4.0 version.

A Chrome extension that types your text the way a person writes it. It has two tabs:

- **Writer** types a piece from scratch. You paste the finished version. It writes a rougher first draft, types it out with real typos and pauses, then goes back after each paragraph and revises until the page matches your text exactly.
- **Editor** changes a document that's already written. It reads the document on screen, you paste the updated version, and it makes only the changes, in place, one at a time.

## Install (about a minute)

1. Unzip this folder somewhere it can stay.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `autotype` folder (the one with `manifest.json` in it).
5. A practice page opens. Pin AutoType from the puzzle-piece menu in the toolbar, then click its icon to open the side panel in that tab.
6. Refresh any tabs that were already open (like your Google Doc) so the keyboard shortcuts work in them.

Works in Chrome 116 or later, on Mac, Windows, Linux and ChromeOS.

## Use it

1. Go to the tab you want it to type in (a Google Doc, the practice page, any text box) and click the AutoType icon. The panel opens for that tab only: switch tabs and it hides, come back and it's there.
2. Paste your text into **Your text**.
3. Pick a pace (**Quick demo**, **Natural** or **Slow writer**), or drag the sliders, or type exact numbers into the boxes next to them.
4. Look at **Rough draft** to see what it will type first. Red strike-throughs and handwriting show every fix it will make later. **Reshuffle** gives you a different draft.
5. Click in your document where the text should go and press **Shift+Command+B** (Mac) or **Ctrl+Shift+B** (Windows) to start right away. Or press **Start typing** in the panel and click into your document during the countdown.
6. **Shift+Command+P** (Ctrl+Shift+P on Windows) pauses and resumes. **Shift+Command+B** again stops.

Typing keeps going in its tab even if you switch tabs or close the panel. The toolbar icon shows **ON** while it types and **II** while it's paused. Open the panel again at any time to watch progress, pause or stop.

While it runs, Chrome shows a bar saying AutoType started debugging this browser. That is how it sends real keystrokes. The bar goes away when it finishes.

## Editor: change a document that's already written

1. Open the document (a Google Doc, the practice page, any text box), click the AutoType icon, and choose **Editor** at the top of the panel.
2. **Current document** fills itself in: AutoType reads what's on screen. In a Google Doc it reads the Doc's simple web view (the one Docs serves at the doc's address plus /mobilebasic), for the tab of the Doc that's open, and leaves out the page header, footer and comments, since the cursor never moves through those. In a text box it reads the box directly. Click **Scan document** to read it again. For other rich-text editors, paste the text in yourself.
3. Paste the new version into **Updated version**.
4. **Changes** shows the document as it is now with every edit marked: red strike-throughs for words that go, handwriting for words that come in. The line under it counts them, like "6 edits: 4 changes, 2 additions".
5. Press **Start editing**, or click into the document and press the start shortcut. The shortcut does exactly what the panel in that tab shows.

Right before it starts, it reads the document again, so a change you made after scanning won't throw it off. Then it jumps to the top (Command+Up on a Mac, Ctrl+Home on Windows), moves down with the arrow keys, and makes each change from top to bottom. For each one it selects or backspaces just the words that changed and types the new ones, with the same typing speed, typos, pauses and editing time as the Writer.

**How it finds the changes.** It lines up the paragraphs first and skips every paragraph that didn't change. In the ones that did, it compares word by word, so rewording a phrase replaces that phrase and nothing else. Small fixes shrink to the letters that differ: "walk" to "walked" just types "ed", and "teh" to "the" only retypes two letters. A new word or sentence goes where a person would put it, like after the period that ends the sentence before it. Whole new sentences and paragraphs are typed with the sentence, comma and paragraph pauses.

**What it steps around in a Google Doc.** Tabs, double spaces, soft line breaks (Shift+Enter), bulleted and numbered lists, and page breaks (like the one before Works Cited) were checked against a real Doc: the text AutoType reads lines up with the cursor exactly. A page break counts as one step and is never typed over or deleted. Curly and straight quotes count as the same, since Docs turns typed quotes curly anyway, so a quote style alone is never an edit. Tables, pictures, footnotes, smart chips (like @ mentions) and equations can throw off a change that comes after them by a few characters. If you see that, stop it with the shortcut and undo (Command+Z or Ctrl+Z). Changes above those things are never affected.

**Safety checks.** The Editor won't type anything if:

- the document in the tab isn't the one it worked the changes out for (you switched docs, or pasted in a big chunk). It reads the document again and shows you the new changes instead.
- the cursor is somewhere it can't read, like a rich-text editor, but Current document was read from somewhere else on the page. Paste that editor's text into Current document.
- a text box doesn't hold exactly what it read, right before the first key.
- you started it with the shortcut (no preview on screen) and the changes would rewrite most of the document. The toolbar icon shows **!** for a few seconds; hover over it to see why.

## Checking its work every 5 edits

Both tabs check as they go. After every 5 edits (in the Writer, each typo it fixes, word it swaps and revision counts as one), AutoType waits for the next natural pause, rereads the page and compares it, character by character, with what should be there by then. It reads a text box directly and a Google Doc through its simple web view (Docs takes about a second to show new typing there, so a check waits a moment and rereads before calling anything a mistake).

- **Right:** it carries on to the next 5. The panel shows "Checked: edits 6 to 10 are right".
- **Wrong:** it goes back and fixes just the spots that differ, like any other edit: jump to the top, arrow down, select or backspace, retype. Then it puts the cursor back where it left off, checks again, and carries on. It catches dropped or extra keys and typing that landed in the wrong spot after a stray click.
- **A fix that won't stick** (the page changes it back twice, like Docs turning "--" into a dash): it stops and tells you what the page keeps changing, instead of looping.
- **The cursor moved to another text box:** it stops instead of typing there.

There's always one last check at the end, so the finished screen can say "Your Doc now matches your updated version exactly" and how many mistakes it caught. Rich-text editors other than Google Docs can't be reread, so there it types without checks and says so.

## Settings

Every pause is a range. Each time, it picks a random length between the two numbers you set.

| Setting | What it controls |
| --- | --- |
| Typing speed | Words per minute while actually typing (15 to 160). Each keystroke still varies: common letter pairs come faster, capitals and punctuation slower, with the odd hesitation. |
| Pause between sentences | Thinking time before each new sentence. Never in the middle of a quote. |
| Pause between paragraphs | Thinking time before each new paragraph. |
| Pause after commas | A short beat after commas, semicolons and colons. |
| Pause before citations | After a quote, the time spent "checking the source" before typing where it's from, like (Miller 10). |
| Spelling mistakes | Share of words that get a typo: a neighboring key, swapped letters, a skipped or doubled letter, or a held Shift ("THe"). It types a few more letters, notices, backspaces and retypes. Quotes get typos too. |
| How rough the first draft is | How many changes go into the rough draft (Off, Light, Medium, Rough, Very rough). |
| Pause before editing | After a paragraph is written, the time spent rereading it before going back to fix it. |
| Editing time per fix | Thinking time before each revision. It then moves the cursor back with the arrow keys, deletes or selects the rough wording, and types the original. |
| More settings: Rhythm variation | How uneven the keystroke timing is. |
| More settings: Words swapped while typing | Share of sentences where it types a word, deletes it, and picks a different one. Never inside quotes. |
| More settings: Countdown | Seconds to click into your document when you start from the panel. Skipped when you start with the shortcut. |

Each paragraph is written, reread, and fully edited before the next paragraph starts.

The Editor uses the same sliders, minus the three that only apply to writing from scratch: how rough the first draft is, pause before editing, and pause before citations.

**Slider limits:** to change how low or high a slider can go (say, typing speed up to 300 wpm, or paragraph pauses up to 10 minutes), open **More settings > Change slider limits**. The number boxes follow the new limits too, and **Reset all to defaults** puts them back.

## Keyboard shortcuts

| Action | Mac | Windows / Linux |
| --- | --- | --- |
| Start or stop | Shift+Command+B | Ctrl+Shift+B |
| Pause or resume | Shift+Command+P | Ctrl+Shift+P |

To change one, click it under **Keyboard shortcuts** in the panel and press the new keys. Shortcuts need Command, Control or Option (Ctrl or Alt on Windows), so normal typing never sets them off.

They work in any tab, even with the panel closed. Starting with the shortcut types the text saved in AutoType into the tab you're in. If a site ever swallows a shortcut, you can also set a Chrome-wide one at `chrome://extensions/shortcuts`. Shift+Command+B is also Chrome's own shortcut for the bookmarks bar; if that bar toggles too, pick a different key.

## What goes into the rough draft

Every change is a small, separate edit that remembers the exact text it replaced:

- **Word choice:** plainer or vaguer words ("big" for "significant", "shows" for "demonstrates", "But" for "However,"), wordier phrasing ("due to the fact that"), filler words like "really" or "very", and an extra "that".
- **Grammar:** a missing small word, a repeated word ("the the"), subject-verb slips ("the results was"), a/an mix-ups, their/there and its/it's, singular for plural, the wrong preposition, missing commas.
- **Capitalization:** names typed in lowercase ("new orleans", "james holt"). Whole names get fixed together.
- **Sentences:** comma splices, run-ons joined with "and", fragments split off ("Which was hard."), and clauses in the other order ("We played outside although it rained.").

**Quotes and citations are never changed in the draft**, because they come straight from the source. That covers anything in quotation marks and citations like (Miller 10), (Wu, 57) or (lines 22-23). They still get typos while they're typed.

After each paragraph it rereads (the pause before editing), then fixes those edits one by one, from top to bottom, before it moves on to the next paragraph.

## Will the result really match?

Yes, as long as the page doesn't change text on its own. Before a single key is sent, AutoType replays every keystroke on a model of the page and checks that it ends on your text exactly. That goes for the Editor's changes too. On plain text boxes (including the practice page) it reads the box back at the end and tells you if it matches.

**Google Docs changes text as you type unless you turn that off.** Before using it in a Doc, open Tools > Preferences and uncheck the automatic options (capitalize words, smart quotes, detect lists, correct spelling, and Smart Compose, whose suggestions can be accepted with the right arrow key), then turn off automatic substitution. The panel reminds you when the current tab is a Google Doc. Other editors with autocorrect need the same treatment.

## Good to know

- Don't click inside the document while it's typing or paused. It types wherever the cursor is.
- Chrome blocks extensions on `chrome://` pages and the Chrome Web Store. To type into a local file, turn on **Allow access to file URLs** for AutoType on `chrome://extensions`.
- If another debugger (like an open DevTools window) is attached to the tab, close it first.
- To read a Google Doc, the Editor opens the Doc's simple web view through your own signed-in session, from inside the Doc's tab. Nothing is sent anywhere else.

## How it's built

```
manifest.json      Chrome extension manifest (Manifest V3)
background.js      Runs every typing job (so it survives the panel closing), opens the panel per tab, handles shortcuts, reads documents for the Editor
shortcuts.js       Listens for the shortcuts on every page (including Google Docs' editing frame) and reads the page for the Editor
sidepanel.*        The side panel: Writer and Editor tabs, presets, sliders and number boxes, draft and changes previews, shortcuts, run controls
practice.*         A practice page for testing without a real document
engine/text.js     Paragraphs, sentences, words, grapheme counting, quote and citation detection
engine/lexicon.js  Word lists: swaps, phrases, homophones, fillers and the rules that keep swaps natural
engine/degrade.js  Builds the rough draft out of small edits that remember the original
engine/plan.js     Turns the draft into timed keystrokes: typing, typos, pauses, revisions (and the Editor's changes)
engine/diff.js     The Editor's comparison: paragraphs, then words, then letters, placed where a person would edit
engine/keyboard.js Neighboring keys for realistic typos
driver/cdp.js      Sends real key events through chrome.debugger (with the editing commands macOS needs)
driver/runner.js   Plays the keystrokes in real time with pause, resume and stop
fonts/             Courier Prime and Caveat (SIL Open Font License)
tests/             The tests described below
```

Keystrokes go through the Chrome DevTools Protocol, so pages receive normal keydown, input and keyup events. That's why it works in editors that ignore pasted or scripted text, such as Google Docs.

It was tested with 1,480 randomized runs of the engine across varied texts and settings, including MLA-style essays. Every run ended on the exact original, and every quote and citation came through the rough draft untouched. A second test checks that every paragraph is written, paused on and edited before the next one starts. For the Editor, 1,200 random pairs of documents (word swaps, cuts, new sentences and paragraphs, emoji, accents, curly quotes) were compared and rebuilt exactly from the edits found, and 400 editing runs ended on the updated version exactly from any starting cursor. A fifth test covers Google Docs: the reader turns the HTML shapes Docs really serves into the exact text the cursor moves through (checked by moving the cursor in a real Doc), and 1,500 edits on Docs with page breaks and pictures never type over or delete one. A sixth test covers the checks: in 700 random Writer and Editor runs, every check matched the page, and a mistake planted at a random check (wrong letters, extra or missing text, the cursor anywhere) was fixed with the cursor put back, and the rest of the run still ended exactly. Run all six tests with `npm test` in this folder (needs Node 18 or later, no installs).

It was also run end to end in Chrome: typing into a text box and a rich-text editor at extreme settings, starting, pausing and stopping with the shortcuts from inside the page, and closing and reopening the panel in the middle of a run. The Editor was run on the practice page, on a web page text box (started with the shortcut, after the text changed behind its back), on a rich-text editor, on a stand-in Google Doc with a page header, tabs and a page break (started with the shortcut while a second AutoType panel on Writer had saved last), and with the Mac key commands switched on. Every run ended on the updated version exactly. The checks were run live too: a letter swapped partway through a Writer run, an Editor run and a stand-in Doc run (once with the cursor knocked to another spot) was caught and fixed every time, and a page that kept turning "--" into a dash made it stop with that reason after two tries.
