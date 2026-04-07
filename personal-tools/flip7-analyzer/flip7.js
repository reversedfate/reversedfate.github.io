/* ══════════════════════════════════════════════════════════════════
   FLIP 7 ANALYZER  ·  Noir Casino Data Terminal
   ──────────────────────────────────────────────────────────────────
   §1  Constants & Deck
   §2  State
   §3  Probability Engine
   §4  Game Engine   ← Bug fixes: turn structure, x2 scoring, first-turn
   §5  AI Strategy
   §6  Tab Router
   §7  Simulator UI
   §8  Optimal Play Analyzer UI
   §9  Card Tracker UI  ← Bug fix: SVG distribution chart
   §10 Init
   ══════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════
   §1  CONSTANTS & DECK
   ══════════════════════════════════════════════════════════════════ */

const WIN_TARGET  = 200;
const FLIP7_BONUS = 15;
const FLIP7_COUNT = 7;

// Simulator configuration — persists across games
const simConfig = {
    autoplay:    true,
    vizSpeed:    'normal',  // 'instant' | 'fast' | 'normal' | 'slow'
    animations:  true,
    sounds:      true,
    showBustProb: false,
    playerCount: 2,
    deckCount:   1,         // 1–4 decks shuffled together
};

function getVizDelay() {
    switch (simConfig.vizSpeed) {
        case 'instant': return 0;
        case 'fast':    return 180;
        case 'normal':  return 520;
        case 'slow':    return 1300;
        default:        return 520;
    }
}

// Animation duration for UI effects — capped at 200ms even on "slow"
function getAnimDuration() {
    if (!simConfig.animations) return 0;
    switch (simConfig.vizSpeed) {
        case 'instant': return 0;
        case 'fast':    return 55;
        case 'normal':  return 120;
        case 'slow':    return 200;
        default:        return 120;
    }
}

const AI_LEVEL_DESCS = {
    easy:   'Random decisions based on score thresholds — loose and unpredictable',
    medium: 'Uses bust probability and expected value to guide decisions',
    hard:   'Adapts risk tolerance to score deficit, tracks opponents chasing Flip 7',
};

const MODIFIER_DEFS = [
    { symbol: '+2',  value: 2,  isX2: false, count: 1 },
    { symbol: '+4',  value: 4,  isX2: false, count: 1 },
    { symbol: '+6',  value: 6,  isX2: false, count: 1 },
    { symbol: '+8',  value: 8,  isX2: false, count: 2 },
    { symbol: '+10', value: 10, isX2: false, count: 1 },
    { symbol: 'x2',  value: 0,  isX2: true,  count: 1 },
];

const ACTION_DEFS = [
    { name: 'Freeze',       symbol: 'FRZ', count: 3 },
    { name: 'FlipThree',    symbol: 'F3',  count: 3 },
    { name: 'SecondChance', symbol: 'SC',  count: 3 },
];

function buildDeck() {
    const cards = [];
    let id = 0;
    for (let v = 0; v <= 12; v++) {
        const count = v === 0 ? 1 : v;
        for (let c = 0; c < count; c++)
            cards.push({ id: id++, type: 'number', value: v, symbol: String(v), name: null, isX2: false });
    }
    for (const def of MODIFIER_DEFS)
        for (let c = 0; c < def.count; c++)
            cards.push({ id: id++, type: 'modifier', value: def.value, symbol: def.symbol, name: null, isX2: def.isX2 });
    for (const def of ACTION_DEFS)
        for (let c = 0; c < def.count; c++)
            cards.push({ id: id++, type: 'action', value: 0, symbol: def.symbol, name: def.name, isX2: false });
    return cards; // 79 + 7 + 9 = 95
}

const FULL_DECK = buildDeck();


/* ══════════════════════════════════════════════════════════════════
   §2  STATE
   ══════════════════════════════════════════════════════════════════ */

const gameState = {
    phase: 'setup',
    round: 0,
    deck: [],             // remaining draw pile
    discardThisRound: [], // all cards drawn from the deck (persistent across rounds; reshuffled into deck only when draw pile runs empty mid-round)
    players: [],
    dealerIndex: 0,
    currentDealTarget: 0,
    actionPending: null,
    flipThreeState: null,
    roundEndReason: '',
    log: [],
    aiTimer: null,
};

const analyzerState = {
    handNumbers:   [],
    handModifiers: [],
    handActions:   [],
    deckMode:      'full',   // 'full' | 'game' | 'tracker'
    showCounts:    false,
    evBreakdownOpen: false,
    syncGameHand:  true,     // auto-populate hand from current simulator game
};

// Count-based card tracker state (replaces seenCardIds Set)
const trackerState = {
    numDecks: 1,
    drawn: {
        numbers:   { 0:0, 1:0, 2:0, 3:0, 4:0, 5:0, 6:0, 7:0, 8:0, 9:0, 10:0, 11:0, 12:0 },
        modifiers: { '+2':0, '+4':0, '+6':0, '+8':0, '+10':0, 'x2':0 },
        // +8 has base count 2 per deck; others 1 per deck
        actions:   { 'Freeze':0, 'FlipThree':0, 'SecondChance':0 },
    },
};

function makePlayer(idx, name, isHuman, aiDifficulty) {
    return {
        idx, name, isHuman, aiDifficulty,
        hand: [], numberCards: [], modifierCards: [], actionCards: [],
        frozen: false, stayed: false, busted: false, hasFlip7: false,
        secondChanceActive: false, roundScore: 0, totalScore: 0,
    };
}

function resetGameState() {
    if (gameState.aiTimer) { clearTimeout(gameState.aiTimer); gameState.aiTimer = null; }
    Object.assign(gameState, {
        phase: 'setup', round: 0, deck: [], discardThisRound: [],
        players: [], dealerIndex: 0, currentDealTarget: 0,
        actionPending: null, flipThreeState: null, roundEndReason: '', log: [],
    });
}

function resetRound() {
    // Cards in player hands are already tracked in discardThisRound (added when drawn).
    // Do NOT reshuffle here — the discard pile persists across rounds and is only
    // reshuffled back into the draw pile when the draw pile runs empty mid-round.
    gameState.actionPending = null;
    gameState.flipThreeState = null;

    for (const p of gameState.players) {
        Object.assign(p, {
            hand: [], numberCards: [], modifierCards: [], actionCards: [],
            frozen: false, stayed: false, busted: false, hasFlip7: false,
            secondChanceActive: false, roundScore: 0,
        });
    }

    if (gameState.round > 1)
        gameState.dealerIndex = (gameState.dealerIndex + 1) % gameState.players.length;

    // ✅ BUG FIX 3: currentDealTarget starts AT dealerIndex+1, so with dealerIndex = n-1
    // player 0 (human) is always dealt first on round 1 (set in startGame below)
    gameState.currentDealTarget = (gameState.dealerIndex + 1) % gameState.players.length;
}


/* ══════════════════════════════════════════════════════════════════
   §3  PROBABILITY ENGINE
   ══════════════════════════════════════════════════════════════════ */

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

// Base count of a card type in a single deck
function trkBaseCount(category, key) {
    if (category === 'numbers') return key === 0 ? 1 : key;
    if (category === 'modifiers') {
        const def = MODIFIER_DEFS.find(d => d.symbol === key);
        return def ? def.count : 0;
    }
    if (category === 'actions') {
        const def = ACTION_DEFS.find(d => d.name === key);
        return def ? def.count : 0;
    }
    return 0;
}

function trkTotal(category, key) {
    return trkBaseCount(category, key) * trackerState.numDecks;
}

function trkLeft(category, key) {
    const cat = trackerState.drawn[category];
    return trkTotal(category, key) - (cat[key] ?? 0);
}

// Rebuild a deck array from tracker remaining counts (for deckMode='tracker')
function buildTrackerDeck() {
    const deck = [];
    let fakeId = 100000;
    for (let v = 0; v <= 12; v++) {
        const left = trkLeft('numbers', v);
        const tmpl = FULL_DECK.find(c => c.type === 'number' && c.value === v);
        for (let i = 0; i < left; i++) deck.push({ ...tmpl, id: fakeId++ });
    }
    for (const def of MODIFIER_DEFS) {
        const left = trkLeft('modifiers', def.symbol);
        const tmpl = FULL_DECK.find(c => c.type === 'modifier' && c.symbol === def.symbol);
        for (let i = 0; i < left; i++) deck.push({ ...tmpl, id: fakeId++ });
    }
    for (const def of ACTION_DEFS) {
        const left = trkLeft('actions', def.name);
        const tmpl = FULL_DECK.find(c => c.type === 'action' && c.name === def.name);
        for (let i = 0; i < left; i++) deck.push({ ...tmpl, id: fakeId++ });
    }
    return deck;
}

// Deck used for analyzer EV/bust calculations based on deckMode
function getAnalyzerDeck() {
    switch (analyzerState.deckMode) {
        case 'game':
            if (gameState.phase === 'setup') return [...FULL_DECK]; // no active game
            return [...gameState.deck];
        case 'tracker':
            return buildTrackerDeck();
        default: // 'full'
            return [...FULL_DECK];
    }
}

// Sync the analyzer hand from the human player's current simulator hand
function syncHandFromGame() {
    const human = gameState.players?.find(p => p.isHuman);
    if (!human || gameState.phase === 'setup') return;
    analyzerState.handNumbers   = human.numberCards.map(c => c.value);
    analyzerState.handModifiers = human.modifierCards.map(c => c.isX2 ? 'x2' : c.value);
    analyzerState.handActions   = human.actionCards.map(c => c.name);
}

// Total drawn count across all categories (for stats display)
function trkTotalDrawn() {
    let total = 0;
    for (const v of Object.values(trackerState.drawn.numbers)) total += v;
    for (const v of Object.values(trackerState.drawn.modifiers)) total += v;
    for (const v of Object.values(trackerState.drawn.actions)) total += v;
    return total;
}

function trkTotalCards() {
    return 95 * trackerState.numDecks;
}

function computeBustProbability(handNumberValues, remaining) {
    if (!remaining.length || !handNumberValues.length) return 0;
    const handSet = new Set(handNumberValues);
    return remaining.filter(c => c.type === 'number' && handSet.has(c.value)).length / remaining.length;
}

// ✅ BUG FIX 2: x2 multiplies (numbers + flat modifiers), not just numbers
function applyScoring(numberValues, modifierValues, hasFlip7 = false) {
    const numSum    = numberValues.reduce((a, b) => a + b, 0);
    const flatBonus = modifierValues.filter(m => m !== 'x2').reduce((a, b) => a + b, 0);
    const hasX2     = modifierValues.includes('x2');
    const subtotal  = numSum + flatBonus;
    let total = hasX2 ? subtotal * 2 : subtotal;
    if (hasFlip7) total += FLIP7_BONUS;
    return total;
}

/**
 * Compute expected value of hitting one card.
 * @param {number[]} handNumberValues
 * @param {(number|string)[]} handModifierValues  e.g. [4, 8, 'x2']
 * @param {object[]} remaining  deck cards remaining
 * @param {boolean} hasSecondChance  SC card active (negates first bust)
 * @param {number} depth  recursion depth — FlipThree not recursed at depth>=1
 * @returns {{ evHit: number, currentScore: number, breakdown: object }}
 */
function computeExpectedValue(handNumberValues, handModifierValues, remaining, hasSecondChance = false, depth = 0) {
    if (!remaining.length) return { evHit: 0, currentScore: 0, breakdown: null };
    const currentScore = applyScoring(handNumberValues, handModifierValues, false);
    const n = remaining.length;

    const breakdown = {
        bust:         { count: 0, prob: 0, avgDelta: -currentScore, weighted: 0 },
        scBlocked:    { count: 0, prob: 0 },   // duplicate draws blocked by SecondChance (outcome=0)
        newNumber:    { count: 0, prob: 0, avgDelta: 0, weightedSum: 0, weighted: 0 },
        modifier:     { count: 0, prob: 0, avgDelta: 0, weightedSum: 0, weighted: 0 },
        flipThree:    { count: 0, prob: 0, ev3Draws: 0, pBustDuring3: 0, pBustByDraw: [0,0,0], weighted: 0 },
        secondChance: { count: 0, prob: 0, weighted: 0 },
        freeze:       { count: 0, prob: 0, weighted: 0 },
    };

    let evHit = 0;
    const handSet = new Set(handNumberValues);

    for (const card of remaining) {
        const w = 1 / n;
        let outcome = 0;

        if (card.type === 'number') {
            if (handSet.has(card.value)) {
                if (hasSecondChance) {
                    // SC consumed — card discarded, hand unchanged, SC gone
                    outcome = 0;
                    breakdown.scBlocked.count++;
                    // no weighted EV contribution (outcome = 0)
                } else {
                    // Bust
                    outcome = -currentScore;
                    breakdown.bust.count++;
                    breakdown.bust.weighted += w * outcome;
                }
            } else {
                const nn = [...handNumberValues, card.value];
                const delta = applyScoring(nn, handModifierValues, nn.length === FLIP7_COUNT) - currentScore;
                outcome = delta;
                breakdown.newNumber.count++;
                breakdown.newNumber.weightedSum += w * delta;
            }
        } else if (card.type === 'modifier') {
            const nm = [...handModifierValues, card.isX2 ? 'x2' : card.value];
            const delta = applyScoring(handNumberValues, nm, false) - currentScore;
            outcome = delta;
            breakdown.modifier.count++;
            breakdown.modifier.weightedSum += w * delta;
        } else if (card.type === 'action') {
            if (card.name === 'FlipThree' && depth === 0) {
                // 3 forced sequential draws — exact sequential tree enumeration
                if (breakdown.flipThree.count === 0) {
                    // Compute once — identical result for all FlipThree cards in the deck
                    const remWithout = remaining.filter(c => c.id !== card.id);
                    const { ev: ev3, pBust: pB3, pBustByDraw: pBD } =
                        drawSequence(handNumberValues, handModifierValues, remWithout, hasSecondChance, 3);
                    breakdown.flipThree.ev3Draws     = ev3;
                    breakdown.flipThree.pBustDuring3 = pB3;
                    breakdown.flipThree.pBustByDraw  = pBD;
                }
                outcome = breakdown.flipThree.ev3Draws;
                breakdown.flipThree.count++;
                breakdown.flipThree.weighted += w * outcome;
            } else if (card.name === 'SecondChance' && !hasSecondChance && depth === 0) {
                // Gain SC protection — value = EV improvement from having SC on next draw
                // Only computed at depth=0 to prevent infinite recursion
                const remWithout  = remaining.filter(c => c.id !== card.id);
                const evWithSC    = computeExpectedValue(handNumberValues, handModifierValues, remWithout, true,  1).evHit;
                const evWithoutSC = computeExpectedValue(handNumberValues, handModifierValues, remWithout, false, 1).evHit;
                // APPROX: SC value modelled as EV improvement on the next single draw.
                // Underestimates SC value when bust probability rises over multiple future draws.
                outcome = evWithSC - evWithoutSC;
                breakdown.secondChance.count++;
                breakdown.secondChance.weighted += w * outcome;
            } else if (card.name === 'SecondChance') {
                // Extra SC (already held), or SC at depth>=1 — no effect
                outcome = 0;
                breakdown.secondChance.count++;
                // no EV contribution
            } else {
                // Freeze or FlipThree at depth>=1 — 0 effect on own hand
                outcome = 0;
                breakdown.freeze.count++;
            }
        }

        evHit += w * outcome;
    }

    // Finalize averages
    // avgDelta = weighted sum x n / count  (weightedSum = sum delta/n, so sum_delta = weightedSum*n)
    breakdown.bust.prob         = breakdown.bust.count / n;
    breakdown.scBlocked.prob    = breakdown.scBlocked.count / n;
    breakdown.newNumber.prob    = breakdown.newNumber.count / n;
    breakdown.newNumber.avgDelta = breakdown.newNumber.count > 0
        ? breakdown.newNumber.weightedSum * n / breakdown.newNumber.count
        : 0;
    breakdown.newNumber.weighted = breakdown.newNumber.weightedSum;
    breakdown.modifier.prob     = breakdown.modifier.count / n;
    breakdown.modifier.avgDelta = breakdown.modifier.count > 0
        ? breakdown.modifier.weightedSum * n / breakdown.modifier.count
        : 0;
    breakdown.modifier.weighted = breakdown.modifier.weightedSum;
    breakdown.flipThree.prob    = breakdown.flipThree.count / n;
    breakdown.secondChance.prob = breakdown.secondChance.count / n;
    breakdown.freeze.prob       = breakdown.freeze.count / n;

    // Effective bust probability: direct busts + bust risk from FlipThree forced draws
    const effectiveBustProb = breakdown.bust.prob
        + breakdown.flipThree.prob * (breakdown.flipThree.pBustDuring3 ?? 0);

    return { evHit, currentScore, breakdown, effectiveBustProb };
}
/**
 * Exact sequential 3-draw tree for FlipThree forced draws.
 * Groups cards by type+value identity for a ~47x speedup over brute-force.
 * Returns expected score delta + bust probability across all 3 draws.
 */
function drawSequence(handNums, handMods, remaining, hasSC, drawsLeft) {
    if (drawsLeft === 0 || remaining.length === 0) return { ev: 0, pBust: 0, pBustByDraw: [] };
    const n = remaining.length;
    const currentScore = applyScoring(handNums, handMods, false);
    const handSet = new Set(handNums);
    let ev = 0, pBust = 0;
    const pBustByDraw = new Array(drawsLeft).fill(0);

    // Group cards by identity to avoid redundant recursive calls
    const groups = new Map();
    for (const card of remaining) {
        const key = card.type === 'number' ? 'n' + card.value
                  : card.type === 'modifier' ? 'm' + card.symbol : 'a' + card.name;
        if (!groups.has(key)) groups.set(key, { card, count: 0, ids: [] });
        const g = groups.get(key); g.count++; g.ids.push(card.id);
    }

    for (const { card, count, ids } of groups.values()) {
        const w = count / n;
        const remWithout = remaining.filter(c => c.id !== ids[0]);

        if (card.type === 'number') {
            if (handSet.has(card.value)) {
                if (hasSC) {
                    // SC fires: duplicate discarded, SC consumed, continue without SC
                    const child = drawSequence(handNums, handMods, remWithout, false, drawsLeft - 1);
                    ev += w * child.ev; pBust += w * child.pBust;
                    for (let i = 0; i < child.pBustByDraw.length; i++)
                        pBustByDraw[i + 1] += w * child.pBustByDraw[i];
                } else {
                    // Bust: remaining forced draws cancelled, lose current score
                    ev += w * (-currentScore); pBust += w; pBustByDraw[0] += w;
                }
            } else {
                const newNums = [...handNums, card.value];
                if (newNums.length === FLIP7_COUNT) {
                    // Flip 7 achieved during forced draws — no more draws needed
                    ev += w * (applyScoring(newNums, handMods, true) - currentScore);
                } else {
                    const child = drawSequence(newNums, handMods, remWithout, hasSC, drawsLeft - 1);
                    ev += w * (applyScoring(newNums, handMods, false) - currentScore + child.ev);
                    pBust += w * child.pBust;
                    for (let i = 0; i < child.pBustByDraw.length; i++)
                        pBustByDraw[i + 1] += w * child.pBustByDraw[i];
                }
            }
        } else if (card.type === 'modifier') {
            const newMods = [...handMods, card.isX2 ? 'x2' : card.value];
            const child = drawSequence(handNums, newMods, remWithout, hasSC, drawsLeft - 1);
            ev += w * (applyScoring(handNums, newMods, false) - currentScore + child.ev);
            pBust += w * child.pBust;
            for (let i = 0; i < child.pBustByDraw.length; i++)
                pBustByDraw[i + 1] += w * child.pBustByDraw[i];
        } else {
            // Action card during forced draws:
            // SecondChance grants SC if not already held; Freeze/FlipThree = 0-effect (no nested F3)
            const newHasSC = (card.name === 'SecondChance' && !hasSC) ? true : hasSC;
            const child = drawSequence(handNums, handMods, remWithout, newHasSC, drawsLeft - 1);
            ev += w * child.ev; pBust += w * child.pBust;
            for (let i = 0; i < child.pBustByDraw.length; i++)
                pBustByDraw[i + 1] += w * child.pBustByDraw[i];
        }
    }
    return { ev, pBust, pBustByDraw };
}

function getRecommendation(rawBustProb, effectiveBustProb, evHit, handSize, hasSC) {
    if (handSize === 0)
        return { action: 'HIT', cls: 'hit', reasoning: 'Empty hand — draw your first card.' };
    if (handSize >= 6 && effectiveBustProb < 0.5) {
        const scNote = hasSC ? ' SC protects against a duplicate.' : '';
        return { action: 'HIT', cls: 'hit',
            reasoning: `One number away from Flip 7! +${FLIP7_BONUS} bonus. Effective bust risk: ${pct(effectiveBustProb)}.${scNote}` };
    }
    const stayThreshold = hasSC ? 0.50 : 0.45;
    if (effectiveBustProb >= stayThreshold)
        return { action: 'STAY', cls: 'caution',
            reasoning: `High effective bust risk (${pct(effectiveBustProb)}).${hasSC ? ' Mainly from FlipThree forced draws.' : ''} Bank your score now.` };
    if (evHit > 0) {
        const riskLabel = effectiveBustProb < 0.25 ? 'Low' : 'Moderate';
        const scNote = hasSC && rawBustProb > 0
            ? ` SC shields duplicates (raw risk: ${pct(rawBustProb)}).` : '';
        return { action: 'HIT', cls: 'hit',
            reasoning: `${riskLabel} effective bust risk (${pct(effectiveBustProb)}).${scNote} EV of hitting: +${evHit.toFixed(1)} pts.` };
    }
    return { action: 'STAY', cls: 'stay',
        reasoning: `EV of hitting is negative (${evHit.toFixed(1)} pts). Stay and bank.` };
}

function pct(p) { return Math.round(p * 100) + '%'; }


/* ══════════════════════════════════════════════════════════════════
   §4  GAME ENGINE
   ══════════════════════════════════════════════════════════════════ */

function drawCard() {
    if (!gameState.deck.length) {
        // Reshuffle discard pile back into deck, excluding cards currently in player hands
        const inHands = new Set(gameState.players.flatMap(p => p.hand.map(c => c.id)));
        const available = gameState.discardThisRound.filter(c => !inHands.has(c.id));
        if (!available.length) return null; // truly empty — no cards anywhere
        gameState.deck = shuffle(available);
        gameState.discardThisRound = gameState.discardThisRound.filter(c => inHands.has(c.id));
        addLog('Draw pile empty — discarded cards reshuffled back in!', 'action');
    }
    const card = gameState.deck.pop();
    gameState.discardThisRound.push(card);
    return card;
}

function isPlayerActive(p) { return !p.frozen && !p.stayed && !p.busted && !p.hasFlip7; }

function nextDealTarget() {
    const n = gameState.players.length;
    let next = (gameState.currentDealTarget + 1) % n;
    for (let t = 0; t < n; t++) {
        if (isPlayerActive(gameState.players[next])) return next;
        next = (next + 1) % n;
    }
    return -1;
}

function processCard(player, card) {
    addLog(`${player.name} draws ${card.symbol}`, player.isHuman ? 'human' : '');

    if (card.type === 'number') {
        const dupe = player.numberCards.some(c => c.value === card.value);
        if (dupe) {
            if (player.secondChanceActive) {
                player.secondChanceActive = false;
                player.actionCards = player.actionCards.filter(c => c.name !== 'SecondChance');
                player.hand = player.hand.filter(c => c.name !== 'SecondChance');
                addLog(`${player.name} used Second Chance — ${card.symbol} discarded, continues!`, 'action');
                if (gameState.flipThreeState?.targetIdx === player.idx)
                    gameState.flipThreeState = null;
                // Player does NOT stay — they continue playing normally
                return 'second-chance';
            }
            // Show the bust card in hand (displayed red)
            player.hand.push({ ...card, isBust: true });
            player.busted = true;
            player.roundScore = 0;
            addLog(`${player.name} BUSTED on ${card.symbol}!`, 'bust');
            return 'bust';
        }
        player.numberCards.push(card);
        player.hand.push(card);
        if (player.numberCards.length === FLIP7_COUNT) {
            player.hasFlip7 = true;
            addLog(`${player.name} achieved FLIP 7!`, 'flip7');
            return 'flip7';
        }
        return 'ok';
    }

    if (card.type === 'modifier') {
        player.modifierCards.push(card);
        player.hand.push(card);
        return 'ok';
    }

    // action
    player.actionCards.push(card);
    player.hand.push(card);
    return 'action:' + card.name;
}

function resolveAction(srcPlayer, actionCard, targetPlayer) {
    srcPlayer.actionCards = srcPlayer.actionCards.filter(c => c.id !== actionCard.id);
    srcPlayer.hand = srcPlayer.hand.filter(c => c.id !== actionCard.id);

    if (actionCard.name === 'Freeze') {
        SoundEngine.freeze();
        addLog(`${srcPlayer.name} FROZE ${targetPlayer.name}!`, 'action');
        targetPlayer.frozen = true;
        targetPlayer.roundScore = computeRoundScore(targetPlayer);
        targetPlayer.hand.push({ ...actionCard, isReceived: true });
        addLog(`${targetPlayer.name} banks ${targetPlayer.roundScore} pts`, 'score');
        if (targetPlayer.roundScore > 0) floatScorePopup(targetPlayer.idx, targetPlayer.roundScore);
    } else if (actionCard.name === 'FlipThree') {
        SoundEngine.flipThree();
        addLog(`${srcPlayer.name} played FLIP THREE on ${targetPlayer.name}!`, 'action');
        if (gameState.flipThreeState) gameState.flipThreeState.cardsLeft += 3;
        else gameState.flipThreeState = { targetIdx: targetPlayer.idx, cardsLeft: 3, sourceName: srcPlayer.name };
    } else if (actionCard.name === 'SecondChance') {
        SoundEngine.secondChanceGet();
        addLog(`${srcPlayer.name} gave Second Chance to ${targetPlayer.name}!`, 'action');
        targetPlayer.secondChanceActive = true;
        targetPlayer.actionCards.push({ ...actionCard, isReceived: true });
        targetPlayer.hand.push({ ...actionCard, isReceived: true });
    }
}

function computeRoundScore(player) {
    if (player.busted) return 0;
    return applyScoring(
        player.numberCards.map(c => c.value),
        player.modifierCards.map(c => c.isX2 ? 'x2' : c.value),
        player.hasFlip7
    );
}

function endRound(reason) {
    if (gameState.phase !== 'playing') return; // guard against double-call
    gameState.phase = 'round_end';
    gameState.roundEndReason = reason;
    for (const p of gameState.players) {
        p.roundScore = computeRoundScore(p);
        p.totalScore += p.roundScore;
        if (!p.busted) {
            addLog(`${p.name}: +${p.roundScore} → total ${p.totalScore}`, 'score');
            if (p.roundScore > 0) floatScorePopup(p.idx, p.roundScore);
        }
    }
    const winners = gameState.players.filter(p => p.totalScore >= WIN_TARGET);
    if (winners.length) {
        gameState.phase = 'game_over';
        winners.sort((a, b) => b.totalScore - a.totalScore);
    }
}

function addLog(msg, cls = '') { gameState.log.push({ msg, cls }); }

// ✅ BUG FIX 1 — TURN STRUCTURE
// Each call to dealOneCard() gives exactly ONE card to ONE player, then advances.
// AI decides to stay BEFORE drawing (not after). After drawing one card, always advance.
function dealOneCard() {
    // ── FlipThree forced draws ──
    if (gameState.flipThreeState) {
        const ft = gameState.flipThreeState;
        const target = gameState.players[ft.targetIdx];

        if (!isPlayerActive(target)) { gameState.flipThreeState = null; return true; }

        const card = drawCard();
        if (!card) { endRound('deck-empty'); return false; }
        SoundEngine.cardDraw();

        // Show card reveal for human target of FlipThree forced draw
        if (target.isHuman && simConfig.animations) {
            const subtitle = `FLIP THREE by ${ft.sourceName ?? 'opponent'}`;
            showCardReveal(target, card, () => {
                const result = processCard(target, card);
                ft.cardsLeft--;
                if (result === 'flip7') { SoundEngine.flip7(); gameState.flipThreeState = null; endRound('flip7'); renderSimulator(); setTimeout(() => showRoundEnd(), 600); return; }
                if (result === 'bust') { SoundEngine.bust(); gameState.flipThreeState = null; renderSimulator(); return; }
                if (result === 'second-chance') { SoundEngine.secondChanceSave(); gameState.flipThreeState = null; renderSimulator(); return; }
                if (ft.cardsLeft <= 0) {
                    gameState.flipThreeState = null;
                    const pending = target.actionCards.filter(c => c.name === 'Freeze' || c.name === 'FlipThree');
                    if (pending.length) { queueActionPrompt(target, pending[0]); renderSimulator(); return; }
                }
                renderSimulator();
                setTimeout(() => continueGame(), getVizDelay());
            }, { subtitle });
            return 'wait-reveal';
        }

        const result = processCard(target, card);
        ft.cardsLeft--;

        if (result === 'flip7') { SoundEngine.flip7(); gameState.flipThreeState = null; endRound('flip7'); return false; }
        if (result === 'bust') { SoundEngine.bust(); gameState.flipThreeState = null; return true; }
        if (result === 'second-chance') { SoundEngine.secondChanceSave(); gameState.flipThreeState = null; return true; }

        if (ft.cardsLeft <= 0) {
            gameState.flipThreeState = null;
            // Resolve any Freeze/FlipThree action cards the target holds
            const pending = target.actionCards.filter(c => c.name === 'Freeze' || c.name === 'FlipThree');
            if (pending.length && target.isHuman) { queueActionPrompt(target, pending[0]); return 'wait-action'; }
            if (pending.length) { const t2 = aiChooseTarget(target, pending[0].name); if (t2) resolveAction(target, pending[0], t2); }
        }
        return true;
    }

    // ── Check if round is over ──
    const active = gameState.players.filter(isPlayerActive);
    if (!active.length) { endRound('all-done'); return false; }

    // Skip inactive players
    const player = gameState.players[gameState.currentDealTarget];
    if (!isPlayerActive(player)) {
        gameState.currentDealTarget = nextDealTarget();
        if (gameState.currentDealTarget === -1) { endRound('all-done'); return false; }
        return true;
    }

    // ── Human turn: wait for input ──
    if (player.isHuman) return 'wait-human';

    // ── AI turn: decide BEFORE drawing ──
    const decision = aiDecide(player);
    if (decision.action === 'stay') {
        SoundEngine.aiStay();
        player.stayed = true;
        player.roundScore = computeRoundScore(player);
        addLog(`${player.name} stays (${player.roundScore} pts)`, 'stay');
        addLog(decision.reasoning, 'reasoning');
        gameState.currentDealTarget = nextDealTarget();
        if (gameState.currentDealTarget === -1) { endRound('all-done'); return false; }
        return true;
    }

    // AI hits — draw exactly ONE card, then advance
    addLog(decision.reasoning, 'reasoning');
    const card = drawCard();
    if (!card) { endRound('deck-empty'); return false; }
    SoundEngine.cardDraw();
    const result = processCard(player, card);

    if (result === 'flip7') { SoundEngine.flip7(); endRound('flip7'); return false; }

    if (result === 'bust') { SoundEngine.bust(); gameState.currentDealTarget = nextDealTarget(); if (gameState.currentDealTarget === -1) { endRound('all-done'); return false; } return true; }
    if (result === 'second-chance') { SoundEngine.secondChanceSave(); gameState.currentDealTarget = nextDealTarget(); if (gameState.currentDealTarget === -1) { endRound('all-done'); return false; } return true; }

    if (result.startsWith('action:')) {
        const name = result.split(':')[1];
        const ac = player.actionCards[player.actionCards.length - 1];
        if (name === 'SecondChance') {
            if (player.secondChanceActive) {
                // Already holding one — give to another (AI gives to lowest-threat target)
                const t2 = aiChooseTarget(player, 'SecondChance');
                if (t2) {
                    addLog(`${player.name} already has Second Chance — passing it on`, 'reasoning');
                    resolveAction(player, ac, t2);
                } else {
                    // No valid target — discard
                    player.actionCards = player.actionCards.filter(c => c.id !== ac.id);
                    player.hand = player.hand.filter(c => c.id !== ac.id);
                }
            } else {
                SoundEngine.secondChanceGet();
                player.secondChanceActive = true;
                addLog(`${player.name} holds Second Chance`);
            }
        } else {
            const t2 = aiChooseTarget(player, name);
            if (t2) resolveAction(player, ac, t2);
        }
    }

    // Always advance after drawing one card
    gameState.currentDealTarget = nextDealTarget();
    if (gameState.currentDealTarget === -1) { endRound('all-done'); return false; }
    return true;
}

// Human pressed HIT — draw one card, show reveal, then advance turn
function humanHit() {
    const player = gameState.players[gameState.currentDealTarget];
    if (!player?.isHuman || !isPlayerActive(player)) return;

    const card = drawCard();
    if (!card) { endRound('deck-empty'); renderSimulator(); setTimeout(() => showRoundEnd(), 400); return; }

    SoundEngine.cardDraw();

    showCardReveal(player, card, () => {
        const result = processCard(player, card);
        renderSimulator();

        // Flash the newly acquired card in the player's hand
        const cardEl = document.querySelector(`[data-card-id="${card.id}"]`);
        if (cardEl) {
            cardEl.classList.add('card-just-acquired');
            cardEl.addEventListener('animationend', () => cardEl.classList.remove('card-just-acquired'), { once: true });
        }

        if (result === 'flip7') {
            SoundEngine.flip7();
            endRound('flip7');
            renderSimulator();
            setTimeout(() => showRoundEnd(), 400);
            return;
        }

        if (result === 'second-chance') {
            SoundEngine.secondChanceSave();
            gameState.currentDealTarget = nextDealTarget();
            if (gameState.currentDealTarget === -1) { endRound('all-done'); setTimeout(() => showRoundEnd(), 400); return; }
            setTimeout(() => continueGame(), 300);
            return;
        }

        if (result === 'bust') {
            gameState.currentDealTarget = nextDealTarget();
            if (gameState.currentDealTarget === -1) { endRound('all-done'); setTimeout(() => showRoundEnd(), 400); return; }
            setTimeout(() => continueGame(), 300);
            return;
        }

        if (result.startsWith('action:')) {
            const name = result.split(':')[1];
            const ac = player.actionCards[player.actionCards.length - 1];
            if (name === 'SecondChance') {
                if (player.secondChanceActive) {
                    queueActionPrompt(player, ac);
                    return;
                }
                SoundEngine.secondChanceGet();
                player.secondChanceActive = true;
                addLog('You hold Second Chance — next bust is blocked', 'human');
                gameState.currentDealTarget = nextDealTarget();
                if (gameState.currentDealTarget === -1) { endRound('all-done'); setTimeout(() => showRoundEnd(), 400); return; }
                renderSimulator();
                setTimeout(() => continueGame(), 300);
                return;
            } else {
                queueActionPrompt(player, ac);
                return;
            }
        }

        // Normal hit — advance to next player
        gameState.currentDealTarget = nextDealTarget();
        if (gameState.currentDealTarget === -1) { endRound('all-done'); setTimeout(() => showRoundEnd(), 400); return; }
        setTimeout(() => continueGame(), 300);
    });
}

function humanStay() {
    const player = gameState.players[gameState.currentDealTarget];
    if (!player?.isHuman || !isPlayerActive(player)) return;

    SoundEngine.stay();
    player.stayed = true;
    player.roundScore = computeRoundScore(player);
    addLog(`You stay with ${player.roundScore} pts`, 'human');

    gameState.currentDealTarget = nextDealTarget();
    renderSimulator();
    if (gameState.currentDealTarget === -1) { endRound('all-done'); showRoundEnd(); return; }
    setTimeout(() => continueGame(), 300);
}

function queueActionPrompt(player, actionCard) {
    const isFlipThree = actionCard.name === 'FlipThree';
    const validTargets = gameState.players.filter(p =>
        (isFlipThree || p.idx !== player.idx) && isPlayerActive(p)
    );
    if (!validTargets.length) {
        // No valid targets — discard the action card silently and advance
        addLog(`${player.name}: no valid targets for ${actionCard.name} — discarded`, 'action');
        player.actionCards = player.actionCards.filter(c => c.id !== actionCard.id);
        player.hand = player.hand.filter(c => c.id !== actionCard.id);
        gameState.currentDealTarget = nextDealTarget();
        renderSimulator();
        if (gameState.currentDealTarget === -1) { endRound('all-done'); setTimeout(() => showRoundEnd(), 400); return; }
        setTimeout(() => continueGame(), 400);
        return;
    }
    gameState.actionPending = { sourceIdx: player.idx, card: actionCard };
    renderSimulator();
    showActionModal(player, actionCard);
}

function resolveActionChoice(targetIdx) {
    const pending = gameState.actionPending;
    if (!pending) return;
    if (targetIdx === pending.sourceIdx && pending.card.name !== 'FlipThree') return;
    gameState.actionPending = null;
    hideActionModal();

    const src = gameState.players[pending.sourceIdx];
    const tgt = gameState.players[targetIdx];
    resolveAction(src, pending.card, tgt);
    renderSimulator();

    // After action resolves, advance human's turn in rotation
    gameState.currentDealTarget = nextDealTarget();
    if (gameState.currentDealTarget === -1) { endRound('all-done'); setTimeout(() => showRoundEnd(), 400); return; }
    setTimeout(() => continueGame(), 500);
}

function continueGame() {
    if (gameState.phase !== 'playing') return;

    // If autoplay is off and it's a non-forced AI turn, pause for manual trigger
    if (!simConfig.autoplay && !gameState.flipThreeState) {
        const cur = gameState.players[gameState.currentDealTarget];
        if (cur && !cur.isHuman && isPlayerActive(cur)) {
            renderSimulator(); // shows NEXT AI MOVE button
            return;
        }
    }

    const result = dealOneCard();
    if (result === false) { renderSimulator(); setTimeout(() => showRoundEnd(), 600); return; }
    if (result === 'wait-human' || result === 'wait-action' || result === 'wait-reveal') { renderSimulator(); return; }
    renderSimulator();

    const delay = getVizDelay();
    if (delay === 0) {
        continueGame();
    } else {
        gameState.aiTimer = setTimeout(() => continueGame(), delay);
    }
}

function startGame(playerCount, aiDifficulty) {
    resetGameState();
    // Build combined deck with unique IDs across all copies
    const combined = [];
    let newId = 0;
    for (let d = 0; d < simConfig.deckCount; d++)
        for (const card of FULL_DECK)
            combined.push({ ...card, id: newId++ });
    gameState.deck = shuffle(combined);
    gameState.phase = 'playing';
    gameState.round = 1;

    for (let i = 0; i < playerCount; i++)
        gameState.players.push(makePlayer(i, i === 0 ? 'YOU' : `CPU ${i}`, i === 0, aiDifficulty));

    // ✅ BUG FIX 3: dealer = last player so human (idx 0) is dealt to first
    gameState.dealerIndex = playerCount - 1;

    addLog(`Game started — first to ${WIN_TARGET} wins`, 'round');
    addLog(`Round 1`, 'round');
    resetRound();
    renderSimulator();
    setTimeout(() => continueGame(), 600);
}

function startNextRound() {
    if (gameState.aiTimer) { clearTimeout(gameState.aiTimer); gameState.aiTimer = null; }
    gameState.round++;
    gameState.phase = 'playing';
    addLog(`Round ${gameState.round}`, 'round');
    animateShuffle(() => {
        resetRound();
        renderSimulator();
        setTimeout(() => continueGame(), 200);
    });
}


/* ══════════════════════════════════════════════════════════════════
   §5  AI STRATEGY
   ══════════════════════════════════════════════════════════════════ */

function aiDecide(player) {
    const diff = player.aiDifficulty;
    if (diff === 'easy') return aiDecideEasy(player);
    if (diff === 'hard') return aiDecideHard(player);
    return aiDecideMedium(player);
}

function aiDecideEasy(player) {
    const score = computeRoundScore(player);
    if (score >= 20 && Math.random() < 0.65)
        return { action: 'stay', reasoning: `Score ${score} looks good enough — banking.` };
    if (score >= 12 && Math.random() < 0.4)
        return { action: 'stay', reasoning: `${score} pts — randomly decided to stop.` };
    return { action: 'hit', reasoning: `Score ${score} — taking a risk.` };
}

function aiDecideMedium(player) {
    const remaining = [...gameState.deck];
    const bp = computeBustProbability(player.numberCards.map(c => c.value), remaining);
    if (bp > 0.30)
        return { action: 'stay', reasoning: `Bust risk ${pct(bp)} > 30% — not worth it.` };
    if (player.numberCards.length >= 6)
        return { action: 'hit', reasoning: `${player.numberCards.length} numbers — Flip 7 within reach!` };
    const { evHit } = computeExpectedValue(
        player.numberCards.map(c => c.value),
        player.modifierCards.map(c => c.isX2 ? 'x2' : c.value),
        remaining
    );
    return evHit > 0
        ? { action: 'hit', reasoning: `EV +${evHit.toFixed(1)} pts, bust risk ${pct(bp)} — hitting.` }
        : { action: 'stay', reasoning: `EV ${evHit.toFixed(1)} is negative — banking ${computeRoundScore(player)} pts.` };
}

function aiDecideHard(player) {
    // Hard AI does full card-counting: when the draw pile is thin, factor in the
    // discard pile (minus cards in other players' hands) since a reshuffle is imminent.
    const inHands = new Set(gameState.players.flatMap(p => p.hand.map(c => c.id)));
    const reshufflable = gameState.discardThisRound.filter(c => !inHands.has(c.id));
    const totalAvailable = gameState.deck.length + reshufflable.length;
    // If deck is < 25% of available pool, treat the reshuffle as effectively already happened
    const remaining = (gameState.deck.length < totalAvailable * 0.25)
        ? [...gameState.deck, ...reshufflable]
        : [...gameState.deck];
    const numVals = player.numberCards.map(c => c.value);
    const modVals = player.modifierCards.map(c => c.isX2 ? 'x2' : c.value);
    const bp = computeBustProbability(numVals, remaining);
    const leaderScore = Math.max(...gameState.players.map(p => p.totalScore));
    const deficit = leaderScore - player.totalScore;
    const tolerance = deficit > 50 ? 0.45 : 0.28;
    if (bp > tolerance)
        return { action: 'stay', reasoning: `Bust ${pct(bp)} > tolerance ${pct(tolerance)} (deficit ${deficit}) — banking ${computeRoundScore(player)} pts.` };
    if (player.numberCards.length >= 6)
        return { action: 'hit', reasoning: `${player.numberCards.length} numbers — going for Flip 7!` };
    const anyChasing = gameState.players.some(p => p !== player && isPlayerActive(p) && p.numberCards.length >= 5);
    if (anyChasing && player.numberCards.length >= 4 && bp < 0.4)
        return { action: 'hit', reasoning: `Opponent near Flip 7 — must keep pressure (bust ${pct(bp)}).` };
    const { evHit } = computeExpectedValue(numVals, modVals, remaining);
    return evHit > 0
        ? { action: 'hit', reasoning: `EV +${evHit.toFixed(1)}, ${deficit > 0 ? deficit + ' pts behind' : 'leading'} — hitting.` }
        : { action: 'stay', reasoning: `EV ${evHit.toFixed(1)} negative — banking ${computeRoundScore(player)} pts.` };
}

function aiChooseTarget(src, actionName) {
    const others = gameState.players.filter(p => p.idx !== src.idx && isPlayerActive(p));
    if (others.length)
        return others.reduce((best, p) => computeRoundScore(p) > computeRoundScore(best) ? p : best, others[0]);
    // Self-target only as last resort for FlipThree
    if (actionName === 'FlipThree' && isPlayerActive(src)) return src;
    return null;
}


/* ══════════════════════════════════════════════════════════════════
   §6  TAB ROUTER
   ══════════════════════════════════════════════════════════════════ */

let activeTab = 'simulator';

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });
}

function showTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === name);
        b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('active', p.id === 'tab-' + name);
        p.classList.toggle('hidden', p.id !== 'tab-' + name);
    });
    if (name === 'analyzer') {
        if (analyzerState.syncGameHand) syncHandFromGame();
        buildAnalyzerChips();
        renderAnalyzer();
    }
    if (name === 'tracker')   renderTracker();
    if (name === 'simulator') renderSimulator();
}


/* ══════════════════════════════════════════════════════════════════
   §6a  SOUND ENGINE  (Web Audio API — procedural, no files)
   ══════════════════════════════════════════════════════════════════ */

const SoundEngine = (() => {
    let _ctx = null;

    function ac() {
        if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (_ctx.state === 'suspended') _ctx.resume();
        return _ctx;
    }

    function go(fn) {
        if (!simConfig.sounds) return;
        try { fn(ac()); } catch (e) {}
    }

    // ── Primitive builders ──
    function osc(c, type, freqSpec, t, dur, vol) {
        const o = c.createOscillator();
        o.type = type;
        if (Array.isArray(freqSpec)) {
            o.frequency.setValueAtTime(freqSpec[0], t);
            o.frequency.exponentialRampToValueAtTime(freqSpec[1], t + dur);
        } else {
            o.frequency.value = freqSpec;
        }
        const g = c.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(c.destination);
        o.start(t); o.stop(t + dur + 0.02);
    }
    function sine(c, f, t, dur, vol = 0.28) { osc(c, 'sine',     f, t, dur, vol); }
    function tri (c, f, t, dur, vol = 0.28) { osc(c, 'triangle', f, t, dur, vol); }
    function saw (c, f, t, dur, vol = 0.22) { osc(c, 'sawtooth', f, t, dur, vol); }
    function sqr (c, f, t, dur, vol = 0.18) { osc(c, 'square',   f, t, dur, vol); }

    function noise(c, t, dur, vol, fc = 3000, Q = 2) {
        const len = Math.ceil(c.sampleRate * (dur + 0.02));
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d   = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = c.createBufferSource(); src.buffer = buf;
        const flt = c.createBiquadFilter(); flt.type = 'bandpass';
        flt.frequency.value = fc; flt.Q.value = Q;
        const g = c.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(flt); flt.connect(g); g.connect(c.destination);
        src.start(t); src.stop(t + dur + 0.02);
    }

    // ── Named sounds ──

    // Card sliding off the deck — paper swish
    function cardDraw() {
        go(c => {
            const t = c.currentTime;
            noise(c, t,        0.06, 0.18, 4000, 5);
            noise(c, t + 0.02, 0.05, 0.10, 1400, 2);
        });
    }

    // Non-duplicate card settles — soft positive tick
    function cardRevealGood() {
        go(c => { tri(c, 1100, c.currentTime, 0.14, 0.13); });
    }

    // Duplicate card hits table — heavy thud + dissonant buzz
    function cardRevealBust() {
        go(c => {
            const t = c.currentTime;
            sine(c, [130, 45], t, 0.28, 0.38);
            saw (c, [190, 80], t, 0.22, 0.14);
        });
    }

    // Player stays — two rising casino chip sounds
    function stay() {
        go(c => {
            const t = c.currentTime;
            tri(c, 523, t,        0.18, 0.30);
            tri(c, 659, t + 0.13, 0.20, 0.28);
        });
    }

    // AI stays — quieter single tone, less intrusive
    function aiStay() {
        go(c => { tri(c, 440, c.currentTime, 0.10, 0.11); });
    }

    // Bust confirmation (AI bust, or end of human reveal sequence)
    function bust() {
        go(c => {
            const t = c.currentTime;
            saw(c, [220, 55], t, 0.42, 0.28);
            sine(c, [150, 38], t, 0.35, 0.18);
        });
    }

    // 7 ascending notes + sparkle chord
    function flip7() {
        go(c => {
            const t = c.currentTime;
            const steps = [0, 4, 7, 12, 16, 19, 24];
            steps.forEach((s, i) =>
                tri(c, 261.63 * Math.pow(2, s / 12), t + i * 0.075, 0.22, 0.22));
            // sparkle
            [1046.5, 1318.5, 1567.98].forEach(f =>
                sine(c, f, t + 7 * 0.075, 0.45, 0.13));
        });
    }

    // Ice-crystal ping with shimmer overtones
    function freeze() {
        go(c => {
            const t = c.currentTime;
            sine(c, 1760, t,        0.55, 0.28);
            sine(c, 2349, t + 0.04, 0.40, 0.14);
            sine(c,  880, t + 0.09, 0.50, 0.11);
        });
    }

    // Three fast staccato pops
    function flipThree() {
        go(c => {
            const t = c.currentTime;
            [360, 500, 700].forEach((f, i) => sqr(c, f, t + i * 0.07, 0.09, 0.17));
        });
    }

    // Second Chance blocked a bust — rising protective shimmer
    function secondChanceSave() {
        go(c => {
            const t = c.currentTime;
            sine(c, [280, 560], t,        0.20, 0.26);
            sine(c, [420, 840], t + 0.06, 0.25, 0.16);
        });
    }

    // Just received / picked up Second Chance
    function secondChanceGet() {
        go(c => {
            const t = c.currentTime;
            tri(c, 880,  t,        0.15, 0.20);
            tri(c, 1108, t + 0.09, 0.15, 0.14);
        });
    }

    // End of round — descending chime
    function roundEnd() {
        go(c => {
            const t = c.currentTime;
            sine(c, 880, t,        0.40, 0.24);
            sine(c, 698, t + 0.20, 0.40, 0.18);
        });
    }

    // Winner fanfare — ascending heroic phrase
    function gameOver() {
        go(c => {
            const t = c.currentTime;
            const melody = [
                [261.63,0], [329.63,0.10], [392,0.20],
                [523.25,0.36], [392,0.48], [523.25,0.58], [659.25,0.72],
            ];
            melody.forEach(([f, dt]) => tri(c, f, t + dt, 0.22, 0.28));
            // Final chord
            [523.25, 659.25, 783.99].forEach(f =>
                sine(c, f, t + 0.95, 0.55, 0.16));
        });
    }

    // Sad trombone — wah-wah-wah-waaah descending glide
    function sadTrombone() {
        go(c => {
            const t = c.currentTime;
            // Three short "wah" punches followed by a long descending wail
            const wahs = [[440, 370, 0.00, 0.18], [370, 311, 0.22, 0.18], [311, 261, 0.44, 0.18]];
            wahs.forEach(([f0, f1, dt, dur]) => {
                const o = c.createOscillator();
                o.type = 'sawtooth';
                o.frequency.setValueAtTime(f0, t + dt);
                o.frequency.exponentialRampToValueAtTime(f1, t + dt + dur);
                const g = c.createGain();
                g.gain.setValueAtTime(0.22, t + dt);
                g.gain.exponentialRampToValueAtTime(0.001, t + dt + dur);
                o.connect(g); g.connect(c.destination);
                o.start(t + dt); o.stop(t + dt + dur + 0.02);
            });
            // Long descending wail: 261 → 130 over ~1.1 s
            const o2 = c.createOscillator();
            o2.type = 'sawtooth';
            o2.frequency.setValueAtTime(261, t + 0.66);
            o2.frequency.exponentialRampToValueAtTime(130, t + 1.78);
            const g2 = c.createGain();
            g2.gain.setValueAtTime(0.26, t + 0.66);
            g2.gain.exponentialRampToValueAtTime(0.001, t + 1.78);
            o2.connect(g2); g2.connect(c.destination);
            o2.start(t + 0.66); o2.stop(t + 1.80);
        });
    }

    // Riffle shuffle — 5 quick noise bursts
    function shuffle() {
        go(c => {
            const t = c.currentTime;
            for (let i = 0; i < 5; i++)
                noise(c, t + i * 0.048, 0.04, 0.20, 1800 + i * 280, 3);
        });
    }

    return {
        cardDraw, cardRevealGood, cardRevealBust,
        stay, aiStay, bust, flip7,
        freeze, flipThree, secondChanceSave, secondChanceGet,
        roundEnd, gameOver, sadTrombone, shuffle,
    };
})();


/* ══════════════════════════════════════════════════════════════════
   §6b  ANIMATION HELPERS
   ══════════════════════════════════════════════════════════════════ */

function showCardReveal(player, card, onDismiss, opts = {}) {
    const dur = getAnimDuration();
    if (dur === 0) { onDismiss(); return; }

    const timeoutMs = Math.max(5400, Math.min(9000, dur * 24));
    const isDupe = card.type === 'number' && player.numberCards.some(c => c.value === card.value);
    const label = isDupe
        ? 'DUPLICATE — BUST!'
        : card.type === 'modifier' ? (card.isX2 ? '×2 MULTIPLIER' : card.symbol + ' MODIFIER')
        : card.type === 'action'   ? card.name.toUpperCase()
        : 'NUMBER ' + card.value;

    const overlay = document.createElement('div');
    overlay.className = 'card-reveal-overlay';
    overlay.style.setProperty('--reveal-dur', dur + 'ms');
    overlay.style.setProperty('--reveal-timeout', timeoutMs + 'ms');
    const corner = card.type === 'number' ? `<span class="card-corner">${card.value}</span>` : '';
    const typeClass = card.type + (isDupe ? ' bust-card' : '');
    const dataAttr = card.type === 'number' ? ` data-value="${card.value}"`
                   : card.type === 'action'  ? ` data-action="${card.name}"`
                   : '';
    const subtitleHtml = opts.subtitle ? `<div class="reveal-subtitle">${esc(opts.subtitle)}</div>` : '';
    overlay.innerHTML = `
        <div class="card-reveal-dialog${isDupe ? ' reveal-bad' : ''}">
            <div class="reveal-card-wrap">
                <div class="playing-card ${typeClass}"${dataAttr}>
                    ${corner}<span class="card-value-main">${card.symbol}</span>
                </div>
                ${isDupe ? '<div class="reveal-cross">✕</div>' : ''}
            </div>
            ${subtitleHtml}
            <div class="reveal-label">${label}</div>
            <div class="reveal-hint">CLICK TO CONTINUE</div>
            <div class="reveal-progress-bar"></div>
        </div>`;

    (document.getElementById('sim-game') || document.body).appendChild(overlay);

    // Mouse parallax tilt on the reveal card (sqrt-based soft limit)
    overlay.addEventListener('mousemove', e => {
        const cardEl = overlay.querySelector('.playing-card');
        if (!cardEl) return;
        const rect = cardEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top  + rect.height / 2;
        const rawDx = (e.clientX - cx) / (rect.width  / 2);
        const rawDy = (e.clientY - cy) / (rect.height / 2);
        const tiltY =  Math.sign(rawDx) * Math.sqrt(Math.abs(rawDx)) * 10;
        const tiltX = -Math.sign(rawDy) * Math.sqrt(Math.abs(rawDy)) * 12;
        cardEl.style.animation = 'none';
        cardEl.style.transform = `perspective(700px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translateY(-6px) scale(1.03)`;
    });
    overlay.addEventListener('mouseleave', () => {
        const cardEl = overlay.querySelector('.playing-card');
        if (!cardEl) return;
        cardEl.style.transform = '';
        cardEl.style.animation = '';
    });

    let dismissed = false;
    let autoTimer = null;

    function dismiss() {
        if (dismissed) return;
        dismissed = true;
        if (autoTimer) clearTimeout(autoTimer);

        const dialog = overlay.querySelector('.card-reveal-dialog');
        const playerHandEl = document.querySelector(`[data-player-idx="${player.idx}"] .player-hand`);
        const targetRect = playerHandEl?.getBoundingClientRect();
        const dialogRect = dialog.getBoundingClientRect();

        if (targetRect) {
            const dx = (targetRect.left + targetRect.width / 2) - (dialogRect.left + dialogRect.width / 2);
            const dy = (targetRect.top  + targetRect.height / 2) - (dialogRect.top  + dialogRect.height / 2);
            dialog.style.transition = `transform ${dur}ms cubic-bezier(0.4,0,0.2,1), opacity ${Math.round(dur * 0.7)}ms ease`;
            dialog.style.transform  = `translate(${dx}px, ${dy}px) scale(0.06)`;
            dialog.style.opacity    = '0';
        } else {
            dialog.style.transition = `opacity ${dur}ms ease, transform ${dur}ms ease`;
            dialog.style.transform  = 'scale(0.1)';
            dialog.style.opacity    = '0';
        }
        setTimeout(() => { overlay.remove(); onDismiss(); }, dur + 16);
    }

    overlay.addEventListener('click', dismiss, { once: true });

    // Double rAF ensures the transition fires after paint
    requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.querySelector('.card-reveal-dialog').classList.add('entered');
        // Play outcome sound once the card "lands"
        setTimeout(() => isDupe ? SoundEngine.cardRevealBust() : SoundEngine.cardRevealGood(), dur);
        const bar = overlay.querySelector('.reveal-progress-bar');
        if (bar) bar.classList.add('draining');
        autoTimer = setTimeout(dismiss, timeoutMs);
    }));
}

function animateDiscardFly(callback) {
    const dur = getAnimDuration();
    if (dur === 0) { callback(); return; }

    const discardBtn = document.getElementById('sim-discard-btn');
    if (!discardBtn) { callback(); return; }

    const cardEls = Array.from(document.querySelectorAll('.player-card .playing-card')).slice(0, 30);
    if (!cardEls.length) { callback(); return; }

    const tgt = discardBtn.getBoundingClientRect();
    const tx = tgt.left + tgt.width  / 2;
    const ty = tgt.top  + tgt.height / 2;

    const clones = cardEls.map(card => {
        const r = card.getBoundingClientRect();
        const cl = card.cloneNode(true);
        Object.assign(cl.style, {
            position: 'fixed', left: r.left + 'px', top: r.top + 'px',
            width: r.width + 'px', height: r.height + 'px',
            zIndex: 150, margin: '0', pointerEvents: 'none', transition: 'none',
        });
        document.body.appendChild(cl);
        return { el: cl, r };
    });

    requestAnimationFrame(() => requestAnimationFrame(() => {
        clones.forEach(({ el, r }, i) => {
            const stagger = i * Math.min(8, dur / clones.length);
            const dx = tx - (r.left + r.width  / 2);
            const dy = ty - (r.top  + r.height / 2);
            const rot = (Math.random() - 0.5) * 40;
            el.style.transition = `transform ${dur}ms cubic-bezier(0.3,0,1,1) ${stagger}ms, opacity ${Math.round(dur * 0.5)}ms ease ${stagger + Math.round(dur * 0.5)}ms`;
            el.style.transform  = `translate(${dx}px,${dy}px) scale(0.25) rotate(${rot}deg)`;
            el.style.opacity    = '0';
        });
        const total = dur + clones.length * Math.min(8, dur / clones.length) + 40;
        setTimeout(() => { clones.forEach(c => c.el.remove()); callback(); }, total);
    }));
}

function animateShuffle(callback) {
    const dur = getAnimDuration();
    SoundEngine.shuffle();
    if (dur === 0) { callback(); return; }

    const container = document.getElementById('sim-game') || document.body;
    const overlay = document.createElement('div');
    overlay.className = 'shuffle-overlay';
    overlay.style.setProperty('--sh-dur', dur + 'ms');
    overlay.innerHTML = `
        <div class="shuffle-content">
            <div class="shuffle-cards">
                ${[0,1,2,3,4].map(i => `<div class="shuffle-card" style="--si:${i}"></div>`).join('')}
            </div>
            <div class="shuffle-label">SHUFFLING DECK…</div>
        </div>`;
    container.appendChild(overlay);

    // Play for 2× dur, then fade out for 1× dur
    setTimeout(() => overlay.classList.add('shuffle-fadeout'), dur * 2);
    setTimeout(() => { overlay.remove(); callback(); }, dur * 3);
}


/* ══════════════════════════════════════════════════════════════════
   §7  SIMULATOR UI
   ══════════════════════════════════════════════════════════════════ */

// ── Visual pile button (stacked card silhouettes + count) ──
function renderPileBtn(id, label, count, total) {
    const btn = document.getElementById(id);
    if (!btn) return;
    const filled = total > 0 ? Math.ceil(count / total * 3) : 0; // 0–3 visible ghosts
    const ghosts = [0, 1, 2].map(i =>
        `<div class="pile-ghost${i < filled ? '' : ' pile-ghost-empty'}"></div>`
    ).join('');
    btn.innerHTML = `<div class="pile-visual">${ghosts}<span class="pile-count-badge">${count}</span></div><span class="pile-label-text">${label}</span>`;
}

// ── Turn order strip ──
function renderTurnStrip() {
    const strip = document.getElementById('sim-turn-strip');
    if (!strip) return;
    if (gameState.phase !== 'playing' && gameState.phase !== 'round_end') { strip.innerHTML = ''; return; }
    strip.innerHTML = gameState.players.map((p, i) => {
        const isCurrent  = p.idx === gameState.currentDealTarget && gameState.phase === 'playing';
        const isInactive = !isPlayerActive(p);
        const cls = ['turn-token',
            isCurrent  ? 'tok-active'   : '',
            isInactive ? 'tok-inactive' : '',
            p.isHuman  ? 'tok-human'    : '',
        ].filter(Boolean).join(' ');
        return `${i > 0 ? '<span class="turn-arrow">›</span>' : ''}
                <div class="${cls}" title="${p.name}">${p.name.charAt(0)}</div>`;
    }).join('');
}

// ── Floating "+X pts" score popup ──
function floatScorePopup(playerIdx, amount) {
    if (amount <= 0) return;
    const el = document.querySelector(`[data-player-idx="${playerIdx}"]`);
    if (!el) return;
    const popup = document.createElement('div');
    popup.className = 'score-popup';
    popup.textContent = '+' + amount;
    el.appendChild(popup);
    popup.addEventListener('animationend', () => popup.remove(), { once: true });
}

function initSimulator() {
    // ── Player count stepper ──
    const countDisplay = document.getElementById('count-display');
    function updateCountDisplay() {
        if (countDisplay) countDisplay.textContent = simConfig.playerCount;
    }
    document.getElementById('count-dec')?.addEventListener('click', () => {
        if (simConfig.playerCount > 2) { simConfig.playerCount--; updateCountDisplay(); }
    });
    document.getElementById('count-inc')?.addEventListener('click', () => {
        if (simConfig.playerCount < 20) { simConfig.playerCount++; updateCountDisplay(); }
    });

    // ── Deck count stepper ──
    const deckDisplay = document.getElementById('deck-count-display');
    function updateDeckDisplay() {
        if (deckDisplay) deckDisplay.textContent = simConfig.deckCount;
    }
    document.getElementById('deck-dec')?.addEventListener('click', () => {
        if (simConfig.deckCount > 1) { simConfig.deckCount--; updateDeckDisplay(); }
    });
    document.getElementById('deck-inc')?.addEventListener('click', () => {
        if (simConfig.deckCount < 4) { simConfig.deckCount++; updateDeckDisplay(); }
    });

    // ── AI level description ──
    const aiSelect = document.getElementById('sim-ai-level');
    const aiDesc   = document.getElementById('sim-ai-desc');
    function updateAiDesc() {
        if (aiDesc) aiDesc.textContent = AI_LEVEL_DESCS[aiSelect?.value] || '';
    }
    aiSelect?.addEventListener('change', updateAiDesc);
    updateAiDesc();

    // ── Start / Reset buttons ──
    document.getElementById('sim-start-btn').addEventListener('click', () => {
        const aiLevel = document.getElementById('sim-ai-level').value;
        document.getElementById('sim-start-btn').classList.add('hidden');
        document.getElementById('sim-reset-btn').classList.remove('hidden');
        document.getElementById('sim-game').classList.remove('hidden');
        startGame(simConfig.playerCount, aiLevel);
    });

    document.getElementById('sim-reset-btn').addEventListener('click', () => {
        if (gameState.aiTimer) clearTimeout(gameState.aiTimer);
        hideActionModal();
        ['sim-round-end','sim-game-over','sim-ai-controls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.getElementById('sim-game').classList.add('hidden');
        document.getElementById('sim-start-btn').classList.remove('hidden');
        document.getElementById('sim-reset-btn').classList.add('hidden');
        resetGameState();
    });

    document.getElementById('sim-hit-btn').addEventListener('click', humanHit);
    document.getElementById('sim-stay-btn').addEventListener('click', humanStay);
    document.getElementById('sim-next-round-btn').addEventListener('click', () => {
        document.getElementById('sim-round-end').classList.add('hidden');
        startNextRound();
    });
    document.getElementById('sim-next-round-ctrl-btn')?.addEventListener('click', () => {
        document.getElementById('sim-round-end').classList.add('hidden');
        startNextRound();
    });
    document.getElementById('sim-round-end-close')?.addEventListener('click', () => {
        document.getElementById('sim-round-end').classList.add('hidden');
    });
    document.getElementById('sim-round-end')?.addEventListener('click', e => {
        if (e.target === document.getElementById('sim-round-end'))
            document.getElementById('sim-round-end').classList.add('hidden');
    });
    document.getElementById('sim-play-again-btn').addEventListener('click', () => {
        ['sim-game-over','sim-game'].forEach(id => document.getElementById(id).classList.add('hidden'));
        document.getElementById('sim-start-btn').classList.remove('hidden');
        document.getElementById('sim-reset-btn').classList.add('hidden');
        resetGameState();
    });

    // ── Pile modals ──
    document.getElementById('sim-draw-btn').addEventListener('click', () => showPileModal('draw'));
    document.getElementById('sim-discard-btn').addEventListener('click', () => showPileModal('discard'));
    document.getElementById('sim-pile-close').addEventListener('click', hidePileModal);
    document.getElementById('sim-pile-modal').addEventListener('click', e => {
        if (e.target === document.getElementById('sim-pile-modal')) hidePileModal();
    });

    // ── AI autoplay toggle ──
    document.getElementById('sim-autoplay-btn')?.addEventListener('click', () => {
        simConfig.autoplay = !simConfig.autoplay;
        const btn = document.getElementById('sim-autoplay-btn');
        if (btn) {
            btn.textContent = simConfig.autoplay ? 'AUTOPLAY: ON' : 'AUTOPLAY: OFF';
            btn.classList.toggle('autoplay-on', simConfig.autoplay);
            btn.classList.toggle('autoplay-off', !simConfig.autoplay);
        }
        renderSimulator();
        // If we just turned autoplay on and it's AI's turn, resume
        if (simConfig.autoplay && gameState.phase === 'playing') {
            if (gameState.aiTimer) clearTimeout(gameState.aiTimer);
            setTimeout(() => continueGame(), getVizDelay());
        }
    });

    // ── Viz speed buttons ──
    document.querySelectorAll('.speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            simConfig.vizSpeed = btn.dataset.speed;
            document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', b === btn));
        });
    });

    // ── Sound toggle ──
    document.getElementById('sim-sound-btn')?.addEventListener('click', () => {
        simConfig.sounds = !simConfig.sounds;
        const btn = document.getElementById('sim-sound-btn');
        if (btn) {
            btn.textContent = simConfig.sounds ? 'SOUNDS: ON' : 'SOUNDS: OFF';
            btn.classList.toggle('autoplay-on',  simConfig.sounds);
            btn.classList.toggle('autoplay-off', !simConfig.sounds);
        }
    });

    // ── Bust % toggle ──
    document.getElementById('sim-bust-prob-btn')?.addEventListener('click', () => {
        simConfig.showBustProb = !simConfig.showBustProb;
        const btn = document.getElementById('sim-bust-prob-btn');
        if (btn) {
            btn.textContent = simConfig.showBustProb ? 'BUST %: ON' : 'BUST %: OFF';
            btn.classList.toggle('autoplay-on',  simConfig.showBustProb);
            btn.classList.toggle('autoplay-off', !simConfig.showBustProb);
        }
        renderSimulator();
    });

    // ── Animations toggle ──
    document.getElementById('sim-anim-btn')?.addEventListener('click', () => {
        simConfig.animations = !simConfig.animations;
        const btn = document.getElementById('sim-anim-btn');
        if (btn) {
            btn.textContent = simConfig.animations ? 'ANIMATIONS: ON' : 'ANIMATIONS: OFF';
            btn.classList.toggle('autoplay-on',  simConfig.animations);
            btn.classList.toggle('autoplay-off', !simConfig.animations);
        }
    });

    // ── Next AI Move button ──
    document.getElementById('sim-next-ai-btn')?.addEventListener('click', () => {
        if (gameState.phase === 'playing') continueGame();
    });
}

function makeCardHTML(card, dealt = true) {
    let extra = '';
    if (card.isBust) extra += ' bust-card';
    if (card.isReceived) extra += ' received-card';
    const cls = `playing-card ${card.type}${extra}${dealt ? ' dealt' : ''}`;
    const corner = card.type === 'number' ? `<span class="card-corner">${card.value}</span>` : '';
    const dataValue = card.type === 'number' ? ` data-value="${card.value}"` : '';
    return `<div class="${cls}"${dataValue} data-card-id="${card.id}" title="${cardTitle(card)}">${corner}<span class="card-value-main">${card.symbol}</span></div>`;
}

function cardTitle(card) {
    if (card.type === 'number') return `Number ${card.value}`;
    if (card.type === 'modifier') return card.isX2 ? '×2 Multiplier' : `${card.symbol} Modifier`;
    return card.name;
}

function renderPlayerCard(player, rank) {
    const active = gameState.currentDealTarget === player.idx && gameState.phase === 'playing';
    const isAiActive = active && !player.isHuman && isPlayerActive(player);
    // Spotlight: dim cards that are not the current player's turn
    const isDimmed = gameState.phase === 'playing'
        && gameState.currentDealTarget !== -1
        && !active
        && !gameState.actionPending;

    let cls = 'player-card';
    if (player.isHuman) cls += ' is-human';
    if (active)   cls += ' is-active';
    if (isAiActive)  cls += ' is-ai';
    if (player.busted)  cls += ' is-busted';
    if (player.frozen)  cls += ' is-frozen';
    if (player.stayed)  cls += ' is-stayed';
    if (isDimmed) cls += ' is-dimmed';

    // Status badge (left side of header)
    const badge = (() => {
        if (player.hasFlip7) return '<span class="player-status-badge badge-flip7">FLIP 7</span>';
        if (player.busted)   return '<span class="player-status-badge badge-busted">BUST</span>';
        if (player.frozen)   return '<span class="player-status-badge badge-frozen">FROZEN</span>';
        if (player.stayed)   return '<span class="player-status-badge badge-stayed">BANKED</span>';
        if (isAiActive)      return '<span class="player-status-badge badge-thinking">THINKING…</span>';
        if (active)          return '<span class="player-status-badge badge-active">ACTIVE</span>';
        return '';
    })();

    // Rank badge (#1 gold, #2 teal, rest dim)
    const rankLabels = ['1ST','2ND','3RD','4TH','5TH','6TH','7TH','8TH','9TH','10TH'];
    const rankBadge = rank !== undefined
        ? `<span class="rank-badge rank-${Math.min(rank + 1, 3)}">${rankLabels[rank] ?? (rank+1)+'TH'}</span>`
        : '';

    // Bust probability badge for any active player with number cards
    let bustBadge = '';
    if (simConfig.showBustProb && isPlayerActive(player) && player.numberCards.length > 0) {
        const bp    = computeBustProbability(player.numberCards.map(c => c.value), [...gameState.deck]);
        const bpPct = Math.round(bp * 100);
        const bpCls = bpPct < 20 ? 'bp-low' : bpPct < 35 ? 'bp-mid' : 'bp-high';
        bustBadge = `<span class="bust-prob-badge ${bpCls}">${bpPct}%</span>`;
    }

    // Score progress bar toward WIN_TARGET
    const progress = Math.min(player.totalScore / WIN_TARGET * 100, 100);
    const progCls  = player.totalScore >= WIN_TARGET * 0.9 ? 'prog-danger'
                   : player.totalScore >= WIN_TARGET * 0.75 ? 'prog-warn' : '';
    const progressBar = `<div class="score-progress-wrap">
        <div class="score-progress-bar ${progCls}" style="width:${progress}%"></div>
    </div>`;

    // Flip 7 pips — 7 dots, filled for each collected number
    const pipCount = player.numberCards.length;
    const pips = `<div class="flip-pips${player.hasFlip7 ? ' pips-complete' : ''}">
        ${Array.from({length: FLIP7_COUNT}, (_, i) => {
            const val = player.numberCards[i]?.value ?? '';
            return `<div class="flip-pip${i < pipCount ? ' pip-filled' : ''}" title="${val}"></div>`;
        }).join('')}
        <span class="pips-label">${pipCount}/${FLIP7_COUNT}</span>
    </div>`;

    const score = computeRoundScore(player);
    const hand = player.hand.length
        ? player.hand.map(c => makeCardHTML(c)).join('')
        : `<span style="color:var(--txt-dim);font-size:11px;font-family:var(--font-mono)">—</span>`;
    const icon = player.isHuman ? '▸' : '◦';

    return `
        <div class="${cls}" data-player-idx="${player.idx}">
            <div class="player-header">
                <div class="player-name-wrap">
                    <div class="player-name">${icon} ${player.name}</div>
                    <div class="player-score-row">
                        ${rankBadge}
                        <div class="player-total">${player.totalScore}</div>
                        ${bustBadge}
                    </div>
                </div>
                ${badge}
            </div>
            ${progressBar}
            ${pips}
            <div class="player-hand">${hand}</div>
            <div class="player-round-score">round: <span class="pts">${score}</span></div>
        </div>`;
}

function renderSimulator() {
    if (gameState.phase === 'setup') return;

    // Compute ranks by total score (for rank badges)
    const ranked = [...gameState.players].sort((a, b) => b.totalScore - a.totalScore);
    const rankMap = new Map(ranked.map((p, i) => [p.idx, i]));

    const playersEl = document.getElementById('sim-players');
    if (playersEl) playersEl.innerHTML = gameState.players.map(p => renderPlayerCard(p, rankMap.get(p.idx))).join('');

    const logEl = document.getElementById('sim-log-entries');
    if (logEl) {
        const entries = gameState.log.slice(-120);
        logEl.innerHTML = entries.map((e, i) => {
            const isLast = i === entries.length - 1;
            return `<div class="log-entry${e.cls ? ' log-' + e.cls : ''}${isLast ? ' log-last' : ''}">${esc(e.msg)}</div>`;
        }).join('');
        logEl.scrollTop = logEl.scrollHeight;
    }

    const roundBadge = document.getElementById('log-round-badge');
    if (roundBadge) roundBadge.textContent = gameState.phase === 'playing' ? `ROUND ${gameState.round}` : '';

    // Update pile buttons — visual stack + count
    renderPileBtn('sim-draw-btn',    'DRAW',    gameState.deck.length,             FULL_DECK.length * simConfig.deckCount);
    renderPileBtn('sim-discard-btn', 'DISCARD', gameState.discardThisRound.length, FULL_DECK.length * simConfig.deckCount);

    // Turn order strip
    renderTurnStrip();

    const humanPlayer = gameState.players.find(p => p.isHuman);
    const isHumanTurn = humanPlayer &&
        gameState.currentDealTarget === humanPlayer.idx &&
        isPlayerActive(humanPlayer) &&
        gameState.phase === 'playing' &&
        !gameState.actionPending &&
        !gameState.flipThreeState;

    // Show/hide AI controls bar
    const aiControlsBar = document.getElementById('sim-ai-controls');
    if (aiControlsBar) aiControlsBar.classList.remove('hidden');

    // Show/hide Next AI Move button
    const nextAiBtn = document.getElementById('sim-next-ai-btn');
    const speedGroup = document.getElementById('sim-speed-group');
    if (nextAiBtn && speedGroup) {
        const curPlayer = gameState.players[gameState.currentDealTarget];
        const isAiTurn = gameState.phase === 'playing' && curPlayer && !curPlayer.isHuman && isPlayerActive(curPlayer);
        const showNextAi = !simConfig.autoplay && isAiTurn && !gameState.flipThreeState;
        nextAiBtn.classList.toggle('hidden', !showNextAi);
        speedGroup.classList.toggle('hidden', !simConfig.autoplay);
    }

    // ── Human controls — always visible, state-driven ──
    const controls = document.getElementById('sim-human-controls');
    const hitBtn  = document.getElementById('sim-hit-btn');
    const stayBtn = document.getElementById('sim-stay-btn');
    const nextRoundCtrl = document.getElementById('sim-next-round-ctrl-btn');
    const statusLabel   = document.getElementById('controls-status-label');

    if (controls) {
        const isRoundOver = gameState.phase === 'round_end' || gameState.phase === 'game_over';

        hitBtn  && (hitBtn.disabled  = !isHumanTurn);
        stayBtn && (stayBtn.disabled = !isHumanTurn);

        if (nextRoundCtrl) {
            nextRoundCtrl.disabled = gameState.phase !== 'round_end';
        }

        if (isHumanTurn) {
            if (statusLabel) statusLabel.textContent = 'YOUR TURN';
            controls.classList.remove('risk-high', 'ctrl-waiting', 'ctrl-round-over');
            const ind = document.getElementById('sim-bust-indicator');
            if (simConfig.showBustProb) {
                const remaining = [...gameState.deck];
                const bp = computeBustProbability(humanPlayer.numberCards.map(c => c.value), remaining);
                const bpPct = Math.round(bp * 100);
                const bpCls = bpPct < 20 ? 'risk-low' : bpPct < 35 ? 'risk-mid' : 'risk-high';
                controls.classList.toggle('risk-high', bpPct >= 35);
                if (ind) {
                    ind.className = 'bust-indicator-bar ' + bpCls;
                    const numCount = humanPlayer.numberCards.length;
                    ind.innerHTML = numCount > 0
                        ? `<span class="bust-label">BUST RISK</span><span class="bust-val">${bpPct}%</span><span class="bust-hint"> · ${numCount} numbers held</span>`
                        : `<span class="bust-label">FIRST CARD — NO BUST RISK</span>`;
                }
            } else {
                controls.classList.remove('risk-high');
                if (ind) ind.innerHTML = '';
            }
        } else if (isRoundOver) {
            if (statusLabel) statusLabel.textContent = gameState.phase === 'game_over' ? 'GAME OVER' : 'ROUND OVER';
            controls.classList.remove('risk-high');
            controls.classList.add('ctrl-round-over');
            const ind = document.getElementById('sim-bust-indicator');
            if (ind) ind.innerHTML = '';
        } else {
            if (statusLabel) statusLabel.textContent = 'WAITING…';
            controls.classList.remove('risk-high', 'ctrl-round-over');
            controls.classList.add('ctrl-waiting');
            const ind = document.getElementById('sim-bust-indicator');
            if (ind) ind.innerHTML = '';
        }
    }

    if (gameState.phase === 'game_over') setTimeout(() => showGameOver(), 300);

    // Re-show action modal if tab was switched away while it was open
    if (gameState.actionPending && gameState.started) {
        const src = gameState.players[gameState.actionPending.sourceIdx];
        if (src) showActionModal(src, gameState.actionPending.card);
    }
}

function showRoundEnd() {
    if (gameState.phase === 'game_over') { showGameOver(); return; }
    animateDiscardFly(() => {
        SoundEngine.roundEnd();
        const el = document.getElementById('sim-round-end');
        if (!el) return;
        const titleEl = document.getElementById('sim-round-title');
        const scoresEl = document.getElementById('sim-round-scores');

        if (titleEl) titleEl.textContent = gameState.roundEndReason === 'flip7'
            ? `Round ${gameState.round} — Flip 7!` : `Round ${gameState.round} Complete`;

        if (scoresEl) {
            const sorted = [...gameState.players].sort((a, b) => b.totalScore - a.totalScore);
            scoresEl.innerHTML = sorted.map(p => `
                <div class="score-row${p.busted ? ' sr-bust' : ''}">
                    <span class="sr-name">${p.isHuman ? '▸' : '◦'} ${p.name}</span>
                    <span class="sr-round" data-target="${p.busted ? 0 : p.roundScore}" data-bust="${p.busted ? 1 : 0}">${p.busted ? 'BUST' : '+0'}</span>
                    <span class="sr-total" data-target="${p.totalScore}">0 pts</span>
                </div>`).join('');
        }
        el.classList.remove('hidden');
        // Count-up animation for scores
        const dur = Math.min(getAnimDuration() * 3, 480);
        if (dur > 0 && scoresEl) {
            const start = performance.now();
            const rounds = scoresEl.querySelectorAll('.sr-round[data-target]');
            const totals = scoresEl.querySelectorAll('.sr-total[data-target]');
            function tick(now) {
                const t = Math.min((now - start) / dur, 1);
                const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t; // ease-in-out
                rounds.forEach(el => {
                    if (el.dataset.bust === '1') return;
                    el.textContent = '+' + Math.round(+el.dataset.target * ease);
                });
                totals.forEach(el => {
                    el.textContent = Math.round(+el.dataset.target * ease) + ' pts';
                });
                if (t < 1) requestAnimationFrame(tick);
                else {
                    rounds.forEach(el => { if (el.dataset.bust !== '1') el.textContent = '+' + el.dataset.target; });
                    totals.forEach(el => { el.textContent = el.dataset.target + ' pts'; });
                }
            }
            requestAnimationFrame(tick);
        } else if (scoresEl) {
            scoresEl.querySelectorAll('.sr-round[data-target]').forEach(el => {
                if (el.dataset.bust !== '1') el.textContent = '+' + el.dataset.target;
            });
            scoresEl.querySelectorAll('.sr-total[data-target]').forEach(el => {
                el.textContent = el.dataset.target + ' pts';
            });
        }
    });
}

function showGameOver() {
    const sorted = [...gameState.players].sort((a, b) => b.totalScore - a.totalScore);
    const winner = sorted[0];
    const humanWon = winner.isHuman;
    if (humanWon) SoundEngine.gameOver(); else SoundEngine.sadTrombone();
    const el = document.getElementById('sim-game-over');
    if (!el) return;
    document.getElementById('sim-winner-text').innerHTML =
        `${winner.isHuman ? '▸' : '◦'} ${winner.name}<br><span style="font-size:20px;color:var(--gold)">${winner.totalScore} pts</span>`;
    document.getElementById('sim-final-scores').innerHTML = sorted.map((p, i) => `
        <div class="score-row">
            <span class="sr-name">${i === 0 ? '★ ' : ''}${p.isHuman ? '▸' : '◦'} ${p.name}</span>
            <span class="sr-total">${p.totalScore} pts</span>
        </div>`).join('');
    el.classList.remove('hidden');
}

function showActionModal(player, actionCard) {
    const modal = document.getElementById('sim-action-modal');
    if (!modal) return;
    const titles = { Freeze: 'FREEZE', FlipThree: 'FLIP THREE', SecondChance: 'SECOND CHANCE' };
    const bodies = {
        Freeze: 'Target player immediately banks their score and exits this round.',
        FlipThree: 'Target player must draw 3 forced cards. You may target yourself.',
        SecondChance: 'You already hold Second Chance — choose a player to give it to.',
    };
    document.getElementById('sim-modal-title').textContent = titles[actionCard.name] || actionCard.name;
    document.getElementById('sim-modal-body').textContent = bodies[actionCard.name] || '';
    const tgts = document.getElementById('sim-modal-targets');
    const isFlipThreeModal = actionCard.name === 'FlipThree';
    tgts.innerHTML = gameState.players
        .filter(p => (isFlipThreeModal || p.idx !== player.idx) && isPlayerActive(p))
        .map(p => `
        <button class="target-btn" data-idx="${p.idx}">
            <span>${p.isHuman ? '▸' : '◦'} ${p.name}${p.idx === player.idx ? ' (YOU)' : ''}</span>
            <span style="color:var(--gold)">${computeRoundScore(p)} pts</span>
        </button>`).join('');
    tgts.querySelectorAll('.target-btn').forEach(btn =>
        btn.addEventListener('click', () => resolveActionChoice(parseInt(btn.dataset.idx))));
    modal.classList.remove('hidden');
}

function hideActionModal() {
    document.getElementById('sim-action-modal')?.classList.add('hidden');
}

function showPileModal(which) {
    const modal = document.getElementById('sim-pile-modal');
    if (!modal) return;

    const isDraw = which === 'draw';
    const cards  = isDraw ? [...gameState.deck].reverse() : [...gameState.discardThisRound].reverse();
    const title  = isDraw
        ? `DRAW PILE — ${cards.length} cards`
        : `DISCARD PILE — ${cards.length} cards`;

    document.getElementById('sim-pile-title').textContent = title;

    // Group by type
    const numbers   = cards.filter(c => c.type === 'number').sort((a, b) => a.value - b.value);
    const modifiers = cards.filter(c => c.type === 'modifier');
    const actions   = cards.filter(c => c.type === 'action');

    const group = (label, list) => {
        if (!list.length) return '';
        return `<div class="pile-group">
            <div class="pile-group-label">${label} (${list.length})</div>
            <div class="pile-cards">${list.map(c => makeCardHTML(c)).join('')}</div>
        </div>`;
    };

    document.getElementById('sim-pile-body').innerHTML =
        cards.length === 0
            ? `<div class="empty-state" style="padding:20px 0">No cards</div>`
            : group('NUMBERS', numbers) + group('MODIFIERS', modifiers) + group('ACTIONS', actions);

    modal.classList.remove('hidden');
}

function hidePileModal() {
    document.getElementById('sim-pile-modal')?.classList.add('hidden');
}

function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


/* ══════════════════════════════════════════════════════════════════
   §8  OPTIMAL PLAY ANALYZER UI
   ══════════════════════════════════════════════════════════════════ */

function initAnalyzer() {
    buildAnalyzerChips();

    // Remove old RESET SEEN button handler (button removed from HTML in Task 3)
    // Deck mode switcher
    document.getElementById('ana-deck-seg')?.addEventListener('click', e => {
        const btn = e.target.closest('.ana-deck-btn');
        if (!btn) return;
        analyzerState.deckMode = btn.dataset.mode;
        document.querySelectorAll('.ana-deck-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === analyzerState.deckMode));
        buildAnalyzerChips();  // refresh badges for new deck
        renderAnalyzer();
    });

    // Show counts toggle
    document.getElementById('ana-show-counts-toggle')?.addEventListener('click', () => {
        analyzerState.showCounts = !analyzerState.showCounts;
        document.getElementById('ana-show-counts-toggle').classList.toggle('on', analyzerState.showCounts);
        buildAnalyzerChips();  // add/remove badges
        renderAnalyzer();
    });

    // EV breakdown toggle — delegated since it's inside dynamically rendered HTML
    document.getElementById('ana-results-panel')?.addEventListener('click', e => {
        if (e.target.closest('#ana-ev-breakdown-toggle')) {
            analyzerState.evBreakdownOpen = !analyzerState.evBreakdownOpen;
            renderAnalyzer();
        }
    });

    // Sync game hand toggle
    document.getElementById('ana-sync-cb')?.addEventListener('change', e => {
        analyzerState.syncGameHand = e.target.checked;
        if (analyzerState.syncGameHand) { syncHandFromGame(); buildAnalyzerChips(); }
        renderAnalyzer();
    });
}

function buildAnalyzerChips() {
    const remaining = getAnalyzerDeck();
    const showCounts = analyzerState.showCounts;

    function countRemaining(type, matchFn) {
        if (!showCounts) return null;
        return remaining.filter(c => c.type === type && matchFn(c)).length;
    }

    function badge(count) {
        if (count === null) return '';
        return `<span class="ana-count-badge${count === 0 ? ' exhausted' : ''}">${count}</span>`;
    }

    const numEl = document.getElementById('ana-number-chips');
    if (numEl) {
        numEl.innerHTML = Array.from({ length: 13 }, (_, v) => {
            const cnt = countRemaining('number', c => c.value === v);
            const sel = analyzerState.handNumbers.includes(v) ? ' selected' : '';
            const dim = (cnt === 0 && showCounts) ? ' dim' : '';
            return `<div class="sel-chip number${sel}${dim}" data-type="number" data-value="${v}" data-max="${v === 0 ? 1 : v}">${badge(cnt)}${v}</div>`;
        }).join('');
        numEl.querySelectorAll('.sel-chip').forEach(c => c.addEventListener('click', () => onNumberChip(c)));
    }

    const modEl = document.getElementById('ana-modifier-chips');
    if (modEl) {
        modEl.innerHTML = MODIFIER_DEFS.map(d => {
            const cnt = countRemaining('modifier', c => c.symbol === d.symbol);
            const val = d.isX2 ? 'x2' : d.value;
            const selCount = analyzerState.handModifiers.filter(m => m === val).length;
            const sel = selCount > 0 ? ' selected' : '';
            const dim = (cnt === 0 && showCounts) ? ' dim' : '';
            return `<div class="sel-chip modifier${sel}${dim}" data-symbol="${d.symbol}" data-isx2="${d.isX2}" data-value="${d.value}" data-max="${d.count}">${badge(cnt)}${d.symbol}</div>`;
        }).join('');
        modEl.querySelectorAll('.sel-chip').forEach(c => c.addEventListener('click', () => onModifierChip(c)));
    }

    const actEl = document.getElementById('ana-action-chips');
    if (actEl) {
        actEl.innerHTML = ACTION_DEFS.map(d => {
            const cnt = countRemaining('action', c => c.name === d.name);
            const sel = analyzerState.handActions.includes(d.name) ? ' selected' : '';
            const dim = (cnt === 0 && showCounts) ? ' dim' : '';
            return `<div class="sel-chip action${sel}${dim}" data-name="${d.name}">${badge(cnt)}${d.symbol}</div>`;
        }).join('');
        actEl.querySelectorAll('.sel-chip').forEach(c => c.addEventListener('click', () => onActionChip(c)));
    }
}

function onNumberChip(chip) {
    const v = parseInt(chip.dataset.value);
    if (analyzerState.handNumbers.includes(v)) {
        analyzerState.handNumbers = analyzerState.handNumbers.filter(x => x !== v);
        chip.classList.remove('selected');
    } else if (analyzerState.handNumbers.length < FLIP7_COUNT) {
        analyzerState.handNumbers.push(v);
        chip.classList.add('selected');
    }
    recomputeAndRender();
}

function onModifierChip(chip) {
    const isX2 = chip.dataset.isx2 === 'true';
    const val = isX2 ? 'x2' : parseInt(chip.dataset.value);
    const max = parseInt(chip.dataset.max);
    const cur = analyzerState.handModifiers.filter(m => m === val).length;
    if (cur >= max) {
        analyzerState.handModifiers = analyzerState.handModifiers.filter(m => m !== val);
        chip.classList.remove('selected');
    } else {
        analyzerState.handModifiers.push(val);
        chip.classList.add('selected');
    }
    recomputeAndRender();
}

function onActionChip(chip) {
    const name = chip.dataset.name;
    if (analyzerState.handActions.includes(name)) {
        analyzerState.handActions = analyzerState.handActions.filter(n => n !== name);
        chip.classList.remove('selected');
    } else {
        analyzerState.handActions.push(name);
        chip.classList.add('selected');
    }
    renderAnalyzer();
}

function recomputeAndRender() {
    buildAnalyzerChips();  // rebuild chips (updates badges + selection state)
    renderAnalyzer();
    if (activeTab === 'tracker') renderBustPanel();
}

function renderEVBreakdown(breakdown, currentScore, remaining, handNums, hasSC) {
    if (!breakdown) return '<div class="empty-state">No breakdown available</div>';
    const n = remaining.length;
    const b = breakdown;

    function fmtDelta(d) {
        const s = d >= 0 ? `+${d.toFixed(2)}` : d.toFixed(2);
        const cls = d > 0 ? 'pos' : d < 0 ? 'neg' : 'neu';
        return `<span class="ev-bd-${cls}">${s}</span>`;
    }

    function pctStr(p) { return (p * 100).toFixed(1) + '%'; }

    const rows = [
        {
            icon: '💥', label: 'Bust (duplicate number)',
            count: b.bust.count, prob: b.bust.prob,
            detail: `−${currentScore} pts each`,
            weighted: b.bust.weighted,
        },
        {
            icon: '🔢', label: 'New number drawn',
            count: b.newNumber.count, prob: b.newNumber.prob,
            detail: `avg ${b.newNumber.count > 0 ? fmtDelta(b.newNumber.avgDelta) : '—'} pts`,
            weighted: b.newNumber.weighted,
        },
        {
            icon: '✚', label: 'Modifier card',
            count: b.modifier.count, prob: b.modifier.prob,
            detail: `avg ${b.modifier.count > 0 ? fmtDelta(b.modifier.avgDelta) : '—'} pts`,
            weighted: b.modifier.weighted,
        },
        {
            icon: '⟲', label: 'Flip Three (3 forced draws)',
            count: b.flipThree.count, prob: b.flipThree.prob,
            detail: b.flipThree.count > 0 ? `EV of 3 draws: ${fmtDelta(b.flipThree.ev3Draws)}` : '— (none in deck)',
            weighted: b.flipThree.weighted,
        },
        {
            icon: '✦', label: `Second Chance (bust shield)${hasSC ? ' — already held, extras discarded' : ''}`,
            count: b.secondChance.count, prob: b.secondChance.prob,
            detail: hasSC ? 'No additional SC effect' : `Value: ${fmtDelta(b.secondChance.weighted / Math.max(b.secondChance.prob, 0.0001))} pts`,
            weighted: b.secondChance.weighted,
        },
        {
            icon: '❄', label: 'Freeze (no hand effect)',
            count: b.freeze.count, prob: b.freeze.prob,
            detail: '0 pts (played on opponent)',
            weighted: 0,
        },
    ];

    const totalEV = b.bust.weighted + b.newNumber.weighted + b.modifier.weighted
                  + b.flipThree.weighted + b.secondChance.weighted;

    return `
        <div class="ev-bd-panel">
            <div class="ev-bd-section">
                <div class="ev-bd-title">HAND SCORE FORMULA</div>
                <div class="ev-bd-formula">
                    Numbers: ${handNums.join(' + ') || '—'} = <strong>${handNums.reduce((a,b)=>a+b,0)}</strong>
                    &nbsp;·&nbsp; Current score: <strong>${currentScore}</strong>
                    &nbsp;·&nbsp; Deck: <strong>${n}</strong> cards remaining
                </div>
            </div>
            <div class="ev-bd-section">
                <div class="ev-bd-title">OUTCOME TABLE</div>
                <table class="ev-bd-table">
                    <thead>
                        <tr>
                            <th>Outcome</th>
                            <th>Cards</th>
                            <th>Prob</th>
                            <th>Effect</th>
                            <th>Weighted EV</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                        <tr>
                            <td>${r.icon} ${esc(r.label)}</td>
                            <td>${r.count}</td>
                            <td>${pctStr(r.prob)}</td>
                            <td>${r.detail}</td>
                            <td>${fmtDelta(r.weighted)}</td>
                        </tr>`).join('')}
                        ${hasSC && b.scBlocked?.count > 0 ? `
                        <tr>
                            <td>🛡 ${esc('Duplicate blocked by SC')}</td>
                            <td>${b.scBlocked.count}</td>
                            <td>${pctStr(b.scBlocked.prob)}</td>
                            <td>Bust negated (SC consumed)</td>
                            <td>${fmtDelta(0)}</td>
                        </tr>` : ''}
                    </tbody>
                    <tfoot>
                        <tr class="ev-bd-total-row">
                            <td colspan="4">Total EV (hit)</td>
                            <td>${fmtDelta(totalEV)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            ${b.flipThree.count > 0 ? (() => {
                const pbd = b.flipThree.pBustByDraw || [0, 0, 0];
                const pp = x => Math.round(x * 100) + '%';
                const pSurvive = Math.max(0, 1 - b.flipThree.pBustDuring3);
                return `
            <div class="ev-bd-section">
                <div class="ev-bd-title">FLIP THREE — SEQUENTIAL 3-DRAW TREE (EXACT)</div>
                <div class="ev-bd-note">Each forced draw removes a card from the remaining deck, changing
                probabilities for subsequent draws. Bust on any draw cancels remaining forced draws.${hasSC ? ' SC can absorb one duplicate during forced draws.' : ''}</div>
                <table class="ev-bd-table"><thead>
                    <tr><th>Outcome</th><th>Probability</th><th>Notes</th></tr>
                </thead><tbody>
                    <tr><td>💥 Bust on draw 1</td><td>${pp(pbd[0])}</td>
                        <td>${hasSC ? 'SC fires here → continues without SC' : 'Lose current score'}</td></tr>
                    <tr><td>💥 Bust on draw 2</td><td>${pp(pbd[1])}</td>
                        <td>Lose current score${hasSC ? ' (SC already consumed on draw 1 if applicable)' : ''}</td></tr>
                    <tr><td>💥 Bust on draw 3</td><td>${pp(pbd[2])}</td><td>Lose current score</td></tr>
                    <tr><td>✅ Survive all 3 draws</td><td>${pp(pSurvive)}</td>
                        <td>Net EV across all paths: ${fmtDelta(b.flipThree.ev3Draws)}</td></tr>
                </tbody><tfoot>
                    <tr><td colspan="2"><strong>Total bust risk from FlipThree</strong></td>
                        <td><strong>${pp(b.flipThree.pBustDuring3)}</strong></td></tr>
                </tfoot></table>
            </div>`;
            })() : ''}
            ${b.secondChance.count > 0 && !hasSC ? `
            <div class="ev-bd-section">
                <div class="ev-bd-title">SECOND CHANCE — BUST SHIELD VALUE</div>
                <div class="ev-bd-note">Drawing Second Chance gives you protection against the next duplicate.
                Value = EV improvement from having SC active vs. not having it.
                Weighted contribution: ${fmtDelta(b.secondChance.weighted)}</div>
            </div>` : ''}
        </div>`;
}

function renderAnalyzer() {
    const { handNumbers, handModifiers, handActions } = analyzerState;
    const remaining = getAnalyzerDeck();
    const rawBustProb = computeBustProbability(handNumbers, remaining);
    const hasSC = analyzerState.handActions.includes('SecondChance');
    const { evHit, currentScore, breakdown, effectiveBustProb } = computeExpectedValue(handNumbers, handModifiers, remaining, hasSC);
    const bp = effectiveBustProb;  // use effective (SC-adjusted) bust prob for display
    const rec = getRecommendation(rawBustProb, effectiveBustProb, evHit, handNumbers.length, hasSC);

    // Sync toggle
    const gameActive = !!(gameState.phase !== 'setup' && gameState.players?.some(p => p.isHuman));
    const syncToggleEl = document.getElementById('ana-sync-label');
    if (syncToggleEl) {
        syncToggleEl.querySelector('input').checked = analyzerState.syncGameHand;
        syncToggleEl.className = 'ana-sync-toggle' + (gameActive ? '' : ' dimmed');
        const noteEl = syncToggleEl.querySelector('.ana-sync-note');
        if (noteEl) noteEl.style.display = gameActive ? 'none' : '';
    }

    // Hand display
    const handEl = document.getElementById('ana-hand-display');
    if (handEl) {
        if (!handNumbers.length && !handModifiers.length && !handActions.length) {
            handEl.innerHTML = '<span class="empty-state">No cards selected</span>';
        } else {
            handEl.innerHTML = [
                ...handNumbers.map(v => `<div class="playing-card number dealt"><span class="card-corner">${v}</span><span class="card-value-main">${v}</span></div>`),
                ...handModifiers.map(m => `<div class="playing-card modifier dealt"><span class="card-value-main">${m === 'x2' ? 'x2' : '+'+m}</span></div>`),
                ...handActions.map(n => { const d = ACTION_DEFS.find(x => x.name === n); return `<div class="playing-card action dealt"><span class="card-value-main">${d?.symbol || n}</span></div>`; }),
            ].join('');
        }
    }

    // Score breakdown
    const scoreEl = document.getElementById('ana-score-breakdown');
    if (scoreEl) {
        if (handNumbers.length || handModifiers.length) {
            const numSum = handNumbers.reduce((a, b) => a + b, 0);
            const flat = handModifiers.filter(m => m !== 'x2').reduce((a, b) => a + b, 0);
            const hasX2 = handModifiers.includes('x2');
            let formula = `${numSum}`;
            if (flat > 0) formula += ` + ${flat}`;
            if (hasX2) formula = `(${formula}) × 2`;
            if (handNumbers.length === FLIP7_COUNT) formula += ` + ${FLIP7_BONUS} (Flip 7)`;
            scoreEl.innerHTML = `<span style="color:var(--txt-dim);font-size:11px">${formula}</span><span class="score-big">${currentScore}</span>`;
        } else { scoreEl.innerHTML = ''; }
    }

    // Results
    const resultsEl = document.getElementById('ana-results-body');
    if (resultsEl) {
        if (!handNumbers.length && !handModifiers.length) {
            resultsEl.innerHTML = '<div class="empty-state" style="padding:20px 0">Select cards to see analysis</div>';
        } else {
            const bpPct = Math.round(bp * 100);
            const rawPct = Math.round(rawBustProb * 100);
            const bpCls = bpPct < 20 ? 'low' : bpPct < 35 ? 'mid' : 'high';
            const evCls = evHit > 0 ? 'positive' : 'negative';
            const canFlip = handNumbers.length >= 6;
            const scBustNote = hasSC && rawBustProb > 0
                ? `<div class="sc-bust-note">SC absorbs duplicates. Raw risk: ${rawPct}%. Effective risk = FlipThree exposure only.</div>`
                : '';

            resultsEl.innerHTML = `
                <div class="analysis-block">
                    <div class="analysis-label">BUST PROBABILITY — NEXT DRAW</div>
                    <div class="prob-track"><div class="prob-fill ${bpCls}" style="width:${bpPct}%"></div></div>
                    <span class="prob-big ${bpCls}">${bpPct}%</span>
                    <span class="prob-sublabel">effective bust risk</span>
                    ${scBustNote}
                    ${canFlip ? `<div style="margin-top:8px;color:var(--gold);font-size:12px">⭐ One number away from Flip 7! (+${FLIP7_BONUS} pts)</div>` : ''}
                </div>

                <div class="analysis-block">
                    <div class="analysis-label">EXPECTED VALUE</div>
                    <div class="ev-header-row">
                        <div class="ev-grid">
                            <div class="ev-cell ev-hit">
                                <div class="ev-cell-label">IF YOU HIT</div>
                                <div class="ev-cell-value ${evCls}">${evHit >= 0 ? '+' : ''}${evHit.toFixed(1)}</div>
                            </div>
                            <div class="ev-cell ev-stay">
                                <div class="ev-cell-label">IF YOU STAY</div>
                                <div class="ev-cell-value">+0.0</div>
                            </div>
                        </div>
                        <button class="ev-breakdown-btn" id="ana-ev-breakdown-toggle">
                            ${analyzerState.evBreakdownOpen ? 'Hide ▴' : 'Full breakdown ▾'}
                        </button>
                    </div>
                    ${analyzerState.evBreakdownOpen ? renderEVBreakdown(breakdown, currentScore, remaining, handNumbers, hasSC) : ''}
                </div>

                <div class="analysis-block">
                    <div class="analysis-label">RECOMMENDATION</div>
                    <div class="rec-block ${rec.cls}">
                        <div class="rec-action">${rec.action}</div>
                        <div class="rec-reason">${rec.reasoning}</div>
                    </div>
                </div>`;
        }
    }

    // Deck context
    const deckLabel = { full: 'Full deck', game: 'Current game draw pile', tracker: 'Card tracker deck' }[analyzerState.deckMode] || 'Full deck';
    document.getElementById('ana-remaining-count').textContent = remaining.length;
    document.getElementById('ana-remaining-numbers').textContent = remaining.filter(c => c.type === 'number').length;
    document.getElementById('ana-seen-count').textContent = trkTotalDrawn();
    const noteEl = document.querySelector('.ctx-note');
    if (noteEl) noteEl.textContent = `Evaluating against: ${deckLabel}`;
}


/* ══════════════════════════════════════════════════════════════════
   §9  CARD TRACKER UI
   ══════════════════════════════════════════════════════════════════ */

function initTracker() {
    renderTracker();

    // Deck count stepper
    document.getElementById('trk-deck-dec')?.addEventListener('click', () => {
        if (trackerState.numDecks <= 1) return;
        if (trkTotalDrawn() > 0 && !confirm('Changing deck count will reset all drawn counts. Continue?')) return;
        trackerState.numDecks--;
        // Clamp drawn counts that would exceed new total
        for (const [k, v] of Object.entries(trackerState.drawn.numbers))
            trackerState.drawn.numbers[k] = Math.min(v, trkTotal('numbers', +k));
        for (const [k, v] of Object.entries(trackerState.drawn.modifiers))
            trackerState.drawn.modifiers[k] = Math.min(v, trkTotal('modifiers', k));
        for (const [k, v] of Object.entries(trackerState.drawn.actions))
            trackerState.drawn.actions[k] = Math.min(v, trkTotal('actions', k));
        document.getElementById('trk-deck-display').textContent = trackerState.numDecks;
        renderTracker();
        if (activeTab === 'analyzer') renderAnalyzer();
    });

    document.getElementById('trk-deck-inc')?.addEventListener('click', () => {
        trackerState.numDecks++;
        document.getElementById('trk-deck-display').textContent = trackerState.numDecks;
        renderTracker();
        if (activeTab === 'analyzer') renderAnalyzer();
    });

    // Reset button
    document.getElementById('trk-reset-btn')?.addEventListener('click', () => {
        if (!confirm('Reset all tracker counts?')) return;
        for (const k of Object.keys(trackerState.drawn.numbers))  trackerState.drawn.numbers[k]  = 0;
        for (const k of Object.keys(trackerState.drawn.modifiers)) trackerState.drawn.modifiers[k] = 0;
        for (const k of Object.keys(trackerState.drawn.actions))   trackerState.drawn.actions[k]   = 0;
        renderTracker();
        if (activeTab === 'analyzer') renderAnalyzer();
    });

    // Load game deck button
    document.getElementById('trk-load-game-btn')?.addEventListener('click', loadGameDeckToTracker);

    // Import to game button
    document.getElementById('trk-import-game-btn')?.addEventListener('click', importTrackerDeckToGame);

    // +/- button delegation for grids
    ['trk-number-grid', 'trk-modifier-grid', 'trk-action-grid'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', e => {
            const btn = e.target.closest('.trk-tile-btn');
            if (!btn) return;
            const tile = btn.closest('.trk-tile');
            if (!tile) return;
            const { category, key } = tile.dataset;
            const delta = btn.dataset.delta === '+' ? 1 : -1;
            const parsedKey = category === 'numbers' ? +key : key;
            const cur   = trackerState.drawn[category][parsedKey] ?? 0;
            const max   = trkTotal(category, parsedKey);
            const next  = Math.max(0, Math.min(max, cur + delta));
            trackerState.drawn[category][parsedKey] = next;
            renderTracker();
            if (activeTab === 'analyzer') renderAnalyzer();
        });
    });
}

function renderTracker() {
    renderTrackerGrids();
    renderTrackerStats();
    renderBustPanel();
    renderDistributionChart();
}

function renderTrackerGrids() {
    // Number cards grid
    const numEl = document.getElementById('trk-number-grid');
    if (numEl) {
        numEl.innerHTML = Array.from({ length: 13 }, (_, v) => {
            const total = trkTotal('numbers', v);
            const drawn = trackerState.drawn.numbers[v] ?? 0;
            const left  = total - drawn;
            const leftCls = left === 0 ? 'exhausted' : left / total < 0.25 ? 'danger' : left / total < 0.5 ? 'warn' : 'ok';
            return `<div class="trk-tile" data-category="numbers" data-key="${v}">
                <div class="trk-tile-value">${v}</div>
                <div class="trk-tile-total">×${total} in deck</div>
                <div class="trk-tile-counter">
                    <button class="trk-tile-btn" data-delta="-">−</button>
                    <span class="trk-tile-drawn">${drawn}</span>
                    <button class="trk-tile-btn" data-delta="+">+</button>
                </div>
                <div class="trk-tile-left ${leftCls}">${left} left</div>
            </div>`;
        }).join('');
    }

    // Modifier cards grid
    const modEl = document.getElementById('trk-modifier-grid');
    if (modEl) {
        modEl.innerHTML = MODIFIER_DEFS.map(def => {
            const total = trkTotal('modifiers', def.symbol);
            const drawn = trackerState.drawn.modifiers[def.symbol] ?? 0;
            const left  = total - drawn;
            const leftCls = left === 0 ? 'exhausted' : left / total < 0.5 ? 'warn' : 'ok';
            return `<div class="trk-tile trk-tile--mod" data-category="modifiers" data-key="${def.symbol}">
                <div class="trk-tile-value">${def.symbol}</div>
                <div class="trk-tile-total">×${total} in deck</div>
                <div class="trk-tile-counter">
                    <button class="trk-tile-btn" data-delta="-">−</button>
                    <span class="trk-tile-drawn">${drawn}</span>
                    <button class="trk-tile-btn" data-delta="+">+</button>
                </div>
                <div class="trk-tile-left ${leftCls}">${left} left</div>
            </div>`;
        }).join('');
    }

    // Action cards grid
    const actEl = document.getElementById('trk-action-grid');
    if (actEl) {
        actEl.innerHTML = ACTION_DEFS.map(def => {
            const total = trkTotal('actions', def.name);
            const drawn = trackerState.drawn.actions[def.name] ?? 0;
            const left  = total - drawn;
            const leftCls = left === 0 ? 'exhausted' : left / total < 0.5 ? 'warn' : 'ok';
            return `<div class="trk-tile trk-tile--act" data-category="actions" data-key="${def.name}">
                <div class="trk-tile-value">${def.symbol}</div>
                <div class="trk-tile-total">×${total} in deck</div>
                <div class="trk-tile-counter">
                    <button class="trk-tile-btn" data-delta="-">−</button>
                    <span class="trk-tile-drawn">${drawn}</span>
                    <button class="trk-tile-btn" data-delta="+">+</button>
                </div>
                <div class="trk-tile-left ${leftCls}">${left} left</div>
            </div>`;
        }).join('');
    }
}


function renderTrackerStats() {
    const el = document.getElementById('trk-stats');
    if (!el) return;
    const remaining = buildTrackerDeck();
    const rN = remaining.filter(c => c.type === 'number').length;
    const rM = remaining.filter(c => c.type === 'modifier').length;
    const rA = remaining.filter(c => c.type === 'action').length;
    const drawn = trkTotalDrawn();
    el.innerHTML = [
        ['REMAINING', remaining.length, true],
        ['NUMBERS',   rN,               false],
        ['MODIFIERS', rM,               false],
        ['ACTIONS',   rA,               false],
        ['DRAWN',     drawn,            false],
    ].map(([lbl, val, hi]) => `
        <div class="trk-stat-item">
            <div class="trk-stat-lbl">${lbl}</div>
            <div class="trk-stat-val${hi ? ' hi' : ''}">${val}</div>
        </div>`).join('');
}

function renderBustPanel() {
    const el = document.getElementById('trk-bust-panel');
    if (!el) return;
    const handNumbers = analyzerState.handNumbers;

    if (!handNumbers.length) {
        el.innerHTML = '<div class="empty-state" style="font-size:12px">Set your hand in Optimal Play tab</div>';
        return;
    }

    const remaining = buildTrackerDeck();
    const bp = computeBustProbability(handNumbers, remaining);
    const bpPct = Math.round(bp * 100);
    const bpCls = bpPct < 20 ? 'low' : bpPct < 35 ? 'mid' : 'high';

    const dangerDetails = [...new Set(handNumbers)].map(v => ({
        value: v,
        count: remaining.filter(c => c.type === 'number' && c.value === v).length,
    })).filter(d => d.count > 0);

    const detailRows = dangerDetails.length
        ? dangerDetails.map(d => {
            const rowPct = Math.round(d.count / remaining.length * 100);
            const rowCls = rowPct < 10 ? 'low' : rowPct < 20 ? 'mid' : 'high';
            return `<div class="bust-row">
                <span class="bust-row-lbl">Another ${d.value}</span>
                <div class="bust-row-bar">
                    <div class="prob-track" style="height:5px">
                        <div class="prob-fill ${rowCls}" style="width:${Math.min(100,rowPct*3)}%"></div>
                    </div>
                </div>
                <span class="bust-row-pct ${rowCls}">${d.count} left</span>
            </div>`;
          }).join('')
        : `<div style="color:var(--teal);font-size:11px;font-family:var(--font-mono)">All your numbers exhausted — no bust possible.</div>`;

    el.innerHTML = `
        <div class="bust-overall">
            <div>
                <div class="bust-overall-label">OVERALL BUST RISK</div>
                <div style="font-size:11px;color:var(--txt-dim);font-family:var(--font-mono)">${remaining.length} cards remain</div>
            </div>
            <div class="bust-overall-pct ${bpCls}">${bpPct}%</div>
        </div>
        <div style="margin-bottom:6px;font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--txt-dim)">DANGEROUS CARDS</div>
        ${detailRows}`;
}

// ✅ BUG FIX 4: Replace broken flex chart with inline SVG
function renderDistributionChart() {
    const el = document.getElementById('trk-chart');
    if (!el) return;

    // Build rows: numbers 0-12, then modifiers by symbol, then actions by name
    const rows = [];

    for (let v = 0; v <= 12; v++) {
        const total = trkTotal('numbers', v);
        const left  = trkLeft('numbers', v);
        rows.push({ label: String(v), total, left, color: '#6272f0', type: 'number' });
    }
    for (const def of MODIFIER_DEFS) {
        const total = trkTotal('modifiers', def.symbol);
        const left  = trkLeft('modifiers', def.symbol);
        rows.push({ label: def.symbol, total, left, color: '#06d6a0', type: 'modifier' });
    }
    for (const def of ACTION_DEFS) {
        const total = trkTotal('actions', def.name);
        const left  = trkLeft('actions', def.name);
        rows.push({ label: def.symbol, total, left, color: '#e8b84b', type: 'action' });
    }

    const maxTotal = Math.max(...rows.map(r => r.total), 1);

    el.innerHTML = `
        <div class="dist-chart">
            <div class="dist-legend">
                <span class="dist-legend-dot" style="background:#6272f0"></span>Numbers
                <span class="dist-legend-dot" style="background:#06d6a0"></span>Modifiers
                <span class="dist-legend-dot" style="background:#e8b84b"></span>Actions
                <span class="dist-legend-dot dist-legend-dot--drawn"></span>Drawn
            </div>
            ${rows.map(r => {
                const drawn    = r.total - r.left;
                const remPct   = r.total > 0 ? (r.left  / maxTotal * 100).toFixed(1) : 0;
                const drawnPct = r.total > 0 ? (drawn   / maxTotal * 100).toFixed(1) : 0;
                const leftCls  = r.left === 0 ? 'exhausted' : r.left / r.total < 0.25 ? 'danger' : '';
                return `<div class="dist-row">
                    <div class="dist-row-label ${r.type}">${esc(r.label)}</div>
                    <div class="dist-row-bar-wrap">
                        <div class="dist-bar-remaining" style="width:${remPct}%; background:${r.color}"></div>
                        <div class="dist-bar-drawn"      style="width:${drawnPct}%"></div>
                    </div>
                    <div class="dist-row-counts ${leftCls}">${r.left}<span class="dist-row-total">/${r.total}</span></div>
                </div>`;
            }).join('')}
        </div>`;
}

function loadGameDeckToTracker() {
    if (gameState.phase === 'setup') {
        alert('No active game. Start a game in the Simulator tab first.');
        return;
    }
    if (trkTotalDrawn() > 0 && !confirm('This will overwrite your current tracker data with the current game deck state. Continue?')) return;

    // Match tracker deck count to current game deck count
    trackerState.numDecks = simConfig.deckCount;
    document.getElementById('trk-deck-display').textContent = trackerState.numDecks;

    // Reset all drawn counts to 0
    for (const k of Object.keys(trackerState.drawn.numbers))  trackerState.drawn.numbers[k]  = 0;
    for (const k of Object.keys(trackerState.drawn.modifiers)) trackerState.drawn.modifiers[k] = 0;
    for (const k of Object.keys(trackerState.drawn.actions))   trackerState.drawn.actions[k]   = 0;

    // Count how many of each card type are still in the draw pile
    const deckNumbers   = {};
    const deckModifiers = {};
    const deckActions   = {};

    for (const card of gameState.deck) {
        if (card.type === 'number')   deckNumbers[card.value]    = (deckNumbers[card.value]    ?? 0) + 1;
        if (card.type === 'modifier') deckModifiers[card.symbol] = (deckModifiers[card.symbol] ?? 0) + 1;
        if (card.type === 'action')   deckActions[card.name]     = (deckActions[card.name]     ?? 0) + 1;
    }

    // drawn = total - inDeckCount
    for (let v = 0; v <= 12; v++) {
        const total = trkTotal('numbers', v);
        trackerState.drawn.numbers[v] = Math.max(0, total - (deckNumbers[v] ?? 0));
    }
    for (const def of MODIFIER_DEFS) {
        const total = trkTotal('modifiers', def.symbol);
        trackerState.drawn.modifiers[def.symbol] = Math.max(0, total - (deckModifiers[def.symbol] ?? 0));
    }
    for (const def of ACTION_DEFS) {
        const total = trkTotal('actions', def.name);
        trackerState.drawn.actions[def.name] = Math.max(0, total - (deckActions[def.name] ?? 0));
    }

    renderTracker();
    if (activeTab === 'analyzer') renderAnalyzer();
}

function importTrackerDeckToGame() {
    if (gameState.phase === 'setup') {
        alert('No active game. Start a game in the Simulator tab first.');
        return;
    }
    if (!confirm('This will rebuild the draw pile and discard pile from tracker counts. Player hands are preserved. Continue?')) return;

    // Count cards in player hands by type key so we never evict them
    const handCount = {}; // 'n7' | 'm+8' | 'aFreeze' -> count
    for (const player of gameState.players) {
        for (const card of player.hand) {
            const key = card.type === 'number'   ? 'n' + card.value
                      : card.type === 'modifier' ? 'm' + card.symbol
                      :                            'a' + card.name;
            handCount[key] = (handCount[key] ?? 0) + 1;
        }
    }

    let fakeId = 200000;
    const newDeck    = [];
    const newDiscard = [];

    function distribute(category, key, tmpl) {
        const mapKey = category === 'numbers' ? 'n' + key
                     : category === 'modifiers' ? 'm' + key : 'a' + key;
        const total   = trkTotal(category, key);
        const left    = trkLeft(category, key);
        const inHand  = handCount[mapKey] ?? 0;
        // Draw pile gets up to left[c] cards, capped by what hands allow
        const deckCnt    = Math.max(0, Math.min(left, total - inHand));
        const discardCnt = Math.max(0, total - deckCnt - inHand);
        for (let i = 0; i < deckCnt;    i++) newDeck.push({    ...tmpl, id: fakeId++ });
        for (let i = 0; i < discardCnt; i++) newDiscard.push({ ...tmpl, id: fakeId++ });
    }

    for (let v = 0; v <= 12; v++) {
        const tmpl = FULL_DECK.find(c => c.type === 'number' && c.value === v);
        distribute('numbers', v, tmpl);
    }
    for (const def of MODIFIER_DEFS) {
        const tmpl = FULL_DECK.find(c => c.type === 'modifier' && c.symbol === def.symbol);
        distribute('modifiers', def.symbol, tmpl);
    }
    for (const def of ACTION_DEFS) {
        const tmpl = FULL_DECK.find(c => c.type === 'action' && c.name === def.name);
        distribute('actions', def.name, tmpl);
    }

    gameState.deck            = shuffle(newDeck);
    gameState.discardThisRound = newDiscard;

    renderSimulator();
}


/* ══════════════════════════════════════════════════════════════════
   §10 INITIALIZATION
   ══════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initSimulator();
    initAnalyzer();
    initTracker();
});
