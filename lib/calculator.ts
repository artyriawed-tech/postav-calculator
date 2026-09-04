export type Product = {
  id: string;
  name: string;
  nominalThickness: number;
  nominalWidth: number;
  cuttingThickness: number;
  cuttingWidth: number;
  color: "blue" | "amber";
  enabled: boolean;
  priority?: "primary" | "byproduct";
};

export type SawLineStages = {
  breakdownKerf: number;
  multiripKerf: number;
  edgingKerf: number;
};

export type Equipment = {
  id: string;
  name: string;
  maxSaws: number;
  kerf: number;
  maxDiameter: number;
  secondaryEdging: boolean;
  multipleFeeds: boolean;
  stages?: SawLineStages;
};

export type Defect = {
  enabled: boolean;
  side: "left" | "right" | "top" | "bottom";
  depth: number;
};

export type Piece = {
  id: string;
  productId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zone: "center" | "side";
  secondary: boolean;
};

export type Variant = {
  id: string;
  cantHeight: number;
  pieces: Piece[];
  counts: Record<string, number>;
  nominalVolume: number;
  cuttingVolume: number;
  logVolume: number;
  gostDiameterCm: number;
  gostLengthM: number;
  actualLogLengthM: number;
  nominalRecovery: number;
  cuttingRecovery: number;
  residualRecovery: number;
  mainSawCount: number;
  secondaryCount: number;
  feeds: number;
  offsetX: number;
  offsetY: number;
  signature: string;
};

export type Calculation = {
  status: "ok" | "invalid" | "no-solution";
  variants: Variant[];
  error?: string;
};

export type GeometryAudit = {
  minEdgeClearance: number;
  overlapCount: number;
  outsideCount: number;
  defectCollisionCount: number;
  edgeClearancePassed: boolean;
  passed: boolean;
};

type RowState = { ids: string[]; pieces: Piece[]; primaryArea: number; totalArea: number; primaryMask: number };
type CapState = { layers: string[][]; primaryArea: number; totalArea: number; primaryMask: number };
type SideState = { ids: string[]; cursor: number; primaryArea: number; totalArea: number; primaryMask: number };

const EPSILON = 1e-7;

// ГОСТ 2708-75, таблица 1: объём одного круглого лесоматериала по толщине
// в верхнем отрубе и длине. В рабочем интерфейсе используются только эти
// стандартные длины, поэтому процент выхода можно сверить обычным кубатурником.
export const GOST_LENGTHS_M = [3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 7, 7.5, 8, 8.5, 9] as const;
const GOST_2708_VOLUMES: Record<number, readonly number[]> = {
  14: [0.052, 0.057, 0.061, 0.067, 0.073, 0.078, 0.084, 0.090, 0.097, 0.104, 0.110, 0.116, 0.123, 0.128, 0.135, 0.150, 0.164, 0.179, 0.195, 0.21],
  16: [0.069, 0.075, 0.082, 0.088, 0.095, 0.102, 0.110, 0.117, 0.124, 0.132, 0.140, 0.147, 0.155, 0.164, 0.172, 0.189, 0.200, 0.220, 0.240, 0.26],
  18: [0.086, 0.095, 0.103, 0.111, 0.120, 0.129, 0.138, 0.147, 0.156, 0.166, 0.175, 0.184, 0.194, 0.200, 0.210, 0.230, 0.25, 0.28, 0.3, 0.32],
  20: [0.107, 0.116, 0.126, 0.136, 0.147, 0.158, 0.170, 0.180, 0.190, 0.200, 0.210, 0.220, 0.230, 0.240, 0.260, 0.28, 0.30, 0.33, 0.36, 0.39],
  22: [0.130, 0.143, 0.154, 0.166, 0.178, 0.190, 0.200, 0.210, 0.230, 0.240, 0.250, 0.260, 0.280, 0.290, 0.310, 0.34, 0.37, 0.40, 0.43, 0.46],
  24: [0.157, 0.170, 0.184, 0.198, 0.210, 0.220, 0.240, 0.250, 0.270, 0.280, 0.300, 0.310, 0.330, 0.340, 0.360, 0.40, 0.43, 0.47, 0.50, 0.55],
  26: [0.185, 0.200, 0.210, 0.230, 0.250, 0.260, 0.280, 0.300, 0.320, 0.340, 0.350, 0.370, 0.390, 0.410, 0.430, 0.46, 0.50, 0.54, 0.58, 0.63],
  28: [0.220, 0.230, 0.250, 0.270, 0.290, 0.310, 0.330, 0.350, 0.370, 0.390, 0.410, 0.430, 0.450, 0.470, 0.490, 0.53, 0.58, 0.63, 0.67, 0.72],
  30: [0.250, 0.270, 0.290, 0.310, 0.330, 0.350, 0.380, 0.400, 0.420, 0.450, 0.470, 0.490, 0.520, 0.540, 0.560, 0.61, 0.66, 0.72, 0.78, 0.83],
  32: [0.280, 0.300, 0.330, 0.350, 0.380, 0.400, 0.430, 0.450, 0.480, 0.510, 0.530, 0.560, 0.590, 0.620, 0.640, 0.70, 0.76, 0.82, 0.88, 0.94],
  34: [0.320, 0.340, 0.370, 0.400, 0.430, 0.460, 0.490, 0.510, 0.540, 0.570, 0.600, 0.630, 0.660, 0.690, 0.720, 0.78, 0.85, 0.92, 0.98, 1.06],
  36: [0.360, 0.390, 0.420, 0.450, 0.480, 0.510, 0.540, 0.570, 0.600, 0.640, 0.670, 0.710, 0.740, 0.770, 0.800, 0.88, 0.95, 1.02, 1.10, 1.18],
};

export function gost2708Volume(diameterMm: number, lengthMm: number) {
  if (!Number.isFinite(diameterMm) || diameterMm < 140) return null;
  // Для толщины от 14 см: доли до следующего нечётного сантиметра отбрасывают,
  // нечётный сантиметр и всё выше округляют к следующему чётному классу.
  const diameterCm = Math.floor((diameterMm / 10 + 1) / 2) * 2;
  const lengthM = lengthMm / 1000;
  const lengthIndex = GOST_LENGTHS_M.findIndex((value) => Math.abs(value - lengthM) < EPSILON);
  const row = GOST_2708_VOLUMES[diameterCm];
  if (!row || lengthIndex < 0) return null;
  return { volume: row[lengthIndex], diameterCm, lengthM };
}

export function calculateFaceMetrics(diameterMm: number, edgeAllowanceMm: number, products: Product[], counts: Record<string, number>) {
  const cuttingArea = products.reduce((sum, product) => sum + (counts[product.id] || 0) * product.cuttingThickness * product.cuttingWidth, 0);
  const workingArea = Math.PI * Math.max(0, diameterMm / 2 - edgeAllowanceMm) ** 2;
  const faceFill = workingArea > 0 ? cuttingArea / workingArea * 100 : 0;
  return { cuttingArea, workingArea, faceFill, freeArea: Math.max(0, 100 - faceFill) };
}

function rectFits(x: number, y: number, width: number, height: number, radius: number) {
  const farX = Math.max(Math.abs(x), Math.abs(x + width));
  const farY = Math.max(Math.abs(y), Math.abs(y + height));
  return farX * farX + farY * farY <= radius * radius + EPSILON;
}

function areaScore(product: Product) {
  return product.nominalThickness * product.nominalWidth;
}

function primaryMaskFor(product: Product, primaryBits: Map<string, number>) {
  const bit = primaryBits.get(product.id);
  return bit === undefined ? 0 : 2 ** bit;
}

function betterScore(a: Pick<SideState, "primaryArea" | "totalArea" | "ids">, b: Pick<SideState, "primaryArea" | "totalArea" | "ids">, objective: "primary" | "recovery") {
  const comparison = objective === "recovery"
    ? a.totalArea - b.totalArea || a.primaryArea - b.primaryArea
    : a.primaryArea - b.primaryArea || a.totalArea - b.totalArea;
  return comparison > EPSILON || (Math.abs(comparison) <= EPSILON && a.ids.length < b.ids.length);
}

function sideStates(
  eligible: Product[],
  kerf: number,
  radius: number,
  inner: number,
  objective: "primary" | "recovery",
  primaryBits: Map<string, number>,
  span: (product: Product) => number,
  fits: (product: Product, start: number) => boolean,
) {
  const initial: SideState = { ids: [], cursor: inner, primaryArea: 0, totalArea: 0, primaryMask: 0 };
  const states = new Map<string, SideState>([[`${Math.round(inner * 1e6)}|0`, initial]]);
  const queue = [initial];
  while (queue.length) {
    const state = queue.shift()!;
    const key = `${Math.round(state.cursor * 1e6)}|${state.primaryMask}`;
    if (states.get(key) !== state) continue;
    for (const product of eligible) {
      if (!fits(product, state.cursor)) continue;
      const productArea = areaScore(product);
      const next: SideState = {
        ids: [...state.ids, product.id],
        cursor: state.cursor + span(product) + kerf,
        primaryArea: state.primaryArea + (product.priority === "primary" ? productArea : 0),
        totalArea: state.totalArea + productArea,
        primaryMask: state.primaryMask | primaryMaskFor(product, primaryBits),
      };
      if (next.cursor - kerf > radius + EPSILON) continue;
      const nextKey = `${Math.round(next.cursor * 1e6)}|${next.primaryMask}`;
      const previous = states.get(nextKey);
      if (!previous || betterScore(next, previous, objective)) {
        states.set(nextKey, next);
        queue.push(next);
      }
    }
  }
  const groups = new Map<string, SideState[]>();
  for (const state of states.values()) {
    const key = `${state.primaryMask}|${state.ids.length}`;
    groups.set(key, [...(groups.get(key) || []), state]);
  }
  const pareto: SideState[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.cursor - b.cursor);
    let best: SideState | null = null;
    for (const state of group) {
      if (best && !betterScore(state, best, objective)) continue;
      pareto.push(state);
      best = state;
    }
  }
  return pareto;
}

function generateRows(products: Product[], kerf: number, radius: number, cantHeight: number, objective: "primary" | "recovery" = "primary") {
  const eligible = products.filter((product) => product.enabled && product.cuttingWidth <= cantHeight + EPSILON);
  if (!eligible.length) return [];
  const productMap = new Map(products.map((product) => [product.id, product]));
  const primaryBits = new Map(products.filter((product) => product.priority === "primary").map((product, index) => [product.id, index]));
  const centers: Array<Product | null> = [null, ...eligible.filter((product) =>
    rectFits(-product.cuttingThickness / 2, -product.cuttingWidth / 2, product.cuttingThickness, product.cuttingWidth, radius),
  )];
  const rows = new Map<string, RowState>();

  for (const center of centers) {
    const inner = center ? center.cuttingThickness / 2 + kerf : kerf / 2;
    const sides = sideStates(
      eligible,
      kerf,
      radius,
      inner,
      objective,
      primaryBits,
      (product) => product.cuttingThickness,
      (product, start) => rectFits(start, -product.cuttingWidth / 2, product.cuttingThickness, product.cuttingWidth, radius),
    );
    for (const left of sides) for (const right of sides) {
      if (!center && !left.ids.length && !right.ids.length) continue;
      const pieces: Piece[] = [];
      let leftCursor = inner;
      for (const id of left.ids) {
        const product = productMap.get(id)!;
        pieces.push({ id: "", productId: id, x: -leftCursor - product.cuttingThickness, y: -product.cuttingWidth / 2, width: product.cuttingThickness, height: product.cuttingWidth, zone: product.cuttingWidth === cantHeight ? "center" : "side", secondary: product.cuttingWidth < cantHeight });
        leftCursor += product.cuttingThickness + kerf;
      }
      if (center) pieces.push({ id: "", productId: center.id, x: -center.cuttingThickness / 2, y: -center.cuttingWidth / 2, width: center.cuttingThickness, height: center.cuttingWidth, zone: center.cuttingWidth === cantHeight ? "center" : "side", secondary: center.cuttingWidth < cantHeight });
      let rightCursor = inner;
      for (const id of right.ids) {
        const product = productMap.get(id)!;
        pieces.push({ id: "", productId: id, x: rightCursor, y: -product.cuttingWidth / 2, width: product.cuttingThickness, height: product.cuttingWidth, zone: product.cuttingWidth === cantHeight ? "center" : "side", secondary: product.cuttingWidth < cantHeight });
        rightCursor += product.cuttingThickness + kerf;
      }
      pieces.sort((a, b) => a.x - b.x);
      const rowMidpoint = (pieces[0].x + pieces.at(-1)!.x + pieces.at(-1)!.width) / 2;
      const centerArea = center ? areaScore(center) : 0;
      const store = (candidatePieces: Piece[]) => {
        candidatePieces.forEach((piece, index) => { piece.id = `row-${index}`; });
        if (!candidatePieces.every((piece) => rectFits(piece.x, piece.y, piece.width, piece.height, radius))) return;
        const state: RowState = {
          ids: candidatePieces.map((piece) => piece.productId),
          pieces: candidatePieces,
          primaryArea: left.primaryArea + right.primaryArea + (center?.priority === "primary" ? centerArea : 0),
          totalArea: left.totalArea + right.totalArea + centerArea,
          primaryMask: left.primaryMask | right.primaryMask | (center ? primaryMaskFor(center, primaryBits) : 0),
        };
        const signature = candidatePieces.map((piece) => `${piece.productId}@${piece.x}`).join(",");
        const previous = rows.get(signature);
        if (!previous || betterScore(state, previous, objective)) rows.set(signature, state);
      };
      store(pieces.map((piece) => ({ ...piece })));
      if (Math.abs(rowMidpoint) > EPSILON) store(pieces.map((piece) => ({ ...piece, x: piece.x - rowMidpoint })));
    }
  }
  const bestRows = new Map<string, RowState>();
  for (const state of rows.values()) {
    const key = `${state.primaryMask}|${state.pieces.length}`;
    const previous = bestRows.get(key);
    if (!previous || betterScore(state, previous, objective)) bestRows.set(key, state);
    else if (previous && !betterScore(previous, state, objective)) {
      const span = Math.max(...state.pieces.map((piece) => piece.x + piece.width)) - Math.min(...state.pieces.map((piece) => piece.x));
      const previousSpan = Math.max(...previous.pieces.map((piece) => piece.x + piece.width)) - Math.min(...previous.pieces.map((piece) => piece.x));
      const maxCorner = (row: RowState) => Math.max(...row.pieces.flatMap((piece) => [piece.x, piece.x + piece.width].flatMap((x) => [piece.y, piece.y + piece.height].map((y) => Math.hypot(x, y)))));
      if (span < previousSpan - EPSILON || (Math.abs(span - previousSpan) <= EPSILON && maxCorner(state) < maxCorner(previous) - EPSILON)) bestRows.set(key, state);
    }
  }
  return [...bestRows.values()].sort((a, b) => objective === "recovery"
    ? b.totalArea - a.totalArea || b.primaryArea - a.primaryArea
    : b.primaryArea - a.primaryArea || b.totalArea - a.totalArea);
}

function buildCapLayer(ids: string[], layer: number, inner: number, products: Product[], kerf: number, radius: number) {
  const map = new Map(products.map((product) => [product.id, product]));
  if (!ids.length) return [];
  const thickness = map.get(ids[0])!.cuttingThickness;
  if (ids.some((id) => Math.abs(map.get(id)!.cuttingThickness - thickness) > EPSILON)) return null;
  const rowWidth = ids.reduce((sum, id) => sum + map.get(id)!.cuttingWidth, 0) + Math.max(0, ids.length - 1) * kerf;
  let cursor = -rowWidth / 2;
  const pieces: Piece[] = [];
  ids.forEach((id, index) => {
    const product = map.get(id)!;
    pieces.push({ id: `cap-top-${layer}-${index}`, productId: id, x: cursor, y: inner, width: product.cuttingWidth, height: thickness, zone: "side", secondary: true });
    pieces.push({ id: `cap-bottom-${layer}-${index}`, productId: id, x: cursor, y: -inner - thickness, width: product.cuttingWidth, height: thickness, zone: "side", secondary: true });
    cursor += product.cuttingWidth + kerf;
  });
  return pieces.every((piece) => rectFits(piece.x, piece.y, piece.width, piece.height, radius)) ? pieces : null;
}

function generateCapLayerOptions(products: Product[], kerf: number, radius: number, inner: number, objective: "primary" | "recovery" = "primary") {
  const groups = new Map<number, Product[]>();
  products.filter((product) => product.enabled).forEach((product) => groups.set(product.cuttingThickness, [...(groups.get(product.cuttingThickness) || []), product]));
  const primaryBits = new Map(products.filter((product) => product.priority === "primary").map((product, index) => [product.id, index]));
  const options = new Map<string, string[]>();
  for (const group of groups.values()) {
    const centers: Array<Product | null> = [null, ...group.filter((product) =>
      rectFits(-product.cuttingWidth / 2, inner, product.cuttingWidth, product.cuttingThickness, radius),
    )];
    for (const center of centers) {
      const start = center ? center.cuttingWidth / 2 + kerf : kerf / 2;
      const sides = sideStates(
        group,
        kerf,
        radius,
        start,
        objective,
        primaryBits,
        (product) => product.cuttingWidth,
        (product, x) => rectFits(x, inner, product.cuttingWidth, product.cuttingThickness, radius),
      );
      for (const left of sides) for (const right of sides) {
        const ids = [...left.ids].reverse().concat(center ? [center.id] : [], right.ids);
        if (!ids.length || !buildCapLayer(ids, 0, inner, products, kerf, radius)) continue;
        options.set(ids.join(","), ids);
      }
    }
  }
  const map = new Map(products.map((product) => [product.id, product]));
  const primaryArea = (ids: string[]) => ids.reduce((sum, id) => {
    const product = map.get(id)!;
    return product.priority === "primary" ? sum + product.nominalThickness * product.nominalWidth : sum;
  }, 0);
  const totalArea = (ids: string[]) => ids.reduce((sum, id) => sum + map.get(id)!.nominalThickness * map.get(id)!.nominalWidth, 0);
  const reduced = new Map<string, string[]>();
  for (const ids of options.values()) {
    const first = map.get(ids[0])!;
    const mask = ids.reduce((value, id) => value | primaryMaskFor(map.get(id)!, primaryBits), 0);
    const key = `${first.cuttingThickness}|${mask}`;
    const previous = reduced.get(key);
    if (!previous) { reduced.set(key, ids); continue; }
    const currentScore = objective === "recovery" ? totalArea(ids) : primaryArea(ids);
    const previousScore = objective === "recovery" ? totalArea(previous) : primaryArea(previous);
    const currentSecondary = objective === "recovery" ? primaryArea(ids) : totalArea(ids);
    const previousSecondary = objective === "recovery" ? primaryArea(previous) : totalArea(previous);
    const currentWidth = ids.reduce((sum, id) => sum + map.get(id)!.cuttingWidth, 0) + (ids.length - 1) * kerf;
    const previousWidth = previous.reduce((sum, id) => sum + map.get(id)!.cuttingWidth, 0) + (previous.length - 1) * kerf;
    if (currentScore > previousScore + EPSILON || (Math.abs(currentScore - previousScore) <= EPSILON && (currentSecondary > previousSecondary + EPSILON || (Math.abs(currentSecondary - previousSecondary) <= EPSILON && currentWidth < previousWidth)))) reduced.set(key, ids);
  }
  return [...reduced.values()]
    .sort((a, b) => objective === "recovery"
      ? totalArea(b) - totalArea(a) || primaryArea(b) - primaryArea(a)
      : primaryArea(b) - primaryArea(a) || totalArea(b) - totalArea(a));
}

function buildCaps(layers: string[][], products: Product[], edgingKerf: number, radius: number, cantHeight: number, breakdownKerf = edgingKerf) {
  const map = new Map(products.map((product) => [product.id, product]));
  let inner = cantHeight / 2 + breakdownKerf;
  const pieces: Piece[] = [];
  for (let layer = 0; layer < layers.length; layer += 1) {
    const layerPieces = buildCapLayer(layers[layer], layer, inner, products, edgingKerf, radius);
    if (!layerPieces) return null;
    pieces.push(...layerPieces);
    inner += map.get(layers[layer][0])!.cuttingThickness + breakdownKerf;
  }
  return pieces;
}

function generateCaps(products: Product[], edgingKerf: number, radius: number, cantHeight: number, breakdownKerf = edgingKerf, objective: "primary" | "recovery" = "primary") {
  const map = new Map(products.map((product) => [product.id, product]));
  const primaryBits = new Map(products.filter((product) => product.priority === "primary").map((product, index) => [product.id, index]));
  const initial: CapState = { layers: [], primaryArea: 0, totalArea: 0, primaryMask: 0 };
  const best = new Map<string, CapState>([[`${Math.round((cantHeight / 2 + breakdownKerf) * 1e6)}|0`, initial]]);
  const optionsCache = new Map<number, string[][]>();
  const queue = [initial];
  while (queue.length) {
    const state = queue.shift()!;
    const inner = cantHeight / 2 + breakdownKerf + state.layers.reduce((sum, layer) => sum + map.get(layer[0])!.cuttingThickness + breakdownKerf, 0);
    const stateKey = `${Math.round(inner * 1e6)}|${state.primaryMask}`;
    if (best.get(stateKey) !== state) continue;
    const innerKey = Math.round(inner * 1e6);
    const options = optionsCache.get(innerKey) || generateCapLayerOptions(products, edgingKerf, radius, inner, objective);
    optionsCache.set(innerKey, options);
    for (const ids of options) {
      const layerArea = ids.reduce((sum, id) => sum + areaScore(map.get(id)!), 0) * 2;
      const layerPrimaryArea = ids.reduce((sum, id) => map.get(id)!.priority === "primary" ? sum + areaScore(map.get(id)!) : sum, 0) * 2;
      const layerMask = ids.reduce((mask, id) => mask | primaryMaskFor(map.get(id)!, primaryBits), 0);
      const next: CapState = { layers: [...state.layers, ids], primaryArea: state.primaryArea + layerPrimaryArea, totalArea: state.totalArea + layerArea, primaryMask: state.primaryMask | layerMask };
      const nextInner = inner + map.get(ids[0])!.cuttingThickness + breakdownKerf;
      const nextKey = `${Math.round(nextInner * 1e6)}|${next.primaryMask}`;
      const previous = best.get(nextKey);
      if (!previous || betterScore({ ...next, ids: next.layers.flat() }, { ...previous, ids: previous.layers.flat() }, objective)) {
        best.set(nextKey, next);
        queue.push(next);
      }
    }
  }
  return [...new Set(best.values())].sort((a, b) => objective === "recovery"
    ? b.totalArea - a.totalArea || b.primaryArea - a.primaryArea
    : b.primaryArea - a.primaryArea || b.totalArea - a.totalArea);
}

function countProducts(pieces: Piece[]) {
  return pieces.reduce<Record<string, number>>((counts, piece) => {
    counts[piece.productId] = (counts[piece.productId] || 0) + 1;
    return counts;
  }, {});
}

function shiftedPieces(pieces: Piece[], offsetX: number, offsetY: number) {
  return pieces.map((piece) => ({ ...piece, x: piece.x + offsetX, y: piece.y + offsetY }));
}

function avoidsDefect(piece: Piece, defect: Defect, radius: number) {
  if (!defect.enabled || defect.depth <= 0) return true;
  const healthyEdge = radius - defect.depth;
  if (defect.side === "right") return piece.x + piece.width <= healthyEdge + EPSILON;
  if (defect.side === "left") return piece.x >= -healthyEdge - EPSILON;
  if (defect.side === "top") return piece.y + piece.height <= healthyEdge + EPSILON;
  return piece.y >= -healthyEdge - EPSILON;
}

export function auditVariantGeometry(diameter: number, variant: Variant, defects: Defect[] = [], requiredEdgeClearance = 0): GeometryAudit {
  const radius = diameter / 2;
  let maxCornerRadius = 0;
  let outsideCount = 0;
  let defectCollisionCount = 0;
  for (const piece of variant.pieces) {
    let outside = false;
    for (const x of [piece.x, piece.x + piece.width]) for (const y of [piece.y, piece.y + piece.height]) {
      const cornerRadius = Math.hypot(x, y);
      maxCornerRadius = Math.max(maxCornerRadius, cornerRadius);
      if (cornerRadius > radius + EPSILON) outside = true;
    }
    if (outside) outsideCount += 1;
    if (defects.some((defect) => defect.enabled && !avoidsDefect(piece, defect, radius))) defectCollisionCount += 1;
  }
  let overlapCount = 0;
  for (let left = 0; left < variant.pieces.length; left += 1) for (let right = left + 1; right < variant.pieces.length; right += 1) {
    const a = variant.pieces[left]; const b = variant.pieces[right];
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    if (overlapX > EPSILON && overlapY > EPSILON) overlapCount += 1;
  }
  const minEdgeClearance = Math.max(0, radius - maxCornerRadius);
  const edgeClearancePassed = minEdgeClearance + EPSILON >= requiredEdgeClearance;
  return {
    minEdgeClearance,
    overlapCount,
    outsideCount,
    defectCollisionCount,
    edgeClearancePassed,
    passed: overlapCount === 0 && outsideCount === 0 && defectCollisionCount === 0 && edgeClearancePassed,
  };
}

function candidateOffsets(defects: Defect[], pieces: Piece[], fitRadius: number, logRadius: number) {
  const minX = Math.min(...pieces.map((piece) => piece.x));
  const maxX = Math.max(...pieces.map((piece) => piece.x + piece.width));
  const minY = Math.min(...pieces.map((piece) => piece.y));
  const maxY = Math.max(...pieces.map((piece) => piece.y + piece.height));
  // Физические границы смещения всего постава внутри торца. Они зависят от
  // диаметра, поэтому фиксированный диапазон здесь давал неверный результат
  // на крупных брёвнах.
  let lowX = -fitRadius - minX; let highX = fitRadius - maxX;
  let lowY = -fitRadius - minY; let highY = fitRadius - maxY;
  let constrainX = false; let constrainY = false;
  for (const defect of defects) {
    const healthyEdge = logRadius - defect.depth;
    if (defect.side === "right") { highX = Math.min(highX, healthyEdge - maxX); constrainX = true; }
    if (defect.side === "left") { lowX = Math.max(lowX, -healthyEdge - minX); constrainX = true; }
    if (defect.side === "top") { highY = Math.min(highY, healthyEdge - maxY); constrainY = true; }
    if (defect.side === "bottom") { lowY = Math.max(lowY, -healthyEdge - minY); constrainY = true; }
  }
  const axis = (low: number, high: number, constrained: boolean) => {
    if (!constrained) return [0];
    if (low > high + EPSILON) return [];
    // Точные границы важны при дробной глубине дефекта. Дополнительно проверяем
    // миллиметровую сетку, как реальную точность настройки большинства линий.
    const values = [low, high, (low + high) / 2, Math.max(low, Math.min(high, 0))];
    for (let value = Math.ceil(low); value <= Math.floor(high); value += 1) values.push(value);
    const unique = [...new Set(values.map((value) => Math.round(value * 1e7) / 1e7))];
    return unique.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  };
  const xs = axis(lowX, highX, constrainX); const ys = axis(lowY, highY, constrainY);
  return xs.flatMap((x) => ys.map((y) => ({ x, y }))).sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y));
}

export function calculate(input: { diameter: number; length: number; logLength?: number; lengthAllowance?: number; edgeAllowance?: number; products: Product[]; equipment: Equipment; defect?: Defect; defects?: Defect[]; topN?: number; objective?: "primary" | "recovery" }): Calculation {
  const { diameter, length, equipment } = input;
  const products = input.products.filter((product) => product.enabled);
  const radius = diameter / 2;
  if (!Number.isFinite(diameter) || diameter <= 0 || !Number.isFinite(length) || length <= 0) return { status: "invalid", variants: [], error: "Проверьте диаметр и готовую длину досок." };
  if (equipment.maxDiameter > 0 && diameter > equipment.maxDiameter) return { status: "invalid", variants: [], error: `Диаметр ${diameter} мм превышает просвет «${equipment.name}» (${equipment.maxDiameter} мм).` };
  if (!Number.isInteger(equipment.maxSaws) || equipment.maxSaws < 0) return { status: "invalid", variants: [], error: "Количество пил не может быть отрицательным." };
  if (!Number.isFinite(equipment.maxDiameter) || equipment.maxDiameter < 0) return { status: "invalid", variants: [], error: "Максимальный просвет оборудования не может быть отрицательным." };
  if (!products.length) return { status: "invalid", variants: [], error: "Включите хотя бы один размер доски." };
  for (const product of products) {
    const values = [product.nominalThickness, product.nominalWidth, product.cuttingThickness, product.cuttingWidth];
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) return { status: "invalid", variants: [], error: `Проверьте размеры изделия «${product.name}»: все значения должны быть больше нуля.` };
    if (product.cuttingThickness < product.nominalThickness || product.cuttingWidth < product.nominalWidth) return { status: "invalid", variants: [], error: `Размер распила «${product.name}» не может быть меньше готового размера ${product.nominalThickness}×${product.nominalWidth} мм.` };
  }
  const breakdownKerf = equipment.stages?.breakdownKerf ?? equipment.kerf;
  const mainKerf = equipment.stages?.multiripKerf ?? equipment.kerf;
  const edgingKerf = equipment.stages?.edgingKerf ?? equipment.kerf;
  if ([breakdownKerf, mainKerf, edgingKerf].some((kerf) => !Number.isFinite(kerf) || kerf <= 0)) return { status: "invalid", variants: [], error: "Ширина каждого пропила должна быть больше нуля." };
  const suppliedDefects = input.defects || (input.defect ? [input.defect] : []);
  const edgeAllowance = input.edgeAllowance ?? 3;
  if (!Number.isFinite(edgeAllowance) || edgeAllowance < 3 || edgeAllowance >= radius) return { status: "invalid", variants: [], error: "Запас от края должен быть не меньше 3 мм и меньше радиуса бревна." };
  const fitRadius = radius - edgeAllowance;
  if (suppliedDefects.some((defect) => defect.enabled && (!Number.isFinite(defect.depth) || defect.depth < 0 || defect.depth >= radius))) return { status: "invalid", variants: [], error: "Глубина каждого дефекта должна быть от 0 до радиуса бревна." };
  const defects = suppliedDefects.filter((defect) => defect.enabled && defect.depth > 0);

  const primaryProducts = products.filter((product) => product.priority === "primary");
  // Побочные размеры тоже участвуют в центральном ряду. Раньше они могли
  // заполнять только верх и низ, поэтому у небольших брёвен оставались пустые
  // боковые зоны даже при включённом полезном доборе.
  const rowProducts = products;
  const heights = [...new Set(rowProducts.map((product) => product.cuttingWidth))].filter((height) => height <= fitRadius * 2);
  const variants: Variant[] = [];
  // `length` — готовая длина продукции. Фактическая длина бревна и припуск
  // обязательны для объёмного учёта: калькулятор больше не подставляет их молча.
  const lengthAllowance = input.lengthAllowance ?? 0;
  const cuttingLength = length + lengthAllowance;
  const logLength = input.logLength ?? 0;
  if (!Number.isFinite(lengthAllowance) || lengthAllowance < 0) return { status: "invalid", variants: [], error: "Припуск по длине не может быть отрицательным." };
  if (!Number.isFinite(logLength) || logLength <= 0) return { status: "invalid", variants: [], error: "Проверьте фактическую длину бревна." };
  if (cuttingLength > logLength + EPSILON) return { status: "invalid", variants: [], error: `Для готовой длины ${length} мм и припуска ${lengthAllowance} мм нужно бревно не короче ${cuttingLength} мм.` };
  const accountingLengthM = [...GOST_LENGTHS_M].reverse().find((value) => value * 1000 <= logLength + EPSILON);
  const gostLog = accountingLengthM ? gost2708Volume(diameter, accountingLengthM * 1000) : null;
  if (!gostLog) return { status: "invalid", variants: [], error: "Для выхода по ГОСТ выберите длину из списка и диаметр, соответствующий рабочему сортаменту Ø14–36 см." };
  const logVolume = gostLog.volume;

  for (const cantHeight of heights) {
    const rows = generateRows(rowProducts, mainKerf, fitRadius, cantHeight, input.objective);
    const caps = generateCaps(products, edgingKerf, fitRadius, cantHeight, breakdownKerf, input.objective);
    for (const row of rows) {
      const rowPieces = row.pieces;
      for (const cap of caps) {
        const capPieces = buildCaps(cap.layers, products, edgingKerf, fitRadius, cantHeight, breakdownKerf);
        if (!capPieces) continue;
        const basePieces = [...rowPieces, ...capPieces];
        const secondaryCount = basePieces.filter((piece) => piece.secondary).length;
        if (secondaryCount && !equipment.secondaryEdging) continue;
        const mainSawCount = rowPieces.length + 1;
        const feeds = equipment.maxSaws > 0 ? Math.max(1, Math.ceil(mainSawCount / equipment.maxSaws)) : 1;
        if (feeds > 1 && !equipment.multipleFeeds) continue;
        for (const offset of candidateOffsets(defects, basePieces, fitRadius, radius)) {
          const pieces = shiftedPieces(basePieces, offset.x, offset.y);
          if (!pieces.every((piece) => rectFits(piece.x, piece.y, piece.width, piece.height, fitRadius) && defects.every((defect) => avoidsDefect(piece, defect, radius)))) continue;
          const counts = countProducts(pieces);
          // Каждый выбранный основной заказ обязан реально присутствовать в
          // поставе. Иначе при нескольких заказах оптимизатор мог набрать
          // большой объём только одним размером и формально забыть остальные.
          if (primaryProducts.some((product) => (counts[product.id] || 0) === 0)) continue;
          const nominalVolume = products.reduce((sum, product) => sum + (counts[product.id] || 0) * product.nominalThickness * product.nominalWidth * length / 1e9, 0);
          const cuttingVolume = products.reduce((sum, product) => sum + (counts[product.id] || 0) * product.cuttingThickness * product.cuttingWidth * cuttingLength / 1e9, 0);
          const signature = `${cantHeight}|${row.ids.join(",")}|${cap.layers.map((layer) => layer.join(",")).join(";")}|${offset.x},${offset.y}`;
          variants.push({ id: signature, cantHeight, pieces, counts, nominalVolume, cuttingVolume, logVolume, gostDiameterCm: gostLog.diameterCm, gostLengthM: gostLog.lengthM, actualLogLengthM: logLength / 1000, nominalRecovery: nominalVolume / logVolume * 100, cuttingRecovery: cuttingVolume / logVolume * 100, residualRecovery: Math.max(0, 100 - cuttingVolume / logVolume * 100), mainSawCount, secondaryCount, feeds, offsetX: offset.x, offsetY: offset.y, signature });
          break;
        }
      }
    }
  }

  const unique = new Map<string, Variant>();
  variants.forEach((variant) => unique.set(variant.signature, variant));
  const primaryIds = new Set(primaryProducts.map((product) => product.id));
  const primaryVolume = (variant: Variant) => products.reduce((sum, product) => primaryIds.has(product.id) ? sum + (variant.counts[product.id] || 0) * product.nominalThickness * product.nominalWidth * length / 1e9 : sum, 0);
  let eligibleVariants = [...unique.values()];
  if (input.objective !== "recovery" && primaryProducts.length && products.some((product) => product.priority === "byproduct")) {
    const baseline = calculate({ ...input, products: primaryProducts, topN: 1, objective: "primary" });
    if (baseline.status === "ok") {
      const minimumPrimaryVolume = primaryVolume(baseline.variants[0]);
      eligibleVariants = eligibleVariants.filter((variant) => primaryVolume(variant) + EPSILON >= minimumPrimaryVolume);
    }
  }
  const sorted = eligibleVariants.sort((a, b) => input.objective === "recovery"
    ? b.nominalVolume - a.nominalVolume || a.feeds - b.feeds || a.secondaryCount - b.secondaryCount || (Math.abs(a.offsetX) + Math.abs(a.offsetY)) - (Math.abs(b.offsetX) + Math.abs(b.offsetY)) || a.signature.localeCompare(b.signature)
    : primaryVolume(b) - primaryVolume(a) || b.nominalVolume - a.nominalVolume || a.feeds - b.feeds || a.secondaryCount - b.secondaryCount || (Math.abs(a.offsetX) + Math.abs(a.offsetY)) - (Math.abs(b.offsetX) + Math.abs(b.offsetY)) || a.signature.localeCompare(b.signature)
  );
  if (!sorted.length) return { status: "no-solution", variants: [], error: "Для этих размеров и оборудования допустимый раскрой не найден." };
  return { status: "ok", variants: sorted.slice(0, input.topN || 5) };
}

export const DEFAULT_PRODUCTS: Product[] = [
  { id: "wide", name: "Доска 27 × 214", nominalThickness: 27, nominalWidth: 214, cuttingThickness: 29, cuttingWidth: 216, color: "blue", enabled: true },
  { id: "narrow", name: "Доска 27 × 122", nominalThickness: 27, nominalWidth: 122, cuttingThickness: 29, cuttingWidth: 124, color: "amber", enabled: true },
];

export const DEFAULT_EQUIPMENT: Equipment[] = [
  { id: "gang-1", name: "Многопил №1", maxSaws: 8, kerf: 3, maxDiameter: 500, secondaryEdging: true, multipleFeeds: true },
  { id: "band-1", name: "Ленточная линия", maxSaws: 1, kerf: 2.2, maxDiameter: 700, secondaryEdging: true, multipleFeeds: true },
];

export const MILL_LINE: Equipment = {
  id: "family-mill-line",
  name: "Основная линия",
  maxSaws: 0,
  kerf: 4,
  maxDiameter: 0,
  secondaryEdging: true,
  multipleFeeds: true,
  stages: { breakdownKerf: 5, multiripKerf: 4, edgingKerf: 3.8 },
};

const assortment = [
  [25, 50], [25, 100], [25, 120], [25, 150],
  [30, 100], [30, 120], [30, 150],
  [40, 100], [40, 150],
  [50, 100], [50, 150], [50, 200],
  [100, 100], [100, 150], [100, 200],
  [150, 150], [150, 200],
] as const;

export const PRODUCT_CATALOG: Product[] = assortment.map(([thickness, width], index) => ({
  id: `catalog-${thickness}x${width}`,
  name: `${thickness} × ${width} мм`,
  nominalThickness: thickness,
  nominalWidth: width,
  cuttingThickness: thickness,
  cuttingWidth: width,
  color: index % 2 === 0 ? "blue" : "amber",
  enabled: false,
  priority: "byproduct",
}));

export function calculateMaxRecovery(input: {
  diameter: number;
  length: number;
  logLength?: number;
  lengthAllowance?: number;
  edgeAllowance?: number;
  equipment: Equipment;
  defects?: Defect[];
  topN?: number;
  products?: Product[];
}): Calculation {
  const { products: suppliedProducts, ...calculationInput } = input;
  return calculate({
    ...calculationInput,
    products: (suppliedProducts || PRODUCT_CATALOG).map((product) => ({ ...product, enabled: true, priority: "byproduct" as const })),
    objective: "recovery",
    topN: input.topN || 1,
  });
}

// Папин список содержал Ø340 дважды. В интерфейсе оставляем уникальные размеры.
export const LOG_DIAMETERS = [140, 160, 180, 200, 220, 240, 260, 280, 300, 340, 360] as const;
