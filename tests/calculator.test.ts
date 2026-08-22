import assert from "node:assert/strict";
import test from "node:test";
import { calculate, DEFAULT_EQUIPMENT, DEFAULT_PRODUCTS } from "../lib/calculator.ts";

test("эталон Ø320 даёт 7 широких и 4 узких доски", () => {
  const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 5 });
  assert.equal(result.status, "ok");
  assert.equal(result.variants[0].counts.wide, 7);
  assert.equal(result.variants[0].counts.narrow, 4);
  assert.equal(result.variants[0].pieces.length, 11);
  assert.equal(result.variants[0].cantHeight, 216);
  assert.equal(result.variants[0].mainSawCount, 10);
  assert.equal(result.variants[0].feeds, 2);
  assert.equal(result.variants[0].secondaryCount, 4);
  assert.ok(Math.abs(result.variants[0].nominalRecovery - 65.95073934711358) < 1e-9);
});

test("готовая длина 3650 мм считается с производственным припуском +40 мм", () => {
  const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(result.status, "ok");
  const variant = result.variants[0];
  const expectedLogVolume = Math.PI * Math.pow(320 / 2000, 2) * 3.69;
  assert.ok(Math.abs(variant.logVolume - expectedLogVolume) < 1e-12);
  assert.ok(Math.abs(variant.nominalVolume / variant.logVolume * 100 - variant.nominalRecovery) < 1e-12);
});

test("фактическая длина бревна участвует в объёме сырья", () => {
  const result = calculate({
    diameter: 320,
    length: 3600,
    logLength: 3800,
    lengthAllowance: 25,
    products: DEFAULT_PRODUCTS,
    equipment: DEFAULT_EQUIPMENT[0],
    topN: 1,
  });
  assert.equal(result.status, "ok");
  const expectedLogVolume = Math.PI * Math.pow(320 / 2000, 2) * 3.8;
  assert.ok(Math.abs(result.variants[0].logVolume - expectedLogVolume) < 1e-12);
});

test("расчёт блокируется, если бревно короче продукции с припуском", () => {
  const result = calculate({
    diameter: 320,
    length: 3650,
    logLength: 3670,
    lengthAllowance: 40,
    products: DEFAULT_PRODUCTS,
    equipment: DEFAULT_EQUIPMENT[0],
  });
  assert.equal(result.status, "invalid");
  assert.match(result.error || "", /не короче 3690/);
});

test("эталонная схема проходит при Ø311, но не является допустимой при Ø310", () => {
  const at311 = calculate({ diameter: 311, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  const at310 = calculate({ diameter: 310, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(at311.variants[0].counts.wide, 7);
  assert.notEqual(at310.variants[0].counts.wide, 7);
});

test("просвет закреплённого оборудования блокирует слишком большое бревно", () => {
  const result = calculate({ diameter: 501, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(result.status, "invalid");
  assert.match(result.error || "", /превышает просвет/);
});

test("без вторичной обрезки эталон не выдаёт боковые доски", () => {
  const equipment = { ...DEFAULT_EQUIPMENT[0], secondaryEdging: false };
  const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment, topN: 1 });
  assert.equal(result.status, "ok");
  assert.equal(result.variants[0].secondaryCount, 0);
});

test("боковой дефект сдвигает постав и сохраняет 11 здоровых досок, когда это возможно", () => {
  const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], defect: { enabled: true, side: "right", depth: 20 }, topN: 1 });
  assert.equal(result.status, "ok");
  assert.equal(result.variants[0].pieces.length, 11);
  assert.equal(result.variants[0].offsetX, -2.5);
  assert.ok(result.variants[0].pieces.every((piece) => piece.x + piece.width <= 140));
});

test("заготовка меньше готовой доски отклоняется до построения чертежа", () => {
  const products = DEFAULT_PRODUCTS.map((product) => product.id === "wide" ? { ...product, cuttingThickness: 19 } : product);
  const result = calculate({ diameter: 320, length: 3650, products, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(result.status, "invalid");
  assert.equal(result.variants.length, 0);
  assert.match(result.error || "", /не может быть меньше номинала/);
});

test("узкие доски заполняют боковые зоны рядами, а не одиночной доской по центру", () => {
  const products = DEFAULT_PRODUCTS.map((product) => product.id === "narrow" ? { ...product, nominalWidth: 58, cuttingWidth: 60 } : product);
  const result = calculate({ diameter: 320, length: 3650, products, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(result.status, "ok");
  assert.equal(result.variants[0].counts.wide, 7);
  assert.ok(result.variants[0].counts.narrow >= 6);
  assert.ok(result.variants[0].pieces.length >= 13);
});

test("серия допустимых расчётов не создаёт пересечений и не выходит за окружность", () => {
  let seed = 20260822;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let run = 0; run < 30; run += 1) {
    const diameter = 280 + Math.floor(random() * 181);
    const allowance = 1 + Math.floor(random() * 4);
    const products = DEFAULT_PRODUCTS.map((product) => ({
      ...product,
      cuttingThickness: product.nominalThickness + allowance,
      cuttingWidth: product.nominalWidth + allowance,
    }));
    const result = calculate({ diameter, length: 3650, products, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
    if (result.status !== "ok") continue;
    const variant = result.variants[0];
    const radiusSquared = (diameter / 2) ** 2;
    for (const piece of variant.pieces) {
      for (const x of [piece.x, piece.x + piece.width]) for (const y of [piece.y, piece.y + piece.height]) assert.ok(x * x + y * y <= radiusSquared + 1e-6);
    }
    for (let left = 0; left < variant.pieces.length; left += 1) for (let right = left + 1; right < variant.pieces.length; right += 1) {
      const a = variant.pieces[left]; const b = variant.pieces[right];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert.ok(overlapX <= 1e-7 || overlapY <= 1e-7, `${a.id} пересекает ${b.id}`);
    }
    assert.ok(variant.cuttingVolume <= variant.logVolume + 1e-9);
  }
});

test("две повреждённые стороны одновременно исключаются из продукции", () => {
  const defects = [
    { enabled: true, side: "right" as const, depth: 12 },
    { enabled: true, side: "top" as const, depth: 12 },
  ];
  const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], defects, topN: 1 });
  assert.equal(result.status, "ok");
  const healthyEdge = 148;
  assert.ok(result.variants[0].pieces.every((piece) => piece.x + piece.width <= healthyEdge + 1e-7));
  assert.ok(result.variants[0].pieces.every((piece) => piece.y + piece.height <= healthyEdge + 1e-7));
});

test("каждая сторона дефекта, включая дробную глубину, исключается из продукции", () => {
  for (const side of ["left", "right", "top", "bottom"] as const) {
    const depth = 17.5;
    const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], defects: [{ enabled: true, side, depth }], topN: 1 });
    assert.equal(result.status, "ok");
    const edge = 160 - depth;
    for (const piece of result.variants[0].pieces) {
      if (side === "left") assert.ok(piece.x >= -edge - 1e-7);
      if (side === "right") assert.ok(piece.x + piece.width <= edge + 1e-7);
      if (side === "bottom") assert.ok(piece.y >= -edge - 1e-7);
      if (side === "top") assert.ok(piece.y + piece.height <= edge + 1e-7);
    }
  }
});

test("некорректная глубина дефекта не игнорируется молча", () => {
  const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], defects: [{ enabled: true, side: "left", depth: -1 }], topN: 1 });
  assert.equal(result.status, "invalid");
  assert.match(result.error || "", /Глубина/);
});

test("ширина пропила оборудования участвует в геометрии и выходе", () => {
  const thin = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: { ...DEFAULT_EQUIPMENT[0], kerf: 2 }, topN: 1 });
  const wide = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: { ...DEFAULT_EQUIPMENT[0], kerf: 8 }, topN: 1 });
  assert.equal(thin.status, "ok");
  assert.equal(wide.status, "ok");
  assert.ok(thin.variants[0].nominalVolume >= wide.variants[0].nominalVolume);
  assert.notEqual(thin.variants[0].signature, wide.variants[0].signature);
});

test("в смешанном центральном ряду учитывается каждый разделительный рез", () => {
  const products = [
    { id: "a", name: "45 × 180", nominalThickness: 45, nominalWidth: 180, cuttingThickness: 47, cuttingWidth: 182, color: "blue" as const, enabled: true },
    { id: "b", name: "20 × 100", nominalThickness: 20, nominalWidth: 100, cuttingThickness: 22, cuttingWidth: 102, color: "amber" as const, enabled: true },
  ];
  const result = calculate({ diameter: 260, length: 3650, products, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(result.status, "ok");
  const row = result.variants[0].pieces.filter((piece) => piece.id.startsWith("row-"));
  assert.ok(new Set(row.map((piece) => piece.productId)).size > 1);
  assert.equal(result.variants[0].mainSawCount, row.length + 1);
});

test("станок без повторных подач никогда не получает больше резов, чем разрешено", () => {
  const equipment = { ...DEFAULT_EQUIPMENT[0], maxSaws: 4, multipleFeeds: false };
  const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment, topN: 5 });
  assert.equal(result.status, "ok");
  assert.ok(result.variants.every((variant) => variant.mainSawCount <= 4));
});

test("крупное бревно не ограничивается прежним пределом в 17 досок центрального ряда", () => {
  const products = [{ id: "x", name: "27 × 100", nominalThickness: 27, nominalWidth: 100, cuttingThickness: 29, cuttingWidth: 102, color: "blue" as const, enabled: true }];
  const equipment = { ...DEFAULT_EQUIPMENT[1], maxSaws: 30 };
  const result = calculate({ diameter: 700, length: 3650, products, equipment, topN: 1 });
  assert.equal(result.status, "ok");
  const row = result.variants[0].pieces.filter((piece) => piece.id.startsWith("row-"));
  assert.ok(row.length > 17);
  assert.equal(result.variants[0].mainSawCount, row.length + 1);
});
