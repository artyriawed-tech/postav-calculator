"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculate,
  DEFAULT_EQUIPMENT,
  DEFAULT_PRODUCTS,
  type Calculation,
  type Defect,
  type Equipment,
  type Piece,
  type Product,
  type Variant,
} from "../lib/calculator";

type DrawingMode = "final" | "first" | "second";
const format = (value: number, digits = 1) =>
  value.toLocaleString("ru-RU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const sideName = (side: Defect["side"]) =>
  side === "right"
    ? "справа"
    : side === "left"
      ? "слева"
      : side === "top"
        ? "сверху"
        : "снизу";
const EXPORT_SVG_STYLES = `.sheet{fill:#fdfdfc;stroke:#1d1f20;stroke-width:1}.log-circle{fill:#fafaf8;stroke:#17191a;stroke-width:2.5}.axis{stroke:#737677;stroke-width:.8;stroke-dasharray:13 5 2 5}.cant-guide{fill:#efefed;stroke:#5f6263;stroke-width:1;stroke-dasharray:6 4}.saw-lines{stroke:#282a2b;stroke-width:1.2;stroke-dasharray:5 2}.board{stroke-width:1.2}.center-board{fill:#eeeeec;stroke:#222526}.side-board{fill:#d9dbda;stroke:#4d5051}.piece-text{fill:#242627;font-size:8px;font-family:Arial,sans-serif;font-weight:700}.defect-zone{fill:#777;opacity:.42}.defect-hatch{fill:none;stroke:#202223;stroke-width:2;stroke-dasharray:3 3}.dimension-line{stroke:#1c1e1f;stroke-width:1}.arrow-fill{fill:#1c1e1f}.dimension-text{fill:#1c1e1f;font-size:14px;font-family:Arial,sans-serif;font-weight:700}.small-dimension{fill:#1c1e1f;font-size:10px;font-family:Arial,sans-serif}.title-box,.production-box{fill:#fff;stroke:#1c1e1f;stroke-width:1}.title-text,.card-title{fill:#1c1e1f;font-family:Arial,sans-serif;font-weight:800}.title-text{font-size:9px}.title-subtext,.card-label,.card-note{fill:#56595a;font-family:Arial,sans-serif}.title-subtext{font-size:7px}.tear-line{stroke:#777;stroke-width:1;stroke-dasharray:7 5}.tear-text{fill:#777;font:700 7px Arial,sans-serif}.card-title{font-size:11px}.card-label{font-size:7px}.card-value{fill:#1c1e1f;font:800 10px Arial,sans-serif}.card-metric{fill:#1c1e1f;font:800 25px Georgia,serif}.card-note{font-size:6.5px}`;
const EXPORT_CARD_STYLES = `.piece-text{font-size:10px}.dimension-text{font-size:16px}.small-dimension{font-size:12px;font-weight:700}.cut-line{stroke:#6d7071;stroke-width:1;stroke-dasharray:6 5}.card-shell{fill:#fff;stroke:#17191a;stroke-width:1.5}.card-header{fill:#202223}.card-header-title{fill:#fff;font:800 14px Arial,sans-serif}.card-header-meta{fill:#d8dada;font:700 8px Arial,sans-serif}.result-group{fill:#fff;stroke:#c7c9ca;stroke-width:1}.recovery-box{fill:#ececeb}.result-divider{stroke:#c7c9ca;stroke-width:1}.card-rule{stroke:#c7c9ca;stroke-width:1}.card-label{fill:#56595a;font:700 9px Arial,sans-serif}.card-value{fill:#1c1e1f;font:800 11px Arial,sans-serif}.card-note{fill:#56595a;font:700 8px Arial,sans-serif}.card-metric{fill:#1c1e1f;font:800 29px Georgia,serif}.equipment-box{fill:#202223}.equipment-label{fill:#d2d4d4;font:700 8px Arial,sans-serif}.equipment-name{fill:#fff;font:800 12px Arial,sans-serif}.equipment-spec{fill:#fff;font:800 13px Arial,sans-serif}`;

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
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
  length,
  variant,
  products,
  mode,
  zoom,
  svgRef,
  equipment,
  defects,
  sawCoordinates,
}: {
  diameter: number;
  length: number;
  variant: Variant;
  products: Product[];
  mode: DrawingMode;
  zoom: number;
  svgRef: React.RefObject<SVGSVGElement | null>;
  equipment: Equipment;
  defects: Defect[];
  sawCoordinates: number[];
}) {
  const center = 300;
  const radiusPx = 215;
  const scale = radiusPx / (diameter / 2);
  const productMap = new Map(products.map((product) => [product.id, product]));
  const pieces = variant.pieces.filter(
    (piece) =>
      mode === "final" ||
      (mode === "first"
        ? piece.id.startsWith("cap")
        : piece.id.startsWith("row")),
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
  const cutXs = [
    ...new Set(rowPieces.flatMap((piece) => [piece.x, piece.x + piece.width])),
  ];
  const cutYs = [
    ...new Set(
      capPieces
        .flatMap((piece) => [piece.y, piece.y + piece.height])
        .concat([
          variant.offsetY - variant.cantHeight / 2,
          variant.offsetY + variant.cantHeight / 2,
        ]),
    ),
  ];
  const chordHalfWidth = (y: number) =>
    Math.sqrt(Math.max(0, (diameter / 2) ** 2 - y * y));
  const productRows = products
    .filter((product) => product.enabled)
    .map(
      (product) =>
        `${product.nominalThickness}×${product.nominalWidth} мм — ${variant.counts[product.id] || 0} шт.`,
    );
  const defectSummary = defects.length
    ? defects
        .map(
          (defect) => `${sideName(defect.side)} ${format(defect.depth, 0)} мм`,
        )
        .join(", ")
    : "не отмечены";
  const sawSummary = sawCoordinates
    .map((value) => `${value > 0 ? "+" : ""}${format(value)}`)
    .join("  ");

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 600 850"
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
      <rect x="7" y="7" width="586" height="836" className="sheet" />
      <circle cx={center} cy={center} r={radiusPx} className="log-circle" />
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
      {mode === "first" && (
        <g className="saw-lines">
          {cutYs.map((y) => {
            const half = chordHalfWidth(y);
            return (
              <line
                key={y}
                x1={center - half * scale}
                x2={center + half * scale}
                y1={center - y * scale}
                y2={center - y * scale}
              />
            );
          })}
        </g>
      )}
      {mode === "second" && (
        <>
          <rect
            x={center - radiusPx}
            y={center - (variant.offsetY + variant.cantHeight / 2) * scale}
            width={radiusPx * 2}
            height={variant.cantHeight * scale}
            className="cant-guide"
            clipPath="url(#log-clip)"
          />
          <g className="saw-lines">
            {cutXs.map((x) => (
              <line
                key={x}
                x1={center + x * scale}
                x2={center + x * scale}
                y1={center - (variant.offsetY + variant.cantHeight / 2) * scale}
                y2={center - (variant.offsetY - variant.cantHeight / 2) * scale}
              />
            ))}
          </g>
        </>
      )}
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
      <g transform="translate(20 632)">
        <rect width="560" height="190" rx="2" className="card-shell" />
        <rect width="560" height="38" className="card-header" />
        <text x="14" y="24" className="card-header-title">
          {mode === "final"
            ? "ИТОГОВЫЙ ПОСТАВ"
            : mode === "first"
              ? "ПЕРВЫЙ РАСПИЛ"
              : "ВТОРОЙ РАСПИЛ"}
        </text>
        <text x="546" y="23" textAnchor="end" className="card-header-meta">
          Ø{format(diameter, 0)} · ГОТОВАЯ ДЛИНА {format(length, 0)} ММ ·{" "}
          {variant.pieces.length} ДОСОК
        </text>
        <g transform="translate(14 50)">
          <rect width="342" height="80" rx="3" className="result-group" />
          <path d="M3 0 H150 V80 H3 Q0 80 0 77 V3 Q0 0 3 0 Z" className="recovery-box" />
          <line x1="150" y1="0" x2="150" y2="80" className="result-divider" />
          <text x="12" y="18" className="card-label">
            ПОЛЕЗНЫЙ ВЫХОД
          </text>
          <text x="12" y="51" className="card-metric">
            {format(variant.nominalRecovery)}%
          </text>
          <text x="12" y="69" className="card-note">
            {format(variant.nominalVolume, 3)} м³ из{" "}
            {format(variant.logVolume, 3)} м³
          </text>
          <text x="164" y="18" className="card-label">
            ПРОДУКЦИЯ
          </text>
          <text x="164" y="38" className="card-value">
            {productRows.slice(0, 2).map((row, index) => (
              <tspan key={row} x="164" dy={index === 0 ? 0 : 17}>
                {row}
              </tspan>
            ))}
          </text>
          <text x="164" y="71" className="card-note">
            Постав {format(variant.cantHeight, 0)} мм · дефекты: {defectSummary}
          </text>
        </g>
        <g transform="translate(370 50)">
          <rect width="176" height="80" rx="3" className="equipment-box" />
          <text x="12" y="19" className="equipment-label">
            ОБОРУДОВАНИЕ РАСЧЁТА
          </text>
          <text x="12" y="39" className="equipment-name">
            {equipment.name}
          </text>
          <text x="12" y="62" className="equipment-spec">
            {equipment.maxSaws} ПИЛ · ПРОПИЛ {format(equipment.kerf)} ММ
          </text>
          <text x="12" y="75" className="equipment-label">
            ЛИНИЙ РЕЗА: {variant.mainSawCount} · ПОДАЧ: {variant.feeds}
          </text>
        </g>
        <line x1="14" y1="143" x2="546" y2="143" className="card-rule" />
        <text x="14" y="160" className="card-label">
          НАСТРОЙКА ПИЛ ОТ ОСИ БРЕВНА, ММ
        </text>
        <text x="14" y="180" className="card-value">
          {sawSummary || "Не требуется"}
        </text>
        <text x="546" y="160" textAnchor="end" className="card-label">
          ЗАГОТОВКИ / ОСТАТОК
        </text>
        <text x="546" y="180" textAnchor="end" className="card-value">
          {format(variant.cuttingRecovery)}% /{" "}
          {format(variant.residualRecovery)}%
        </text>
      </g>
    </svg>
  );
}

export function CalculatorApp() {
  const [diameter, setDiameter] = useState(320);
  const [length, setLength] = useState(3650);
  const [products, setProducts] = useState<Product[]>(DEFAULT_PRODUCTS);
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([]);
  const [equipmentId, setEquipmentId] = useState("");
  const [defects, setDefects] = useState<Defect[]>([]);
  const [drawingMode, setDrawingMode] = useState<DrawingMode>("final");
  const [zoom, setZoom] = useState(1);
  const [editingEquipment, setEditingEquipment] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(true);
  const [equipmentLoaded, setEquipmentLoaded] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("postav-equipment-v2");
      if (saved) {
        const items: Equipment[] = JSON.parse(saved);
        setEquipmentList(items);
        setEquipmentId(items[0]?.id || "");
      }
    } catch {
      /* device-local setting */
    } finally {
      setEquipmentLoaded(true);
    }
  }, []);
  useEffect(() => {
    if (equipmentLoaded)
      localStorage.setItem(
        "postav-equipment-v2",
        JSON.stringify(equipmentList),
      );
  }, [equipmentList, equipmentLoaded]);
  const equipment = equipmentList.find((item) => item.id === equipmentId);
  const result: Calculation = useMemo(
    () =>
      equipment
        ? calculate({ diameter, length, products, equipment, defects, topN: 1 })
        : {
            status: "invalid",
            variants: [],
            error: "Сначала добавьте оборудование для этого расчёта.",
          },
    [diameter, length, products, equipment, defects],
  );
  const variant = result.variants[0];
  const sawCoordinates = useMemo(() => {
    if (!variant || !equipment) return [];
    const row = variant.pieces
      .filter((piece) => piece.id.startsWith("row-"))
      .sort((a, b) => a.x - b.x);
    if (!row.length) return [];
    return [
      row[0].x - equipment.kerf / 2,
      ...row
        .slice(0, -1)
        .map((piece, index) => (piece.x + piece.width + row[index + 1].x) / 2),
      row.at(-1)!.x + row.at(-1)!.width + equipment.kerf / 2,
    ];
  }, [variant, equipment]);
  const updateProduct = (id: string, patch: Partial<Product>) =>
    setProducts((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  const updateEquipment = (patch: Partial<Equipment>) =>
    equipment &&
    setEquipmentList((items) =>
      items.map((item) =>
        item.id === equipment.id ? { ...item, ...patch } : item,
      ),
    );
  const persistEquipment = (items: Equipment[]) =>
    localStorage.setItem("postav-equipment-v2", JSON.stringify(items));
  const saveEquipment = () => {
    persistEquipment(equipmentList);
    setEditingEquipment(false);
  };
  const addEquipment = () => {
    const item: Equipment = {
      ...DEFAULT_EQUIPMENT[0],
      id: `equipment-${Date.now()}`,
      name: "Новое оборудование",
    };
    setEquipmentList((items) => [...items, item]);
    setEquipmentId(item.id);
    setEditingEquipment(true);
  };
  const deleteEquipment = () => {
    if (!equipment) return;
    const items = equipmentList.filter((item) => item.id !== equipment.id);
    setEquipmentList(items);
    setEquipmentId(items[0]?.id || "");
    persistEquipment(items);
    setEditingEquipment(false);
  };
  const reset = () => {
    setDiameter(320);
    setLength(3650);
    setProducts(DEFAULT_PRODUCTS);
    setDefects([]);
  };
  const toggleDefects = (enabled: boolean) =>
    setDefects(enabled ? [{ enabled: true, side: "right", depth: 20 }] : []);
  const addDefect = () => {
    const unused = (
      ["right", "left", "top", "bottom"] as Defect["side"][]
    ).find((side) => !defects.some((defect) => defect.side === side));
    if (unused)
      setDefects((items) => [
        ...items,
        { enabled: true, side: unused, depth: 20 },
      ]);
  };
  const updateDefect = (index: number, patch: Partial<Defect>) =>
    setDefects((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  const removeDefect = (index: number) =>
    setDefects((items) => items.filter((_, itemIndex) => itemIndex !== index));
  const saveDrawing = async () => {
    if (!svgRef.current || saveState === "saving") return;
    setSaveState("saving");
    try {
      const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", "1200");
      clone.setAttribute("height", "1700");
      clone.style.transform = "none";
      const style = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "style",
      );
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
      canvas.height = 1700;
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
      const file = new File([blob], `postav-${diameter}mm.png`, {
        type: "image/png",
      });
      const phoneShare =
        window.matchMedia("(pointer: coarse)").matches &&
        window.innerWidth < 900 &&
        navigator.share &&
        navigator.canShare?.({ files: [file] });
      if (phoneShare)
        await navigator.share({
          files: [file],
          title: `Постав Ø${diameter} мм`,
        });
      else {
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
      if (error instanceof DOMException && error.name === "AbortError")
        setSaveState("idle");
      else {
        setSaveState("error");
        setTimeout(() => setSaveState("idle"), 2500);
      }
    }
  };

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className={`control-panel ${inputsOpen ? "open" : "collapsed"}`}>
          <div className="panel-heading">
            <span>Исходные данные</span>
            <div className="panel-heading-actions">
              <button className="reset-button" onClick={reset}>
                Сбросить всё
              </button>
              <button
                className="collapse-button"
                aria-label={
                  inputsOpen
                    ? "Скрыть исходные данные"
                    : "Показать исходные данные"
                }
                aria-expanded={inputsOpen}
                onClick={() => setInputsOpen((value) => !value)}
              >
                {inputsOpen ? "↑" : "↓"}
              </button>
            </div>
          </div>
          <div className="inputs-body">
            <section className="input-section equipment-section">
              <div className="section-title">
                <h3>Оборудование расчёта</h3>
                <p>Этот станок будет указан на производственной карте</p>
              </div>
              {equipment ? (
                <div className="active-equipment">
                  <label>
                    <span>Выбранный станок</span>
                    <select
                      value={equipment.id}
                      onChange={(event) => setEquipmentId(event.target.value)}
                    >
                      {equipmentList.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="active-equipment-summary">
                    {equipment.maxSaws} пил · пропил {format(equipment.kerf)} мм
                    · рабочий просвет Ø{equipment.maxDiameter} мм
                  </p>
                  <div className="active-equipment-actions">
                    <button onClick={() => setEditingEquipment(true)}>
                      Настроить
                    </button>
                    <button
                      className="equipment-plus"
                      aria-label="Добавить ещё оборудование"
                      onClick={addEquipment}
                    >
                      ＋
                    </button>
                  </div>
                </div>
              ) : (
                <button className="add-equipment-button" onClick={addEquipment}>
                  ＋ Добавить оборудование
                </button>
              )}
            </section>
            <section className="input-section log-section">
              <div className="section-title">
                <h3>Бревно</h3>
                <p>Размеры и состояние конкретного бревна</p>
              </div>
              <div className="field-grid">
                <NumberField
                  label="Диаметр рабочего торца, мм"
                  value={diameter}
                  onChange={setDiameter}
                />
                <NumberField
                  label="Готовая длина досок, мм"
                  value={length}
                  onChange={setLength}
                />
              </div>
              <p className="length-requirement">
                Для припуска +40 мм нужна длина бревна не менее <strong>{format(length + 40, 0)} мм</strong>
              </p>
              <div className="defect-panel">
                <label className="defect-toggle">
                  <input
                    type="checkbox"
                    checked={defects.length > 0}
                    onChange={(event) => toggleDefects(event.target.checked)}
                  />
                  <div>
                    <strong>Есть гниль или дефект</strong>
                    <span>Можно отметить несколько повреждённых сторон</span>
                  </div>
                </label>
                {defects.length > 0 && (
                  <div className="defects-list">
                    {defects.map((defect, index) => (
                      <div className="defect-row" key={index}>
                        <label>
                          <span>Сторона</span>
                          <select
                            value={defect.side}
                            onChange={(event) =>
                              updateDefect(index, {
                                side: event.target.value as Defect["side"],
                              })
                            }
                          >
                            <option value="right">Справа</option>
                            <option value="left">Слева</option>
                            <option value="top">Сверху</option>
                            <option value="bottom">Снизу</option>
                          </select>
                        </label>
                        <NumberField
                          label="Глубина, мм"
                          value={defect.depth}
                          onChange={(depth) => updateDefect(index, { depth })}
                        />
                        <button
                          aria-label={`Удалить дефект ${index + 1}`}
                          onClick={() => removeDefect(index)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {defects.length < 4 && (
                      <button className="add-defect-button" onClick={addDefect}>
                        ＋ Добавить повреждённую сторону
                      </button>
                    )}
                    <p className="defect-warning">
                      Без сканера каждая зона считается непрерывной по всей
                      длине.
                    </p>
                  </div>
                )}
              </div>
            </section>
            <section className="input-section boards-section">
              <div className="section-title">
                <h3>Сечения продукции</h3>
                <p>Размеры готовых досок, которые нужно получить</p>
              </div>
              {products.map((product) => (
                <div
                  className={`product-editor ${!product.enabled ? "disabled" : ""}`}
                  key={product.id}
                >
                  <div className="product-card-heading">
                    <label>
                      <input
                        type="checkbox"
                        checked={product.enabled}
                        onChange={(event) =>
                          updateProduct(product.id, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                      <strong>Включить в постав</strong>
                    </label>
                    <span>
                      {product.nominalThickness} × {product.nominalWidth} мм
                    </span>
                  </div>
                  <div className="field-pair-title">Готовое сечение</div>
                  <div className="mini-fields">
                    <NumberField
                      label="Толщина, мм"
                      value={product.nominalThickness}
                      onChange={(value) =>
                        updateProduct(product.id, {
                          nominalThickness: value,
                          cuttingThickness:
                            value +
                            Math.max(
                              0,
                              product.cuttingThickness -
                                product.nominalThickness,
                            ),
                        })
                      }
                    />
                    <NumberField
                      label="Ширина, мм"
                      value={product.nominalWidth}
                      onChange={(value) =>
                        updateProduct(product.id, {
                          nominalWidth: value,
                          cuttingWidth:
                            value +
                            Math.max(
                              0,
                              product.cuttingWidth - product.nominalWidth,
                            ),
                        })
                      }
                    />
                  </div>
                  <div className="field-pair-title">Заготовка с припуском</div>
                  <div className="mini-fields">
                    <NumberField
                      label="Толщина, мм"
                      value={product.cuttingThickness}
                      onChange={(value) =>
                        updateProduct(product.id, { cuttingThickness: value })
                      }
                    />
                    <NumberField
                      label="Ширина, мм"
                      value={product.cuttingWidth}
                      onChange={(value) =>
                        updateProduct(product.id, { cuttingWidth: value })
                      }
                    />
                  </div>
                  {variant && (
                    <span className="result-count">
                      На листе: {variant.counts[product.id] || 0} шт. — размеры
                      сразу меняют постав
                    </span>
                  )}
                </div>
              ))}
            </section>
          </div>
        </aside>
        <section className="drawing-panel">
          <div className="drawing-toolbar">
            <div>
              <h2>Чертёж распила</h2>
              <p className="drawing-context">
                {variant
                  ? `Бревно Ø${format(diameter, 0)} мм · выход ${variant.pieces.length} досок`
                  : "Появится после добавления оборудования"}
              </p>
            </div>
            {variant && (
              <>
                <div className="drawing-tabs">
                  <button
                    className={drawingMode === "final" ? "active" : ""}
                    onClick={() => setDrawingMode("final")}
                  >
                    Итог
                  </button>
                  <button
                    className={drawingMode === "first" ? "active" : ""}
                    onClick={() => setDrawingMode("first")}
                  >
                    1-й распил
                  </button>
                  <button
                    className={drawingMode === "second" ? "active" : ""}
                    onClick={() => setDrawingMode("second")}
                  >
                    2-й распил
                  </button>
                </div>
                <div className="toolbar-actions">
                  <button
                    aria-label="Уменьшить чертёж"
                    onClick={() =>
                      setZoom((value) => Math.max(0.5, value - 0.1))
                    }
                  >
                    −
                  </button>
                  <span>{Math.round(zoom * 100)}%</span>
                  <button
                    aria-label="Увеличить чертёж"
                    onClick={() => setZoom((value) => Math.min(2, value + 0.1))}
                  >
                    +
                  </button>
                  <button
                    className="download-button"
                    onClick={saveDrawing}
                    disabled={saveState === "saving"}
                  >
                    {saveState === "saving"
                      ? "Готовим…"
                      : saveState === "saved"
                        ? "✓ Сохранено"
                        : saveState === "error"
                          ? "Ошибка"
                          : "Сохранить в галерею"}
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="drawing-stage">
            {variant && equipment ? (
              <TechnicalDrawing
                diameter={Math.max(1, diameter)}
                length={length}
                variant={variant}
                products={products}
                mode={drawingMode}
                zoom={zoom}
                svgRef={svgRef}
                equipment={equipment}
                defects={defects}
                sawCoordinates={sawCoordinates}
              />
            ) : (
              <div className="drawing-empty">
                <span>＋</span>
                <h2>Начните с оборудования</h2>
                <p>
                  Добавьте реальный станок — после этого здесь появится чертёж
                  распила.
                </p>
                <button onClick={addEquipment}>Добавить оборудование</button>
              </div>
            )}
          </div>
          {variant && (
            <div className="drawing-caption">
              <span>
                <i className="legend center" /> Центральная продукция
              </span>
              <span>
                <i className="legend side" /> Боковая продукция
              </span>
              {defects.length > 0 && (
                <span>
                  <i className="legend defect" /> Исключённая зона
                </span>
              )}
              <strong>Оборудование указано на карте</strong>
            </div>
          )}
        </section>
      </section>
      {editingEquipment && equipment && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setEditingEquipment(false)}
        >
          <section
            className="equipment-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Профиль оборудования</p>
                <h2>{equipment.name}</h2>
              </div>
              <button onClick={() => setEditingEquipment(false)}>×</button>
            </div>
            <label className="wide-field">
              <span>Название</span>
              <input
                value={equipment.name}
                onChange={(event) =>
                  updateEquipment({ name: event.target.value })
                }
              />
            </label>
            <div className="modal-grid">
              <NumberField
                label="Максимум пил"
                value={equipment.maxSaws}
                onChange={(value) => updateEquipment({ maxSaws: value })}
              />
              <NumberField
                label="Пропил, мм"
                value={equipment.kerf}
                step={0.1}
                onChange={(value) => updateEquipment({ kerf: value })}
              />
              <NumberField
                label="Макс. диаметр, мм"
                value={equipment.maxDiameter}
                onChange={(value) => updateEquipment({ maxDiameter: value })}
              />
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={equipment.secondaryEdging}
                onChange={(event) =>
                  updateEquipment({ secondaryEdging: event.target.checked })
                }
              />
              <div>
                <strong>Есть вторичная обрезка</strong>
                <span>
                  Можно получать боковые доски из отделённых заготовок.
                </span>
              </div>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={equipment.multipleFeeds}
                onChange={(event) =>
                  updateEquipment({ multipleFeeds: event.target.checked })
                }
              />
              <div>
                <strong>Разрешены несколько подач</strong>
                <span>
                  Если пил недостаточно, операция разбивается на несколько
                  подач.
                </span>
              </div>
            </label>
            <div className="modal-actions spread">
              <button className="delete-button" onClick={deleteEquipment}>
                Удалить оборудование
              </button>
              <div>
                <button
                  className="quiet-button"
                  onClick={() => setEditingEquipment(false)}
                >
                  Отмена
                </button>
                <button
                  className="calculate-button compact"
                  onClick={saveEquipment}
                >
                  Сохранить
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
