/* Candoku hints: finds the next logical deduction and returns it.
   It prefers telling the player where an X goes. It places a candy only when a color, row or column
   has exactly one spot left. If no pure deduction exists, it falls back to the stored answer for an X. */
(function (root) {
  const DIRS8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  // state: 0 empty, 1 X (player), 2 candy.  Returns {type:'x'|'candy', cells:[[y,x]...], text}
  function next(n, regions, state, solution, trustX) {
    // The player's own X marks only count as eliminations when none of them sits on a correct spot.
    if (trustX === undefined) {
      trustX = true;
      for (let y = 0; y < n; y++) if (state[y][solution[y]] === 1) trustX = false;
    }
    const placed = [];
    const rowDone = new Array(n).fill(false), colDone = new Array(n).fill(false), regDone = new Array(n).fill(false);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (state[y][x] === 2) {
      placed.push([y, x]); rowDone[y] = true; colDone[x] = true; regDone[regions[y][x]] = true;
    }
    // cand[y][x]: a candy could still go here
    const cand = Array.from({ length: n }, () => new Array(n).fill(true));
    for (const [py, px] of placed) {
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (y === py || x === px || regions[y][x] === regions[py][px] || (Math.abs(y - py) <= 1 && Math.abs(x - px) <= 1)) cand[y][x] = false;
      }
      cand[py][px] = false;
    }
    if (trustX) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (state[y][x] === 1) cand[y][x] = false;
    const rowsOpen = [], colsOpen = [], regsOpen = [];
    for (let i = 0; i < n; i++) { if (!rowDone[i]) rowsOpen.push(i); if (!colDone[i]) colsOpen.push(i); if (!regDone[i]) regsOpen.push(i); }
    if (!rowsOpen.length) return null;

    const cellsOfRow = (y) => { const a = []; for (let x = 0; x < n; x++) if (cand[y][x]) a.push([y, x]); return a; };
    const cellsOfCol = (x) => { const a = []; for (let y = 0; y < n; y++) if (cand[y][x]) a.push([y, x]); return a; };
    const cellsOfReg = (g) => { const a = []; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cand[y][x] && regions[y][x] === g) a.push([y, x]); return a; };
    const free = (y, x) => state[y][x] === 0 || state[y][x] === 3;            // empty or marked "?"
    const fresh = (cells) => cells.filter(([y, x]) => free(y, x));          // cells that do not already show a player X
    let rk = 1;                                                              // difficulty rank of the rule being tried
    const xhint = (cells, text) => { const f = fresh(cells); return f.length ? { type: 'x', cells: f, text, rank: rk } : null; };

    // Rule 1: pointing. A color whose spots all sit in one row (or column) owns that row (or column).
    for (const g of regsOpen) {
      const cs = cellsOfReg(g);
      if (cs.length < 2) continue;
      if (cs.every((c) => c[0] === cs[0][0])) {
        const y = cs[0][0];
        const h = xhint(cellsOfRow(y).filter(([, x]) => regions[y][x] !== g), 'This color can only go in one row, so cross out the other spots in that row.');
        if (h) return h;
      }
      if (cs.every((c) => c[1] === cs[0][1])) {
        const x = cs[0][1];
        const h = xhint(cellsOfCol(x).filter(([y]) => regions[y][x] !== g), 'This color can only go in one column, so cross out the other spots in that column.');
        if (h) return h;
      }
    }
    for (const y of rowsOpen) {
      const cs = cellsOfRow(y);
      if (cs.length < 2) continue;
      const g = regions[cs[0][0]][cs[0][1]];
      if (cs.every(([yy, xx]) => regions[yy][xx] === g)) {
        const h = xhint(cellsOfReg(g).filter(([yy]) => yy !== y), 'This row only has spots of one color, so cross out that color everywhere else.');
        if (h) return h;
      }
    }
    for (const x of colsOpen) {
      const cs = cellsOfCol(x);
      if (cs.length < 2) continue;
      const g = regions[cs[0][0]][cs[0][1]];
      if (cs.every(([yy, xx]) => regions[yy][xx] === g)) {
        const h = xhint(cellsOfReg(g).filter(([, xx]) => xx !== x), 'This column only has spots of one color, so cross out that color everywhere else.');
        if (h) return h;
      }
    }

    rk = 2;
    // Rule 2: a candy here would leave some color, row or column with no room left.
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!cand[y][x] || !free(y, x)) continue;
      const g = regions[y][x];
      const gone = (yy, xx) => yy === y || xx === x || regions[yy][xx] === g || (Math.abs(yy - y) <= 1 && Math.abs(xx - x) <= 1);
      let dead = false;
      for (const r of rowsOpen) { if (r === y) continue; if (!cellsOfRow(r).some(([yy, xx]) => !gone(yy, xx))) { dead = true; break; } }
      if (!dead) for (const c of colsOpen) { if (c === x) continue; if (!cellsOfCol(c).some(([yy, xx]) => !gone(yy, xx))) { dead = true; break; } }
      if (!dead) for (const r of regsOpen) { if (r === g) continue; if (!cellsOfReg(r).some(([yy, xx]) => !gone(yy, xx))) { dead = true; break; } }
      if (dead) return { type: 'x', rank: 2, cells: [[y, x]], text: 'A candy here would leave another color, row or column with nowhere to go. Cross it out.' };
    }

    rk = 3;
    // Rule 3: groups. k colors that live inside k rows (or columns) fill those rows completely, and the reverse.
    const subsets = (arr, kmin, kmax) => {
      const out = [], m = arr.length;
      for (let mask = 1; mask < (1 << m); mask++) {
        let k = 0; for (let i = 0; i < m; i++) if (mask & (1 << i)) k++;
        if (k >= kmin && k <= kmax) { const s = []; for (let i = 0; i < m; i++) if (mask & (1 << i)) s.push(arr[i]); out.push(s); }
      }
      return out;
    };
    const kmax = Math.max(2, regsOpen.length - 1);
    for (const axis of ['row', 'col']) {
      const open = axis === 'row' ? rowsOpen : colsOpen;
      const idx = axis === 'row' ? (c) => c[0] : (c) => c[1];
      const linesCells = (v) => (axis === 'row' ? cellsOfRow(v) : cellsOfCol(v));
      // colors -> lines
      for (const G of subsets(regsOpen, 2, kmax)) {
        const lines = new Set();
        for (const g of G) for (const c of cellsOfReg(g)) lines.add(idx(c));
        if (lines.size === G.length) {
          const cells = [];
          for (const v of lines) for (const c of linesCells(v)) if (!G.includes(regions[c[0]][c[1]])) cells.push(c);
          const h = xhint(cells, 'These ' + G.length + ' colors must use these ' + G.length + ' ' + axis + 's, so cross out the other colors there.');
          if (h) return h;
        }
      }
      // lines -> colors
      for (const L of subsets(open, 2, Math.max(2, open.length - 1))) {
        const gs = new Set();
        for (const v of L) for (const c of linesCells(v)) gs.add(regions[c[0]][c[1]]);
        if (gs.size === L.length) {
          const cells = [];
          for (const g of gs) for (const c of cellsOfReg(g)) if (!L.includes(idx(c))) cells.push(c);
          const h = xhint(cells, 'These ' + L.length + ' ' + axis + 's only hold ' + L.length + ' colors, so those colors can\'t go anywhere else.');
          if (h) return h;
        }
      }
    }

    // Forced candy: a color, row or column with exactly one spot left.
    for (const g of regsOpen) { const cs = cellsOfReg(g); if (cs.length === 1 && state[cs[0][0]][cs[0][1]] !== 2) return { type: 'candy', rank: 0, cells: cs, text: 'This color has only one spot left!' }; }
    for (const y of rowsOpen) { const cs = cellsOfRow(y); if (cs.length === 1) return { type: 'candy', rank: 0, cells: cs, text: 'This row has only one spot left!' }; }
    for (const x of colsOpen) { const cs = cellsOfCol(x); if (cs.length === 1) return { type: 'candy', rank: 0, cells: cs, text: 'This column has only one spot left!' }; }

    // Fallback: use the answer to cross out one wrong spot, else reveal a candy.
    const wrong = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (cand[y][x] && solution[y] !== x && free(y, x)) wrong.push([y, x]);
    if (wrong.length) {
      // pick the wrong spot closest to a placed candy's color, so it feels connected
      return { type: 'x', rank: 9, cells: [wrong[0]], text: 'Not here. Cross this spot out.' };
    }
    for (const y of rowsOpen) if (state[y][solution[y]] !== 2) return { type: 'candy', rank: 9, cells: [[y, solution[y]]], text: 'This is the spot!' };
    return null;
  }

  // How hard is a board? Solve it with the hint engine and record the hardest rule needed.
  // 0 = only forced single spots, 1 = pointing, 2 = look-ahead, 3 = groups, 9 = needs guessing.
  function rate(n, regions, solution) {
    const state = Array.from({ length: n }, () => new Array(n).fill(0));
    let max = 0, hard = 0, groups = 0;
    for (let step = 0; step < n * n * 2; step++) {
      const h = next(n, regions, state, solution, true);
      if (!h) break;
      if (h.rank > max) max = h.rank;
      if (h.rank >= 2) hard++;
      if (h.rank === 3) groups++;
      for (const [y, x] of h.cells) state[y][x] = h.type === 'candy' ? 2 : 1;
      let done = 0; for (let y = 0; y < n; y++) if (state[y][solution[y]] === 2) done++;
      if (done === n) break;
    }
    return { max, hard, groups };
  }

  root.CandokuHints = { next, rate };
})(window);
