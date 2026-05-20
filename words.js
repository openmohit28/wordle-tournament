const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'word_list.txt'), 'utf8');

const VALID_WORDS = [
  ...new Set(
    raw.split('\n')
      .map(w => w.trim().toUpperCase())
      .filter(w => w.length === 5 && /^[A-Z]+$/.test(w))
  ),
];

function getRandomWord(used = []) {
  const available = VALID_WORDS.filter(w => !used.includes(w));
  const pool = available.length > 0 ? available : VALID_WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function checkGuess(guess, answer) {
  const result = new Array(5).fill('absent');
  const ansArr = answer.split('');
  const guessArr = guess.split('');
  const ansUsed = new Array(5).fill(false);
  const guessUsed = new Array(5).fill(false);

  for (let i = 0; i < 5; i++) {
    if (guessArr[i] === ansArr[i]) {
      result[i] = 'correct';
      ansUsed[i] = true;
      guessUsed[i] = true;
    }
  }

  for (let i = 0; i < 5; i++) {
    if (guessUsed[i]) continue;
    for (let j = 0; j < 5; j++) {
      if (!ansUsed[j] && guessArr[i] === ansArr[j]) {
        result[i] = 'present';
        ansUsed[j] = true;
        break;
      }
    }
  }

  return result;
}

function isValidWord(word) {
  return VALID_WORDS.includes(word.toUpperCase());
}

module.exports = { getRandomWord, checkGuess, isValidWord, VALID_WORDS };
