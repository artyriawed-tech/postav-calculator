import { CalculatorApp } from "./calculator-app.tsx";

export const metadata = {
  title: "Постав — калькулятор раскроя бревна",
  description: "Инженерный расчёт раскроя бревна и схема установки пил.",
};

export default function Home() {
  return <CalculatorApp />;
}
