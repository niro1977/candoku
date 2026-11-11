/* Candoku puzzle engine: generates n x n colored-region boards with exactly one solution.
   Rules: one candy per region, one per row, one per column, no two candies touching (incl. diagonals). */
(function (root) {
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, r) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Random placement: one per row/col, no touching.
  function randomQueens(n, r) {
    const cols = new Array(n).fill(-1);
    const used = new Array(n).fill(false);
    function go(row) {
      if (row === n) return true;
      for (const c of shuffle([...Array(n).keys()], r)) {
        if (used[c]) continue;
        if (row > 0 && Math.abs(c - cols[row - 1]) <= 1) continue;
        used[c] = true; cols[row] = c;
        if (go(row + 1)) return true;
        used[c] = false; cols[row] = -1;
      }
      return false;
    }
    return go(0) ? cols : null;
  }

  // Grow n connected regions, one around each candy cell, filling the whole grid.
  function growRegions(n, queens, r) {
    const grid = Array.from({ length: n }, () => new Array(n).fill(-1));
    const frontier = [];
    queens.forEach((c, row) => { grid[row][c] = row; });
    let filled = n;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // weights vary per region so shapes differ in size
    const weight = queens.map(() => 0.4 + r() * 1.6);
    while (filled < n * n) {
      const cand = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (grid[y][x] !== -1) continue;
        const seen = new Set();
        for (const [dy, dx] of dirs) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
          const g = grid[yy][xx];
          if (g !== -1 && !seen.has(g)) { seen.add(g); cand.push([y, x, g, weight[g]]); }
        }
      }
      let total = 0;
      for (const c of cand) total += c[3];
      let pick = r() * total, chosen = cand[cand.length - 1];
      for (const c of cand) { pick -= c[3]; if (pick <= 0) { chosen = c; break; } }
      grid[chosen[0]][chosen[1]] = chosen[2];
      filled++;
    }
    return grid;
  }

  // Count solutions (stops at `limit`). regions[y][x] = region id 0..n-1.
  function countSolutions(n, regions, limit) {
    let count = 0;
    const colUsed = new Array(n).fill(false);
    const regUsed = new Array(n).fill(false);
    let prev = -10;
    const stack = [];
    function go(row) {
      if (count >= limit) return;
      if (row === n) { count++; return; }
      for (let c = 0; c < n; c++) {
        if (colUsed[c] || Math.abs(c - prev) <= 1) continue;
        const g = regions[row][c];
        if (regUsed[g]) continue;
        colUsed[c] = regUsed[g] = true;
        const savedPrev = prev; prev = c;
        go(row + 1);
        prev = savedPrev;
        colUsed[c] = regUsed[g] = false;
        if (count >= limit) return;
      }
    }
    go(0);
    return count;
  }

  function findSolution(n, regions) {
    const colUsed = new Array(n).fill(false);
    const regUsed = new Array(n).fill(false);
    const sol = new Array(n).fill(-1);
    function go(row) {
      if (row === n) return true;
      for (let c = 0; c < n; c++) {
        if (colUsed[c]) continue;
        if (row > 0 && Math.abs(c - sol[row - 1]) <= 1) continue;
        const g = regions[row][c];
        if (regUsed[g]) continue;
        colUsed[c] = regUsed[g] = true; sol[row] = c;
        if (go(row + 1)) return true;
        colUsed[c] = regUsed[g] = false; sol[row] = -1;
      }
      return false;
    }
    return go(0) ? sol : null;
  }

  function connectedWithout(n, regions, g, ay, ax) {
    // is region g still connected if cell (ay,ax) is removed?
    let start = null, total = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
      if (regions[y][x] === g && !(y === ay && x === ax)) { total++; if (!start) start = [y, x]; }
    if (total === 0) return false;
    const seen = new Set([start[0] * n + start[1]]), st = [start];
    while (st.length) {
      const [y, x] = st.pop();
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
        if (regions[yy][xx] !== g || (yy === ay && xx === ax)) continue;
        const k = yy * n + xx;
        if (!seen.has(k)) { seen.add(k); st.push([yy, xx]); }
      }
    }
    return seen.size === total;
  }

  // Reshape borders until exactly one solution remains; the planted candies stay valid throughout.
  function refine(n, regions, queens, r) {
    const CAP = 40;
    let cur = countSolutions(n, regions, CAP);
    for (let it = 0; it < 6000 && cur > 1; it++) {
      const y = Math.floor(r() * n), x = Math.floor(r() * n);
      if (queens[y] === x) continue;
      const g = regions[y][x];
      const opts = [];
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const yy = y + dy, xx = x + dx;
        if (yy < 0 || xx < 0 || yy >= n || xx >= n) continue;
        if (regions[yy][xx] !== g) opts.push(regions[yy][xx]);
      }
      if (!opts.length) continue;
      if (!connectedWithout(n, regions, g, y, x)) continue;
      const g2 = opts[Math.floor(r() * opts.length)];
      regions[y][x] = g2;
      const next = countSolutions(n, regions, CAP);
      if (next <= cur) cur = next; else regions[y][x] = g;
    }
    return cur === 1;
  }

  function generate(n, seed) {
    const r = rng(seed);
    for (let attempt = 0; attempt < 200; attempt++) {
      const q = randomQueens(n, r);
      if (!q) continue;
      const regions = growRegions(n, q, r);
      if (refine(n, regions, q, r) && countSolutions(n, regions, 2) === 1) {
        return { n, regions, solution: findSolution(n, regions), seed };
      }
    }
    throw new Error('could not generate board ' + n);
  }

  // Conflicts among placed candies. placed: array of [row, col].
  function conflicts(n, regions, placed) {
    const bad = new Set();
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const [r1, c1] = placed[i], [r2, c2] = placed[j];
      const clash = r1 === r2 || c1 === c2 ||
        regions[r1][c1] === regions[r2][c2] ||
        (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1);
      if (clash) { bad.add(r1 + ',' + c1); bad.add(r2 + ',' + c2); }
    }
    return bad;
  }

  const api = { rng, generate, countSolutions, findSolution, conflicts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CandokuEngine = api;
})(typeof self !== 'undefined' ? self : this);
