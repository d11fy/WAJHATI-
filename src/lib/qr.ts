// Pure ISO/IEC 18004 QR Code matrix generator (Versions 1-6, Error Correction Level L, Byte Mode).

const CAPACITIES = [0, 17, 32, 53, 78, 106, 134] as const;
const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172] as const;
const EC_CODEWORDS = [0, 7, 10, 15, 20, 26, 18] as const;
const BLOCKS = [0, 1, 1, 1, 1, 1, 2] as const;
const ALIGNMENT: readonly (readonly number[])[] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]];

function gfMul(a: number, b: number): number {
  let res = 0;
  let x = a;
  let y = b;
  while (y > 0) {
    if (y & 1) res ^= x;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
    y >>= 1;
  }
  return res;
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
    root = gfMul(root, 2);
  }
  return poly;
}

function rsRemainder(data: number[], degree: number): number[] {
  const gen = rsGeneratorPoly(degree);
  const rem = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < degree; i++) {
      rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return rem;
}

function placeFinder(grid: (number | null)[][], reserved: boolean[][], row: number, col: number) {
  const size = grid.length;
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      grid[rr][cc] = inOuter && (onBorder || inInner) ? 1 : 0;
      reserved[rr][cc] = true;
    }
  }
}

function placeAlignment(grid: (number | null)[][], reserved: boolean[][], row: number, col: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = row + r;
      const cc = col + c;
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      grid[rr][cc] = dark ? 1 : 0;
      reserved[rr][cc] = true;
    }
  }
}

function formatBits(mask: number): number {
  // Error Correction Level L = 01
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0b10100110111 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0b101010000010010;
}

export function createQrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1;
  while (version <= 6 && bytes.length > CAPACITIES[version]) version++;
  if (version > 6) {
    throw new Error("QR payload exceeds maximum supported length.");
  }

  const totalCodewords = TOTAL_CODEWORDS[version];
  const ecPerBlock = EC_CODEWORDS[version];
  const blocks = BLOCKS[version];
  const dataCodewords = totalCodewords - ecPerBlock * blocks;

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };

  // Byte mode indicator (0100) + character count (8 bits for versions 1-9)
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);

  const maxBits = dataCodewords * 8;
  pushBits(0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  let padToggle = true;
  while (data.length < dataCodewords) {
    data.push(padToggle ? 0xec : 0x11);
    padToggle = !padToggle;
  }

  const blockSize = dataCodewords / blocks;
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let b = 0; b < blocks; b++) {
    const slice = data.slice(b * blockSize, (b + 1) * blockSize);
    dataBlocks.push(slice);
    ecBlocks.push(rsRemainder(slice, ecPerBlock));
  }

  const codewords: number[] = [];
  for (let i = 0; i < blockSize; i++) {
    for (let b = 0; b < blocks; b++) codewords.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let b = 0; b < blocks; b++) codewords.push(ecBlocks[b][i]);
  }

  const size = 17 + version * 4;
  const grid: (number | null)[][] = Array.from({ length: size }, () => new Array<number | null>(size).fill(null));
  const reserved: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

  placeFinder(grid, reserved, 0, 0);
  placeFinder(grid, reserved, 0, size - 7);
  placeFinder(grid, reserved, size - 7, 0);

  const coords = ALIGNMENT[version];
  for (const r of coords) {
    for (const c of coords) {
      if (!reserved[r][c]) placeAlignment(grid, reserved, r, c);
    }
  }

  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) {
      grid[6][i] = i % 2 === 0 ? 1 : 0;
      reserved[6][i] = true;
    }
    if (!reserved[i][6]) {
      grid[i][6] = i % 2 === 0 ? 1 : 0;
      reserved[i][6] = true;
    }
  }

  // Dark module and reserved format information areas
  grid[size - 8][8] = 1;
  reserved[size - 8][8] = true;
  for (let i = 0; i < 9; i++) {
    if (i < size) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  const stream: number[] = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) stream.push((cw >>> i) & 1);
  }

  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          grid[r][c] = bitIdx < stream.length ? stream[bitIdx++] : 0;
        }
      }
    }
    upward = !upward;
  }

  // Apply mask 0: (r + c) % 2 === 0
  const mask = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && (r + c) % 2 === 0) {
        grid[r][c] = (grid[r][c] ?? 0) ^ 1;
      }
    }
  }

  const fmt = formatBits(mask);
  for (let i = 0; i <= 5; i++) grid[8][i] = (fmt >>> i) & 1;
  grid[8][7] = (fmt >>> 6) & 1;
  grid[8][8] = (fmt >>> 7) & 1;
  grid[7][8] = (fmt >>> 8) & 1;
  for (let i = 9; i < 15; i++) grid[14 - i][8] = (fmt >>> i) & 1;

  for (let i = 0; i < 8; i++) grid[8][size - 1 - i] = (fmt >>> i) & 1;
  for (let i = 8; i < 15; i++) grid[size - 15 + i][8] = (fmt >>> i) & 1;

  return grid.map((row) => row.map((cell) => cell === 1));
}

