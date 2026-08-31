"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculate,
  calculateFaceMetrics,
  calculateMaxRecovery,
  LOG_DIAMETERS,
  MILL_LINE,
  PRODUCT_CATALOG,
  type Calculation,
  type Defect,
  type Equipment,
  type Piece,
  type Product,
  type Variant,
} from "../lib/calculator";

type DrawingMode = "final" | "breakdown" | "multirip" | "edging";
const format = (value: number, digits = 1) =>
  value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const EXPORT_SVG_STYLES = `.sheet{fill:#fdfdfc;stroke:#1d1f20;stroke-width:1}.log-circle{fill:#fafaf8;stroke:#17191a;stroke-width:2.5}.working-circle{fill:none;stroke:#777b7c;stroke-width:1;stroke-dasharray:5 4}.axis{stroke:#737677;stroke-width:.8;stroke-dasharray:13 5 2 5}.cant-guide{fill:#efefed;stroke:#5f6263;stroke-width:1;stroke-dasharray:6 4}.saw-lines{stroke:#282a2b;stroke-width:1.2;stroke-dasharray:5 2}.board{stroke-width:1.2}.center-board{fill:#eeeeec;stroke:#222526}.side-board{fill:#d9dbda;stroke:#4d5051}.piece-text{fill:#242627;font-size:8px;font-family:Arial,sans-serif;font-weight:700}.defect-zone{fill:#777;opacity:.42}.defect-hatch{fill:none;stroke:#202223;stroke-width:2;stroke-dasharray:3 3}.dimension-line{stroke:#1c1e1f;stroke-width:1}.arrow-fill{fill:#1c1e1f}.dimension-text{fill:#1c1e1f;font-size:14px;font-family:Arial,sans-serif;font-weight:700}.small-dimension{fill:#1c1e1f;font-size:10px;font-family:Arial,sans-serif}.title-box,.production-box{fill:#fff;stroke:#1c1e1f;stroke-width:1}.title-text,.card-title{fill:#1c1e1f;font-family:Arial,sans-serif;font-weight:800}.title-text{font-size:9px}.title-subtext,.card-label,.card-note{fill:#56595a;font-family:Arial,sans-serif}.title-subtext{font-size:7px}.tear-line{stroke:#777;stroke-width:1;stroke-dasharray:7 5}.tear-text{fill:#777;font:700 7px Arial,sans-serif}.card-title{font-size:11px}.card-label{font-size:7px}.card-value{fill:#1c1e1f;font:800 10px Arial,sans-serif}.card-metric{fill:#1c1e1f;font:800 25px Georgia,serif}.card-note{font-size:6.5px}`;
const EXPORT_CARD_STYLES = `.piece-text{font-size:10px}.dimension-text{font-size:16px}.small-dimension{font-size:12px;font-weight:700}.cut-line{stroke:#8d8b84;stroke-width:1;stroke-dasharray:6 5}.card-shell{fill:#fff;stroke:#20211f;stroke-width:1.4}.card-header{fill:#20211f}.card-header-title{fill:#fff;font:800 13px Arial,sans-serif}.card-header-meta{fill:#d9d7d1;font:700 8px Arial,sans-serif}.summary-box{fill:#f5f2eb;stroke:#d8d4ca;stroke-width:1}.summary-label{fill:#6c6a64;font:700 7.5px Arial,sans-serif}.summary-value{fill:#20211f;font:800 24px Arial,sans-serif}.product-label{fill:#6c6a64;font:700 7.5px Arial,sans-serif}.product-value{fill:#20211f;font:800 10px Arial,sans-serif}`;

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  required = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  required?: boolean;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min="0"
        required={required}
        value={value ?? ""}
        placeholder="Введите"
        onChange={(event) =>
          onChange(event.target.value === "" ? null : Number(event.target.value))
        }
      />
    </label>
  );
}

function productsForOrders(primaryIds: string[], includeByproducts: boolean) {
  const selectedIds = new Set(primaryIds);
  const primaryProducts = PRODUCT_CATALOG.filter((product) => selectedIds.has(product.id));
  if (!primaryProducts.length) return [];
  return PRODUCT_CATALOG.filter((product) =>
    selectedIds.has(product.id) ||
    (includeByproducts &&
      primaryProducts.some((primary) =>
        product.nominalThickness <= primary.nominalThickness &&
        product.nominalWidth <= primary.nominalWidth,
      )),
  ).map((product) => ({
    ...product,
    enabled: true,
    priority: selectedIds.has(product.id) ? "primary" as const : "byproduct" as const,
  }));
}

function defectRect(
  defect: Defect,
  center: number,
  radiusPx: number,
  scale: number,
) {
  const depth = Math.max(0, defect.depth) * scale;
  if (defect.side === "right")
    return {
      x: center + radiusPx - depth,
      y: center - radiusPx,
      width: depth,
      height: radiusPx * 2,
    };
  if (defect.side === "left")
    return {
      x: center - radiusPx,
      y: center - radiusPx,
      width: depth,
      height: radiusPx * 2,
    };
  if (defect.side === "top")
    return {
      x: center - radiusPx,
      y: center - radiusPx,
      width: radiusPx * 2,
      height: depth,
    };
  return {
    x: center - radiusPx,
    y: center + radiusPx - depth,
    width: radiusPx * 2,
    height: depth,
  };
}

function TechnicalDrawing({
  diameter,
  variant,
  products,
  mode,
  zoom,
  svgRef,
  equipment,
  defects,
  edgeAllowance,
}: {
  diameter: number;
  variant: Variant;
  products: Product[];
  mode: DrawingMode;
  zoom: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
  equipment: Equipment;
  defects: Defect[];
  edgeAllowance: number;
}) {
  const center = 300;
  const radiusPx = 215;
  const scale = radiusPx / (diameter / 2);
  const workingRadiusPx = Math.max(0, radiusPx - edgeAllowance * scale);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const pieces = variant.pieces.filter((piece) =>
    mode === "final" || mode === "breakdown" || (mode === "edging" ? piece.id.startsWith("cap") : piece.id.startsWith("row")),
  );
  const toSvg = (piece: Piece) => ({
    x: center + piece.x * scale,
    y: center - (piece.y + piece.height) * scale,
    width: piece.width * scale,
    height: piece.height * scale,
  });
  const rowPieces = variant.pieces.filter((piece) =>
    piece.id.startsWith("row"),
  );
  const capPieces = variant.pieces.filter((piece) =>
    piece.id.startsWith("cap"),
  );
  const rowMin = Math.min(...rowPieces.map((piece) => piece.x));
  const rowMax = Math.max(...rowPieces.map((piece) => piece.x + piece.width));
  const chordHalfWidth = (y: number) => Math.sqrt(Math.max(0, (diameter / 2) ** 2 - y * y));
  const capGroups = new Map<string, Piece[]>();
  for (const piece of capPieces) {
    const match = piece.id.match(/^(cap-(?:top|bottom)-\d+)-/);
    if (match) capGroups.set(match[1], [...(capGroups.get(match[1]) || []), piece]);
  }
  const breakdownKerf = equipment.stages?.breakdownKerf ?? equipment.kerf;
  const multiripKerf = equipment.stages?.multiripKerf ?? equipment.kerf;
  const edgingKerf = equipment.stages?.edgingKerf ?? equipment.kerf;
  const breakdownBands: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const side of ["top", "bottom"] as const) {
    const layers = [...capGroups.entries()]
      .filter(([key]) => key.startsWith(`cap-${side}-`))
      .map(([, layerPieces]) => ({ min: Math.min(...layerPieces.map((piece) => piece.y)), max: Math.max(...layerPieces.map((piece) => piece.y + piece.height)) }))
      .sort((a, b) => side === "top" ? a.min - b.min : b.max - a.max);
    let boundary = variant.offsetY + (side === "top" ? variant.cantHeight / 2 : -variant.cantHeight / 2);
    for (const layer of layers) {
      const low = side === "top" ? boundary : layer.max;
      const high = side === "top" ? layer.min : boundary;
      if (high > low + 1e-7) breakdownBands.push({ x: -chordHalfWidth((low + high) / 2), y: low, width: chordHalfWidth((low + high) / 2) * 2, height: high - low });
      boundary = side === "top" ? layer.max : layer.min;
    }
    if (layers.length) {
      const low = side === "top" ? boundary : boundary - breakdownKerf;
      const high = side === "top" ? boundary + breakdownKerf : boundary;
      const half = chordHalfWidth((low + high) / 2);
      breakdownBands.push({ x: -half, y: low, width: half * 2, height: high - low });
    } else {
      const low = side === "top" ? boundary : boundary - breakdownKerf;
      const high = side === "top" ? boundary + breakdownKerf : boundary;
      const half = chordHalfWidth((low + high) / 2);
      breakdownBands.push({ x: -half, y: low, width: half * 2, height: high - low });
    }
  }
  const sortedRowPieces = [...rowPieces].sort((a, b) => a.x - b.x);
  const multiripBands = sortedRowPieces.slice(1).map((piece, index) => {
    const previous = sortedRowPieces[index];
    return { x: previous.x + previous.width, y: variant.offsetY - variant.cantHeight / 2, width: piece.x - previous.x - previous.width, height: variant.cantHeight };
  }).filter((band) => band.width > 1e-7);
  if (sortedRowPieces.length) {
    multiripBands.unshift({ x: sortedRowPieces[0].x - multiripKerf, y: variant.offsetY - variant.cantHeight / 2, width: multiripKerf, height: variant.cantHeight });
    const last = sortedRowPieces.at(-1)!;
    multiripBands.push({ x: last.x + last.width, y: variant.offsetY - variant.cantHeight / 2, width: multiripKerf, height: variant.cantHeight });
  }
  const edgingBands = [...capGroups.values()].flatMap((layerPieces) => {
    const sorted = [...layerPieces].sort((a, b) => a.x - b.x);
    const internal = sorted.slice(1).map((piece, index) => {
      const previous = sorted[index];
      return { x: previous.x + previous.width, y: piece.y, width: piece.x - previous.x - previous.width, height: piece.height };
    }).filter((band) => band.width > 1e-7);
    const first = sorted[0]; const last = sorted.at(-1)!;
    return [
      { x: first.x - edgingKerf, y: first.y, width: edgingKerf, height: first.height },
      ...internal,
      { x: last.x + last.width, y: last.y, width: edgingKerf, height: last.height },
    ];
  });
  const bandRect = (band: { x: number; y: number; width: number; height: number }) => ({
    x: center + band.x * scale,
    y: center - (band.y + band.height) * scale,
    width: band.width * scale,
    height: band.height * scale,
  });
  const productRows = products
    .filter((product) => product.enabled && (variant.counts[product.id] || 0) > 0)
    .sort((a, b) => Number(b.priority === "primary") - Number(a.priority === "primary"))
    .map(
      (product) =>
        `${product.nominalThickness}×${product.nominalWidth} мм — ${variant.counts[product.id] || 0} шт.`,
    );
  const productDisplayRows = productRows.slice(0, 5);
  const { faceFill } = calculateFaceMetrics(diameter, edgeAllowance, products, variant.counts);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 600 780"
      style={{
        width: `${600 * zoom}px`,
        maxWidth: zoom <= 1 ? "100%" : "none",
      }}
      role="img"
      aria-label={`Чертёж распила бревна диаметром ${diameter} миллиметров`}
    >
      <defs>
        <style>{EXPORT_CARD_STYLES}</style>
        <clipPath id="log-clip">
          <circle cx={center} cy={center} r={radiusPx} />
        </clipPath>
      </defs>
      <rect x="7" y="7" width="586" height="766" className="sheet" />
      <circle cx={center} cy={center} r={radiusPx} className="log-circle" />
      {edgeAllowance > 0 && <circle cx={center} cy={center} r={workingRadiusPx} className="working-circle" />}
      {defects.map((defect, index) => {
        const rect = defectRect(defect, center, radiusPx, scale);
        return (
          <g key={`${defect.side}-${index}`} clipPath="url(#log-clip)">
            <rect {...rect} className="defect-zone" />
            <path
              d={`M ${rect.x} ${rect.y} h ${rect.width} v ${rect.height} h ${-rect.width} z`}
              className="defect-hatch"
            />
          </g>
        );
      })}
      <line x1="65" y1={center} x2="535" y2={center} className="axis" />
      <line x1={center} y1="65" x2={center} y2="535" className="axis" />
      {mode === "breakdown" && (
        <g>
          {breakdownBands.map((band, index) => <rect key={index} {...bandRect(band)} className="saw-kerf" fill="#202223" opacity="0.72" clipPath="url(#log-clip)" />)}
        </g>
      )}
      {mode === "multirip" && (
        <>
          <rect
            x={center - radiusPx}
            y={center - (variant.offsetY + variant.cantHeight / 2) * scale}
            width={radiusPx * 2}
            height={variant.cantHeight * scale}
            className="cant-guide"
            clipPath="url(#log-clip)"
          />
          <g>{multiripBands.map((band, index) => <rect key={index} {...bandRect(band)} className="saw-kerf" fill="#202223" opacity="0.72" />)}</g>
        </>
      )}
      {mode === "edging" && <g>{edgingBands.map((band, index) => <rect key={index} {...bandRect(band)} className="saw-kerf" fill="#202223" opacity="0.72" />)}</g>}
      {pieces.map((piece) => {
        const box = toSvg(piece);
        const product = productMap.get(piece.productId)!;
        return (
          <g key={piece.id}>
            <rect
              {...box}
              className={`board ${product.color === "blue" ? "center-board" : "side-board"}`}
            />
            {Math.min(box.width, box.height) > 28 && (
              <text
                x={box.x + box.width / 2}
                y={box.y + box.height / 2 + 4}
                textAnchor="middle"
                className="piece-text"
              >
                {product.cuttingThickness}×{product.cuttingWidth}
              </text>
            )}
          </g>
        );
      })}
      <line
        x1={center - radiusPx}
        y1="548"
        x2={center + radiusPx}
        y2="548"
        className="dimension-line"
      />
      <line
        x1={center - radiusPx}
        y1="540"
        x2={center - radiusPx}
        y2="556"
        className="dimension-line"
      />
      <line
        x1={center + radiusPx}
        y1="540"
        x2={center + radiusPx}
        y2="556"
        className="dimension-line"
      />
      <path
        d={`M ${center - radiusPx} 548 l 10 -4 v 8 z M ${center + radiusPx} 548 l -10 -4 v 8 z`}
        className="arrow-fill"
      />
      <text x={center} y="575" textAnchor="middle" className="dimension-text">
        Ø {format(diameter, 0)} мм
      </text>
      <line
        x1="67"
        y1={center - (variant.offsetY + variant.cantHeight / 2) * scale}
        x2="67"
        y2={center - (variant.offsetY - variant.cantHeight / 2) * scale}
        className="dimension-line"
      />
      <text
        x="54"
        y={center - variant.offsetY * scale}
        transform={`rotate(-90 54 ${center - variant.offsetY * scale})`}
        textAnchor="middle"
        className="small-dimension"
      >
        постав {format(variant.cantHeight, 0)} мм
      </text>
      {rowPieces.length > 0 && (
        <>
          <line
            x1={center + rowMin * scale}
            y1="55"
            x2={center + rowMax * scale}
            y2="55"
            className="dimension-line"
          />
          <line
            x1={center + rowMin * scale}
            y1="49"
            x2={center + rowMin * scale}
            y2="61"
            className="dimension-line"
          />
          <line
            x1={center + rowMax * scale}
            y1="49"
            x2={center + rowMax * scale}
            y2="61"
            className="dimension-line"
          />
          <text
            x={center + ((rowMin + rowMax) / 2) * scale}
            y="45"
            textAnchor="middle"
            className="small-dimension"
          >
            ширина ряда {format(rowMax - rowMin, 0)} мм
          </text>
        </>
      )}
      <line x1="28" y1="612" x2="580" y2="612" className="cut-line" />
      <g transform="translate(20 626)">
        <rect width="560" height="132" rx="4" className="card-shell" />
        <rect width="560" height="34" rx="4" className="card-header" />
        <path d="M0 30 H560 V34 H0 Z" className="card-header" />
        <text x="14" y="22" className="card-header-title">
          {mode === "final"
            ? "ИТОГОВЫЙ ПОСТАВ"
            : mode === "breakdown"
              ? "БРУСОВАЛЬНЫЙ СТАНОК"
              : mode === "multirip"
                ? "МНОГОПИЛ"
                : "КРОМКООБРЕЗНОЙ СТАНОК"}
        </text>
        <text x="546" y="21" textAnchor="end" className="card-header-meta">
          Ø{format(diameter, 0)} · {variant.pieces.length} ШТ.
        </text>
        <g transform="translate(14 46)">
          <rect width="132" height="72" rx="4" className="summary-box" />
          <text x="12" y="18" className="summary-label">ПОЛЕЗНЫЙ ВЫХОД</text>
          <text x="12" y="52" className="summary-value">{format(variant.nominalRecovery)}%</text>
        </g>
        <g transform="translate(154 46)">
          <rect width="132" height="72" rx="4" className="summary-box" />
          <text x="12" y="18" className="summary-label">ЗАПОЛНЕНИЕ ТОРЦА</text>
          <text x="12" y="52" className="summary-value">{format(faceFill)}%</text>
        </g>
        <g transform="translate(304 46)">
          <text x="0" y="12" className="product-label">ПРОДУКЦИЯ</text>
          <text x="0" y="29" className="product-value">
            {productDisplayRows.map((row, index) => (
              <tspan key={row} x="0" dy={index === 0 ? 0 : 13}>
                {row}
              </tspan>
            ))}
          </text>
        </g>
      </g>
    </svg>
  );
}

export function CalculatorApp() {
  const [diameter, setDiameter] = useState<number | null>(null);
  const logLength = 4000;
  const finishedLength = 4000;
  const lengthAllowance = 0;
  const edgeAllowance = 3;
  const [logAdded, setLogAdded] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [includeByproducts, setIncludeByproducts] = useState(true);
  const [orderMode, setOrderMode] = useState<"primary" | "auto" | null>(null);
  const [additionalOrderOpen, setAdditionalOrderOpen] = useState(false);
  const [customDiameterOpen, setCustomDiameterOpen] = useState(false);
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([MILL_LINE]);
  const [equipmentId, setEquipmentId] = useState(MILL_LINE.id);
  const [equipmentDraft, setEquipmentDraft] = useState<Equipment | null>(null);
  const [equipmentDraftMode, setEquipmentDraftMode] = useState<"create" | "edit" | null>(null);
  const [defects, setDefects] = useState<Defect[]>([]);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("final");
  const [zoom, setZoom] = useState(1);
  const [inputsOpen, setInputsOpen] = useState(true);
  const [equipmentLoaded, setEquipmentLoaded] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- restoring an external device-local preference */
    try {
      const saved = localStorage.getItem("postav-equipment-v4");
      if (saved) {
        const items: Equipment[] = JSON.parse(saved);
        if (items.length) {
          setEquipmentList(items);
          setEquipmentId(items[0].id);
        }
      }
    } catch {
      /* device-local setting */
    } finally {
      setEquipmentLoaded(true);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (equipmentLoaded) {
      localStorage.setItem("postav-equipment-v4", JSON.stringify(equipmentList));
    }
  }, [equipmentList, equipmentLoaded]);

  const equipment = equipmentList.find((item) => item.id === equipmentId);
  const positive = (value: number | null | undefined) =>
    typeof value === "number" && Number.isFinite(value) && value > 0;
  const equipmentReady =
    !!equipment && positive(equipment.kerf) && !!equipment.stages;
  const logReady = logAdded && positive(diameter);
  const effectiveEdgeAllowance = edgeAllowance;
  const calculationProducts = products;
  const productsReady =
    calculationProducts.some((product) => product.enabled) &&
    (orderMode === "auto" || calculationProducts.some((product) => product.enabled && product.priority === "primary")) &&
    calculationProducts.filter((product) => product.enabled).every(
      (product) =>
        positive(product.nominalThickness) &&
        positive(product.nominalWidth) &&
        product.cuttingThickness >= product.nominalThickness &&
        product.cuttingWidth >= product.nominalWidth,
    );
  const readyToCalculate = equipmentReady && logReady && productsReady;

  const missingMessage = !equipment
    ? "Добавьте оборудование, на котором будет выполняться распил."
    : !logAdded
      ? "Выберите диаметр бревна."
      : !logReady
        ? "Выберите диаметр тонкого торца."
        : products.length === 0
          ? "Добавьте размеры продукции, которую нужно получить."
          : !productsReady
            ? "Заполните толщину и ширину каждого размера продукции."
            : "";

  const calculationLength = finishedLength;
  const calculationLogLength = logLength;

  const result: Calculation = useMemo(() => {
    if (!readyToCalculate || !equipment) return { status: "invalid", variants: [], error: missingMessage };
    const common = {
      diameter: diameter!,
      length: calculationLength,
      logLength: calculationLogLength,
      lengthAllowance,
      edgeAllowance: effectiveEdgeAllowance,
      equipment,
      defects,
      topN: 1,
    };
    if (orderMode !== "auto") return calculate({ ...common, products: calculationProducts });

    return calculateMaxRecovery({ ...common, products: calculationProducts });
  }, [readyToCalculate, equipment, diameter, calculationLength, calculationLogLength, lengthAllowance, effectiveEdgeAllowance, calculationProducts, defects, missingMessage, orderMode]);
  const variant = result.variants[0];

  const addEquipment = () => {
    setEquipmentDraft({
      id: `equipment-${equipmentList.length + 1}`,
      name: "",
      maxSaws: 0,
      kerf: 0,
      maxDiameter: 0,
      secondaryEdging: false,
      multipleFeeds: false,
    });
    setEquipmentDraftMode("create");
  };
  const editEquipment = () => {
    if (!equipment) return;
    setEquipmentDraft({ ...equipment });
    setEquipmentDraftMode("edit");
  };
  const closeEquipment = () => {
    setEquipmentDraft(null);
    setEquipmentDraftMode(null);
  };
  const updateEquipmentDraft = (patch: Partial<Equipment>) =>
    setEquipmentDraft((item) => (item ? { ...item, ...patch } : item));
  const validEquipmentDraft =
    !!equipmentDraft &&
    (equipmentDraft.stages
      ? positive(equipmentDraft.stages.breakdownKerf) &&
        positive(equipmentDraft.stages.multiripKerf) &&
        positive(equipmentDraft.stages.edgingKerf)
      : Number.isInteger(equipmentDraft.maxSaws) &&
        positive(equipmentDraft.maxSaws) &&
        positive(equipmentDraft.kerf) &&
        positive(equipmentDraft.maxDiameter));
  const saveEquipment = () => {
    if (!equipmentDraft || !validEquipmentDraft) return;
    const index =
      equipmentDraftMode === "edit"
        ? equipmentList.findIndex((item) => item.id === equipmentDraft.id)
        : equipmentList.length;
    const item = {
      ...equipmentDraft,
      name: equipmentDraft.name.trim() || `Оборудование ${index + 1}`,
    };
    setEquipmentList((items) =>
      equipmentDraftMode === "edit"
        ? items.map((existing) => (existing.id === item.id ? item : existing))
        : [...items, item],
    );
    setEquipmentId(item.id);
    closeEquipment();
  };
  const addLog = () => {
    setLogAdded(true);
    setDiameter(null);
    setDefects([]);
  };
  const removeLog = () => {
    setLogAdded(true);
    setDiameter(null);
    setDefects([]);
  };
  const resetCalculation = () => {
    removeLog();
    setProducts([]);
    setIncludeByproducts(true);
    setOrderMode(null);
    setAdditionalOrderOpen(false);
    setCustomDiameterOpen(false);
    setDrawingMode("final");
    setZoom(1);
  };

  const selectPrimaryProduct = (id: string) => {
    setOrderMode("primary");
    const currentIds = products.filter((product) => product.priority === "primary").map((product) => product.id);
    const nextIds = [...new Set([...currentIds, id])];
    setProducts(productsForOrders(nextIds, includeByproducts));
    setAdditionalOrderOpen(false);
  };
  const selectAutomaticYield = () => {
    setOrderMode("auto");
    setProducts(PRODUCT_CATALOG.map((product) => ({ ...product, enabled: true, priority: "byproduct" })));
    setAdditionalOrderOpen(false);
  };
  const selectPrimaryMode = () => {
    if (orderMode === "primary") return;
    setOrderMode("primary");
    setProducts([]);
    setAdditionalOrderOpen(false);
  };
  const changeByproducts = (enabled: boolean) => {
    setIncludeByproducts(enabled);
    const primaryIds = products.filter((product) => product.priority === "primary").map((product) => product.id);
    if (primaryIds.length) setProducts(productsForOrders(primaryIds, enabled));
  };
  const chooseAnotherPrimaryProduct = () => {
    setProducts([]);
    setAdditionalOrderOpen(false);
  };

  const toggleDefects = (enabled: boolean) =>
    setDefects(enabled ? [{ enabled: true, side: "right", depth: 0 }] : []);
  const addDefect = () => {
    const unused = (["right", "left", "top", "bottom"] as Defect["side"][]).find(
      (side) => !defects.some((defect) => defect.side === side),
    );
    if (unused) setDefects((items) => [...items, { enabled: true, side: unused, depth: 0 }]);
  };
  const updateDefect = (index: number, patch: Partial<Defect>) =>
    setDefects((items) =>
      items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  const removeDefect = (index: number) =>
    setDefects((items) => items.filter((_, itemIndex) => itemIndex !== index));

  const saveDrawing = async () => {
    if (!svgRef.current || saveState === "saving" || !diameter) return;
    setSaveState("saving");
    try {
      const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", "1200");
      clone.setAttribute("height", "1800");
      clone.style.transform = "none";
      const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
      style.textContent = EXPORT_SVG_STYLES;
      clone.insertBefore(style, clone.firstChild);
      const sourceUrl = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(clone)], {
          type: "image/svg+xml;charset=utf-8",
        }),
      );
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("export"));
        image.src = sourceUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 1800;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(sourceUrl);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("png"))),
          "image/png",
          1,
        ),
      );
      const file = new File([blob], `postav-${diameter}mm.png`, { type: "image/png" });
      const phoneShare =
        window.matchMedia("(pointer: coarse)").matches &&
        window.innerWidth < 900 &&
        navigator.canShare?.({ files: [file] });
      if (phoneShare) {
        await navigator.share({ files: [file], title: `Постав Ø${diameter} мм` });
      } else {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = file.name;
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1800);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") setSaveState("idle");
      else {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2500);
      }
    }
  };

  const emptyAction = !equipment
    ? { title: "Добавьте оборудование", button: "Добавить оборудование", action: addEquipment }
    : !logAdded
      ? { title: "Добавьте бревно", button: "Добавить бревно", action: addLog }
      : !logReady
        ? { title: "Заполните данные бревна", button: "", action: undefined }
      : orderMode === null
        ? { title: "Выберите цель расчёта", button: "", action: undefined }
      : products.length === 0
        ? { title: "Выберите размер заказа", button: "", action: undefined }
        : !productsReady
          ? { title: "Заполните данные продукции", button: "", action: undefined }
          : { title: "Проверьте исходные данные", button: "", action: undefined };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <span className="brand-mark">П</span>
          <div>
            <small>Производственный расчёт</small>
            <h1>Постав</h1>
          </div>
        </div>
        <p>Калькулятор раскроя круглого леса</p>
      </header>
      <section className="workspace">
        <aside className={`control-panel ${inputsOpen ? "open" : "collapsed"}`}>
          <div className="panel-heading">
            <span>Исходные данные</span>
            <div className="panel-heading-actions">
              <button className="reset-button" onClick={resetCalculation}>Сбросить расчёт</button>
              <button
                className="collapse-button"
                aria-label={inputsOpen ? "Скрыть исходные данные" : "Показать исходные данные"}
                aria-expanded={inputsOpen}
                onClick={() => setInputsOpen((value) => !value)}
              >
                {inputsOpen ? "↑" : "↓"}
              </button>
            </div>
          </div>

          <div className="inputs-body">
            <section className="input-section equipment-section">
              <div className="section-title with-state">
                <div>
                  <h3>Оборудование</h3>
                  <p>Настройки сохраняются на этом устройстве</p>
                </div>
              </div>
              {equipment ? (
                <div className="mill-line-card">
                  <div className="mill-line-heading">
                    <strong>Линия распила</strong>
                    <button onClick={editEquipment}>Изменить</button>
                  </div>
                  <div className="mill-stages">
                    <span><b>Брусовальный</b><small>пропил {format(equipment.stages?.breakdownKerf ?? 5)} мм</small></span>
                    <span><b>Многопил</b><small>пропил {format(equipment.stages?.multiripKerf ?? 4)} мм</small></span>
                    <span><b>Кромкообрезной</b><small>пропил {format(equipment.stages?.edgingKerf ?? 3.8)} мм</small></span>
                  </div>
                  <p>Эти значения уже участвуют в каждом расчёте.</p>
                </div>
              ) : (
                <button className="primary-add-button" onClick={addEquipment}>＋ Добавить оборудование</button>
              )}
            </section>

            <section className="input-section log-section">
              <div className="section-title with-state">
                <div>
                  <h3>Бревно</h3>
                  <p>Измеряем то бревно, которое сейчас пойдёт в распил</p>
                </div>
              </div>
              {!logAdded ? (
                <button className="secondary-add-button" onClick={addLog}>＋ Добавить бревно</button>
              ) : (
                <div className="log-editor">
                  <strong className="input-prompt">Выберите диаметр тонкого торца</strong>
                  <div className="diameter-grid">
                    {LOG_DIAMETERS.map((value) => (
                      <button
                        key={value}
                        className={diameter === value ? "active" : ""}
                        onClick={() => { setDiameter(value); setCustomDiameterOpen(false); }}
                      >
                        Ø{value / 10}
                      </button>
                    ))}
                    <button
                      className={customDiameterOpen ? "active" : ""}
                      onClick={() => { setCustomDiameterOpen(true); setDiameter(null); }}
                    >
                      ✎ Ввести
                    </button>
                  </div>
                  {customDiameterOpen && (
                    <div className="manual-diameter">
                      <NumberField label="Диаметр тонкого торца, мм" value={diameter} onChange={setDiameter} required />
                    </div>
                  )}
                  <p className="field-help">Измеряйте тонкий торец без коры. До Ø20 см достаточно одного диаметра; крупнее — измерьте в двух направлениях и возьмите среднее.</p>
                  <div className="log-safety-panel">
                    <div className="damage-choice">
                      <div>
                        <strong>Гниль или повреждение</strong>
                        <span>Есть ли на бревне место, которое нельзя пускать в доску?</span>
                      </div>
                      <div className="binary-choice" role="group" aria-label="Есть ли гниль или повреждение">
                        <button className={defects.length === 0 ? "active" : ""} onClick={() => toggleDefects(false)}>Нет</button>
                        <button className={defects.length > 0 ? "active" : ""} onClick={() => toggleDefects(true)}>Есть</button>
                      </div>
                    </div>
                    {defects.length > 0 && (
                      <div className="defects-list">
                        <p className="damage-instruction">Укажите, где начинается повреждённая древесина.</p>
                        {defects.map((defect, index) => (
                          <div className="defect-row" key={`${defect.side}-${index}`}>
                            <label>
                              <span>С какой стороны</span>
                              <select value={defect.side} onChange={(event) => updateDefect(index, { side: event.target.value as Defect["side"] })}>
                                <option value="right">Справа</option>
                                <option value="left">Слева</option>
                                <option value="top">Сверху</option>
                                <option value="bottom">Снизу</option>
                              </select>
                            </label>
                            <NumberField label="Насколько вглубь, мм" value={defect.depth || null} onChange={(depth) => updateDefect(index, { depth: depth ?? 0 })} />
                            <button aria-label={`Удалить повреждение ${index + 1}`} onClick={() => removeDefect(index)}>×</button>
                          </div>
                        ))}
                        {defects.length < 4 && <button className="add-defect-button" onClick={addDefect}>＋ Добавить ещё сторону</button>}
                        <p className="defect-warning">Модель считает, что эта плоская запрещённая зона идёт по всей длине бревна. Для локальной гнили нужен отдельный продольный замер.</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="input-section boards-section">
              <div className="section-title with-state">
                <div>
                  <h3>Что нужно получить</h3>
                  <p>Сначала выберите цель: максимум объёма продукции или выполнение конкретного заказа.</p>
                </div>
              </div>

              {!equipmentReady || !logReady ? (
                <div className="product-locked">
                  Сначала выберите диаметр бревна.
                </div>
              ) : (
                <>
                  <div className="calculation-mode-switch" role="group" aria-label="Цель расчёта">
                    <button className={orderMode === "auto" ? "active" : ""} onClick={selectAutomaticYield}>
                      <strong>Максимальный объём</strong>
                      <small>Без цен: программа максимизирует номинальный объём</small>
                    </button>
                    <span className="mode-or">или</span>
                    <button className={orderMode === "primary" ? "active" : ""} onClick={selectPrimaryMode}>
                      <strong>Выполнить заказ</strong>
                      <small>Сначала нужный размер доски</small>
                    </button>
                  </div>
                  {orderMode === null && (
                    <p className="mode-hint">Выберите, что сейчас важнее: наибольший номинальный объём со всего бревна или конкретный заказ.</p>
                  )}
                  {orderMode === "primary" && products.length > 0 && (
                    <div className="selected-primary-order">
                      <span>
                        <small>Основной заказ</small>
                        <strong>{products.filter((product) => product.priority === "primary").map((product) => product.name).join(" + ")}</strong>
                      </span>
                      <div className="selected-order-actions">
                        <button onClick={chooseAnotherPrimaryProduct}>Выбрать другой</button>
                        <button className="add-order-button" aria-label="Добавить ещё один заказ" title="Добавить ещё один заказ" onClick={() => setAdditionalOrderOpen((value) => !value)}>＋</button>
                      </div>
                    </div>
                  )}
                  {orderMode === "primary" && (products.length === 0 || additionalOrderOpen) && (
                    <div className="catalog-picker primary-catalog">
                      <strong>{products.length === 0 ? "Какой размер нужен в первую очередь?" : "Добавить ещё один основной заказ"}</strong>
                      <div className="catalog-grid">
                        {PRODUCT_CATALOG.filter((product) => !products.some((item) => item.id === product.id && item.priority === "primary")).map((product) => (
                          <button key={product.id} onClick={() => selectPrimaryProduct(product.id)}>
                            {product.nominalThickness} × {product.nominalWidth}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {orderMode === "primary" && products.length > 0 && (
                    <label className="byproduct-toggle" htmlFor="include-byproducts">
                      <input id="include-byproducts" aria-label="Заполнять свободные места" type="checkbox" checked={includeByproducts} onChange={(event) => changeByproducts(event.target.checked)} />
                      <span>
                        <strong>Заполнять свободные места</strong>
                        <small>Добавлять меньшие размеры из ассортимента, если они повышают полезный выход.</small>
                      </span>
                    </label>
                  )}
                  {variant && products.length > 0 && (
                    <div className="order-result-list">
                      <strong>Получится с одного бревна</strong>
                      {[...products].filter((product) => (variant.counts[product.id] || 0) > 0).sort((a, b) => Number(b.priority === "primary") - Number(a.priority === "primary")).map((product) => (
                        <div key={product.id} className={product.priority === "primary" ? "primary" : ""}>
                          <span>{product.name}</span>
                          <b>{variant.counts[product.id]} шт.</b>
                        </div>
                      ))}
                    </div>
                  )}
                  {variant && (
                    <details className="metric-help">
                      <summary>Как считаются проценты и объёмы</summary>
                      <p><b>Заполнение торца</b> = площадь размеров распила ÷ площадь рабочей окружности после запаса.</p>
                      <p><b>Полезный выход продукции</b> = номинальный объём готовых досок ÷ табличный объём бревна по ГОСТ 2708-75.</p>
                      <p><b>Свободная площадь</b> = 100% − заполнение торца. Это не объём отходов.</p>
                      <p>Объём сырья по ГОСТ 2708-75: {format(variant.logVolume, 3)} м³.</p>
                    </details>
                  )}
                </>
              )}
            </section>
          </div>
        </aside>

        <section className="drawing-panel">
          <div className="drawing-toolbar">
            <div>
              <h2>Чертёж распила</h2>
              <p className="drawing-context">
                {variant && diameter
                  ? `Бревно Ø${format(diameter, 0)} мм · получаем ${variant.pieces.length} шт. · полезный выход продукции ${format(variant.nominalRecovery)}%`
                  : "Чертёж появится, когда исходные данные будут заполнены"}
              </p>
            </div>
            {variant && (
              <>
                <div className="drawing-tabs">
                  <button className={drawingMode === "final" ? "active" : ""} onClick={() => setDrawingMode("final")}>Итог</button>
                  <button className={drawingMode === "breakdown" ? "active" : ""} onClick={() => setDrawingMode("breakdown")}>Брусовальный</button>
                  <button className={drawingMode === "multirip" ? "active" : ""} onClick={() => setDrawingMode("multirip")}>Многопил</button>
                  <button className={drawingMode === "edging" ? "active" : ""} onClick={() => setDrawingMode("edging")}>Кромкообрезной</button>
                </div>
                <div className="toolbar-actions">
                  <button aria-label="Уменьшить чертёж" onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}>−</button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button aria-label="Увеличить чертёж" onClick={() => setZoom((value) => Math.min(2, value + 0.1))}>+</button>
                  <button className="download-button" onClick={saveDrawing} disabled={saveState === "saving"}>
                    {saveState === "saving" ? "Готовим…" : saveState === "saved" ? "✓ Сохранено" : saveState === "error" ? "Ошибка" : "Сохранить в галерею"}
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="drawing-stage">
            {variant && equipment && diameter ? (
              <TechnicalDrawing
                diameter={diameter}
                variant={variant}
                products={calculationProducts}
                mode={drawingMode}
                zoom={zoom}
                svgRef={svgRef}
                equipment={equipment}
                defects={defects}
                edgeAllowance={effectiveEdgeAllowance}
              />
            ) : (
              <div className={`drawing-empty ${result.status === "no-solution" ? "error" : ""}`}>
                <span>{result.status === "no-solution" ? "!" : "＋"}</span>
                <h2>{result.status === "no-solution" ? "Раскрой не найден" : emptyAction.title}</h2>
                <p>{result.error || missingMessage}</p>
                {emptyAction.action && result.status !== "no-solution" && (
                  <button onClick={emptyAction.action}>{emptyAction.button}</button>
                )}
              </div>
            )}
          </div>
          {variant && (
            <div className="drawing-caption">
              <span><i className="legend center" /> Центральная продукция</span>
              <span><i className="legend side" /> Боковая продукция</span>
              {defects.length > 0 && <span><i className="legend defect" /> Исключённая зона</span>}
              <strong>Оборудование указано на карте</strong>
            </div>
          )}
        </section>
      </section>

      {equipmentDraft && (
        <div className="modal-backdrop">
          <section className="equipment-modal">
            <div className="modal-heading">
              <div>
                <h2>Пропилы оборудования</h2>
                <p>Измените только тот станок, на котором поменялась пила.</p>
              </div>
              <button aria-label="Закрыть" onClick={closeEquipment}>×</button>
            </div>
            <div className="modal-grid line-kerf-grid">
              <NumberField label="Брусовальный, мм" value={equipmentDraft.stages?.breakdownKerf ?? null} step={0.1} onChange={(value) => updateEquipmentDraft({ stages: { ...equipmentDraft.stages!, breakdownKerf: value ?? 0 } })} required />
              <NumberField label="Многопил, мм" value={equipmentDraft.stages?.multiripKerf ?? null} step={0.1} onChange={(value) => updateEquipmentDraft({ stages: { ...equipmentDraft.stages!, multiripKerf: value ?? 0 } })} required />
              <NumberField label="Кромкообрезной, мм" value={equipmentDraft.stages?.edgingKerf ?? null} step={0.1} onChange={(value) => updateEquipmentDraft({ stages: { ...equipmentDraft.stages!, edgingKerf: value ?? 0 } })} required />
            </div>
            <p className="modal-note">Значения сохранятся на этом устройстве и сразу попадут в новый расчёт.</p>
            <div className="modal-actions spread">
              <span />
              <div>
                <button className="quiet-button" onClick={closeEquipment}>Отмена</button>
                <button className="calculate-button compact" onClick={saveEquipment} disabled={!validEquipmentDraft}>Сохранить</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
