import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

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

function nextTurn(roomId) {
  const state = getRoomState(roomId);
  const ids = Array.from(state.players.keys()).filter((id) => !state.players.get(id).folded);
  if (ids.length === 0) {
    state.currentTurn = null;
    return;
  }
  if (!state.currentTurn || !ids.includes(state.currentTurn)) {
    state.currentTurn = ids[0];
    return;
  }
  const idx = ids.indexOf(state.currentTurn);
  state.currentTurn = ids[(idx + 1) % ids.length];
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
    })),
    community: state.community,
    pot: state.pot,
    gameStarted: state.gameStarted,
  };
}

io.on("connection", (socket) => {
  socket.on("join", ({ roomId, name }) => {
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
    });

    io.to(roomId).emit("state", publicState(roomId));
  });

  socket.on("start", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = getRoomState(roomId);
    if (state.players.size < 2) return;

    state.deck = createDeck();
    state.community = [];
    state.pot = 0;
    state.gameStarted = true;
    state.currentTurn = null;

    for (const p of state.players.values()) {
      p.hand = [state.deck.pop(), state.deck.pop()];
      p.folded = false;
      p.bet = 0;
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
    if (state.community.length === 0) {
      state.community.push(state.deck.pop(), state.deck.pop(), state.deck.pop());
    } else if (state.community.length < 5) {
      state.community.push(state.deck.pop());
    }
    io.to(roomId).emit("state", publicState(roomId));
  });

  socket.on("bet", (amount) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = getRoomState(roomId);
    const player = state.players.get(socket.id);
    if (!player || state.currentTurn !== socket.id) return;
    const bet = Math.max(0, Math.min(player.chips, Number(amount) || 0));
    player.chips -= bet;
    player.bet += bet;
    state.pot += bet;
    nextTurn(roomId);
    io.to(roomId).emit("state", publicState(roomId));
  });

  socket.on("fold", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = getRoomState(roomId);
    const player = state.players.get(socket.id);
    if (!player || state.currentTurn !== socket.id) return;
    player.folded = true;
    nextTurn(roomId);
    io.to(roomId).emit("state", publicState(roomId));
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const state = getRoomState(roomId);
    state.players.delete(socket.id);
    if (state.players.size === 0) rooms.delete(roomId);
    else if (state.currentTurn === socket.id) nextTurn(roomId);
    io.to(roomId).emit("state", publicState(roomId));
  });
});

server.listen(PORT, () => {
  console.log(`Poker app running on http://localhost:${PORT}`);
});
