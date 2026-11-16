/* ==========================================================================
   GAMBIT · local fallback engine
   A compact negamax + alpha-beta + quiescence search. Zero dependencies,
   runs inside a worker when available.
   ========================================================================== */

import { Chess } from '../vendor/chess.js';

const PIECE_VALUE = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
const MATE = 100000;

// Tables are written from White's point of view, a1 first, h8 last.
const PAWN_TABLE = [
  0, 0, 0, 0, 0, 0, 0, 0,
  6, 10, 10, -18, -18, 10, 10, 6,
  4, -4, -8, 0, 0, -8, -4, 4,
  2, 2, 2, 18, 18, 2, 2, 2,
  6, 6, 12, 24, 24, 12, 6, 6,
  12, 12, 18, 30, 30, 18, 12, 12,
  55, 55, 55, 55, 55, 55, 55, 55,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const KNIGHT_TABLE = [
  -50, -40, -28, -28, -28, -28, -40, -50,
  -40, -18, 0, 6, 6, 0, -18, -40,
  -28, 6, 12, 17, 17, 12, 6, -28,
  -28, 2, 17, 22, 22, 17, 2, -28,
  -28, 6, 17, 22, 22, 17, 6, -28,
  -28, 2, 12, 17, 17, 12, 2, -28,
  -40, -18, 0, 2, 2, 0, -18, -40,
  -50, -40, -28, -28, -28, -28, -40, -50,
];

const BISHOP_TABLE = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 6, 10, 10, 6, 0, -10,
  -10, 6, 6, 10, 10, 6, 6, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 6, 0, 0, 0, 0, 6, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];

const ROOK_TABLE = [
  0, 0, 0, 6, 6, 0, 0, 0,
  -6, 0, 0, 0, 0, 0, 0, -6,
  -6, 0, 0, 0, 0, 0, 0, -6,
  -6, 0, 0, 0, 0, 0, 0, -6,
  -6, 0, 0, 0, 0, 0, 0, -6,
  -6, 0, 0, 0, 0, 0, 0, -6,
  6, 10, 10, 10, 10, 10, 10, 6,
  0, 0, 0, 0, 0, 0, 0, 0,
];

const QUEEN_TABLE = [
  -20, -10, -10, -4, -4, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 6, 6, 6, 6, 0, -10,
  -4, 0, 6, 8, 8, 6, 0, -4,
  -4, 0, 6, 8, 8, 6, 0, -4,
  -10, 0, 6, 6, 6, 6, 0, -10,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -20, -10, -10, -4, -4, -10, -10, -20,
];

const KING_MIDDLE = [
  -60, -70, -70, -80, -80, -70, -70, -60,
  -60, -70, -70, -80, -80, -70, -70, -60,
  -60, -70, -70, -80, -80, -70, -70, -60,
  -60, -70, -70, -80, -80, -70, -70, -60,
  -40, -50, -50, -60, -60, -50, -50, -40,
  -20, -30, -30, -40, -40, -30, -30, -20,
  18, 18, -8, -10, -10, -8, 18, 18,
  22, 32, 10, -10, -10, 8, 36, 24,
];

const KING_END = [
  -50, -30, -30, -30, -30, -30, -30, -50,
  -30, -10, 0, 0, 0, 0, -10, -30,
  -30, 0, 16, 22, 22, 16, 0, -30,
  -30, 0, 22, 32, 32, 22, 0, -30,
  -30, 0, 22, 32, 32, 22, 0, -30,
  -30, 0, 16, 22, 22, 16, 0, -30,
  -30, -10, 0, 0, 0, 0, -10, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

const TABLES = { p: PAWN_TABLE, n: KNIGHT_TABLE, b: BISHOP_TABLE, r: ROOK_TABLE, q: QUEEN_TABLE };

function mirroredIndex(rank, file, color) {
  return color === 'w' ? rank * 8 + file : (7 - rank) * 8 + file;
}

function isEndgame(board) {
  let queens = 0;
  let minorMajor = 0;
  for (const rank of board) {
    for (const piece of rank) {
      if (!piece) continue;
      if (piece.type === 'q') queens += 1;
      else if (piece.type !== 'p' && piece.type !== 'k') minorMajor += 1;
    }
  }
  return queens === 0 || (queens <= 2 && minorMajor <= 4);
}

function sideMaterial(board, color) {
  let total = 0;
  for (const rank of board) {
    for (const piece of rank) {
      if (piece && piece.color === color) total += PIECE_VALUE[piece.type];
    }
  }
  return total;
}

/**
 * Static evaluation in centipawns, positive meaning White is better.
 */
export function evaluate(game) {
  const board = game.board();
  const endgame = isEndgame(board);
  let score = 0;
  let whiteBishops = 0;
  let blackBishops = 0;
  const pawnFiles = { w: new Array(8).fill(0), b: new Array(8).fill(0) };
  const pawnRanks = { w: [], b: [] };
  const pieces = [];
  const kingSquare = { w: null, b: null };

  for (let row = 0; row < 8; row += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[row][file];
      if (!piece) continue;
      const rank = 7 - row;
      const color = piece.color;
      const sign = color === 'w' ? 1 : -1;
      const idx = mirroredIndex(rank, file, color);
      let table = TABLES[piece.type];
      if (piece.type === 'k') table = endgame ? KING_END : KING_MIDDLE;
      let value = PIECE_VALUE[piece.type] + (table ? table[idx] : 0);

      if (piece.type === 'b') {
        if (color === 'w') whiteBishops += 1;
        else blackBishops += 1;
      }
      if (piece.type === 'p') {
        pawnFiles[color][file] += 1;
        pawnRanks[color].push({ file, rank });
      }
      if (piece.type === 'k') kingSquare[color] = { file, rank };
      pieces.push({ ...piece, file, rank });
      score += sign * value;
    }
  }

  if (whiteBishops >= 2) score += 28;
  if (blackBishops >= 2) score -= 28;

  // Rooks love open and semi-open files.
  for (const piece of pieces) {
    if (piece.type !== 'r') continue;
    const ownPawns = pawnFiles[piece.color][piece.file];
    const enemy = piece.color === 'w' ? 'b' : 'w';
    const enemyPawns = pawnFiles[enemy][piece.file];
    if (ownPawns === 0) score += (piece.color === 'w' ? 1 : -1) * (enemyPawns === 0 ? 22 : 11);
  }

  // Passed pawns and doubled/isolated pawns.
  for (const color of ['w', 'b']) {
    const sign = color === 'w' ? 1 : -1;
    const enemy = color === 'w' ? 'b' : 'w';
    for (const { file, rank } of pawnRanks[color]) {
      let passed = true;
      for (const { file: ef, rank: er } of pawnRanks[enemy]) {
        if (Math.abs(ef - file) > 1) continue;
        if (color === 'w' ? er > rank : er < rank) {
          passed = false;
          break;
        }
      }
      if (passed) {
        const advance = color === 'w' ? rank : 7 - rank;
        score += sign * (18 + advance * advance * 5);
      }
      const left = file > 0 ? pawnFiles[color][file - 1] : 0;
      const right = file < 7 ? pawnFiles[color][file + 1] : 0;
      if (left === 0 && right === 0) score -= sign * 12;
      if (pawnFiles[color][file] > 1) score -= sign * 11;
    }
  }

  // Basic king safety: friendly pawn shield while the queens are around.
  if (!endgame) {
    for (const color of ['w', 'b']) {
      const king = kingSquare[color];
      if (!king) continue;
      const sign = color === 'w' ? 1 : -1;
      const shieldRank = color === 'w' ? king.rank + 1 : king.rank - 1;
      let shield = 0;
      for (let df = -1; df <= 1; df += 1) {
        const f = king.file + df;
        if (f < 0 || f > 7) continue;
        if (pawnRanks[color].some((p) => p.file === f && p.rank === shieldRank)) shield += 1;
      }
      score += sign * shield * 9;
    }
  }

  // Side-to-move tempo.
  score += game.turn() === 'w' ? 4 : -4;

  // Keep evaluations bounded well below mate scores.
  return Math.max(-MATE / 2, Math.min(MATE / 2, score));
}

function moveOrderScore(move) {
  let score = 0;
  if (move.captured) score += 10 * PIECE_VALUE[move.captured] - PIECE_VALUE[move.piece];
  if (move.promotion) score += PIECE_VALUE[move.promotion] || 0;
  if (move.san.includes('#')) score += 50000;
  else if (move.san.includes('+')) score += 60;
  if (move.flags.includes('k') || move.flags.includes('q')) score += 25;
  if (move.to) {
    const file = move.to.charCodeAt(0) - 97;
    const rank = Number(move.to[1]) - 1;
    score += 8 - Math.abs(file - 3.5) * 2 - Math.abs(rank - 3.5) * 2;
  }
  return score;
}

function orderedMoves(game, capturesOnly = false) {
  let moves = game.moves({ verbose: true });
  if (capturesOnly) moves = moves.filter((m) => m.captured || m.promotion || m.san.includes('+'));
  moves.sort((a, b) => moveOrderScore(b) - moveOrderScore(a));
  return moves;
}

class Timeout extends Error {}

function quiescence(game, alpha, beta, depth, ctx) {
  ctx.nodes += 1;
  if ((ctx.nodes & 511) === 0 && performance.now() > ctx.deadline) throw new Timeout();
  if (game.isCheckmate()) return -MATE + (ctx.rootDepth - depth) * 10;
  if (game.isDraw()) return 0;

  const sign = game.turn() === 'w' ? 1 : -1;
  if (depth <= 0) return sign * evaluate(game);

  const inCheck = game.inCheck();
  if (!inCheck) {
    const standPat = sign * evaluate(game);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
  }

  const moves = orderedMoves(game, !inCheck);
  if (inCheck && moves.length === 0) return -MATE + (ctx.rootDepth - depth) * 10;
  for (const move of moves) {
    game.move(move);
    const score = -quiescence(game, -beta, -alpha, depth - 1, ctx);
    game.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(game, depth, alpha, beta, ctx) {
  ctx.nodes += 1;
  if ((ctx.nodes & 511) === 0 && performance.now() > ctx.deadline) throw new Timeout();
  if (game.isCheckmate()) return -MATE + (ctx.rootDepth - depth) * 10;
  if (game.isDraw()) return 0;
  if (depth <= 0) return quiescence(game, alpha, beta, ctx.quiescenceDepth, ctx);

  const moves = orderedMoves(game);
  if (moves.length === 0) return -MATE + (ctx.rootDepth - depth) * 10;

  let best = -Infinity;
  for (const move of moves) {
    game.move(move);
    const score = -negamax(game, depth - 1, -beta, -alpha, ctx);
    game.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
    if (score > best) best = score;
  }
  return best;
}

function describeMove(game, move) {
  if (move.san.includes('#')) return '将杀。';
  if (move.promotion) return '兵升变，局面进入新阶段。';
  if (move.captured) {
    const names = { p: '兵', n: '马', b: '象', r: '车', q: '后', k: '王' };
    return `吃掉对方的${names[move.captured] || '棋子'}。`;
  }
  if (move.san.includes('+')) return '将军，抢占主动。';
  if (move.flags.includes('k') || move.flags.includes('q')) return '完成易位，稳固王城。';
  if (move.piece === 'p') return '推进兵形，争夺中心。';
  if (move.piece === 'n' || move.piece === 'b') return '出动子力，保持协调。';
  return '稳步改善局面。';
}

/**
 * Choose a move with iterative deepening. Designed to stop well under the
 * budget even on modest hardware.
 */
export function chooseLocalMove(fen, options = {}) {
  const game = new Chess(fen);
  if (game.isGameOver()) return null;
  const timeLimit = Math.max(120, Math.min(3000, options.timeLimit || 1150));
  const maxDepth = Math.max(1, Math.min(4, options.maxDepth || 3));
  const started = performance.now();
  const ctx = {
    nodes: 0,
    deadline: started + timeLimit,
    quiescenceDepth: options.quiescenceDepth ?? 3,
    rootDepth: 1,
  };

  const rootMoves = orderedMoves(game);
  if (!rootMoves.length) return null;
  if (options.randomize !== false && rootMoves.length > 1) {
    // Add a tiny jitter so the local engine does not repeat itself forever.
    for (const move of rootMoves) {
      if (!move.captured && !move.promotion && !move.san.includes('+')) {
        const file = move.to.charCodeAt(0) - 97;
        const rank = Number(move.to[1]) - 1;
        const central = 14 - Math.abs(file - 3.5) * 3 - Math.abs(rank - 3.5) * 3;
        move._jitter = Math.random() * 5 + central;
      }
    }
    rootMoves.sort((a, b) => moveOrderScore(b) + (b._jitter || 0) - (moveOrderScore(a) + (a._jitter || 0)));
  }

  let bestMove = rootMoves[0];
  let bestScore = 0;
  let completedDepth = 0;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    ctx.rootDepth = depth;
    let alpha = -Infinity;
    let depthBest = null;
    let depthScore = -Infinity;
    try {
      for (const move of rootMoves) {
        if (performance.now() > ctx.deadline) throw new Timeout();
        game.move(move);
        const score = -negamax(game, depth - 1, -Infinity, -alpha, ctx);
        game.undo();
        if (score > depthScore) {
          depthScore = score;
          depthBest = move;
        }
        if (score > alpha) alpha = score;
      }
      if (depthBest) {
        bestMove = depthBest;
        bestScore = depthScore;
        completedDepth = depth;
        // Put the previous best first for quicker pruning next iteration.
        const idx = rootMoves.indexOf(depthBest);
        if (idx > 0) {
          rootMoves.splice(idx, 1);
          rootMoves.unshift(depthBest);
        }
      }
    } catch (error) {
      if (!(error instanceof Timeout)) throw error;
      break;
    }
    if (performance.now() > ctx.deadline) break;
    if (Math.abs(bestScore) > MATE - 1000) break;
  }

  const elapsedMs = Math.round(performance.now() - started);
  return {
    move: {
      san: bestMove.san,
      from: bestMove.from,
      to: bestMove.to,
      promotion: bestMove.promotion || null,
    },
    comment: describeMove(game, bestMove),
    score: bestScore,
    depth: completedDepth || 1,
    nodes: ctx.nodes,
    elapsedMs,
  };
}

export { Chess };
