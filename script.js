'use strict';

/* ============================================================
 * Chessy — a dependency-free chess game.
 *
 * The file is split into two clearly separated sections:
 *   1. Engine  — pure chess rules (no DOM access)
 *   2. UI      — rendering, drag & drop, effects, customization
 * The engine is also exported for headless testing under Node.
 * ============================================================ */

/* ============================ Engine ============================ */

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const BACK_RANK = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
const PROMOTION_PIECES = ['q', 'r', 'b', 'n'];

const KNIGHT_OFFSETS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING_OFFSETS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

const inBoard = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const opposite = (color) => (color === 'w' ? 'b' : 'w');

function buildInitialBoard() {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    board[0][c] = { type: BACK_RANK[c], color: 'b' };
    board[1][c] = { type: 'p', color: 'b' };
    board[6][c] = { type: 'p', color: 'w' };
    board[7][c] = { type: BACK_RANK[c], color: 'w' };
  }
  return board;
}

/** Is square (r, c) attacked by any piece of `byColor` on `board`? */
function isSquareAttacked(board, r, c, byColor) {
  // Pawns: a white pawn attacks upward (row - 1), a black pawn downward.
  const pawnRow = r - (byColor === 'w' ? -1 : 1);
  for (const dc of [-1, 1]) {
    if (inBoard(pawnRow, c + dc)) {
      const p = board[pawnRow][c + dc];
      if (p && p.color === byColor && p.type === 'p') return true;
    }
  }
  // Knights
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    if (inBoard(r + dr, c + dc)) {
      const p = board[r + dr][c + dc];
      if (p && p.color === byColor && p.type === 'n') return true;
    }
  }
  // King
  for (const [dr, dc] of KING_OFFSETS) {
    if (inBoard(r + dr, c + dc)) {
      const p = board[r + dr][c + dc];
      if (p && p.color === byColor && p.type === 'k') return true;
    }
  }
  // Sliding pieces (rook/queen on straight lines, bishop/queen on diagonals)
  const scan = (dirs, types) => {
    for (const [dr, dc] of dirs) {
      let tr = r + dr;
      let tc = c + dc;
      while (inBoard(tr, tc)) {
        const p = board[tr][tc];
        if (p) {
          if (p.color === byColor && types.includes(p.type)) return true;
          break;
        }
        tr += dr;
        tc += dc;
      }
    }
    return false;
  };
  return scan(ROOK_DIRS, ['r', 'q']) || scan(BISHOP_DIRS, ['b', 'q']);
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) return { r, c };
    }
  }
  return null;
}

function isKingInCheck(board, color) {
  const king = findKing(board, color);
  return king ? isSquareAttacked(board, king.r, king.c, opposite(color)) : false;
}

/** Mutates `board`, applying the move. No validation — used for legality tests. */
function applyMoveToBoard(board, move) {
  const piece = board[move.from.r][move.from.c];
  board[move.from.r][move.from.c] = null;
  if (move.enPassant) board[move.from.r][move.to.c] = null;
  board[move.to.r][move.to.c] = move.promotion ? { type: move.promotion, color: piece.color } : piece;
  if (move.castle === 'k') {
    board[move.to.r][5] = board[move.to.r][7];
    board[move.to.r][7] = null;
  } else if (move.castle === 'q') {
    board[move.to.r][3] = board[move.to.r][0];
    board[move.to.r][0] = null;
  }
}

class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = buildInitialBoard();
    this.turn = 'w';
    this.castlingRights = { w: { k: true, q: true }, b: { k: true, q: true } };
    this.enPassant = null; // square behind a pawn that just double-pushed
    this.capturedBy = { w: [], b: [] }; // pieces captured BY each color
    this.lastMove = null;
    this.status = 'active'; // 'active' | 'checkmate' | 'stalemate'
    this.winner = null;
  }

  isInCheck(color) {
    return isKingInCheck(this.board, color);
  }

  /** Pseudo-legal moves for the piece on (r, c); ignores own-king safety. */
  pseudoMoves(r, c) {
    const piece = this.board[r][c];
    if (!piece) return [];
    const moves = [];
    const color = piece.color;
    const enemy = opposite(color);
    const add = (tr, tc, extra = {}) => moves.push({ from: { r, c }, to: { r: tr, c: tc }, ...extra });

    const pushPawnMove = (tr, tc, extra = {}) => {
      const lastRow = color === 'w' ? 0 : 7;
      if (tr === lastRow) {
        for (const promotion of PROMOTION_PIECES) add(tr, tc, { ...extra, promotion });
      } else {
        add(tr, tc, extra);
      }
    };

    switch (piece.type) {
      case 'p': {
        const dir = color === 'w' ? -1 : 1;
        const startRow = color === 'w' ? 6 : 1;
        if (inBoard(r + dir, c) && !this.board[r + dir][c]) {
          pushPawnMove(r + dir, c);
          if (r === startRow && !this.board[r + 2 * dir][c]) add(r + 2 * dir, c, { double: true });
        }
        for (const dc of [-1, 1]) {
          const tr = r + dir;
          const tc = c + dc;
          if (!inBoard(tr, tc)) continue;
          const target = this.board[tr][tc];
          if (target && target.color === enemy) {
            pushPawnMove(tr, tc, { captured: target });
          } else if (!target && this.enPassant && this.enPassant.r === tr && this.enPassant.c === tc) {
            const victim = this.board[r][tc];
            if (victim && victim.type === 'p' && victim.color === enemy) {
              add(tr, tc, { enPassant: true, captured: victim });
            }
          }
        }
        break;
      }
      case 'n':
      case 'k': {
        const offsets = piece.type === 'n' ? KNIGHT_OFFSETS : KING_OFFSETS;
        for (const [dr, dc] of offsets) {
          const tr = r + dr;
          const tc = c + dc;
          if (!inBoard(tr, tc)) continue;
          const target = this.board[tr][tc];
          if (!target) add(tr, tc);
          else if (target.color === enemy) add(tr, tc, { captured: target });
        }
        if (piece.type === 'k') this.addCastlingMoves(r, c, color, add);
        break;
      }
      default: {
        // q, r, b
        const dirs =
          piece.type === 'r' ? ROOK_DIRS : piece.type === 'b' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
        for (const [dr, dc] of dirs) {
          let tr = r + dr;
          let tc = c + dc;
          while (inBoard(tr, tc)) {
            const target = this.board[tr][tc];
            if (!target) {
              add(tr, tc);
            } else {
              if (target.color === enemy) add(tr, tc, { captured: target });
              break;
            }
            tr += dr;
            tc += dc;
          }
        }
      }
    }
    return moves;
  }

  /** Adds king-side and queen-side castling moves when legal. */
  addCastlingMoves(r, c, color, add) {
    const homeRow = color === 'w' ? 7 : 0;
    if (r !== homeRow || c !== 4) return;
    if (this.isInCheck(color)) return;
    const enemy = opposite(color);
    const rights = this.castlingRights[color];
    const rookOk = (col) => {
      const p = this.board[homeRow][col];
      return p && p.type === 'r' && p.color === color;
    };
    const empty = (col) => !this.board[homeRow][col];
    const safe = (col) => !isSquareAttacked(this.board, homeRow, col, enemy);

    // King-side: king e -> g, rook h -> f.
    if (rights.k && rookOk(7) && empty(5) && empty(6) && safe(5) && safe(6)) {
      add(homeRow, 6, { castle: 'k' });
    }
    // Queen-side: king e -> c, rook a -> d.
    if (rights.q && rookOk(0) && empty(1) && empty(2) && empty(3) && safe(3) && safe(2)) {
      add(homeRow, 2, { castle: 'q' });
    }
  }

  /** Fully legal moves for the piece on (r, c). */
  legalMoves(r, c) {
    const piece = this.board[r][c];
    if (!piece) return [];
    return this.pseudoMoves(r, c).filter((move) => {
      const copy = this.board.map((row) => row.slice());
      applyMoveToBoard(copy, move);
      return !isKingInCheck(copy, piece.color);
    });
  }

  hasAnyLegalMove(color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.color === color && this.legalMoves(r, c).length > 0) return true;
      }
    }
    return false;
  }

  /** Applies a legal move and returns a summary of what happened. */
  makeMove(move) {
    const piece = this.board[move.from.r][move.from.c];
    const color = piece.color;
    const captured = move.enPassant
      ? this.board[move.from.r][move.to.c]
      : this.board[move.to.r][move.to.c];

    applyMoveToBoard(this.board, move);
    if (captured) this.capturedBy[color].push(captured);
    this.updateCastlingRights(piece, move, captured);
    this.enPassant = move.double ? { r: (move.from.r + move.to.r) / 2, c: move.from.c } : null;
    this.lastMove = move;
    this.turn = opposite(color);

    const summary = { move, captured, check: false, checkmate: false, stalemate: false };
    const inCheck = this.isInCheck(this.turn);
    const canMove = this.hasAnyLegalMove(this.turn);
    if (inCheck && !canMove) {
      this.status = 'checkmate';
      this.winner = color;
      summary.checkmate = true;
    } else if (!inCheck && !canMove) {
      this.status = 'stalemate';
      summary.stalemate = true;
    } else if (inCheck) {
      summary.check = true;
    }
    return summary;
  }

  updateCastlingRights(piece, move, captured) {
    const rights = this.castlingRights;
    if (piece.type === 'k') rights[piece.color].k = rights[piece.color].q = false;
    const homeRow = piece.color === 'w' ? 7 : 0;
    if (piece.type === 'r' && move.from.r === homeRow) {
      if (move.from.c === 0) rights[piece.color].q = false;
      if (move.from.c === 7) rights[piece.color].k = false;
    }
    // A rook captured on its home corner also removes that right.
    if (captured && captured.type === 'r') {
      const capturedHome = captured.color === 'w' ? 7 : 0;
      if (move.to.r === capturedHome) {
        if (move.to.c === 0) rights[captured.color].q = false;
        if (move.to.c === 7) rights[captured.color].k = false;
      }
    }
  }

  /** Total material value of the pieces this color has captured. */
  score(color) {
    return this.capturedBy[color].reduce((sum, p) => sum + PIECE_VALUES[p.type], 0);
  }
}

/* ============================ UI ============================ */

if (typeof document !== 'undefined') initUI();

function initUI() {
  const game = new Game();

  const els = {
    board: document.getElementById('board'),
    squares: document.getElementById('squares'),
    pieces: document.getElementById('pieces'),
    effects: document.getElementById('effects'),
    status: document.getElementById('status'),
    newGame: document.getElementById('new-game'),
    promotion: document.getElementById('promotion'),
    promotionChoices: document.getElementById('promotion-choices'),
    captured: { w: document.getElementById('captured-w'), b: document.getElementById('captured-b') },
    score: { w: document.getElementById('score-w'), b: document.getElementById('score-b') },
    advantage: { w: document.getElementById('adv-w'), b: document.getElementById('adv-b') },
    dot: { w: document.getElementById('dot-w'), b: document.getElementById('dot-b') },
  };

  let selected = null; // { r, c } of the selected piece
  let selectedMoves = []; // legal moves of the selected piece
  let drag = null; // active drag state
  let inputLocked = false; // true while the promotion dialog is open

  /* ----- Board scaffolding ----- */

  buildSquares();
  new ResizeObserver(updateSquareSize).observe(els.board);
  updateSquareSize();
  initColorControls();
  bindInput();
  render();

  function buildSquares() {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = document.createElement('div');
        sq.className = `square ${(r + c) % 2 === 0 ? 'light' : 'dark'}`;
        if (c === 0) sq.appendChild(coord('rank', String(8 - r)));
        if (r === 7) sq.appendChild(coord('file', 'abcdefgh'[c]));
        els.squares.appendChild(sq);
      }
    }
  }

  function coord(kind, text) {
    const el = document.createElement('span');
    el.className = `coord ${kind}`;
    el.textContent = text;
    return el;
  }

  function updateSquareSize() {
    const size = els.board.getBoundingClientRect().width / 8;
    els.board.style.setProperty('--sq', `${size}px`);
  }

  /* ----- Rendering ----- */

  function render() {
    renderPieces();
    renderSquareStates();
    renderCaptured();
    renderStatus();
  }

  function renderPieces() {
    els.pieces.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = game.board[r][c];
        if (!piece) continue;
        const el = document.createElement('div');
        el.className = `piece ${piece.color}`;
        el.style.left = `${c * 12.5}%`;
        el.style.top = `${r * 12.5}%`;
        el.dataset.r = r;
        el.dataset.c = c;
        const glyph = document.createElement('span');
        glyph.className = 'glyph';
        glyph.textContent = GLYPHS[piece.type];
        el.appendChild(glyph);
        if (piece.type === 'k' && game.isInCheck(piece.color)) el.classList.add('shake');
        els.pieces.appendChild(el);
      }
    }
  }

  function squareEl(r, c) {
    return els.squares.children[r * 8 + c];
  }

  function renderSquareStates() {
    for (const sq of els.squares.children) {
      sq.classList.remove('last-from', 'last-to', 'selected', 'hint', 'hint-capture', 'check');
    }
    if (game.lastMove) {
      squareEl(game.lastMove.from.r, game.lastMove.from.c).classList.add('last-from');
      squareEl(game.lastMove.to.r, game.lastMove.to.c).classList.add('last-to');
    }
    for (const color of ['w', 'b']) {
      if (game.isInCheck(color)) {
        const king = findKing(game.board, color);
        if (king) squareEl(king.r, king.c).classList.add('check');
      }
    }
    if (selected) {
      squareEl(selected.r, selected.c).classList.add('selected');
      for (const m of selectedMoves) {
        squareEl(m.to.r, m.to.c).classList.add(m.captured ? 'hint-capture' : 'hint');
      }
    }
  }

  function renderCaptured() {
    for (const color of ['w', 'b']) {
      const box = els.captured[color];
      box.innerHTML = '';
      const sorted = [...game.capturedBy[color]].sort(
        (a, b) => PIECE_VALUES[b.type] - PIECE_VALUES[a.type]
      );
      for (const piece of sorted) {
        const span = document.createElement('span');
        span.className = `cap ${piece.color}`;
        span.textContent = GLYPHS[piece.type];
        box.appendChild(span);
      }
      els.score[color].textContent = game.score(color);
      els.advantage[color].textContent = '';
    }
    const diff = game.score('w') - game.score('b');
    if (diff > 0) els.advantage.w.textContent = `+${diff}`;
    if (diff < 0) els.advantage.b.textContent = `+${-diff}`;
  }

  function renderStatus() {
    const names = { w: 'White', b: 'Black' };
    let text;
    if (game.status === 'checkmate') {
      text = `Checkmate — ${names[game.winner]} wins 🏆`;
    } else if (game.status === 'stalemate') {
      text = 'Stalemate — draw 🤝';
    } else if (game.isInCheck(game.turn)) {
      text = `${names[game.turn]} is in check!`;
    } else {
      text = `${names[game.turn]} to move`;
    }
    els.status.textContent = text;
    els.status.classList.toggle('alert', game.status !== 'active' || game.isInCheck(game.turn));
    els.dot.w.classList.toggle('active', game.status === 'active' && game.turn === 'w');
    els.dot.b.classList.toggle('active', game.status === 'active' && game.turn === 'b');
  }

  /* ----- Selection & moves ----- */

  function select(r, c) {
    selected = { r, c };
    selectedMoves = game.legalMoves(r, c);
    renderSquareStates();
  }

  function clearSelection() {
    selected = null;
    selectedMoves = [];
    renderSquareStates();
  }

  async function attemptMove(from, to) {
    const options = game
      .legalMoves(from.r, from.c)
      .filter((m) => m.to.r === to.r && m.to.c === to.c);
    if (options.length === 0) return false;

    let move = options[0];
    if (options.length > 1) {
      // Pawn promotion: one candidate move per piece choice.
      const choice = await askPromotion(game.turn);
      move = options.find((m) => m.promotion === choice) ?? options[0];
    }

    const summary = game.makeMove(move);
    selected = null;
    selectedMoves = [];
    render();
    if (summary.captured) spawnBurst(move.to.r, move.to.c);
    return true;
  }

  function askPromotion(color) {
    inputLocked = true;
    return new Promise((resolve) => {
      els.promotionChoices.innerHTML = '';
      for (const type of PROMOTION_PIECES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `promo-btn ${color}`;
        btn.textContent = GLYPHS[type];
        btn.addEventListener('click', () => {
          els.promotion.hidden = true;
          inputLocked = false;
          resolve(type);
        });
        els.promotionChoices.appendChild(btn);
      }
      els.promotion.hidden = false;
    });
  }

  /* ----- Drag & drop ----- */

  function bindInput() {
    els.board.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', cancelDrag);
    els.newGame.addEventListener('click', () => {
      game.reset();
      selected = null;
      selectedMoves = [];
      render();
    });
  }

  function squareFromPoint(x, y) {
    const rect = els.board.getBoundingClientRect();
    const c = Math.floor(((x - rect.left) / rect.width) * 8);
    const r = Math.floor(((y - rect.top) / rect.height) * 8);
    return inBoard(r, c) ? { r, c } : null;
  }

  function onPointerDown(e) {
    if (inputLocked || game.status !== 'active') return;
    const sq = squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();

    const piece = game.board[sq.r][sq.c];
    const ownPiece = piece && piece.color === game.turn;

    // Clicked a highlighted target square while a piece is selected.
    if (!ownPiece && selected && selectedMoves.some((m) => m.to.r === sq.r && m.to.c === sq.c)) {
      attemptMove(selected, sq);
      return;
    }

    if (ownPiece) {
      select(sq.r, sq.c);
      const el = e.target.closest('.piece');
      drag = { from: sq, el, startX: e.clientX, startY: e.clientY, moved: false };
      el?.classList.add('dragging');
    } else {
      clearSelection();
    }
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved && drag.el) drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  async function onPointerUp(e) {
    if (!drag) return;
    const current = drag;
    drag = null;
    current.el?.classList.remove('dragging');
    if (!current.moved) return; // plain click: keep the selection

    const sq = squareFromPoint(e.clientX, e.clientY);
    const sameSquare = sq && sq.r === current.from.r && sq.c === current.from.c;
    const moved = sq && !sameSquare ? await attemptMove(current.from, sq) : false;
    if (!moved) render(); // snap back / clear the drag offset
  }

  function cancelDrag() {
    if (!drag) return;
    drag.el?.classList.remove('dragging');
    drag = null;
    render();
  }

  /* ----- Capture burst effect ----- */

  function spawnBurst(r, c) {
    const burst = document.createElement('div');
    burst.className = 'burst';
    burst.style.left = `${c * 12.5 + 6.25}%`;
    burst.style.top = `${r * 12.5 + 6.25}%`;
    for (let i = 0; i < 14; i++) {
      const spark = document.createElement('span');
      spark.style.setProperty('--a', `${Math.random() * 360}deg`);
      spark.style.setProperty('--d', `${18 + Math.random() * 30}px`);
      spark.style.setProperty('--s', `${0.6 + Math.random() * 0.9}`);
      burst.appendChild(spark);
    }
    els.effects.appendChild(burst);
    setTimeout(() => burst.remove(), 700);
  }

  /* ----- Color customization ----- */

  function initColorControls() {
    const settings = [
      { id: 'color-light', cssVar: '--light' },
      { id: 'color-dark', cssVar: '--dark' },
      { id: 'color-wp', cssVar: '--piece-white' },
      { id: 'color-bp', cssVar: '--piece-black' },
    ];
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem('chessy.colors') || '{}');
    } catch {
      saved = {};
    }

    for (const { id, cssVar } of settings) {
      const input = document.getElementById(id);
      if (saved[cssVar]) {
        input.value = saved[cssVar];
        document.documentElement.style.setProperty(cssVar, saved[cssVar]);
      }
      input.addEventListener('input', () => {
        document.documentElement.style.setProperty(cssVar, input.value);
        try {
          const current = JSON.parse(localStorage.getItem('chessy.colors') || '{}');
          current[cssVar] = input.value;
          localStorage.setItem('chessy.colors', JSON.stringify(current));
        } catch {
          /* storage unavailable — colors still apply for the session */
        }
      });
    }
  }
}

/* Node export for headless engine testing (ignored by browsers). */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Game, applyMoveToBoard, isSquareAttacked, isKingInCheck };
}
