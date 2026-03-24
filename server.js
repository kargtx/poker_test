import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3001;

app.use(express.static("public"));

// Simple in-memory state per room
const rooms = new Map();

function getRoomState(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      players: new Map(),
      deck: [],
      community: [],
      pot: 0,
      currentTurn: null,
      gameStarted: false,
      dealerId: null,
      winner: null,
      currentBet: 0,
      acted: new Set(),
      lastActorId: null,
    });
  }
  return rooms.get(roomId);
}

function createDeck() {
  const suits = ["H", "D", "C", "S"];
  const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];
  const deck = [];
  for (const s of suits) {
    for (const r of ranks) {
      deck.push(r + s);
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function eligibleDealerIds(state) {
  const eligible = Array.from(state.players.values()).filter((p) => p.canBeDealer);
  if (eligible.length > 0) return eligible.map((p) => p.id);
  return Array.from(state.players.keys());
}

function chooseDealer(state) {
  const ids = eligibleDealerIds(state);
  if (ids.length === 0) return null;
  const idx = Math.floor(Math.random() * ids.length);
  return ids[idx];
}

function orderedIds(state) {
  return Array.from(state.players.keys());
}

function nextActiveAfter(state, fromId) {
  const ids = orderedIds(state);
  if (ids.length === 0) return null;
  const startIndex = fromId && ids.includes(fromId) ? ids.indexOf(fromId) : -1;
  for (let i = 1; i <= ids.length; i += 1) {
    const id = ids[(startIndex + i) % ids.length];
    const p = state.players.get(id);
    if (p && !p.folded) return id;
  }
  return null;
}

function nextTurn(roomId, fromId = null) {
  const state = getRoomState(roomId);
  const next = nextActiveAfter(state, fromId != null ? fromId : state.currentTurn);
  state.currentTurn = next;
}

function cardValue(rank) {
  return { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14 }[rank];
}

function parseCard(card) {
  return { rank: card[0], suit: card[1], value: cardValue(card[0]) };
}

function straightHigh(values) {
  const uniq = Array.from(new Set(values)).sort((a, b) => b - a);
  if (uniq.length !== 5) return null;
  if (uniq[0] - uniq[4] === 4) return uniq[0];
  const wheel = [14, 5, 4, 3, 2];
  if (wheel.every((v) => uniq.includes(v))) return 5;
  return null;
}

function rank5(cards) {
  const parsed = cards.map(parseCard);
  const suits = parsed.map((c) => c.suit);
  const values = parsed.map((c) => c.value);
  const isFlush = suits.every((s) => s === suits[0]);
  const straight = straightHigh(values);

  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const groups = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || b.value - a.value);

  if (straight && isFlush) return { type: 8, ranks: [straight] };
  if (groups[0].count === 4) {
    const kicker = groups.find((g) => g.count === 1).value;
    return { type: 7, ranks: [groups[0].value, kicker] };
  }
  if (groups[0].count === 3 && groups[1].count === 2) return { type: 6, ranks: [groups[0].value, groups[1].value] };
  if (isFlush) return { type: 5, ranks: values.sort((a, b) => b - a) };
  if (straight) return { type: 4, ranks: [straight] };
  if (groups[0].count === 3) {
    const kickers = groups.filter((g) => g.count === 1).map((g) => g.value).sort((a, b) => b - a);
    return { type: 3, ranks: [groups[0].value, ...kickers] };
  }
  if (groups[0].count === 2 && groups[1].count === 2) {
    const pairValues = groups.filter((g) => g.count === 2).map((g) => g.value).sort((a, b) => b - a);
    const kicker = groups.find((g) => g.count === 1).value;
    return { type: 2, ranks: [...pairValues, kicker] };
  }
  if (groups[0].count === 2) {
    const kickers = groups.filter((g) => g.count === 1).map((g) => g.value).sort((a, b) => b - a);
    return { type: 1, ranks: [groups[0].value, ...kickers] };
  }
  return { type: 0, ranks: values.sort((a, b) => b - a) };
}

function compareRank(a, b) {
  if (a.type !== b.type) return a.type - b.type;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i += 1) {
    const av = a.ranks[i] || 0;
    const bv = b.ranks[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function bestOfSeven(cards) {
  let best = null;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            const rank = rank5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareRank(rank, best) > 0) best = rank;
          }
        }
      }
    }
  }
  return best;
}

function handName(type) {
  return ["Старшая карта", "Пара", "Две пары", "Сет", "Стрит", "Флеш", "Фулл хаус", "Каре", "Стрит-флеш"][type] || "Комбинация";
}

function activePlayers(state) {
  return Array.from(state.players.values()).filter((p) => !p.folded);
}

function resetBettingRound(state) {
  state.acted = new Set();
  state.lastActorId = null;
  for (const p of state.players.values()) p.bet = 0;
}

function bettingRoundComplete(state) {
  const active = activePlayers(state);
  if (active.length <= 1) return false;
  for (const p of active) {
    if (p.bet !== state.currentBet) return false;
    if (!state.acted.has(p.id)) return false;
  }
  return true;
}

function advanceStreet(state) {
  if (state.community.length === 0) {
    state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
  } else if (state.community.length < 5) {
    state.community.push(state.deck.pop());
  }
  if (state.community.length === 5) {
    checkWinner(state);
    return;
  }
  resetBettingRound(state);
  state.currentTurn = nextActiveAfter(state, state.lastActorId);
}

function finishRound(state, winners, winningType) {
  if (winners.length === 0) return;
  const share = Math.floor(state.pot / winners.length);
  let remainder = state.pot - share * winners.length;
  for (const w of winners) {
    w.chips += share;
    if (remainder > 0) {
      w.chips += 1;
      remainder -= 1;
    }
  }
  state.pot = 0;
  for (const p of state.players.values()) p.bet = 0;
  state.gameStarted = false;
  state.currentTurn = null;
  state.currentBet = 0;
  state.acted = new Set();
  state.lastActorId = null;
  state.winner = {
    names: winners.map((w) => w.name),
    hand: handName(winningType),
  };
}

function checkWinner(state) {
  if (!state.gameStarted) return;
  const active = activePlayers(state);
  if (active.length === 1) {
    finishRound(state, active, 0);
    return;
  }
  if (state.community.length < 5) return;

  let bestRank = null;
  let winners = [];
  for (const p of active) {
    const rank = bestOfSeven([...p.hand, ...state.community]);
    if (!bestRank || compareRank(rank, bestRank) > 0) {
      bestRank = rank;
      winners = [p];
    } else if (compareRank(rank, bestRank) === 0) {
      winners.push(p);
    }
  }
  finishRound(state, winners, bestRank.type);
}

function publicState(roomId) {
  const state = getRoomState(roomId);
  return {
    players: Array.from(state.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      chips: p.chips,
      folded: p.folded,
      bet: p.bet,
      isTurn: state.currentTurn === p.id,
      isDealer: state.dealerId === p.id,
      hand: state.winner ? p.hand : null,
    })),
    community: state.community,
    pot: state.pot,
    gameStarted: state.gameStarted,
    dealerId: state.dealerId,
    winner: state.winner,
    currentBet: state.currentBet,
  };
}

io.on("connection", (socket) => {
  socket.on("join", ({ roomId, name, canBeDealer }) => {
    if (!roomId || !name) return;
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;

    const state = getRoomState(roomId);
    state.players.set(socket.id, {
      id: socket.id,
      name,
      chips: 1000,
      hand: [],
      folded: false,
      bet: 0,
      canBeDealer: Boolean(canBeDealer),
    });

    const statePayload = publicState(roomId);
    socket.emit("state", statePayload);
    socket.to(roomId).emit("state", statePayload);
  });

  socket.on("start", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = getRoomState(roomId);
    if (state.players.size < 2) return;

    if (!state.dealerId || !state.players.has(state.dealerId)) {
      state.dealerId = chooseDealer(state);
      io.to(roomId).emit("state", publicState(roomId));
    }
    if (state.dealerId && socket.id !== state.dealerId) return;

    state.deck = createDeck();
    state.community = [];
    state.pot = 0;
    state.gameStarted = true;
    state.currentTurn = null;
    state.winner = null;
    state.currentBet = 0;
    resetBettingRound(state);

    for (const p of state.players.values()) {
      p.hand = [state.deck.pop(), state.deck.pop()];
      p.folded = false;
    }

    nextTurn(roomId);
    io.to(roomId).emit("state", publicState(roomId));
    for (const p of state.players.values()) {
      io.to(p.id).emit("hand", p.hand);
    }
  });

  socket.on("deal", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = getRoomState(roomId);
    if (!state.gameStarted) return;
    // Автоматическое открытие карт происходит после завершения круга ставок
    io.to(roomId).emit("state", publicState(roomId));
  });

  socket.on("bet", (amount) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = getRoomState(roomId);
    const player = state.players.get(socket.id);
    if (!player || state.currentTurn !== socket.id) return;
    const desired = Number(amount) || 0;
    const bet = Math.max(0, Math.min(player.chips, desired));
    const afterBet = player.bet + bet;
    if (afterBet < state.currentBet) return;
    const prevCurrentBet = state.currentBet;
    player.chips -= bet;
    player.bet += bet;
    state.pot += bet;
    if (player.bet > state.currentBet) state.currentBet = player.bet;
    if (state.currentBet > prevCurrentBet) state.acted = new Set([player.id]);
    else state.acted.add(player.id);
    state.lastActorId = player.id;
    if (bettingRoundComplete(state)) {
      advanceStreet(state);
    } else {
      nextTurn(roomId, player.id);
    }
    checkWinner(state);
    io.to(roomId).emit("state", publicState(roomId));
  });

  socket.on("fold", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = getRoomState(roomId);
    const player = state.players.get(socket.id);
    if (!player || state.currentTurn !== socket.id) return;
    player.folded = true;
    state.lastActorId = player.id;
    if (bettingRoundComplete(state)) {
      advanceStreet(state);
    } else {
      nextTurn(roomId, player.id);
    }
    checkWinner(state);
    io.to(roomId).emit("state", publicState(roomId));
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = getRoomState(roomId);
    state.players.delete(socket.id);
    if (state.dealerId === socket.id) state.dealerId = chooseDealer(state);
    if (state.players.size === 0) rooms.delete(roomId);
    else if (state.currentTurn === socket.id) nextTurn(roomId);
    io.to(roomId).emit("state", publicState(roomId));
  });
});

server.listen(PORT, () => {
  console.log(`Poker app running on http://localhost:${PORT}`);
});
