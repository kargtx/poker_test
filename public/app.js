const socket = io();

const joinPanel = document.getElementById("joinPanel");
const gamePanel = document.getElementById("gamePanel");
const roomLabel = document.getElementById("roomLabel");
const playersEl = document.getElementById("players");
const communityEl = document.getElementById("community");
const potEl = document.getElementById("pot");
const handEl = document.getElementById("hand");
const connStatusEl = document.getElementById("connStatus");
const dealerLabelEl = document.getElementById("dealerLabel");
const winnerLabelEl = document.getElementById("winnerLabel");

const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const canDealerInput = document.getElementById("canDealerInput");

const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startBtn");
const dealBtn = document.getElementById("dealBtn");
const betInput = document.getElementById("betInput");
const betBtn = document.getElementById("betBtn");
const allInBtn = document.getElementById("allInBtn");
const foldBtn = document.getElementById("foldBtn");
const resetPotBtn = document.getElementById("resetPotBtn");

let myHand = [];
let joined = false;
let currentRoomId = "";
let currentName = "";

function setStatus(connected) {
  if (!connStatusEl) return;
  connStatusEl.textContent = connected ? "есть" : "нет";
  connStatusEl.classList.toggle("status-good", connected);
  connStatusEl.classList.toggle("status-bad", !connected);
}

function emitJoin() {
  if (!joined || !currentRoomId || !currentName) return;
  if (!socket.connected) return;
  const canBeDealer = canDealerInput ? Boolean(canDealerInput.checked) : false;
  socket.emit("join", { roomId: currentRoomId, name: currentName, canBeDealer });
}

function cardView(card) {
  if (!card) return "";
  const rankRaw = card[0];
  const suit = card[1];
  const rank = rankRaw === "T" ? "10" : rankRaw;
  const suitChar = { H: "♥", D: "♦", C: "♣", S: "♠" }[suit];
  return `${rank}${suitChar}`;
}

function cardClass(card) {
  if (!card) return "card";
  const suit = card[1];
  const isRed = suit === "H" || suit === "D";
  return `card ${isRed ? "card-red" : "card-black"}`;
}

function renderState(state) {
  const isDealer = state.dealerId && state.dealerId === socket.id;
  playersEl.innerHTML = "";
  state.players.forEach((p) => {
    const div = document.createElement("div");
    div.className = "player" + (p.isTurn ? " turn" : "");
    const cardsHtml = Array.isArray(p.hand)
      ? `<div class="pCards">${p.hand.map((c) => `<span class="${cardClass(c)}">${cardView(c)}</span>`).join("")}</div>`
      : "";
    div.innerHTML = `
      <div class="pName">${p.name}</div>
      <div class="pChips">Фишки: ${p.chips}</div>
      <div class="pBet">Ставка: ${p.bet}</div>
      <div class="pStatus">${p.folded ? "Фолд" : p.isTurn ? "Ход" : ""}</div>
      ${cardsHtml}
    `;
    playersEl.appendChild(div);
  });

  communityEl.innerHTML = "";
  state.community.forEach((c) => {
    const span = document.createElement("span");
    span.className = cardClass(c);
    span.textContent = cardView(c);
    communityEl.appendChild(span);
  });

  potEl.textContent = state.pot;
  renderHand();

  if (dealerLabelEl) {
    const dealer = state.players.find((p) => p.id === state.dealerId);
    dealerLabelEl.textContent = dealer ? dealer.name : "—";
  }
  if (winnerLabelEl) {
    if (state.winner && state.winner.names && state.winner.names.length) {
      winnerLabelEl.textContent = `${state.winner.names.join(", ")} (${state.winner.hand})`;
    } else {
      winnerLabelEl.textContent = "—";
    }
  }

  const self = state.players.find((p) => p.id === socket.id);
  const isMyTurn = self ? self.isTurn : false;
  if (startBtn) startBtn.disabled = state.gameStarted || (state.dealerId && !isDealer);
  if (dealBtn) dealBtn.disabled = true;
  if (betBtn) betBtn.disabled = !isMyTurn;
  if (allInBtn) allInBtn.disabled = !isMyTurn;
  if (foldBtn) foldBtn.disabled = !isMyTurn;

  if (betInput) {
    const already = self ? Number(self.bet) || 0 : 0;
    const chips = self ? Number(self.chips) || 0 : 0;
    const minBet = Math.max(0, (Number(state.currentBet) || 0) - already);
    betInput.min = String(minBet);
    const currentVal = Number(betInput.value) || 0;
    if (currentVal < minBet) betInput.value = String(minBet);
    if (chips > 0 && Number(betInput.value) > chips) betInput.value = String(chips);
    if (!state.gameStarted) betInput.value = String(minBet);
  }
}

function renderHand() {
  handEl.innerHTML = "";
  myHand.forEach((c) => {
    const span = document.createElement("span");
    span.className = cardClass(c);
    span.textContent = cardView(c);
    handEl.appendChild(span);
  });
}

joinBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const roomId = roomInput.value.trim();
  if (!name || !roomId) return;
  currentName = name;
  currentRoomId = roomId;
  joined = true;
  emitJoin();
  roomLabel.textContent = roomId;
  joinPanel.classList.add("hidden");
  gamePanel.classList.remove("hidden");
});

startBtn.addEventListener("click", () => socket.emit("start"));
dealBtn.addEventListener("click", () => socket.emit("deal"));
betBtn.addEventListener("click", () => socket.emit("bet", betInput.value));
allInBtn.addEventListener("click", () => socket.emit("allin"));
foldBtn.addEventListener("click", () => socket.emit("fold"));
resetPotBtn.addEventListener("click", () => {
  const pass = window.prompt("Введите пароль для обновления фишек");
  if (pass == null) return;
  socket.emit("reset_pot", { password: pass });
});

socket.on("state", renderState);
socket.on("hand", (hand) => {
  myHand = hand;
  renderHand();
});

socket.on("connect", () => {
  setStatus(true);
  emitJoin();
});

socket.on("disconnect", () => {
  setStatus(false);
});

socket.on("connect_error", () => {
  setStatus(false);
});

setStatus(socket.connected);
