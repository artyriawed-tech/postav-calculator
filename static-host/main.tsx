import React from "react";
import { createRoot } from "react-dom/client";
import { CalculatorApp } from "../app/calculator-app";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) throw new Error("Не найден контейнер приложения");

createRoot(root).render(
  <React.StrictMode>
    <CalculatorApp />
  </React.StrictMode>,
);
