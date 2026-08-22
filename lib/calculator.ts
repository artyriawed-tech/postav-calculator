export type Product = {
  id: string;
  name: string;
  nominalThickness: number;
  nominalWidth: number;
  cuttingThickness: number;
  cuttingWidth: number;
  color: "blue" | "amber";
  enabled: boolean;
};

export type Equipment = {
  id: string;
  name: string;
  maxSaws: number;
  kerf: number;
  maxDiameter: number;
  secondaryEdging: boolean;
  multipleFeeds: boolean;
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

function generateRows(products: Product[], kerf: number, radius: number, cantHeight: number) {
  const eligible = products.filter((product) => product.enabled && product.cuttingWidth <= cantHeight);
  const rows: RowState[] = [{ ids: [] }];
  const minSpan = Math.min(...eligible.map((product) => product.cuttingThickness + kerf));
  const maxPairs = Math.min(16, Math.max(1, Math.ceil(radius / minSpan)));

  for (const center of eligible) {
    const stack: RowState[] = [{ ids: [center.id] }];
    while (stack.length) {
      const state = stack.pop()!;
      if (!buildCenteredRow(state.ids, products, kerf, radius, cantHeight)) continue;
      rows.push(state);
      if ((state.ids.length - 1) / 2 >= maxPairs) continue;
      for (const pair of eligible) stack.push({ ids: [pair.id, ...state.ids, pair.id] });
    }
  }

  const evenStack: RowState[] = [{ ids: [] }];
  while (evenStack.length) {
    const state = evenStack.pop()!;
    if (state.ids.length && buildCenteredRow(state.ids, products, kerf, radius, cantHeight)) rows.push(state);
    if (state.ids.length / 2 >= maxPairs) continue;
    for (const pair of eligible) {
      const next = { ids: [pair.id, ...state.ids, pair.id] };
      if (buildCenteredRow(next.ids, products, kerf, radius, cantHeight)) evenStack.push(next);
    }
  }

  return rows;
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

function generateCapLayerOptions(products: Product[], kerf: number, radius: number, inner: number) {
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
  return [...new Map(options.map((ids) => [ids.join(","), ids])).values()].sort((a, b) => b.reduce((sum, id) => sum + map.get(id)!.nominalThickness * map.get(id)!.nominalWidth, 0) - a.reduce((sum, id) => sum + map.get(id)!.nominalThickness * map.get(id)!.nominalWidth, 0)).slice(0, 50);
}

function buildCaps(layers: string[][], products: Product[], kerf: number, radius: number, cantHeight: number) {
  const map = new Map(products.map((product) => [product.id, product]));
  let inner = cantHeight / 2 + kerf;
  const pieces: Piece[] = [];
  for (let layer = 0; layer < layers.length; layer += 1) {
    const layerPieces = buildCapLayer(layers[layer], layer, inner, products, kerf, radius);
    if (!layerPieces) return null;
    pieces.push(...layerPieces);
    inner += map.get(layers[layer][0])!.cuttingThickness + kerf;
  }
  return pieces;
}

function generateCaps(products: Product[], kerf: number, radius: number, cantHeight: number) {
  const map = new Map(products.map((product) => [product.id, product]));
  const minLayer = Math.min(...products.filter((product) => product.enabled).map((product) => product.cuttingThickness + kerf));
  const maxLayers = Math.min(8, Math.max(1, Math.ceil((radius - cantHeight / 2) / minLayer)));
  const result: CapState[] = [{ layers: [] }];
  const stack: CapState[] = [{ layers: [] }];
  while (stack.length) {
    const state = stack.pop()!;
    if (state.layers.length >= maxLayers || result.length >= 1500) continue;
    const inner = cantHeight / 2 + kerf + state.layers.reduce((sum, layer) => sum + map.get(layer[0])!.cuttingThickness + kerf, 0);
    for (const ids of generateCapLayerOptions(products, kerf, radius, inner)) {
      const next = { layers: [...state.layers, ids] };
      if (buildCaps(next.layers, products, kerf, radius, cantHeight)) {
        result.push(next);
        stack.push(next);
      }
    }
  }
  return result;
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

function candidateOffsets(defects: Defect[], pieces: Piece[], radius: number) {
  const minX = Math.min(...pieces.map((piece) => piece.x));
  const maxX = Math.max(...pieces.map((piece) => piece.x + piece.width));
  const minY = Math.min(...pieces.map((piece) => piece.y));
  const maxY = Math.max(...pieces.map((piece) => piece.y + piece.height));
  // Физические границы смещения всего постава внутри торца. Они зависят от
  // диаметра, поэтому фиксированный диапазон здесь давал неверный результат
  // на крупных брёвнах.
  let lowX = -radius - minX; let highX = radius - maxX;
  let lowY = -radius - minY; let highY = radius - maxY;
  let constrainX = false; let constrainY = false;
  for (const defect of defects) {
    const healthyEdge = radius - defect.depth;
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

export function calculate(input: { diameter: number; length: number; products: Product[]; equipment: Equipment; defect?: Defect; defects?: Defect[]; topN?: number }): Calculation {
  const { diameter, length, equipment } = input;
  const products = input.products.filter((product) => product.enabled);
  const radius = diameter / 2;
  if (!Number.isFinite(diameter) || diameter <= 0 || !Number.isFinite(length) || length <= 0) return { status: "invalid", variants: [], error: "Проверьте диаметр и готовую длину досок." };
  if (diameter > equipment.maxDiameter) return { status: "invalid", variants: [], error: `Диаметр ${diameter} мм превышает просвет «${equipment.name}» (${equipment.maxDiameter} мм).` };
  if (!products.length) return { status: "invalid", variants: [], error: "Включите хотя бы один размер доски." };
  for (const product of products) {
    const values = [product.nominalThickness, product.nominalWidth, product.cuttingThickness, product.cuttingWidth];
    if (values.some((value) => !Number.isFinite(value) || value <= 0)) return { status: "invalid", variants: [], error: `Проверьте размеры изделия «${product.name}»: все значения должны быть больше нуля.` };
    if (product.cuttingThickness < product.nominalThickness || product.cuttingWidth < product.nominalWidth) return { status: "invalid", variants: [], error: `Заготовка «${product.name}» не может быть меньше номинала ${product.nominalThickness}×${product.nominalWidth} мм.` };
  }
  if (equipment.kerf <= 0) return { status: "invalid", variants: [], error: "Ширина пропила должна быть больше нуля." };
  const suppliedDefects = input.defects || (input.defect ? [input.defect] : []);
  if (suppliedDefects.some((defect) => defect.enabled && (!Number.isFinite(defect.depth) || defect.depth < 0 || defect.depth >= radius))) return { status: "invalid", variants: [], error: "Глубина каждого дефекта должна быть от 0 до радиуса бревна." };
  const defects = suppliedDefects.filter((defect) => defect.enabled && defect.depth > 0);

  const heights = [...new Set(products.map((product) => product.cuttingWidth))].filter((height) => height <= diameter);
  const variants: Variant[] = [];
  // `length` — готовая длина продукции. На исходном чертеже к ней задан припуск +40 мм.
  const cuttingLength = length + 40;
  const logVolume = Math.PI * Math.pow(diameter / 2000, 2) * (cuttingLength / 1000);

  for (const cantHeight of heights) {
    const rows = generateRows(products, equipment.kerf, radius, cantHeight);
    const caps = generateCaps(products, equipment.kerf, radius, cantHeight);
    for (const row of rows) {
      if (!row.ids.length) continue;
      const rowPieces = buildCenteredRow(row.ids, products, equipment.kerf, radius, cantHeight);
      if (!rowPieces) continue;
      for (const cap of caps) {
        const capPieces = buildCaps(cap.layers, products, equipment.kerf, radius, cantHeight);
        if (!capPieces) continue;
        const basePieces = [...rowPieces, ...capPieces];
        const secondaryCount = basePieces.filter((piece) => piece.secondary).length;
        if (secondaryCount && !equipment.secondaryEdging) continue;
        const mainSawCount = rowPieces.length + 1;
        const feeds = Math.max(1, Math.ceil(mainSawCount / equipment.maxSaws));
        if (feeds > 1 && !equipment.multipleFeeds) continue;
        for (const offset of candidateOffsets(defects, basePieces, radius)) {
          const pieces = shiftedPieces(basePieces, offset.x, offset.y);
          if (!pieces.every((piece) => rectFits(piece.x, piece.y, piece.width, piece.height, radius) && defects.every((defect) => avoidsDefect(piece, defect, radius)))) continue;
          const counts = countProducts(pieces);
          const nominalVolume = products.reduce((sum, product) => sum + (counts[product.id] || 0) * product.nominalThickness * product.nominalWidth * length / 1e9, 0);
          const cuttingVolume = products.reduce((sum, product) => sum + (counts[product.id] || 0) * product.cuttingThickness * product.cuttingWidth * cuttingLength / 1e9, 0);
          const signature = `${cantHeight}|${row.ids.join(",")}|${cap.layers.map((layer) => layer.join(",")).join(";")}|${offset.x},${offset.y}`;
          variants.push({ id: signature, cantHeight, pieces, counts, nominalVolume, cuttingVolume, logVolume, nominalRecovery: nominalVolume / logVolume * 100, cuttingRecovery: cuttingVolume / logVolume * 100, residualRecovery: Math.max(0, 100 - cuttingVolume / logVolume * 100), mainSawCount, secondaryCount, feeds, offsetX: offset.x, offsetY: offset.y, signature });
          break;
        }
      }
    }
  }

  const unique = new Map<string, Variant>();
  variants.forEach((variant) => unique.set(variant.signature, variant));
  const sorted = [...unique.values()].sort((a, b) =>
    b.nominalVolume - a.nominalVolume || a.feeds - b.feeds || a.secondaryCount - b.secondaryCount || (Math.abs(a.offsetX) + Math.abs(a.offsetY)) - (Math.abs(b.offsetX) + Math.abs(b.offsetY)) || a.signature.localeCompare(b.signature)
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
