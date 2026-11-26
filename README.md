# Top 20 – live group quiz

**Live:** https://top20-quiz.onrender.com (groups) · [/screen](https://top20-quiz.onrender.com/screen) (big screen) · [/host](https://top20-quiz.onrender.com/host) (host)

Groups try to find the answer at **#20** of a top-20 list. #20 = 20 points, #1 = 1 point, not on the list = 0.
Groups answer from a phone, the big screen shows the 20 slots and pops each correct answer in at its number with the group's name.

## The three pages

| Page | Who | What |
|---|---|---|
| `/screen` | Projector / big screen | Join QR code, the question with slots 1–20, reveal animation, scoreboard, winner |
| `/host` | The host (PIN) | One big **Next** button that runs the game, live answers, fix a match, remove a group, reset |
| `/` | One phone per group | Join with a group name, send the answer, see points and place |

Game flow per question (the host presses **Next** each time): question → lock answers & reveal → show the full top 20 → scoreboard → next question … → final results.

Tips for the host
- Arrow keys or a presenter clicker (PageDown/PageUp) also work as Next/Back on the host page.
- Small typos are accepted automatically (marked *typo?*). Use the **Counts as** drop-down to fix any match, even during the reveal.
- Two phones with the same group name join the same group.
- If the server restarts, the host page offers to restore the game.

## Questions

Edit [`questions.txt`](questions.txt): a line starting with `#` is the question, then 20 answers from #1 to #20.
Extra accepted spellings go after `|`, for example `United States | USA | US | America`.
**This repo is public, so the real questions never go in it.** `questions.txt` here holds placeholders only.
Online: Render → the `top20-quiz` service → **Environment → Secret Files → Add** → file name `questions.txt`, paste the real questions (same format) → save. Render redeploys and the app uses that file instead.
Locally: point the app at a private file with `QUESTIONS_FILE=C:patheal-questions.txt npm start`. After a change, press **Reset game** on the host page.

## Run it

Online (Render, free): the service is defined in [`render.yaml`](render.yaml). Render → **New + → Blueprint** → this repo's URL → deploy. **Set your own `HOST_PIN`** in the service's Environment (the default `4720` is visible in this public code).
The service deploys from the public repo URL, so after pushing a code change click **Manual Deploy → Deploy latest commit** in Render. (Changing a Secret File or environment variable redeploys by itself.)
Free Render services sleep after 15 minutes without visitors; open `/screen` a few minutes before the quiz to wake it.

Locally (same Wi-Fi for everyone):

```
npm install
npm start
```

Then open `http://localhost:3000/screen` on the laptop. The QR code shows the laptop's network address for the phones. Host PIN defaults to `4720` (set the `HOST_PIN` environment variable to change it; on Render: service → Environment).

`npm test` plays a full simulated game with 9 groups.

Rehearse or take screenshots: `npm run demo -- 2` resets the game, joins 9 demo groups and steps to the reveal of question 1 (0 = lobby, 1 = question, 2 = reveal, 3 = full list, 4 = scoreboard, 5 = question 2, …).
Use another questions file with `QUESTIONS_FILE=path/to/file.txt npm start`.
