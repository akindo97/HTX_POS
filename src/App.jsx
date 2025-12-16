import { useState } from "react";
import "./App.css";
import POSScreen from "./screens/POSScreen";
import ProductManagement from "./screens/ProductManagement";
import InvoiceHistory from "./screens/InvoiceHistory";
import CashierSelection from "./screens/CashierSelection";
import RevenueReport from "./screens/RevenueReport";

function App() {
  // Theo dõi màn hình đang mở và thu ngân hiện tại
  const [activeScreen, setActiveScreen] = useState("pos");
  const [currentCashier, setCurrentCashier] = useState("Linh");

  return (
    <div className="app-shell">
      {activeScreen === "pos" && (
        <POSScreen
          currentCashier={currentCashier}
          onOpenSettings={() => setActiveScreen("product")}
          onOpenHistory={() => setActiveScreen("history")}
          onSwitchCashier={() => setActiveScreen("cashier")}
          onOpenReport={() => setActiveScreen("report")}
        />
      )}
      {activeScreen === "product" && <ProductManagement onBack={() => setActiveScreen("pos")} />}
      {activeScreen === "history" && <InvoiceHistory onBack={() => setActiveScreen("pos")} />}
      {activeScreen === "cashier" && (
        <CashierSelection
          onBack={() => setActiveScreen("pos")}
          onSelect={(cashier) => {
            setCurrentCashier(cashier);
            setActiveScreen("pos");
          }}
        />
      )}
      {activeScreen === "report" && <RevenueReport onBack={() => setActiveScreen("pos")} />}
    </div>
  );
}

export default App;
