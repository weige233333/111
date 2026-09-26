/* ============================================================
   俄罗斯方块 · 游戏逻辑
   说明：包含三个核心类 Board / Piece / Game
   本文件已实现：七种方块形状定义 + 7-bag 随机算法
   ============================================================ */

/* ------------------------------------------------------------
   常量配置
   - COLS / ROWS / CELL：棋盘尺寸与单元格像素
   - COLORS：七种方块颜色（标准 Tetris 配色）
   - SHAPES：七种方块的「出生状态」矩阵
     表示约定：1 = 实心格，0 = 空白格
     尺寸约定：I = 4x4，O = 2x2，T/S/Z/J/L = 3x3
   ------------------------------------------------------------ */
const CONFIG = {
  COLS: 10,
  ROWS: 20,
  CELL: 30,
  NEXT_COUNT: 3,    // NEXT 预览展示接下来几个方块
  PREVIEW_CELL: 16, // 预览区每个格子的像素大小

  COLORS: {
    I: "#00f0f0", // 青
    O: "#f0f000", // 黄
    T: "#a000f0", // 紫
    S: "#00f000", // 绿
    Z: "#f00000", // 红
    J: "#0000f0", // 蓝
    L: "#f0a000", // 橙
  },

  // 每种方块仅定义「初始朝向」，其余旋转态在运行时由矩阵旋转生成
  SHAPES: {
    I: [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    O: [
      [1, 1],
      [1, 1],
    ],
    T: [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    S: [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    Z: [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
    J: [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    L: [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
  },
};

/* ------------------------------------------------------------
   工具函数：矩阵旋转（适用于方阵：2x2 / 3x3 / 4x4）
   dir = 1  顺时针 90°
   dir = -1 逆时针 90°
   返回一个新矩阵，不修改原矩阵
   ------------------------------------------------------------ */
function rotateMatrix(matrix, dir = 1) {
  const n = matrix.length;
  const result = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (dir === 1) {
        // 顺时针：new[x][n-1-y] = old[y][x]
        result[x][n - 1 - y] = matrix[y][x];
      } else {
        // 逆时针：new[n-1-x][y] = old[y][x]
        result[n - 1 - x][y] = matrix[y][x];
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------
   碰撞检测：isValidPosition
   纯函数 —— 不修改任何状态，仅判断「某方块在指定位置与旋转下是否合法」。
   参数：
     board    : Board 实例（含 cols/rows/grid）
     piece    : Piece 实例（至少含 type，用于取基础形状）
     offsetX  : 目标左上角列坐标（对应 piece.x）
     offsetY  : 目标左上角行坐标（对应 piece.y）
     rotation : 从基础形状起顺时针旋转 90° 的次数（0~3）
   判定：
     - 任一实心格越界（列 < 0 / 列 >= cols / 行 < 0 / 行 >= rows）→ 非法
     - 任一实心格与已锁定方块重叠（grid 非空）→ 非法
   返回：true 表示合法，false 表示不可放置
   ------------------------------------------------------------ */
function isValidPosition(board, piece, offsetX, offsetY, rotation) {
  // 取得该方块在 rotation 个顺时针 90° 旋转后的矩阵
  let matrix = CONFIG.SHAPES[piece.type].map((row) => [...row]);
  const r = ((rotation % 4) + 4) % 4; // 归一化到 0~3
  for (let i = 0; i < r; i++) matrix = rotateMatrix(matrix, 1);

  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix[y].length; x++) {
      if (!matrix[y][x]) continue; // 空白格跳过
      const col = offsetX + x;
      const row = offsetY + y;
      // 越界检查
      if (col < 0 || col >= board.cols || row < 0 || row >= board.rows) {
        return false;
      }
      // 与已锁定方块重叠检查
      if (board.grid[row][col]) {
        return false;
      }
    }
  }
  return true;
}

/* ------------------------------------------------------------
   SRS（Super Rotation System）旋转系统 + 墙踢（Wall Kick）偏移表
   状态编号：0 = 出生(spawn)，1 = 顺时针一次(R)，2 = 180°，3 = 逆时针一次(L)
   偏移表坐标约定（与 tetris.wiki 一致）：x 正方向 = 右，y 正方向 = 上
   注意：游戏棋盘的 y 正方向为「下」，因此应用时 newY = piece.y - ky
   - JLSTZ 组（J / L / S / T / Z）使用 3×3 包围盒
   - I 组使用 4×4 包围盒
   - O 不旋转、无踢墙
   每组 8 个相邻状态转移；每个转移最多 5 次测试偏移，按优先级从前到后尝试
   ------------------------------------------------------------ */
const SRS_KICKS = {
  // J / L / S / T / Z（3×3 包围盒）
  JLSTZ: {
    "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  },
  // I（4×4 包围盒）
  I: {
    "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  },
};

/**
 * 尝试按 SRS 规则旋转方块（含墙踢）。
 * 成功则原地修改 piece（matrix / rotation / x / y）并返回 true；
 * 所有踢墙测试均失败则不改变 piece 并返回 false。
 * @param {Board} board
 * @param {Piece} piece
 * @param {number} direction 1 = 顺时针，-1 = 逆时针
 */
function tryRotate(board, piece, direction = 1) {
  if (piece.type === "O") return false; // O 不旋转

  const from = piece.rotation;
  const to = (from + (direction === 1 ? 1 : 3)) % 4;

  const table = piece.type === "I" ? SRS_KICKS.I : SRS_KICKS.JLSTZ;
  const kicks = table[`${from}>${to}`];

  // 计算目标旋转后的矩阵（仅用于最终应用；校验时由 isValidPosition 按 rotation 重新推导）
  const rotated = rotateMatrix(piece.matrix, direction);

  for (const [kx, ky] of kicks) {
    // wiki 偏移 y 正方向为「上」，棋盘 y 正方向为「下」→ newY = piece.y - ky
    const candX = piece.x + kx;
    const candY = piece.y - ky;
    if (isValidPosition(board, piece, candX, candY, to)) {
      piece.x = candX;
      piece.y = candY;
      piece.rotation = to;
      piece.matrix = rotated;
      return true;
    }
  }
  return false; // 全部踢墙测试失败，取消旋转
}

/* ------------------------------------------------------------
   渲染工具：单元格 / 棋盘 / 方块
   约定：每个格子「实心填充 + 1px 深色边框」绘制；
        不同方块类型使用各自颜色（piece.color 或网格中存储的颜色）。
   ------------------------------------------------------------ */

/** 绘制单个单元格：填充 + 1px 边框（0.5px 偏移保证像素清晰不糊） */
function drawCell(ctx, px, py, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(px, py, size, size);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
}

/** 绘制棋盘：清屏 + 背景 + 已锁定格子 + 淡色网格线 */
function drawBoard(ctx, board) {
  const cell = CONFIG.CELL;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // 背景
  ctx.fillStyle = "#0b0d13";
  ctx.fillRect(0, 0, w, h);

  // 已锁定的格子（grid 中存储颜色字符串，空格为 null）
  if (board.grid) {
    for (let y = 0; y < board.grid.length; y++) {
      for (let x = 0; x < board.grid[y].length; x++) {
        const color = board.grid[y][x];
        if (color) drawCell(ctx, x * cell, y * cell, cell, color);
      }
    }
  }

  // 淡色网格线，便于辨识空格
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += cell) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += cell) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
}

/** 绘制单个方块（按其在棋盘中的 x/y 偏移定位） */
function drawPiece(ctx, piece) {
  const cell = CONFIG.CELL;
  const m = piece.getMatrix();
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m[y].length; x++) {
      if (m[y][x]) {
        drawCell(ctx, (piece.x + x) * cell, (piece.y + y) * cell, cell, piece.color);
      }
    }
  }
}

/* ------------------------------------------------------------
   Bag 类：7-bag 随机算法
   规则：每 7 个方块为一袋，袋内包含完整且不重复的
        I / O / T / S / Z / J / L 各一个，袋内随机打乱。
        当前袋取空后才生成下一袋，保证任意连续 7 个方块
        都恰好是全部七种，避免某一种长时间不出。
   ------------------------------------------------------------ */
class Bag {
  constructor() {
    this.pieces = ["I", "O", "T", "S", "Z", "J", "L"];
    this.queue = [];
    this._refill();
  }

  /** 生成一袋并 Fisher-Yates 洗牌后加入队列 */
  _refill() {
    const bag = [...this.pieces];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    this.queue.push(...bag);
  }

  /** 取出下一个方块类型（队列空时自动补一袋） */
  next() {
    if (this.queue.length === 0) this._refill();
    return this.queue.shift();
  }

  /** 预看下一个（不弹出，用于 NEXT 预览） */
  peek() {
    if (this.queue.length === 0) this._refill();
    return this.queue[0];
  }
}

/* ------------------------------------------------------------
   Piece 类：表示一个下落中的方块
   职责：维护方块形状、旋转状态、当前位置(x, y)、颜色
   ------------------------------------------------------------ */
class Piece {
  constructor(type, board) {
    this.type = type;                       // 方块类型（I/O/T/S/Z/J/L）
    this.board = board;                     // 对棋盘的引用，用于碰撞检测
    // 克隆初始矩阵，避免旋转后污染 CONFIG 中的原始定义
    this.matrix = CONFIG.SHAPES[type].map((row) => [...row]);
    this.rotation = 0; // 当前顺时针旋转次数（0~3），供 isValidPosition 使用
    this.color = CONFIG.COLORS[type];
    const size = this.matrix.length;
    // 出生位置：水平居中、贴顶
    this.x = Math.floor((CONFIG.COLS - size) / 2);
    this.y = 0;
  }

  /** 获取当前旋转状态下的形状矩阵 */
  getMatrix() {
    return this.matrix;
  }

  /** 按当前矩阵绘制方块到指定画布上下文 */
  draw(ctx) {
    drawPiece(ctx, this);
  }

  /** 旋转（dir: 1 顺时针 / -1 逆时针），使用 SRS 墙踢系统 */
  rotate(direction = 1) {
    // 委托给 SRS 旋转系统（含墙踢）；返回是否成功，成功后内部已更新 matrix/rotation/x/y
    return tryRotate(this.board, this, direction);
  }

  /** 水平移动（左/右）；合法则移动并返回 true */
  move(dx) {
    if (isValidPosition(this.board, this, this.x + dx, this.y, this.rotation)) {
      this.x += dx;
      return true;
    }
    return false;
  }

  /** 垂直下落一格；合法则下移并返回 true，否则返回 false */
  moveDown() {
    if (isValidPosition(this.board, this, this.x, this.y + 1, this.rotation)) {
      this.y += 1;
      return true;
    }
    return false;
  }

  /** 硬降（直接落到底部） */
  hardDrop() {}

  /** 检测当前位置/旋转下是否与边界或已锁定方块碰撞 */
  collides() {
    return !isValidPosition(this.board, this, this.x, this.y, this.rotation);
  }
}

/* ------------------------------------------------------------
   Board 类：表示游戏棋盘（网格状态）
   职责：存储已落定的方块、判满行、消行、提供碰撞查询
   ------------------------------------------------------------ */
class Board {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.grid = []; // 二维数组：null 表示空，否则存颜色字符串
    this.reset();
  }

  /** 用空白单元格初始化网格 */
  reset() {
    this.grid = Array.from({ length: this.rows }, () =>
      new Array(this.cols).fill(null)
    );
  }

  /** 将某个方块固化（锁定）到棋盘网格中（写入颜色） */
  lockPiece(piece) {
    const m = piece.getMatrix();
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const gx = piece.x + x;
        const gy = piece.y + y;
        if (gy >= 0 && gy < this.rows && gx >= 0 && gx < this.cols) {
          this.grid[gy][gx] = piece.color;
        }
      }
    }
  }

  /** 检测并清除已填满的行，返回消除的行数 */
  clearLines() {
    let cleared = 0;
    for (let y = this.rows - 1; y >= 0; y--) {
      if (this.isRowFull(y)) {
        this.grid.splice(y, 1);                 // 移除满行
        this.grid.unshift(new Array(this.cols).fill(null)); // 顶部补空行
        cleared++;
        y++; // 同一索引需重新检查（上方行已下移）
      }
    }
    return cleared;
  }

  /** 判断某一行是否已填满 */
  isRowFull(row) {
    return this.grid[row].every((c) => c !== null);
  }

  /** 判断坐标 (x, y) 是否合法（未越界且为空） */
  isValid(x, y) {
    return (
      x >= 0 && x < this.cols && y >= 0 && y < this.rows && !this.grid[y][x]
    );
  }

  /** 将整个棋盘绘制到主画布 */
  draw(ctx) {
    drawBoard(ctx, this);
  }
}

/* ------------------------------------------------------------
   Game 类：游戏主控制器
   职责：协调 Board 与 Piece、游戏循环、输入处理、计分、状态管理
   ------------------------------------------------------------ */
class Game {
  constructor(boardCanvas, nextCanvas, holdCanvas) {
    this.boardCanvas = boardCanvas;
    this.nextCanvas = nextCanvas;
    this.holdCanvas = holdCanvas;
    // 各画布的 2D 上下文
    this.boardCtx = boardCanvas.getContext("2d");
    this.nextCtx = nextCanvas.getContext("2d");
    this.holdCtx = holdCanvas.getContext("2d");

    this.board = new Board(CONFIG.COLS, CONFIG.ROWS); // 棋盘网格
    this.bag = new Bag();                             // 7-bag 随机发生器
    this.current = null;                             // 当前下落方块
    this.nextQueue = [];                             // 接下来 NEXT_COUNT 个方块类型
    this.holdType = null;                            // Hold 中的方块类型
    this.canHold = true;                             // 本回合是否已使用过 Hold

    // 计分与状态
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.paused = false;
    this.isGameOver = false;

    // 主循环计时
    this.lastTime = 0;     // 上一帧时间戳（0 表示需要重新对齐）
    this.dropCounter = 0;  // 累计经过的时间（ms）
    this.rafId = null;     // requestAnimationFrame 句柄
  }

  /** 初始化/重置一局游戏 */
  init() {
    this.board.reset();
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.paused = false;
    this.isGameOver = false;
    this.canHold = true;
    this.holdType = null;
    this.nextQueue = [];
    this._refillNext();     // 预先填充 NEXT 队列
    this.updateScorePanel();
    this.spawnPiece();
  }

  /** 启动主循环（在 init 之后调用） */
  start() {
    if (this.rafId) cancelAnimationFrame(this.rafId); // 避免重复调度
    this.lastTime = 0;
    this.dropCounter = 0;
    this.isGameOver = false;
    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  /**
   * 按等级返回自动下落间隔（毫秒）。
   * 等级越高间隔越短：level 1 ≈ 1000ms，按 0.85 指数递减，最低 80ms。
   */
  getDropInterval() {
    const base = 1000;
    const minInterval = 80;
    return Math.max(minInterval, base * Math.pow(0.85, this.level - 1));
  }

  /** 预先填充 NEXT 队列，使其始终保有 NEXT_COUNT 个方块类型 */
  _refillNext() {
    while (this.nextQueue.length < CONFIG.NEXT_COUNT) {
      this.nextQueue.push(this.bag.next());
    }
  }

  /** 生成下一个方块（从 NEXT 队列取类型），并补充队列 */
  spawnPiece() {
    const type = this.nextQueue.shift();
    this._refillNext();
    this.current = new Piece(type, this.board);
    // 出生即与已有方块碰撞 → 游戏结束
    if (this.current.collides()) {
      this.gameOver();
    }
  }

  /** 重力下落一步：能下移则下移，否则锁定并生成新方块 */
  drop() {
    if (!this.current) return;
    if (!this.current.moveDown()) {
      this.lockPiece();
    }
  }

  /** 将当前方块锁定到棋盘、消行、计分、生成新方块 */
  lockPiece() {
    this.board.lockPiece(this.current);
    const cleared = this.board.clearLines();
    if (cleared > 0) this.updateScore(cleared);
    this.canHold = true;
    this.spawnPiece();
  }

  /**
   * Hold 功能：将当前方块存入 Hold 区。
   * 规则：每个方块在「落地前」只能 Hold 一次（canHold 控制）。
   * - 首次 Hold：直接存入，再从 NEXT 队列取出新方块。
   * - 非首次：与 Hold 中的方块交换（取出 Hold 方块，当前方块存入 Hold）。
   */
  holdPiece() {
    if (!this.canHold || !this.current) return;
    const curType = this.current.type;
    if (this.holdType === null) {
      this.holdType = curType;
      this.spawnPiece(); // 取 NEXT 队列中的新方块
    } else {
      const swapType = this.holdType;
      this.holdType = curType;
      this.current = new Piece(swapType, this.board);
      // 交换后若出生即碰撞 → 游戏结束
      if (this.current.collides()) this.gameOver();
    }
    this.canHold = false; // 本回合已使用 Hold
    this.dropCounter = 0; // 重置重力计时，避免立刻下落
  }

  /**
   * 主游戏循环（requestAnimationFrame 驱动）。
   * 依据经过的时间累计，达到当前等级的下落间隔时执行一次重力下落。
   */
  loop(time = 0) {
    if (this.isGameOver) return;

    if (this.paused) {
      this.rafId = requestAnimationFrame((t) => this.loop(t));
      return;
    }

    // 首帧或刚恢复：将 delta 归零，避免一次暴冲
    if (this.lastTime === 0) this.lastTime = time;
    const delta = time - this.lastTime;
    this.lastTime = time;

    this.dropCounter += delta;
    if (this.dropCounter >= this.getDropInterval()) {
      this.drop();
      this.dropCounter = 0;
    }

    if (this.isGameOver) {
      this.render();
      return; // 已结束，不再调度下一帧
    }

    this.render();
    this.rafId = requestAnimationFrame((t) => this.loop(t));
  }

  /** 硬降：直接落到底部并锁定（每下落一格 +2 分） */
  hardDrop() {
    if (!this.current) return;
    let dropped = 0;
    while (this.current.moveDown()) dropped++;
    this.score += dropped * 2;
    this.updateScorePanel();
    this.lockPiece();
  }

  /** 处理键盘输入（左/右/下/旋转/硬降/Hold/暂停/重开） */
  handleInput(event) {
    const k = event.key;

    // 重新开始（任何时候可用）
    if (k === "r" || k === "R") {
      this.init();
      this.start();
      event.preventDefault();
      return;
    }

    if (this.isGameOver) return;

    // 暂停切换（任何时候可用）
    if (k === "p" || k === "P") {
      this.togglePause();
      event.preventDefault();
      return;
    }
    if (this.paused) return;
    if (!this.current) return;

    switch (k) {
      case "ArrowLeft":
        this.current.move(-1);
        break;
      case "ArrowRight":
        this.current.move(1);
        break;
      case "ArrowDown":
        if (this.current.moveDown()) {
          this.score += 1; // 软降每格 +1 分
          this.updateScorePanel();
        }
        this.dropCounter = 0; // 软降：重置重力计时
        break;
      case "ArrowUp":
      case "x":
      case "X":
        this.current.rotate(1); // 顺时针
        break;
      case "z":
      case "Z":
        this.current.rotate(-1); // 逆时针
        break;
      case " ":
        this.hardDrop();
        break;
      case "c":
      case "C":
      case "Shift":
        this.holdPiece();
        break;
    }
    event.preventDefault();
  }

  /** 更新分数、等级、消行数，并刷新 DOM 面板 */
  updateScore(linesCleared) {
    // 单/双/三/四消行基础分（实际再乘以当前等级）
    const table = [0, 100, 300, 500, 800];
    this.score += (table[linesCleared] || 0) * this.level;
    this.lines += linesCleared;
    this.level = Math.floor(this.lines / 10) + 1; // 每 10 行升一级
    this.updateScorePanel();
  }

  /** 刷新分数面板 DOM */
  updateScorePanel() {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set("score", this.score);
    set("lines", this.lines);
    set("level", this.level);
  }

  /** 绘制所有画布：主棋盘 + 当前方块 + NEXT 预览 + HOLD 预览 + 状态遮罩 */
  render() {
    this.board.draw(this.boardCtx);
    if (this.current) this.current.draw(this.boardCtx);
    this.drawNext();
    this.drawHold();
    this.drawOverlay();
  }

  /** 暂停 / 结束时的半透明遮罩与文字提示 */
  drawOverlay() {
    const ctx = this.boardCtx;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    if (this.paused) {
      this._overlayBox(ctx, W, H, "已暂停", "按 P 继续");
    } else if (this.isGameOver) {
      this._overlayBox(ctx, W, H, "游戏结束", "得分 " + this.score + " · 按 R 重开");
    }
  }

  /** 在棋盘上绘制半透明遮罩与居中文字 */
  _overlayBox(ctx, W, H, title, sub) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px sans-serif";
    ctx.fillText(title, W / 2, H / 2 - 18);
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.fillText(sub, W / 2, H / 2 + 22);
  }

  /** 绘制 NEXT 预览（竖排展示接下来 NEXT_COUNT 个方块） */
  drawNext() {
    const ctx = this.nextCtx;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.fillStyle = "#0b0d13";
    ctx.fillRect(0, 0, W, H);
    const n = this.nextQueue.length;
    const slotH = H / n;
    for (let i = 0; i < n; i++) {
      // 槽位分隔线（除第一个外）
      if (i > 0) {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, i * slotH + 0.5);
        ctx.lineTo(W, i * slotH + 0.5);
        ctx.stroke();
      }
      this.drawPreviewPiece(
        ctx,
        this.nextQueue[i],
        0,
        i * slotH,
        W,
        slotH,
        CONFIG.PREVIEW_CELL
      );
    }
  }

  /** 绘制 HOLD 预览（单个方块居中） */
  drawHold() {
    const ctx = this.holdCtx;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    ctx.fillStyle = "#0b0d13";
    ctx.fillRect(0, 0, W, H);
    if (this.holdType) {
      this.drawPreviewPiece(ctx, this.holdType, 0, 0, W, H, CONFIG.PREVIEW_CELL);
    }
  }

  /**
   * 在指定槽位内居中绘制某类型的方块预览。
   * 先裁剪掉空白行列，使 I/O 等形状都能自然居中。
   */
  drawPreviewPiece(ctx, type, slotX, slotY, slotW, slotH, cell) {
    const color = CONFIG.COLORS[type];
    const shape = CONFIG.SHAPES[type];
    let minX = 99, maxX = -1, minY = 99, maxY = -1;
    const cells = [];
    for (let y = 0; y < shape.length; y++) {
      for (let x = 0; x < shape[y].length; x++) {
        if (shape[y][x]) {
          cells.push([x, y]);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const startX = slotX + (slotW - w * cell) / 2;
    const startY = slotY + (slotH - h * cell) / 2;
    for (const [x, y] of cells) {
      drawCell(ctx, startX + (x - minX) * cell, startY + (y - minY) * cell, cell, color);
    }
  }

  /** 暂停 / 恢复游戏 */
  togglePause() {
    this.paused = !this.paused;
    if (!this.paused) this.lastTime = 0; // 恢复后下一帧 delta 归零
  }

  /** 游戏结束处理 */
  gameOver() {
    this.isGameOver = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    console.log("GAME OVER — 分数:", this.score, "行数:", this.lines, "等级:", this.level);
  }
}

/* ------------------------------------------------------------
   启动入口
   在 DOM 加载完成后实例化各画布并启动游戏
   ------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  const boardCanvas = document.getElementById("board-canvas");
  const nextCanvas = document.getElementById("next-canvas");
  const holdCanvas = document.getElementById("hold-canvas");

  const game = new Game(boardCanvas, nextCanvas, holdCanvas);
  game.init();  // 初始化并生成首个方块
  game.start(); // 启动 requestAnimationFrame 主循环

  // 键盘控制：← → 移动，↓ 软降，↑/X 顺时针，Z 逆时针，空格硬降，C/Shift Hold，P 暂停
  document.addEventListener("keydown", (e) => game.handleInput(e));
});
