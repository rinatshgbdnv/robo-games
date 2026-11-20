// Логика игр без DOM: уровни, интерпретатор робота, правила фабрики. Тестируется в node (tests/test_games.mjs).

// --- Робот: карта из строк. # стена, O яма, S старт, G будка, B косточка, . пол. За краем — стена. ---
export const DIRS = { U: [0, -1], R: [1, 0], D: [0, 1], L: [-1, 0] };
export const ARROW = { U: "⬆️", R: "➡️", D: "⬇️", L: "⬅️" };
export const CYCLE = ["U", "R", "D", "L"]; // порядок поворота стрелки по тапу в «Охоте на баги»
const STEP_LIMIT = 300;

export function parseMap(rows) {
  const m = { w: rows[0].length, h: rows.length, cells: rows.map(r => r.split("")), bones: [], start: null, goal: null };
  rows.forEach((r, y) => r.split("").forEach((c, x) => {
    if (c === "S") m.start = [x, y];
    if (c === "G") m.goal = [x, y];
    if (c === "B") m.bones.push([x, y]);
  }));
  return m;
}

export function cell(m, x, y) {
  return x < 0 || y < 0 || x >= m.w || y >= m.h ? "#" : m.cells[y][x];
}

export function countBlocks(program) {
  return program.reduce((n, b) => n + 1 + (b.op === "loop" ? countBlocks(b.body) : 0), 0);
}

// Программа: [{op:"U"|"R"|"D"|"L"} | {op:"loop", n, body:[...]}]. path — индексы до блока, для подсветки.
// Возвращает {win, reason, trace}; trace: {t:"move"|"bump"|"fall"|"pick"|"goal", x, y, dir, path}.
export function runRobot(level, program) {
  const m = parseMap(level.map);
  let [x, y] = m.start;
  const left = new Set(m.bones.map(([bx, by]) => `${bx},${by}`));
  const trace = [];
  let steps = 0;
  let end = null;

  function exec(list, prefix) {
    for (let i = 0; i < list.length && !end; i++) {
      const b = list[i], path = [...prefix, i];
      if (b.op === "loop") {
        for (let k = 0; k < b.n && !end; k++) exec(b.body, path);
        continue;
      }
      if (++steps > STEP_LIMIT) { end = "toolong"; return; }
      const [dx, dy] = DIRS[b.op];
      const nx = x + dx, ny = y + dy, c = cell(m, nx, ny);
      if (c === "#") { trace.push({ t: "bump", x, y, dir: b.op, path }); end = "bump"; return; }
      x = nx; y = ny;
      trace.push({ t: "move", x, y, dir: b.op, path });
      if (c === "O") { trace.push({ t: "fall", x, y, dir: b.op, path }); end = "fall"; return; }
      if (left.delete(`${x},${y}`)) trace.push({ t: "pick", x, y, dir: b.op, path });
      if (c === "G" && left.size === 0) { trace.push({ t: "goal", x, y, dir: b.op, path }); end = "goal"; return; }
    }
  }
  exec(program, []);
  if (!end) {
    const atGoal = x === m.goal[0] && y === m.goal[1];
    end = atGoal ? "bones" : "notgoal"; // на будке, но косточки не собраны — или просто не дошла
  }
  return { win: end === "goal", reason: end, trace };
}

export function robotStars(level, program) {
  const n = countBlocks(program);
  return n <= level.best ? 3 : n <= level.best + 2 ? 2 : 1;
}

// --- Охота на баги: сколько блоков отличается от исходной программы (структура та же, меняются стрелки и N). ---
export function countEdits(a, b) {
  let n = 0;
  a.forEach((x, i) => {
    const y = b[i];
    if (x.op === "loop") n += (x.n !== y.n ? 1 : 0) + countEdits(x.body, y.body);
    else if (x.op !== y.op) n += 1;
  });
  return n;
}

export function bugStars(level, program) {
  const n = countEdits(level.program, program);
  return n <= level.fix ? 3 : n <= level.fix + 2 ? 2 : 1;
}

export const clone = p => JSON.parse(JSON.stringify(p));

// --- Фабрика: конфета "цвет форма вес", например "r c 3". ---
export const COLORS = { r: "красная", b: "синяя", g: "зелёная", y: "жёлтая" };
export const SHAPES = { c: "круглая", s: "квадратная", t: "звёздочка", h: "сердечко" };
export const ATTRS = { c: "цвет", s: "форма", w: "вес" };

export function parseCandy(s) {
  const [c, sh, w] = s.split(" ");
  return { c, s: sh, w: Number(w) };
}

// Условие: {k:"c"|"s"|"w", cmp:"="|"≠"|">"|"<", v}, или {a, op:"и"|"или", b}.
export function test(cond, candy) {
  if (cond.op) {
    const a = test(cond.a, candy), b = test(cond.b, candy);
    return cond.op === "и" ? a && b : a || b;
  }
  const val = candy[cond.k];
  switch (cond.cmp) {
    case "=": return val === cond.v;
    case "≠": return val !== cond.v;
    case ">": return val > cond.v;
    case "<": return val < cond.v;
  }
  return false;
}

// Программа: {rules:[{cond, bin}], else: bin}. Первое подошедшее правило решает — порядок важен.
export function sortCandy(program, candy) {
  for (let i = 0; i < program.rules.length; i++) {
    if (test(program.rules[i].cond, candy)) return { bin: program.rules[i].bin, rule: i };
  }
  return { bin: program.else, rule: -1 };
}

export function runFactory(level, program) {
  const trace = level.items.map(s => {
    const candy = parseCandy(s), want = level.truth(candy), got = sortCandy(program, candy);
    return { candy, want, bin: got.bin, rule: got.rule, ok: got.bin === want };
  });
  return { win: trace.every(t => t.ok), reason: trace.every(t => t.ok) ? "goal" : "wrong", trace };
}

export function factoryStars(level, program) {
  return program.rules.length <= level.best ? 3 : 2;
}

// --- Уровни ---
export const ROBOT = [
  { title: "Первые шаги", map: ["S...G"], max: 8, best: 4,
    hint: "Программа — это список команд по порядку. Тяни стрелки в программу и довези Мейсона до будки 🏠" },
  { title: "Поворот", map: ["S..##", "##.##", "##..G"], max: 8, best: 6,
    hint: "Стрелка показывает, куда сделать шаг. Не врежься в стену!" },
  { title: "Косточка", map: ["S..B", "###.", "G..."], max: 10, best: 8,
    hint: "Сначала собери косточку 🦴, потом в будку." },
  { title: "Осторожно, ямы", map: ["S.O..", ".O..O", "..BO.", "O...G"], max: 10, best: 7,
    hint: "В яму падать нельзя. Найди безопасную дорожку." },
  { title: "Цикл!", map: ["S.......G"], max: 3, best: 2,
    hint: "Блоков мало! Перетащи 🔁, положи внутрь ➡️ и кнопкой «+» поставь, сколько раз повторить. Посчитай клетки до будки!" },
  { title: "Лесенка", map: ["S.###", "#..##", "##..#", "###..", "####G"], max: 4, best: 3,
    hint: "Найди, что повторяется, и положи это в цикл." },
  { title: "Змейка", map: ["S...#", "###.#", "#...#", "#.###", "#...G"], max: 10, best: 10,
    hint: "Несколько циклов подряд. Новый цикл отпускай после предыдущего, а не внутрь." },
  { title: "Цикл в цикле", map: ["S...###", "###.###", "###.###", "###....", "######.", "######.", "######G"],
    max: 5, best: 5, hint: "Цикл можно положить внутрь другого цикла. Подумай, что повторяется дважды." },
];

// --- Дерево программы для перетаскивания. path — индексы до блока; listPath — путь до цикла, в чьё тело кладём ([] — верх). ---
export const newBlock = op => op === "loop" ? { op, n: 2, body: [] } : { op };
export const isPrefix = (a, b) => a.length <= b.length && a.every((v, i) => b[i] === v);
export function listAt(program, listPath) { let l = program; for (const i of listPath) l = l[i].body; return l; }
export function insertBlock(program, listPath, index, block) { listAt(program, listPath).splice(index, 0, block); }
export function removeBlock(program, path) { return listAt(program, path.slice(0, -1)).splice(path.at(-1), 1)[0]; }

// Перенос блока, цикл — вместе с телом. index — место в списке до переноса. В себя или своего потомка нельзя → false.
export function moveBlock(program, from, toList, index) {
  if (isPrefix(from, toList)) return false;
  const parent = from.slice(0, -1), k = from.at(-1), to = [...toList];
  if (parent.length < to.length && isPrefix(parent, to) && to[parent.length] > k) to[parent.length]--; // сосед слева ушёл
  if (parent.join() === toList.join() && index > k) index--;
  insertBlock(program, to, index, removeBlock(program, from));
  return true;
}

// Шаг демо: add — из палитры в [listPath, index], tap — тап по палитре (в конец), move — перенос в [listPath, index],
// trash — в 🗑, plus — «+» у цикла, run — запуск. say — текст на плашке перед шагом.
export function applyStep(program, s) {
  if (s.add) insertBlock(program, ...s.to, newBlock(s.add));
  else if (s.tap) program.push(newBlock(s.tap));
  else if (s.move) moveBlock(program, s.move, ...s.to);
  else if (s.trash) removeBlock(program, s.trash);
  else if (s.plus) listAt(program, s.plus.slice(0, -1))[s.plus.at(-1)].n++;
}

// Обучение перед уровнем с новым приёмом (ключ — индекс уровня): демо пальцем на поле demo, потом мини-задача try.
export const TUTORIALS = {
  0: { title: "собираем программу", demo: ["S", ".", "G"], steps: [
    { say: "Тяни стрелку пальцем в программу", add: "D", to: [[], 0] },
    { say: "Или просто нажми — встанет в конец", tap: "D" },
    { say: "Ой, лишняя стрелка…", add: "U", to: [[], 2] },
    { say: "Утащи её вниз, на кнопки — в 🗑", trash: [2] },
    { say: "Жми ▶️ Запуск!", run: 1 }],
    try: { map: ["S..G"], max: 5, say: "Доведи Мейсона до будки 🏠" } },
  4: { title: "цикл", demo: ["S", ".", ".", "G"], steps: [
    { say: "Тяни 🔁 — это цикл, он повторяет команды", add: "loop", to: [[], 0] },
    { say: "Положи стрелку ВНУТРЬ цикла", add: "D", to: [[0], 0] },
    { say: "Жми «+»: теперь повторит 3 раза", plus: [0] },
    { say: "Запуск!", run: 1 }],
    try: { map: ["S....G"], max: 2, say: "Всего 2 блока: цикл и стрелка внутри" } },
  5: { title: "что повторяется", demo: ["S.#", "#..", "##G"], steps: [
    { say: "Тут повторяется «➡️ ⬇️». Тяни цикл", add: "loop", to: [[], 0] },
    { say: "Обе стрелки — внутрь цикла", add: "R", to: [[0], 0] },
    { add: "D", to: [[0], 1] },
    { say: "Запуск!", run: 1 }],
    try: { map: ["S##", ".##", "..#", "#.#", "#.G"], max: 4, say: "Найди, что повторяется, и положи в цикл" } },
  6: { title: "циклы подряд", demo: ["S..", "##.", "##G"], steps: [
    { say: "Первый цикл — шаги вправо", add: "loop", to: [[], 0] },
    { add: "R", to: [[0], 0] },
    { say: "Второй цикл отпусти ПОСЛЕ первого, а не внутрь", add: "loop", to: [[], 1] },
    { say: "А в него — шаги вниз", add: "D", to: [[1], 0] },
    { say: "Запуск!", run: 1 }],
    try: { map: ["S###", ".###", ".###", "...G"], max: 4, say: "Два цикла подряд" } },
  7: { title: "цикл в цикле", demo: ["S..##", "##...", "####G"], steps: [
    { say: "Большой цикл", add: "loop", to: [[], 0] },
    { say: "И ещё один цикл со стрелкой", add: "loop", to: [[], 1] },
    { add: "R", to: [[1], 0] },
    { say: "Теперь перетащи цикл ВНУТРЬ большого", move: [1], to: [[0], 0] },
    { say: "И шаг вниз — тоже в большой цикл", add: "D", to: [[0], 1] },
    { say: "Запуск!", run: 1 }],
    try: { map: ["S...###", "###....", "######G"], max: 4, say: "Цикл внутри цикла, всего 4 блока" } },
};

const L = op => ({ op });
const loop = (n, ...body) => ({ op: "loop", n, body });

export const BUGS = [
  { title: "Не туда", map: ROBOT[0].map, program: [L("R"), L("R"), L("L"), L("R")], fix: 1,
    hint: "В программе ошибка — баг 🐞. Нажми «По шагу» и посмотри, где Мейсон идёт не туда." },
  { title: "Последний шаг", map: ROBOT[1].map, program: [L("R"), L("R"), L("D"), L("D"), L("R"), L("U")], fix: 1,
    hint: "Тапни по стрелке, чтобы повернуть её." },
  { title: "Не хватило", map: ROBOT[4].map, program: [loop(7, L("R"))], fix: 1,
    hint: "Тапни по числу в цикле, чтобы его поменять." },
  { title: "Перепутал", map: ROBOT[5].map, program: [loop(4, L("D"), L("R"))], fix: 2,
    hint: "Иногда команды стоят не в том порядке." },
  { title: "Почти дошёл", map: ROBOT[2].map, program: [loop(3, L("R")), loop(2, L("D")), loop(2, L("L"))], fix: 1,
    hint: "Где Мейсон остановился? Сколько шагов не хватило?" },
  { title: "Яма!", map: ROBOT[3].map, program: [L("D"), L("D"), L("R"), L("R"), L("R"), L("D"), L("R")], fix: 2,
    hint: "Найди шаг, на котором Мейсон падает, и что должно быть вместо него." },
  { title: "Змейка", map: ROBOT[6].map,
    program: [loop(3, L("R")), loop(2, L("D")), loop(2, L("L")), loop(2, L("D")), loop(3, L("L"))], fix: 1,
    hint: "Смотри на последний поворот." },
  { title: "Два бага", map: ROBOT[7].map, program: [loop(2, loop(2, L("R")), loop(3, L("U")))], fix: 2,
    hint: "Здесь сразу две ошибки. Отлаживай по шагу!" },
];

const items = s => s.split(",").map(x => x.trim());

export const FACTORY = [
  { title: "Красные — сюда", bins: { A: "🍓 Красные", B: "📦 Остальные" }, best: 1,
    tools: { attrs: ["c"], cmps: ["="], ops: [], maxRules: 1 },
    items: items("r c 2, b c 3, r s 4, g t 1, r h 2, y c 5"),
    truth: c => c.c === "r" ? "A" : "B",
    hint: "ЕСЛИ условие верно — конфета едет в эту корзину. ИНАЧЕ — в другую." },
  { title: "Сердечки", bins: { A: "💖 Сердечки", B: "📦 Остальные" }, best: 1,
    tools: { attrs: ["c", "s"], cmps: ["="], ops: [], maxRules: 1 },
    items: items("r h 2, b c 3, g h 4, y t 1, b h 2, r s 5"),
    truth: c => c.s === "h" ? "A" : "B",
    hint: "Теперь можно проверять не только цвет, но и форму." },
  { title: "Три корзины", bins: { A: "🍓 Красные", B: "🫐 Синие", C: "📦 Остальные" }, best: 2,
    tools: { attrs: ["c", "s"], cmps: ["="], ops: [], maxRules: 2 },
    items: items("r c 2, b s 3, g t 4, r h 1, y c 2, b h 5, g s 3"),
    truth: c => c.c === "r" ? "A" : c.c === "b" ? "B" : "C",
    hint: "Правил может быть несколько. Конфета проверяет их сверху вниз." },
  { title: "Порядок важен", bins: { A: "⭐ Звёздочки", B: "🍓 Красные", C: "📦 Остальные" }, best: 2,
    tools: { attrs: ["c", "s"], cmps: ["="], ops: [], maxRules: 2 },
    items: items("r t 2, r c 3, b t 4, r h 1, g c 2, y t 5, r s 3"),
    truth: c => c.s === "t" ? "A" : c.c === "r" ? "B" : "C",
    hint: "Красная звёздочка — это звёздочка! Срабатывает первое подошедшее правило." },
  { title: "Оператор И", bins: { A: "❤️ Красные сердечки", B: "📦 Остальные" }, best: 1,
    tools: { attrs: ["c", "s"], cmps: ["="], ops: ["и"], maxRules: 1 },
    items: items("r h 2, r c 3, b h 4, r h 1, g h 2, r s 5"),
    truth: c => c.c === "r" && c.s === "h" ? "A" : "B",
    hint: "«И» — верно, только если верны ОБА условия." },
  { title: "Два И", bins: { A: "💙 Синие кружки", B: "💛 Жёлтые звёзды", C: "📦 Остальные" }, best: 2,
    tools: { attrs: ["c", "s"], cmps: ["="], ops: ["и"], maxRules: 2 },
    items: items("b c 2, b t 3, y t 4, y c 1, b c 5, g t 2, y t 3, b s 1"),
    truth: c => c.c === "b" && c.s === "c" ? "A" : c.c === "y" && c.s === "t" ? "B" : "C",
    hint: "Два правила, в каждом — «И»." },
  { title: "Оператор ИЛИ", bins: { A: "🔥 Тёплые (красные и жёлтые)", B: "❄️ Холодные" }, best: 1,
    tools: { attrs: ["c", "s"], cmps: ["="], ops: ["и", "или"], maxRules: 1 },
    items: items("r c 2, y s 3, b t 4, g h 1, y h 2, r t 5, b c 3"),
    truth: c => c.c === "r" || c.c === "y" ? "A" : "B",
    hint: "«ИЛИ» — верно, если верно ХОТЯ БЫ одно условие." },
  { title: "Тяжёлые конфеты", bins: { A: "🏋️ Тяжёлые (вес больше 5)", B: "🫐 Лёгкие синие", C: "📦 Остальные" }, best: 2,
    tools: { attrs: ["c", "s", "w"], cmps: ["=", "≠", ">", "<"], ops: ["и", "или"], maxRules: 2 },
    items: items("b c 7, b s 2, r t 9, g c 3, y h 5, b h 6, y s 1, b t 5, r c 6"),
    truth: c => c.w > 5 ? "A" : c.c === "b" ? "B" : "C",
    hint: "Вес — это число. Числа можно сравнивать: больше «>», меньше «<»." },
];

export const GAMES = { robot: ROBOT, factory: FACTORY, bugs: BUGS };
