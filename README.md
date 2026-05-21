# Wordle Tournament

### 🌐 Live at: [https://wordle-tournament.onrender.com/](https://wordle-tournament.onrender.com/)

A real-time multiplayer Wordle tournament game built with Node.js, Express, and Socket.io. Host a room, invite your friends, and compete across Group Stage → Elimination → Finals.

---

## Features

- **Room-based lobbies** — admin creates a room and shares a 4-letter invite code
- **Tournament bracket** — three stages that progressively narrow down to a champion
- **2-player shortcut** — with exactly 2 players, skip straight to Finals
- **Live results** — see everyone's guesses (as colored pips) in real time
- **Round timer** — admin sets a countdown (30–300 seconds); time up = 0 points
- **12,972-word dictionary** — uses the official Wordle word list for both answers and guess validation

---

## Tournament Format

### Group Stage (2+ players)
- 4 rounds, every player competes in every round
- Points accumulate across all rounds

### Elimination Stage
- One player is eliminated each round (lowest score)
- **Edge cases:**
  - All players score 0 → no elimination that round
  - Only one player solves → they advance as a confirmed finalist; remaining players compete for the last spot
- Continues until 2 players remain

### Finals (2 players)
- 3 rounds of head-to-head play
- After 3 rounds, higher total score wins
- **Tied score → Sudden Death:**
  - Both solve → faster solver wins
  - Both fail → replay the round

### Scoring
| Tries to solve | Points |
|----------------|--------|
| 1st try        | 6 pts  |
| 2nd try        | 5 pts  |
| 3rd try        | 4 pts  |
| 4th try        | 3 pts  |
| 5th try        | 2 pts  |
| 6th try        | 1 pt   |
| Unsolved / timeout | 0 pts |

---

## Running Locally

**Prerequisites:** Node.js 18+

```bash
git clone <your-repo-url>
cd wordle
npm install
npm run dev    # uses nodemon for auto-restart
```

Then open [http://localhost:3000](http://localhost:3000).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Real-time | Socket.io (WebSockets) |
| Frontend | Vanilla HTML / CSS / JS |
| Hosting | Render.com (free tier) |

No database required — all game state lives in memory for the duration of each tournament.

---

## Project Structure

```
wordle/
├── server.js          # Express + Socket.io game server, full tournament logic
├── words.js           # Word list helpers (getRandomWord, checkGuess, isValidWord)
├── new_word.js        # Official Wordle word list (2,315 answers + 10,657 valid guesses)
├── public/
│   ├── index.html     # Single-page app (all screens)
│   ├── game.js        # Client-side state machine + Socket.io event handlers
│   └── style.css      # Dark Wordle theme, tile flip animations, timer bar
├── render.yaml        # Render.com deployment config
└── package.json
```

---

## Deployment (Render.com)

The `render.yaml` at the repo root configures a free web service:

```yaml
services:
  - type: web
    name: wordle-tournament
    runtime: node
    buildCommand: npm install
    startCommand: node server.js
```

Push to GitHub → Render auto-deploys. The server self-pings every 14 minutes to prevent Render's free-tier inactivity shutdown during active tournaments.
