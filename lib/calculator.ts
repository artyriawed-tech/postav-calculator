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

type RowState = { ids: string[] };
type CapState = { layers: string[][] };

const EPSILON = 1e-7;

// ГОСТ 2708-75, таблица 1: объём одного круглого лесоматериала по толщине
// в верхнем отрубе и длине. В рабочем интерфейсе используются только эти
// стандартные длины, поэтому процент выхода можно сверить обычным кубатурником.
export const GOST_LENGTHS_M = [3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9] as const;
const GOST_2708_VOLUMES: Record<number, readonly number[]> = {
  14: [0.052, 0.061, 0.073, 0.084, 0.097, 0.110, 0.123, 0.135, 0.150, 0.164, 0.179, 0.195, 0.21],
  16: [0.069, 0.082, 0.095, 0.110, 0.124, 0.140, 0.155, 0.172, 0.189, 0.200, 0.220, 0.240, 0.26],
  18: [0.086, 0.103, 0.120, 0.138, 0.156, 0.175, 0.194, 0.210, 0.230, 0.25, 0.28, 0.3, 0.32],
  20: [0.107, 0.126, 0.147, 0.170, 0.190, 0.210, 0.23, 0.26, 0.28, 0.30, 0.33, 0.36, 0.39],
  22: [0.130, 0.154, 0.178, 0.200, 0.230, 0.250, 0.28, 0.31, 0.34, 0.37, 0.40, 0.43, 0.46],
  24: [0.157, 0.184, 0.210, 0.240, 0.270, 0.300, 0.33, 0.36, 0.40, 0.43, 0.47, 0.50, 0.55],
  26: [0.185, 0.210, 0.250, 0.280, 0.320, 0.350, 0.39, 0.43, 0.46, 0.50, 0.54, 0.58, 0.63],
  28: [0.220, 0.250, 0.290, 0.330, 0.370, 0.410, 0.45, 0.49, 0.53, 0.58, 0.63, 0.67, 0.72],
  30: [0.25, 0.29, 0.33, 0.38, 0.42, 0.47, 0.52, 0.56, 0.61, 0.66, 0.72, 0.78, 0.83],
  32: [0.28, 0.33, 0.38, 0.43, 0.48, 0.53, 0.59, 0.64, 0.70, 0.76, 0.82, 0.88, 0.94],
  34: [0.32, 0.37, 0.43, 0.49, 0.54, 0.60, 0.66, 0.72, 0.78, 0.85, 0.92, 0.98, 1.06],
  36: [0.36, 0.42, 0.48, 0.54, 0.60, 0.67, 0.74, 0.80, 0.88, 0.95, 1.02, 1.10, 1.18],
};

export function gost2708Volume(diameterMm: number, lengthMm: number) {
  const diameterCm = Math.floor(diameterMm / 20) * 2;
  const lengthM = lengthMm / 1000;
  const lengthIndex = GOST_LENGTHS_M.findIndex((value) => Math.abs(value - lengthM) < EPSILON);
  const row = GOST_2708_VOLUMES[diameterCm];
  if (!row || lengthIndex < 0) return null;
  return { volume: row[lengthIndex], diameterCm, lengthM };
}

function rectFits(x: number, y: number, width: number, height: number, radius: number) {
  const farX = Math.max(Math.abs(x), Math.abs(x + width));
  const farY = Math.max(Math.abs(y), Math.abs(y + height));
  return farX * farX + farY * farY <= radius * radius + EPSILON;
}

function buildCenteredRow(ids: string[], products: Product[], kerf: number, radius: number, cantHeight: number) {
  const map = new Map(products.map((product) => [product.id, product]));
  const rowWidth = ids.reduce((sum, id) => sum + map.get(id)!.cuttingThickness, 0) + Math.max(0, ids.length - 1) * kerf;
  let cursor = -rowWidth / 2;
  const pieces: Piece[] = [];

  for (let index = 0; index < ids.length; index += 1) {
    const product = map.get(ids[index])!;
    const y = -product.cuttingWidth / 2;
    if (product.cuttingWidth > cantHeight + EPSILON || !rectFits(cursor, y, product.cuttingThickness, product.cuttingWidth, radius)) return null;
    pieces.push({
      id: `row-${index}`,
      productId: product.id,
      x: cursor,
      y,
      width: product.cuttingThickness,
      height: product.cuttingWidth,
      zone: product.cuttingWidth === cantHeight ? "center" : "side",
      secondary: product.cuttingWidth < cantHeight,
    });
    cursor += product.cuttingThickness + kerf;
  }
  return pieces;
}

function generateRows(products: Product[], kerf: number, radius: number, cantHeight: number, objective: "primary" | "recovery" = "primary") {
  const eligible = products.filter((product) => product.enabled && product.cuttingWidth <= cantHeight);
  if (!eligible.length) return [{ ids: [] }];
  const rows: RowState[] = [{ ids: [] }];
  const minSpan = Math.min(...eligible.map((product) => product.cuttingThickness + kerf));
  const maxPairs = Math.min(16, Math.max(1, Math.ceil(radius / minSpan)));
  const map = new Map(products.map((product) => [product.id, product]));
  const primaryArea = (ids: string[]) => ids.reduce((sum, id) => {
    const product = map.get(id)!;
    return product.priority === "primary" ? sum + product.nominalThickness * product.nominalWidth : sum;
  }, 0);
  const totalArea = (ids: string[]) => ids.reduce((sum, id) => {
    const product = map.get(id)!;
    return sum + product.nominalThickness * product.nominalWidth;
  }, 0);
  const rowWidth = (ids: string[]) => ids.reduce((sum, id) => sum + map.get(id)!.cuttingThickness, 0) + Math.max(0, ids.length - 1) * kerf;
  const compare = (a: RowState, b: RowState) => objective === "recovery"
    ? totalArea(b.ids) - totalArea(a.ids) || primaryArea(b.ids) - primaryArea(a.ids) || rowWidth(b.ids) - rowWidth(a.ids)
    : primaryArea(b.ids) - primaryArea(a.ids) || totalArea(b.ids) - totalArea(a.ids) || rowWidth(b.ids) - rowWidth(a.ids);
  const keepBest = (states: RowState[]) => [...new Map(states.map((state) => [state.ids.join(","), state])).values()]
    .filter((state) => buildCenteredRow(state.ids, products, kerf, radius, cantHeight))
    .sort(compare)
    .slice(0, 80);

  let odd = eligible.map((center) => ({ ids: [center.id] }));
  let even: RowState[] = [{ ids: [] }];
  for (let depth = 0; depth <= maxPairs; depth += 1) {
    const validOdd = keepBest(odd);
    const validEven = depth === 0 ? [] : keepBest(even);
    rows.push(...validOdd, ...validEven);
    if (depth === maxPairs) break;
    odd = validOdd.flatMap((state) => eligible.map((pair) => ({ ids: [pair.id, ...state.ids, pair.id] })));
    even = (depth === 0 ? [{ ids: [] }] : validEven)
      .flatMap((state) => eligible.map((pair) => ({ ids: [pair.id, ...state.ids, pair.id] })));
  }

  return [...new Map(rows.map((state) => [state.ids.join(","), state])).values()]
    .sort(compare)
    .slice(0, 160);
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
  const options: string[][] = [];
  for (const group of groups.values()) {
    const minSpan = Math.min(...group.map((product) => product.cuttingWidth + kerf));
    const maxPairs = Math.min(12, Math.max(1, Math.ceil(radius / minSpan)));
    for (const center of group) {
      const stack = [[center.id]];
      while (stack.length) {
        const ids = stack.pop()!;
        if (!buildCapLayer(ids, 0, inner, products, kerf, radius)) continue;
        options.push(ids);
        if ((ids.length - 1) / 2 >= maxPairs) continue;
        for (const pair of group) stack.push([pair.id, ...ids, pair.id]);
      }
    }
    const evenStack: string[][] = [[]];
    while (evenStack.length) {
      const ids = evenStack.pop()!;
      if (ids.length && buildCapLayer(ids, 0, inner, products, kerf, radius)) options.push(ids);
      if (ids.length / 2 >= maxPairs) continue;
      for (const pair of group) {
        const next = [pair.id, ...ids, pair.id];
        if (buildCapLayer(next, 0, inner, products, kerf, radius)) evenStack.push(next);
      }
    }
  }
  const map = new Map(products.map((product) => [product.id, product]));
  const primaryArea = (ids: string[]) => ids.reduce((sum, id) => {
    const product = map.get(id)!;
    return product.priority === "primary" ? sum + product.nominalThickness * product.nominalWidth : sum;
  }, 0);
  const totalArea = (ids: string[]) => ids.reduce((sum, id) => sum + map.get(id)!.nominalThickness * map.get(id)!.nominalWidth, 0);
  return [...new Map(options.map((ids) => [ids.join(","), ids])).values()]
    .sort((a, b) => objective === "recovery"
      ? totalArea(b) - totalArea(a) || primaryArea(b) - primaryArea(a)
      : primaryArea(b) - primaryArea(a) || totalArea(b) - totalArea(a))
    .slice(0, 30);
}

function buildCaps(layers: string[][], products: Product[], kerf: number, radius: number, cantHeight: number, cantKerf = kerf) {
  const map = new Map(products.map((product) => [product.id, product]));
  let inner = cantHeight / 2 + cantKerf;
  const pieces: Piece[] = [];
  for (let layer = 0; layer < layers.length; layer += 1) {
    const layerPieces = buildCapLayer(layers[layer], layer, inner, products, kerf, radius);
    if (!layerPieces) return null;
    pieces.push(...layerPieces);
    inner += map.get(layers[layer][0])!.cuttingThickness + kerf;
  }
  return pieces;
}

function generateCaps(products: Product[], kerf: number, radius: number, cantHeight: number, cantKerf = kerf, objective: "primary" | "recovery" = "primary") {
  const map = new Map(products.map((product) => [product.id, product]));
  const minLayer = Math.min(...products.filter((product) => product.enabled).map((product) => product.cuttingThickness + kerf));
  const maxLayers = Math.min(8, Math.max(1, Math.ceil((radius - cantHeight / 2) / minLayer)));
  const result: CapState[] = [{ layers: [] }];
  const stack: CapState[] = [{ layers: [] }];
  while (stack.length) {
    const state = stack.pop()!;
    if (state.layers.length >= maxLayers || result.length >= 300) continue;
    const inner = cantHeight / 2 + cantKerf + state.layers.reduce((sum, layer) => sum + map.get(layer[0])!.cuttingThickness + kerf, 0);
    for (const ids of [...generateCapLayerOptions(products, kerf, radius, inner, objective)].reverse()) {
      const next = { layers: [...state.layers, ids] };
      if (buildCaps(next.layers, products, kerf, radius, cantHeight, cantKerf)) {
        result.push(next);
        stack.push(next);
      }
    }
  }
  const primaryArea = (state: CapState) => state.layers.flat().reduce((sum, id) => {
    const product = map.get(id)!;
    return product.priority === "primary" ? sum + product.nominalThickness * product.nominalWidth : sum;
  }, 0);
  const totalArea = (state: CapState) => state.layers.flat().reduce((sum, id) => {
    const product = map.get(id)!;
    return sum + product.nominalThickness * product.nominalWidth;
  }, 0);
  return result
    .sort((a, b) => objective === "recovery"
      ? totalArea(b) - totalArea(a) || primaryArea(b) - primaryArea(a)
      : primaryArea(b) - primaryArea(a) || totalArea(b) - totalArea(a))
    .slice(0, 80);
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
  const edgeAllowance = input.edgeAllowance ?? 0;
  if (!Number.isFinite(edgeAllowance) || edgeAllowance < 0 || edgeAllowance >= radius) return { status: "invalid", variants: [], error: "Запас от края должен быть от 0 до радиуса бревна." };
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
  // `length` — готовая длина продукции. Припуск и фактическая длина бревна
  // передаются отдельно; значения по умолчанию сохраняют совместимость со
  // старым эталонным чертежом (+40 мм).
  const lengthAllowance = input.lengthAllowance ?? 40;
  const cuttingLength = length + lengthAllowance;
  const logLength = input.logLength ?? ((GOST_LENGTHS_M.find((value) => value * 1000 + EPSILON >= cuttingLength) ?? 0) * 1000);
  if (!Number.isFinite(lengthAllowance) || lengthAllowance < 0) return { status: "invalid", variants: [], error: "Припуск по длине не может быть отрицательным." };
  if (!Number.isFinite(logLength) || logLength <= 0) return { status: "invalid", variants: [], error: "Проверьте фактическую длину бревна." };
  if (cuttingLength > logLength + EPSILON) return { status: "invalid", variants: [], error: `Для готовой длины ${length} мм и припуска ${lengthAllowance} мм нужно бревно не короче ${cuttingLength} мм.` };
  const gostLog = gost2708Volume(diameter, logLength);
  if (!gostLog) return { status: "invalid", variants: [], error: "Для выхода по ГОСТ выберите стандартную длину 3–9 м с шагом 0,5 м и диаметр 140–379 мм." };
  const logVolume = gostLog.volume;

  for (const cantHeight of heights) {
    const rows = generateRows(rowProducts, mainKerf, fitRadius, cantHeight, input.objective);
    const caps = generateCaps(products, edgingKerf, fitRadius, cantHeight, breakdownKerf, input.objective);
    for (const row of rows) {
      if (!row.ids.length) continue;
      const rowPieces = buildCenteredRow(row.ids, products, mainKerf, fitRadius, cantHeight);
      if (!rowPieces) continue;
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
          const nominalVolume = products.reduce((sum, product) => sum + (counts[product.id] || 0) * product.nominalThickness * product.nominalWidth * length / 1e9, 0);
          const cuttingVolume = products.reduce((sum, product) => sum + (counts[product.id] || 0) * product.cuttingThickness * product.cuttingWidth * cuttingLength / 1e9, 0);
          const signature = `${cantHeight}|${row.ids.join(",")}|${cap.layers.map((layer) => layer.join(",")).join(";")}|${offset.x},${offset.y}`;
          variants.push({ id: signature, cantHeight, pieces, counts, nominalVolume, cuttingVolume, logVolume, gostDiameterCm: gostLog.diameterCm, gostLengthM: gostLog.lengthM, nominalRecovery: nominalVolume / logVolume * 100, cuttingRecovery: cuttingVolume / logVolume * 100, residualRecovery: Math.max(0, 100 - cuttingVolume / logVolume * 100), mainSawCount, secondaryCount, feeds, offsetX: offset.x, offsetY: offset.y, signature });
          break;
        }
      }
    }
  }

  const unique = new Map<string, Variant>();
  variants.forEach((variant) => unique.set(variant.signature, variant));
  const primaryIds = new Set(primaryProducts.map((product) => product.id));
  const primaryVolume = (variant: Variant) => products.reduce((sum, product) => primaryIds.has(product.id) ? sum + (variant.counts[product.id] || 0) * product.nominalThickness * product.nominalWidth * length / 1e9 : sum, 0);
  const sorted = [...unique.values()].sort((a, b) => input.objective === "recovery"
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
  [25, 50], [25, 100], [25, 150],
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
}): Calculation {
  const anchors = [...new Map(
    [...PRODUCT_CATALOG]
      .filter((product) => product.cuttingWidth <= input.diameter)
      .sort((a, b) => a.nominalThickness - b.nominalThickness)
      .map((product) => [product.nominalWidth, product]),
  ).values()];
  const variants = anchors.flatMap((anchor) => {
    const family = PRODUCT_CATALOG
      .filter((product) => product.nominalThickness <= anchor.nominalThickness && product.nominalWidth <= anchor.nominalWidth)
      .map((product) => ({
        ...product,
        enabled: true,
        priority: product.id === anchor.id ? "primary" as const : "byproduct" as const,
      }));
    const result = calculate({ ...input, products: family, objective: "recovery", topN: 1 });
    return result.status === "ok" ? result.variants : [];
  });
  variants.sort((a, b) =>
    b.nominalVolume - a.nominalVolume ||
    a.feeds - b.feeds ||
    a.secondaryCount - b.secondaryCount ||
    (Math.abs(a.offsetX) + Math.abs(a.offsetY)) - (Math.abs(b.offsetX) + Math.abs(b.offsetY)) ||
    a.signature.localeCompare(b.signature),
  );
  if (!variants.length) return { status: "no-solution", variants: [], error: "Для этого бревна полезный раскрой не найден." };
  return { status: "ok", variants: variants.slice(0, input.topN || 1) };
}

// Папин список содержал Ø340 дважды. В интерфейсе оставляем уникальные размеры.
export const LOG_DIAMETERS = [140, 160, 180, 200, 220, 240, 280, 300, 340, 360] as const;
