import assert from "node:assert/strict";
import test from "node:test";
import { auditVariantGeometry, calculate as rawCalculate, calculateFaceMetrics, calculateMaxRecovery as rawCalculateMaxRecovery, DEFAULT_EQUIPMENT, DEFAULT_PRODUCTS, GOST_LENGTHS_M, gost2708Volume, LOG_DIAMETERS, MILL_LINE, PRODUCT_CATALOG } from "../lib/calculator.ts";

const calculate = (input: Parameters<typeof rawCalculate>[0]) => rawCalculate({ logLength: 4000, lengthAllowance: 0, edgeAllowance: 3, ...input });
const calculateMaxRecovery = (input: Parameters<typeof rawCalculateMaxRecovery>[0]) => rawCalculateMaxRecovery({ logLength: 4000, lengthAllowance: 0, edgeAllowance: 3, ...input });

test("Ø26 входит в основной рабочий ряд диаметров", () => {
  assert.ok(LOG_DIAMETERS.includes(260));
  assert.ok(gost2708Volume(260, 4000));
});

test("папин пример Ø140 × 4 м даёт 47,1% по ГОСТ, а не 55,9% от идеального цилиндра", () => {
  const primaryId = "catalog-30x120";
  const products = PRODUCT_CATALOG
    .filter((product) => product.id === primaryId || (product.nominalThickness <= 30 && product.nominalWidth <= 120))
    .map((product) => ({ ...product, enabled: true, priority: product.id === primaryId ? "primary" as const : "byproduct" as const }));
  const result = calculate({ diameter: 140, length: 4000, logLength: 4000, lengthAllowance: 0, edgeAllowance: 3, products, equipment: MILL_LINE, topN: 1 });
  assert.equal(result.status, "ok");
  const variant = result.variants[0];
  assert.equal(variant.counts[primaryId], 1);
  assert.equal(variant.counts["catalog-25x100"], 2);
  assert.ok(Math.abs(variant.nominalVolume - 0.0344) < 1e-12);
  assert.equal(variant.logVolume, 0.073);
  assert.ok(Math.abs(variant.nominalRecovery - 47.12328767123288) < 1e-10);
  const idealCylinderVolume = Math.PI * (0.14 / 2) ** 2 * 4;
  const rejectedCylinderPercent = variant.nominalVolume / idealCylinderVolume * 100;
  assert.ok(Math.abs(rejectedCylinderPercent - 55.86663308531836) < 1e-10);
  assert.ok(Math.abs(variant.nominalRecovery - rejectedCylinderPercent) > 8);
  const audit = auditVariantGeometry(140, variant, [], 3);
  assert.equal(audit.passed, true);
  assert.ok(audit.minEdgeClearance >= 3 - 1e-7);
  assert.equal(audit.overlapCount, 0);
  assert.equal(audit.outsideCount, 0);
  assert.equal(audit.edgeClearancePassed, true);
});

test("тот же пример отдельно даёт 61,0% заполнения рабочего торца и 39,0% свободной площади", () => {
  const products = PRODUCT_CATALOG.filter((product) => ["catalog-30x120", "catalog-25x100"].includes(product.id));
  const metrics = calculateFaceMetrics(140, 3, products, { "catalog-30x120": 1, "catalog-25x100": 2 });
  assert.equal(metrics.cuttingArea, 8600);
  assert.ok(Math.abs(metrics.workingArea - Math.PI * 67 ** 2) < 1e-9);
  assert.ok(Math.abs(metrics.faceFill - 60.98162221386946) < 1e-10);
  assert.ok(Math.abs(metrics.freeArea - 39.01837778613054) < 1e-10);
});

test("запас от края меньше обязательных 3 мм отклоняется", () => {
  const product = { ...PRODUCT_CATALOG[0], enabled: true, priority: "primary" as const };
  const result = rawCalculate({ diameter: 140, length: 4000, logLength: 4000, lengthAllowance: 0, edgeAllowance: 2.9, products: [product], equipment: MILL_LINE });
  assert.equal(result.status, "invalid");
  assert.match(result.error || "", /не меньше 3 мм/);
});

test("припуски меняют геометрию и объём распила, но не номинальный объём готовой продукции", () => {
  const base = PRODUCT_CATALOG.find((product) => product.id === "catalog-30x120")!;
  const nominal = calculate({ diameter: 180, length: 3900, logLength: 4000, lengthAllowance: 0, products: [{ ...base, enabled: true, priority: "primary" }], equipment: MILL_LINE, topN: 1 });
  const oversized = calculate({ diameter: 180, length: 3900, logLength: 4000, lengthAllowance: 100, products: [{ ...base, cuttingThickness: 32, cuttingWidth: 123, enabled: true, priority: "primary" }], equipment: MILL_LINE, topN: 1 });
  assert.equal(nominal.status, "ok");
  assert.equal(oversized.status, "ok");
  assert.equal(nominal.variants[0].nominalVolume, oversized.variants[0].nominalVolume);
  assert.ok(oversized.variants[0].cuttingVolume > nominal.variants[0].cuttingVolume);
});

test("контроль расчёта обнаруживает испорченную геометрию, а не ставит формальный статус", () => {
  const result = calculate({ diameter: 320, length: 4000, logLength: 4000, lengthAllowance: 0, edgeAllowance: 3, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(result.status, "ok");
  const original = result.variants[0];
  const broken = { ...original, pieces: [...original.pieces, { ...original.pieces[0], id: "forced-overlap" }] };
  const audit = auditVariantGeometry(320, broken);
  assert.equal(audit.passed, false);
  assert.ok(audit.overlapCount > 0);
});

test("контроль расчёта отдельно проверяет заявленный запас от края", () => {
  const primary = PRODUCT_CATALOG.find((product) => product.id === "catalog-30x120")!;
  const result = calculate({ diameter: 140, length: 4000, logLength: 4000, lengthAllowance: 0, edgeAllowance: 3, products: [{ ...primary, enabled: true, priority: "primary" }], equipment: MILL_LINE, topN: 1 });
  assert.equal(result.status, "ok");
  assert.equal(auditVariantGeometry(140, result.variants[0], [], 3).passed, true);
  assert.equal(auditVariantGeometry(140, result.variants[0], [], 30).passed, false);
});

test("кубатурник содержит каждую рабочую пару диаметра и стандартной длины", () => {
  for (const diameter of LOG_DIAMETERS) for (const length of GOST_LENGTHS_M) {
    assert.ok(gost2708Volume(diameter, length * 1000), `Ø${diameter}, ${length} м`);
  }
});

test("ручной диаметр округляется к чётному классу по правилам обмера круглого леса", () => {
  assert.equal(gost2708Volume(139, 4000), null);
  assert.equal(gost2708Volume(149, 4000)?.diameterCm, 14);
  assert.equal(gost2708Volume(150, 4000)?.diameterCm, 16);
  assert.equal(gost2708Volume(169, 4000)?.diameterCm, 16);
  assert.equal(gost2708Volume(170, 4000)?.diameterCm, 18);
  assert.equal(gost2708Volume(150, 4000)?.volume, 0.095);
});

test("четвертные длины пиловочника берутся из таблицы ГОСТ без интерполяции", () => {
  assert.equal(gost2708Volume(140, 3250)?.volume, 0.057);
  assert.equal(gost2708Volume(240, 4750)?.volume, 0.250);
  assert.equal(gost2708Volume(360, 6250)?.volume, 0.770);
});

test("Ø140 с запасом 3 мм безопасно добирает 25×100 вокруг заказа 30×120", () => {
  const primaryId = "catalog-30x120";
  const primary = PRODUCT_CATALOG.find((product) => product.id === primaryId)!;
  const onlyPrimary = [{ ...primary, enabled: true, priority: "primary" as const }];
  const withByproducts = PRODUCT_CATALOG
    .filter((product) => product.id === primaryId || (product.nominalThickness <= 30 && product.nominalWidth <= 120))
    .map((product) => ({ ...product, enabled: true, priority: product.id === primaryId ? "primary" as const : "byproduct" as const }));
  const plain = calculate({ diameter: 140, length: 1000, edgeAllowance: 3, products: onlyPrimary, equipment: MILL_LINE, topN: 1 });
  const filled = calculate({ diameter: 140, length: 1000, edgeAllowance: 3, products: withByproducts, equipment: MILL_LINE, topN: 1 });
  assert.equal(plain.status, "ok");
  assert.equal(filled.status, "ok");
  assert.equal(filled.variants[0].counts[primaryId], 1);
  assert.equal(filled.variants[0].counts["catalog-25x100"], 2);
  assert.ok(filled.variants[0].nominalRecovery > plain.variants[0].nominalRecovery);
});

test("автоматический режим на каждом рабочем диаметре находит полезный раскрой", () => {
  for (const diameter of LOG_DIAMETERS) {
    const edgeAllowance = 3;
    const result = calculateMaxRecovery({ diameter, length: 1000, edgeAllowance, equipment: MILL_LINE, topN: 1 });
    assert.equal(result.status, "ok", `Ø${diameter}`);
    assert.ok(result.variants[0].pieces.length > 0, `Ø${diameter}`);
    assert.ok(result.variants[0].nominalRecovery > 0, `Ø${diameter}`);
    let bestSingleRecovery = 0;
    for (const product of PRODUCT_CATALOG) {
      const single = calculate({
        diameter,
        length: 1000,
        edgeAllowance,
        products: [{ ...product, enabled: true, priority: "primary" as const }],
        equipment: MILL_LINE,
        topN: 1,
      });
      if (single.status === "ok") bestSingleRecovery = Math.max(bestSingleRecovery, single.variants[0].nominalRecovery);
    }
    assert.ok(result.variants[0].nominalRecovery + 1e-9 >= bestSingleRecovery, `Ø${diameter}: автоматический режим хуже лучшего раскроя одним размером`);
    if (diameter === 140) assert.ok(new Set(result.variants[0].pieces.map((piece) => piece.productId)).size > 1, "Ø140: автоматический режим не заполнил свободные зоны вторым размером");
    const workingRadiusSquared = (diameter / 2 - edgeAllowance) ** 2;
    for (const piece of result.variants[0].pieces) {
      for (const x of [piece.x, piece.x + piece.width]) for (const y of [piece.y, piece.y + piece.height]) {
        assert.ok(x * x + y * y <= workingRadiusSquared + 1e-6, `Ø${diameter}: угол продукции вошёл в запас от края`);
      }
    }
    const variant = result.variants[0];
    const row = variant.pieces.filter((piece) => piece.id.startsWith("row-")).sort((a, b) => a.x - b.x);
    for (let index = 1; index < row.length; index += 1) {
      assert.ok(row[index].x - (row[index - 1].x + row[index - 1].width) >= MILL_LINE.stages!.multiripKerf - 1e-7, `Ø${diameter}: не учтён пропил многопила`);
    }
    const capGroups = new Map<string, typeof variant.pieces>();
    for (const piece of variant.pieces.filter((item) => item.id.startsWith("cap-"))) {
      const match = piece.id.match(/^(cap-(?:top|bottom)-\d+)-/);
      if (!match) continue;
      capGroups.set(match[1], [...(capGroups.get(match[1]) || []), piece]);
    }
    for (const cap of capGroups.values()) {
      cap.sort((a, b) => a.x - b.x);
      for (let index = 1; index < cap.length; index += 1) {
        assert.ok(cap[index].x - (cap[index - 1].x + cap[index - 1].width) >= MILL_LINE.stages!.edgingKerf - 1e-7, `Ø${diameter}: не учтён пропил кромкообрезного`);
      }
    }
    for (const side of ["top", "bottom"] as const) {
      const layers = [...capGroups.entries()]
        .filter(([key]) => key.startsWith(`cap-${side}-`))
        .map(([, pieces]) => ({ min: Math.min(...pieces.map((piece) => piece.y)), max: Math.max(...pieces.map((piece) => piece.y + piece.height)) }))
        .sort((a, b) => a.min - b.min);
      for (let index = 1; index < layers.length; index += 1) {
        assert.ok(layers[index].min - layers[index - 1].max >= MILL_LINE.stages!.breakdownKerf - 1e-7, `Ø${diameter}: не учтён межрядный пропил брусовального станка`);
      }
      if (layers.length) {
        const distanceFromCant = side === "top"
          ? layers[0].min - variant.cantHeight / 2
          : -variant.cantHeight / 2 - layers.at(-1)!.max;
        assert.ok(distanceFromCant >= MILL_LINE.stages!.breakdownKerf - 1e-7, `Ø${diameter}: не учтён пропил брусовального`);
      }
    }
  }
});

test("запас от края и боковой дефект учитываются независимо", () => {
  const edgeAllowance = 3;
  const defectDepth = 20;
  const result = calculate({
    diameter: 320,
    length: 3650,
    edgeAllowance,
    products: DEFAULT_PRODUCTS,
    equipment: DEFAULT_EQUIPMENT[0],
    defects: [{ enabled: true, side: "right", depth: defectDepth }],
    topN: 1,
  });
  assert.equal(result.status, "ok");
  const workingRadiusSquared = (160 - edgeAllowance) ** 2;
  for (const piece of result.variants[0].pieces) {
    assert.ok(piece.x + piece.width <= 160 - defectDepth + 1e-7);
    for (const x of [piece.x, piece.x + piece.width]) for (const y of [piece.y, piece.y + piece.height]) {
      assert.ok(x * x + y * y <= workingRadiusSquared + 1e-6);
    }
  }
});

test("основной заказ 50×150 сохраняет максимум, а свободные зоны дают 25×100", () => {
  const primaryId = "catalog-50x150";
  const primary = PRODUCT_CATALOG.find((product) => product.id === primaryId)!;
  const onlyPrimary = [{ ...primary, enabled: true, priority: "primary" as const }];
  const withByproducts = PRODUCT_CATALOG
    .filter((product) => product.id === primaryId || (product.nominalThickness <= 50 && product.nominalWidth <= 150))
    .map((product) => ({ ...product, enabled: true, priority: product.id === primaryId ? "primary" as const : "byproduct" as const }));
  const plain = calculate({ diameter: 340, length: 1000, products: onlyPrimary, equipment: MILL_LINE, topN: 1 });
  const filled = calculate({ diameter: 340, length: 1000, products: withByproducts, equipment: MILL_LINE, topN: 1 });
  assert.equal(plain.status, "ok");
  assert.equal(filled.status, "ok");
  assert.equal(filled.variants[0].counts[primaryId], plain.variants[0].counts[primaryId]);
  assert.ok(Object.entries(filled.variants[0].counts).some(([id, count]) => id !== primaryId && count > 0));
  assert.ok(filled.variants[0].nominalRecovery > plain.variants[0].nominalRecovery);
});

test("несколько основных заказов обязательны, а свободное место заполняется третьим размером", () => {
  const primaryIds = new Set(["catalog-25x100", "catalog-25x150"]);
  const primaryProducts = PRODUCT_CATALOG.filter((product) => primaryIds.has(product.id));
  const products = PRODUCT_CATALOG
    .filter((product) => primaryIds.has(product.id) || primaryProducts.some((primary) =>
      product.nominalThickness <= primary.nominalThickness && product.nominalWidth <= primary.nominalWidth))
    .map((product) => ({ ...product, enabled: true, priority: primaryIds.has(product.id) ? "primary" as const : "byproduct" as const }));
  const result = calculate({ diameter: 360, length: 1000, edgeAllowance: 3, products, equipment: MILL_LINE, topN: 1 });
  assert.equal(result.status, "ok");
  const variant = result.variants[0];
  assert.ok((variant.counts["catalog-25x100"] || 0) > 0);
  assert.ok((variant.counts["catalog-25x150"] || 0) > 0);
  assert.ok((variant.counts["catalog-25x50"] || 0) > 0, "свободная зона не заполнена побочным размером");
  assert.equal(auditVariantGeometry(360, variant, [], 3).passed, true);
});

test("полезный добор не уменьшает основной заказ на всём каталоге диаметров", () => {
  for (const diameter of LOG_DIAMETERS) {
    for (const primary of PRODUCT_CATALOG) {
      const onlyPrimary = [{ ...primary, enabled: true, priority: "primary" as const }];
      const withByproducts = PRODUCT_CATALOG
        .filter((product) => product.id === primary.id || (product.nominalThickness <= primary.nominalThickness && product.nominalWidth <= primary.nominalWidth))
        .map((product) => ({ ...product, enabled: true, priority: product.id === primary.id ? "primary" as const : "byproduct" as const }));
      const plain = calculate({ diameter, length: 1000, products: onlyPrimary, equipment: MILL_LINE, topN: 1 });
      if (plain.status !== "ok") continue;
      const filled = calculate({ diameter, length: 1000, products: withByproducts, equipment: MILL_LINE, topN: 1 });
      assert.equal(filled.status, "ok", `${diameter} мм, ${primary.name}`);
      assert.equal(filled.variants[0].counts[primary.id] || 0, plain.variants[0].counts[primary.id] || 0, `${diameter} мм, ${primary.name}`);
      assert.ok(filled.variants[0].nominalRecovery + 1e-9 >= plain.variants[0].nominalRecovery, `${diameter} мм, ${primary.name}`);
      const variant = filled.variants[0];
      const radiusSquared = (diameter / 2) ** 2;
      for (const piece of variant.pieces) {
        for (const x of [piece.x, piece.x + piece.width]) for (const y of [piece.y, piece.y + piece.height]) {
          assert.ok(x * x + y * y <= radiusSquared + 1e-6, `${diameter} мм, ${primary.name}: продукция вышла за торец`);
        }
      }
      for (let left = 0; left < variant.pieces.length; left += 1) for (let right = left + 1; right < variant.pieces.length; right += 1) {
        const a = variant.pieces[left]; const b = variant.pieces[right];
        const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        assert.ok(overlapX <= 1e-7 || overlapY <= 1e-7, `${diameter} мм, ${primary.name}: изделия пересекаются`);
      }
    }
  }
});

test("контрпример Ø360: добор не уменьшает общий объём двух обязательных заказов", () => {
  const primaryIds = new Set(["catalog-25x100", "catalog-25x150"]);
  const primary = PRODUCT_CATALOG.filter((product) => primaryIds.has(product.id))
    .map((product) => ({ ...product, enabled: true, priority: "primary" as const }));
  const withByproducts = PRODUCT_CATALOG
    .filter((product) => primaryIds.has(product.id) || (product.nominalThickness <= 25 && product.nominalWidth <= 150))
    .map((product) => ({ ...product, enabled: true, priority: primaryIds.has(product.id) ? "primary" as const : "byproduct" as const }));
  const plain = calculate({ diameter: 360, length: 4000, edgeAllowance: 3, products: primary, equipment: MILL_LINE, topN: 1 });
  const filled = calculate({ diameter: 360, length: 4000, edgeAllowance: 3, products: withByproducts, equipment: MILL_LINE, topN: 1 });
  assert.equal(plain.status, "ok");
  assert.equal(filled.status, "ok");
  const primaryVolume = (counts: Record<string, number>) => primary.reduce((sum, product) => sum + (counts[product.id] || 0) * product.nominalThickness * product.nominalWidth * 4000 / 1e9, 0);
  assert.ok(primaryVolume(filled.variants[0].counts) + 1e-12 >= primaryVolume(plain.variants[0].counts));
  assert.ok(filled.variants[0].nominalVolume + 1e-12 >= plain.variants[0].nominalVolume);
});

test("контрпример Ø140: два разных обязательных размера помещаются без зеркальной пары", () => {
  const ids = new Set(["catalog-25x100", "catalog-40x100"]);
  const products = PRODUCT_CATALOG.filter((product) => ids.has(product.id))
    .map((product) => ({ ...product, enabled: true, priority: "primary" as const }));
  const result = calculate({ diameter: 140, length: 4000, edgeAllowance: 3, products, equipment: MILL_LINE, topN: 1 });
  assert.equal(result.status, "ok");
  assert.ok((result.variants[0].counts["catalog-25x100"] || 0) > 0);
  assert.ok((result.variants[0].counts["catalog-40x100"] || 0) > 0);
  assert.equal(auditVariantGeometry(140, result.variants[0], [], 3).passed, true);
});

test("контрпример Ø160: автоматический режим сравнивает смеси размеров и даёт не меньше 0,047 м³", () => {
  const result = calculateMaxRecovery({ diameter: 160, length: 4000, edgeAllowance: 3, equipment: MILL_LINE, topN: 1 });
  assert.equal(result.status, "ok");
  assert.ok(result.variants[0].nominalVolume >= 0.047 - 1e-12);
});

test("каждый рабочий диаметр и каждый размер заказа проверяются по углам", () => {
  for (const diameter of LOG_DIAMETERS) for (const product of PRODUCT_CATALOG) {
    const result = calculate({ diameter, length: 4000, edgeAllowance: 3, products: [{ ...product, enabled: true, priority: "primary" }], equipment: MILL_LINE, topN: 1 });
    if (result.status === "no-solution") continue;
    assert.equal(result.status, "ok", `Ø${diameter}, ${product.name}`);
    assert.ok((result.variants[0].counts[product.id] || 0) > 0, `Ø${diameter}, ${product.name}`);
    assert.equal(auditVariantGeometry(diameter, result.variants[0], [], 3).passed, true, `Ø${diameter}, ${product.name}`);
  }
});

test("все пары обязательных заказов либо присутствуют вместе, либо честно отклонены", () => {
  for (const diameter of LOG_DIAMETERS) for (let left = 0; left < PRODUCT_CATALOG.length; left += 1) for (let right = left + 1; right < PRODUCT_CATALOG.length; right += 1) {
    const selected = [PRODUCT_CATALOG[left], PRODUCT_CATALOG[right]].map((product) => ({ ...product, enabled: true, priority: "primary" as const }));
    const result = calculate({ diameter, length: 4000, edgeAllowance: 3, products: selected, equipment: MILL_LINE, topN: 1 });
    if (result.status === "no-solution") {
      const radius = diameter / 2 - 3;
      const kerf = MILL_LINE.stages!.multiripKerf;
      const a = selected[0]; const b = selected[1];
      const cornerFits = (x: number, product: typeof a) => Math.hypot(Math.max(Math.abs(x), Math.abs(x + product.cuttingThickness)), product.cuttingWidth / 2) <= radius + 1e-7;
      const directFit = cornerFits(-kerf / 2 - a.cuttingThickness, a) && cornerFits(kerf / 2, b)
        || cornerFits(-kerf / 2 - b.cuttingThickness, b) && cornerFits(kerf / 2, a);
      assert.equal(directFit, false, `ложный отказ Ø${diameter}, ${a.name} + ${b.name}`);
      continue;
    }
    assert.equal(result.status, "ok", `Ø${diameter}, ${selected[0].name} + ${selected[1].name}`);
    assert.ok((result.variants[0].counts[selected[0].id] || 0) > 0);
    assert.ok((result.variants[0].counts[selected[1].id] || 0) > 0);
    assert.equal(auditVariantGeometry(diameter, result.variants[0], [], 3).passed, true);
  }
});

test("эталон Ø320 даёт 7 широких и 4 узких доски с объёмом сырья для явно заданных 4 м", () => {
  const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 5 });
  assert.equal(result.status, "ok");
  assert.equal(result.variants[0].counts.wide, 7);
  assert.equal(result.variants[0].counts.narrow, 4);
  assert.equal(result.variants[0].pieces.length, 11);
  assert.equal(result.variants[0].cantHeight, 216);
  assert.equal(result.variants[0].mainSawCount, 10);
  assert.equal(result.variants[0].feeds, 2);
  assert.equal(result.variants[0].secondaryCount, 4);
  assert.equal(result.variants[0].logVolume, 0.38);
  assert.ok(Math.abs(result.variants[0].nominalRecovery - 51.50534210526316) < 1e-9);
});

test("объём сырья берётся по явно заданной длине бревна, а не по скрытому подбору", () => {
  const result = calculate({ diameter: 320, length: 3650, logLength: 3750, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(result.status, "ok");
  const variant = result.variants[0];
  const expectedLogVolume = 0.35;
  assert.ok(Math.abs(variant.logVolume - expectedLogVolume) < 1e-12);
  assert.ok(Math.abs(variant.nominalVolume / variant.logVolume * 100 - variant.nominalRecovery) < 1e-12);
});

test("расчёт без фактической длины бревна блокируется", () => {
  const result = rawCalculate({ diameter: 320, length: 3650, lengthAllowance: 0, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0] });
  assert.equal(result.status, "invalid");
  assert.match(result.error || "", /фактическую длину бревна/);
});

test("нестандартная длина для кубатурника округляется вниз, а не вверх", () => {
  const result = rawCalculate({ diameter: 320, length: 3600, logLength: 3690, lengthAllowance: 40, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(result.status, "ok");
  assert.equal(result.variants[0].actualLogLengthM, 3.69);
  assert.equal(result.variants[0].gostLengthM, 3.5);
  assert.equal(result.variants[0].logVolume, 0.33);
});

test("фактическая длина бревна участвует в объёме сырья", () => {
  const result = calculate({
    diameter: 320,
    length: 3600,
    logLength: 4000,
    lengthAllowance: 25,
    products: DEFAULT_PRODUCTS,
    equipment: DEFAULT_EQUIPMENT[0],
    topN: 1,
  });
  assert.equal(result.status, "ok");
  const expectedLogVolume = 0.38;
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

test("соседние ручные диаметры независимо проходят проверку реальных углов", () => {
  const at311 = calculate({ diameter: 311, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  const at310 = calculate({ diameter: 310, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(at311.status, "ok");
  assert.equal(at310.status, "ok");
  assert.equal(auditVariantGeometry(311, at311.variants[0], [], 3).passed, true);
  assert.equal(auditVariantGeometry(310, at310.variants[0], [], 3).passed, true);
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

test("боковой дефект сдвигает постав и не оставляет досок в запрещённой зоне", () => {
  const result = calculate({ diameter: 320, length: 3650, products: DEFAULT_PRODUCTS, equipment: DEFAULT_EQUIPMENT[0], defect: { enabled: true, side: "right", depth: 20 }, topN: 1 });
  assert.equal(result.status, "ok");
  assert.ok(result.variants[0].pieces.length > 0);
  assert.ok(result.variants[0].offsetX < 0);
  assert.ok(result.variants[0].pieces.every((piece) => piece.x + piece.width <= 140));
});

test("размер распила меньше готовой доски отклоняется до построения чертежа", () => {
  const products = DEFAULT_PRODUCTS.map((product) => product.id === "wide" ? { ...product, cuttingThickness: 19 } : product);
  const result = calculate({ diameter: 320, length: 3650, products, equipment: DEFAULT_EQUIPMENT[0], topN: 1 });
  assert.equal(result.status, "invalid");
  assert.equal(result.variants.length, 0);
  assert.match(result.error || "", /не может быть меньше готового размера/);
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

test("крупное бревно из рабочего сортамента не ограничивается коротким центральным рядом", () => {
  const products = [{ id: "x", name: "27 × 100", nominalThickness: 27, nominalWidth: 100, cuttingThickness: 29, cuttingWidth: 102, color: "blue" as const, enabled: true }];
  const equipment = { ...DEFAULT_EQUIPMENT[1], maxSaws: 30 };
  const result = calculate({ diameter: 360, length: 3650, products, equipment, topN: 1 });
  assert.equal(result.status, "ok");
  const row = result.variants[0].pieces.filter((piece) => piece.id.startsWith("row-"));
  assert.ok(row.length > 9);
  assert.equal(result.variants[0].mainSawCount, row.length + 1);
});
