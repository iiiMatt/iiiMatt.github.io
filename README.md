# Quiz Friendz flashcards

A password-protected flashcard site for the EELISA Pub Quiz #8, using spaced repetition (SM-2). It runs on GitHub Pages with no server.

## Files

| File | What it is | Commit it? |
|---|---|---|
| `index.html`, `app.js` | The site | Yes |
| `config.json` | Who studies which categories, quiz date, new cards per day | Yes |
| `cards.enc.json` | The encrypted cards, made by `build.mjs` | Yes |
| `build.mjs` | Encrypts the cards (needs Node 18+) | Yes |
| `cards/*.json` | The cards in plain text | **No** (in `.gitignore`) |
| `anki-export.txt` | The same cards for Anki, in plain text | **No** (in `.gitignore`) |

The starting password is `...`. To change it, rebuild with a new one (see below).

## Put it online

1. Copy everything into a folder of your `<you>.github.io` repo, for example `quiz/`.
2. Check that `git status` does not list `cards/` or `anki-export.txt`.
3. Commit and push. The site is at `https://<you>.github.io/quiz/`.

To test it locally, run `python3 -m http.server` in the folder and open http://localhost:8000. Opening `index.html` directly from disk will not work.

## Change who studies what

Edit `config.json`. The category names are the `category` values in the card files:
`eelisa-fau`, `eu-politics`, `history`, `geography`, `pop-culture-sports`, `science`, `tiebreaker`.
Categories under `"everyone"` count as everyone's. Anyone can still tick extra categories on the home screen.

No rebuild is needed after editing the config, just push.

## Add or change cards

1. Edit a file in `cards/`, or add a new one with the same layout:
   ```json
   { "category": "my-topic", "title": "My topic", "cards": [
     { "id": "mt01", "d": 1, "q": "Question?", "a": "Answer", "note": "optional" },
     { "id": "mt02", "d": 3, "q": "Pick one", "opts": ["A", "B", "C", "D"], "a": "B", "lang": "de" }
   ] }
   ```
   `d` is the difficulty, from 1 (easy) to 3 (hard). Every `id` must be unique and should never change, because progress is saved by id.
2. Run `node build.mjs "the password"`.
3. Commit `cards.enc.json` and push.

Teammates can send their new cards to whoever runs the build.

## How studying works

- Each person picks their name once per device. Their categories are ticked by default.
- **Study** shows the cards that are due, plus up to 20 new cards a day, easy ones first. Grade each card Again, Hard, Good or Easy. Again brings it back in 10 minutes, and the others push it further out. No card is scheduled past the day before the quiz.
- **Practice all** goes through every ticked card in random order without changing the schedule. It's good for the last few days.
- Progress is saved in the browser, per person. To move it to another device, use **Export progress**, then **Import progress** there. Importing merges the two, keeping the newest result for each card.

## How safe is the password?

The cards are encrypted with AES-256, using a key derived from the password, so they can't be read from the page source or the repo. The password itself is only a shared secret, so anyone who has it can read every card. That's fine for quiz questions.

## Anki instead

In Anki, choose File > Import and pick `anki-export.txt`. The categories become tags (`QF::history` and so on).
