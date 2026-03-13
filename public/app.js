const socket = io();

const joinPanel = document.getElementById("joinPanel");
const gamePanel = document.getElementById("gamePanel");
const roomLabel = document.getElementById("roomLabel");
const playersEl = document.getElementById("players");
const communityEl = document.getElementById("community");
const potEl = document.getElementById("pot");
const handEl = document.getElementById("hand");

const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");

const joinBtn = document.getElementById("joinBtn");
const startBtn = document.getElementById("startBtn");
const dealBtn = document.getElementById("dealBtn");
const betInput = document.getElementById("betInput");
const betBtn = document.getElementById("betBtn");
const foldBtn = document.getElementById("foldBtn");

let myHand = [];

function cardView(card) {
  if (!card) return "";
  const rank = card[0];
  const suit = card[1];
  const suitChar = { H: "♥", D: "♦", C: "♣", S: "♠" }[suit];
  return `${rank}${suitChar}`;
}

function renderState(state) {
  playersEl.innerHTML = "";
  state.players.forEach((p) => {
    const div = document.createElement("div");
    div.className = "player" + (p.isTurn ? " turn" : "");
    div.innerHTML = `
      <div class="pName">${p.name}</div>
      <div class="pChips">Фишки: ${p.chips}</div>
      <div class="pBet">Ставка: ${p.bet}</div>
      <div class="pStatus">${p.folded ? "Фолд" : p.isTurn ? "Ход" : ""}</div>
    `;
    playersEl.appendChild(div);
  });

  communityEl.innerHTML = "";
  state.community.forEach((c) => {
    const span = document.createElement("span");
    span.className = "card";
    span.textContent = cardView(c);
    communityEl.appendChild(span);
  });

  potEl.textContent = state.pot;
  renderHand();
}

function renderHand() {
  handEl.innerHTML = "";
  myHand.forEach((c) => {
    const span = document.createElement("span");
    span.className = "card";
    span.textContent = cardView(c);
    handEl.appendChild(span);
  });
}

joinBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  const roomId = roomInput.value.trim();
  if (!name || !roomId) return;
  socket.emit("join", { roomId, name });
  roomLabel.textContent = roomId;
  joinPanel.classList.add("hidden");
  gamePanel.classList.remove("hidden");
});

startBtn.addEventListener("click", () => socket.emit("start"));
dealBtn.addEventListener("click", () => socket.emit("deal"));
betBtn.addEventListener("click", () => socket.emit("bet", betInput.value));
foldBtn.addEventListener("click", () => socket.emit("fold"));

socket.on("state", renderState);
socket.on("hand", (hand) => {
  myHand = hand;
  renderHand();
});
