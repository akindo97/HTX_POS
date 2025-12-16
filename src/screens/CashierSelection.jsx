import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

// Danh sách thu ngân fallback khi chưa có dữ liệu từ SQLite
const fallbackCashiers = [
  // { code: "linh", name: "Linh", role: "Trưởng ca", lastActive: "08:05", requirePin: true, pin: "1234" },
  // { code: "hoang", name: "Hoàng", role: "Thu ngân", lastActive: "08:10", requirePin: false },
  // { code: "an", name: "An", role: "Thu ngân", lastActive: "Đang nghỉ", requirePin: true, pin: "5678" },
  // { code: "vi", name: "Vi", role: "Thu ngân", lastActive: "Hôm qua", requirePin: false },
];

const normalizeCashierRecord = (record) => ({
  code: record.code ?? String(record.id ?? record.name ?? ""),
  name: record.name ?? "—",
  role: record.role ?? "Thu ngân",
  lastActive: record.lastActive ?? record.last_active ?? "—",
  requirePin: Boolean(record.requirePin ?? record.require_pin),
  pin: record.pin ?? "",
  isActive: record.isActive ?? record.is_active ?? true,
});

const CashierSelection = ({ onBack, onSelect }) => {
  const [cashiers, setCashiers] = useState([]);
  const [selectedCode, setSelectedCode] = useState(null);
  const [pinValue, setPinValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const activeCashier = cashiers.find((cashier) => cashier.code === selectedCode);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rows = await invoke("list_cashiers");
        console.log("Loaded cashiers from database:", rows);
        if (!mounted) return;
        if (Array.isArray(rows) && rows.length) {
          setCashiers(
            rows
              .map((row) => normalizeCashierRecord(row))
              .filter((cashier) => cashier.isActive !== false),
          );
        } else {
          setCashiers(fallbackCashiers);
        }
      } catch (error) {
        console.error("Không thể tải danh sách thu ngân:", error);
        setCashiers(fallbackCashiers);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (selectedCode && !cashiers.find((cashier) => cashier.code === selectedCode)) {
      setSelectedCode(null);
      setPinValue("");
    }
  }, [cashiers, selectedCode]);

  const canConfirm =
    !!activeCashier &&
    (!activeCashier.requirePin || pinValue === (activeCashier.pin ?? ""));

  const handleChoose = (cashier) => {
    if (!cashier.requirePin) {
      onSelect(cashier.name);
    } else {
      setSelectedCode(cashier.code);
      setPinValue("");
    }
  };

  const handleConfirm = () => {
    if (activeCashier && canConfirm) {
      onSelect(activeCashier.name);
    }
  };

  return (
    <div className="cashier-screen">
      <header className="cashier-header">
        <div>
          <p className="caption">Đổi ca nhanh</p>
          <h1>Chọn người tính tiền</h1>
          <p className="subtext">Bấm vào tài khoản · nhập PIN nếu cần · quay lại POS ngay.</p>
        </div>
        <button className="ghost-btn" onClick={onBack}>
          ← Quay lại POS
        </button>
      </header>

      {isLoading && <p className="subtext">Đang tải danh sách thu ngân...</p>}

      <div className="cashier-grid">
        {cashiers.length ? (
          cashiers.map((cashier) => (
            <button
              key={cashier.code}
              className={`cashier-card ${selectedCode === cashier.code ? "active" : ""}`}
              onClick={() => handleChoose(cashier)}
            >
              <div className="cashier-avatar">{cashier.name.charAt(0)}</div>
              <strong>{cashier.name}</strong>
              <span>{cashier.role}</span>
              <p>Đăng nhập gần nhất: {cashier.lastActive}</p>
              {cashier.requirePin && <small>Yêu cầu PIN</small>}
            </button>
          ))
        ) : (
          <div className="empty-state">Chưa có thu ngân nào. Vui lòng thêm trong cấu hình.</div>
        )}
      </div>

      {activeCashier && activeCashier.requirePin && (
        <div className="pin-panel">
          <h2>Nhập PIN cho {activeCashier.name}</h2>
          <input
            type="password"
            value={pinValue}
            onChange={(event) => setPinValue(event.target.value)}
            placeholder="Nhập PIN 4 số"
            maxLength={6}
          />
          <button className="primary-btn" onClick={handleConfirm} disabled={!canConfirm}>
            Xác nhận
          </button>
        </div>
      )}
    </div>
  );
};

export default CashierSelection;
