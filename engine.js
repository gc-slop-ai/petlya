// Петля — детерминированный движок. Состояние целиком выводится из записанных петель,
// поэтому отмена хода и предпросмотр будущего — это просто повторная симуляция.
(function (root) {
  const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0], W: [0, 0] };
  const INVERSE = { x: 'A', y: 'B', z: 'C' };

  const LEVELS = [
    {
      name: 'Эхо',
      hint: 'Дверь открыта, пока кто-то стоит на плите. Дойди до плиты, нажми E — и прошлый ты будет держать её за тебя.',
      maxT: 10, maxEchoes: 1,
      map: [
        '#########',
        '#S..#...#',
        '#...a.E.#',
        '#A..#...#',
        '#########',
      ],
    },
    {
      name: 'Двое',
      hint: 'Эхо живёт ровно столько ходов, сколько длилась его петля. Двум плитам нужны двое.',
      maxT: 10, maxEchoes: 2,
      map: [
        '#############',
        '#A...S.....B#',
        '#####.#######',
        '    #.#      ',
        '    #a#      ',
        '    #.#      ',
        '    #b#      ',
        '    #.#      ',
        '    #E#      ',
        '    ###      ',
      ],
    },
    {
      name: 'Наоборот',
      hint: 'Штрихованная дверь закрыта, пока плита НАЖАТА. Эхо должно сойти с плиты вовремя — или исчезнуть.',
      maxT: 14, maxEchoes: 1,
      map: [
        '#############',
        '#S.x..a..x.E#',
        '#.###########',
        '#...A#       ',
        '######       ',
      ],
    },
    {
      name: 'Цепочка',
      hint: 'Эхо повторяет нажатия клавиш, а не путь. Записанное позже эхо может пройти там, где раньше было закрыто.',
      maxT: 14, maxEchoes: 2,
      map: [
        '###########',
        '#A...S...a#',
        '#####.###.#',
        '#E.b..#B..#',
        '###########',
      ],
    },
    {
      name: 'Окно',
      hint: 'Плите A нужно быть нажатой для одного и отпущенной для другого. Найди окно.',
      maxT: 14, maxEchoes: 2,
      map: [
        '#############',
        '#S....a...C.#',
        '#.###########',
        '#....x....cE#',
        '#A###########',
        '#############',
      ],
    },
    {
      name: 'Петля',
      hint: 'Три плиты, три двери, одна жизнь. Каждый следующий открывает путь следующему.',
      maxT: 22, maxEchoes: 3,
      map: [
        '###############',
        '#A....S....a.B#',
        '######.########',
        '#C.b.........##',
        '############.##',
        '#E.....c..x..##',
        '###############',
      ],
    },
  ];

  function parseLevel(def) {
    const h = def.map.length;
    const w = Math.max(...def.map.map(r => r.length));
    const tiles = [];
    const doors = [];
    const plates = [];
    let start = null, exit = null;
    for (let y = 0; y < h; y++) {
      const row = [];
      for (let x = 0; x < w; x++) {
        const ch = def.map[y][x] || ' ';
        if (ch === 'S') { start = { x, y }; row.push('.'); continue; }
        if (ch === 'E') exit = { x, y };
        if (ch >= 'A' && ch <= 'C') plates.push({ x, y, key: ch });
        if (ch >= 'a' && ch <= 'c') doors.push({ x, y, key: ch.toUpperCase(), inv: false });
        if (INVERSE[ch]) doors.push({ x, y, key: INVERSE[ch], inv: true });
        row.push(ch);
      }
      tiles.push(row);
    }
    const doorAt = new Map(doors.map((d, i) => [d.x + ',' + d.y, i]));
    return { ...def, w, h, tiles, doors, plates, start, exit, doorAt };
  }

  function isWall(lv, x, y) {
    if (x < 0 || y < 0 || x >= lv.w || y >= lv.h) return true;
    const c = lv.tiles[y][x];
    return c === '#' || c === ' ';
  }

  function doorState(lv, pos, alive) {
    const pressed = new Set();
    for (const p of lv.plates) {
      if (pos.some((e, i) => alive[i] && e.x === p.x && e.y === p.y)) pressed.add(p.key);
    }
    const open = lv.doors.map(d => {
      const occupied = pos.some((e, i) => alive[i] && e.x === d.x && e.y === d.y);
      const held = pressed.has(d.key);
      return occupied || (d.inv ? !held : held);
    });
    return { pressed, open };
  }

  // Возвращает кадры 0..T. Эхо i существует в моменты 0..echoes[i].length.
  // Ход t проверяет двери по кадру t-1. `extra` — сколько ходов игрок «ждёт» сверх записанного (для прогноза).
  function simulate(lv, echoes, cur, extra = 0) {
    const runs = echoes.concat([cur]);
    const last = runs.length - 1;
    let pos = runs.map(() => ({ x: lv.start.x, y: lv.start.y }));
    const aliveAt = t => runs.map((r, i) => i === last || t <= r.length);
    const frames = [];
    const push = (t, blocked) => {
      const alive = aliveAt(t);
      frames.push({ t, pos: pos.map(p => ({ ...p })), alive, blocked, ...doorState(lv, pos, alive) });
    };
    push(0, runs.map(() => false));
    const T = cur.length + extra;
    for (let t = 1; t <= T; t++) {
      const prev = frames[t - 1];
      const blocked = [];
      pos = pos.map((p, i) => {
        blocked.push(false);
        if (i !== last && t > runs[i].length) return p;
        const move = i === last ? (cur[t - 1] || 'W') : runs[i][t - 1];
        const [dx, dy] = DIRS[move];
        const nx = p.x + dx, ny = p.y + dy;
        if (move === 'W') return p;
        const di = lv.doorAt.get(nx + ',' + ny);
        if (isWall(lv, nx, ny) || (di !== undefined && !prev.open[di])) {
          blocked[i] = true;
          return p;
        }
        return { x: nx, y: ny };
      });
      push(t, blocked);
    }
    return frames;
  }

  function isWin(lv, frame) {
    const p = frame.pos[frame.pos.length - 1];
    return p.x === lv.exit.x && p.y === lv.exit.y;
  }

  const api = { DIRS, LEVELS, parseLevel, simulate, isWin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Petlya = api;
})(typeof window !== 'undefined' ? window : globalThis);
