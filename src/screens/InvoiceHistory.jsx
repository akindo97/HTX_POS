import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import ReceiptPrinter from "../components/ReceiptPrinter";

const formatCurrency = (value) => `${Number(value || 0).toLocaleString("vi-VN")}đ`;
const formatQuantity = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) return "0";
  if (Math.abs(numeric - Math.round(numeric)) < 1e-6) {
    return String(Math.round(numeric));
  }
  return numeric
    .toFixed(3)
    .replace(/\.0+$/, "")
    .replace(/\.$/, "");
};
const extractDatePart = (value) => (value ? value.slice(0, 10) : "");
const extractTimePart = (value) => {
  if (!value) return "";
  const [, time = ""] = value.split(" ");
  return time.slice(0, 5);
};
const formatFullTimestamp = (value) => {
  if (!value) return "";
  const [date, time] = value.split(" ");
  if (!date) return value;
  return `${date} ${time?.slice(0, 5) ?? ""}`.trim();
};
const STORE_PROFILE = {
  name: "HTX POS Cafe",
  address: "123 Đường POS, Q.1, TP.HCM",
  phone: "0123 456 789",
  footer: "Cảm ơn quý khách và hẹn gặp lại!",
};
const DEFAULT_PAPER_WIDTH = "58mm";

const InvoiceHistory = ({ onBack }) => {
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [invoices, setInvoices] = useState([]);
  const [activeInvoice, setActiveInvoice] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingPrint, setPendingPrint] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rows = await invoke("list_payments");
        if (!mounted) return;
        if (Array.isArray(rows)) {
          setInvoices(rows);
          setActiveInvoice((current) => {
            if (!rows.length) return null;
            if (current) {
              const existing = rows.find((invoice) => invoice.id === current.id);
              if (existing) return existing;
            }
            return rows[0];
          });
        } else {
          setInvoices([]);
          setActiveInvoice(null);
        }
      } catch (error) {
        console.error("Không thể tải lịch sử hoá đơn:", error);
        setInvoices([]);
        setActiveInvoice(null);
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

  const filteredInvoices = useMemo(() => {
    if (!selectedDate) return invoices;
    return invoices.filter((invoice) => extractDatePart(invoice.createdAt) === selectedDate);
  }, [invoices, selectedDate]);

  useEffect(() => {
    setActiveInvoice((current) => {
      if (!filteredInvoices.length) {
        return null;
      }
      if (current) {
        const existing = filteredInvoices.find((invoice) => invoice.id === current.id);
        if (existing) return existing;
      }
      return filteredInvoices[0];
    });
  }, [filteredInvoices]);

  const handleReprint = () => {
    if (!activeInvoice) return;
    setPendingPrint({
      ...activeInvoice,
      paperWidth: DEFAULT_PAPER_WIDTH,
      store: STORE_PROFILE,
      note: activeInvoice.note ?? null,
      discount: activeInvoice.discount ?? 0,
      tax: activeInvoice.tax ?? 0,
      subtotal: activeInvoice.subtotal ?? 0,
      total: activeInvoice.total ?? 0,
      paidCash: activeInvoice.paidCash ?? activeInvoice.total ?? 0,
      changeDue: activeInvoice.changeDue ?? 0,
    });
  };

  return (
    <>
      <ReceiptPrinter data={pendingPrint} onAfterPrint={() => setPendingPrint(null)} />
      <div className="history-screen">
      <header className="history-header">
        <div>
          <p className="caption"></p>
          <div style={{fontSize: 26, fontWeight: "bold"}}>Lịch sử hoá đơn (Tra cứu & in lại)</div>
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={onBack}>
            ← Quay lại POS
          </button>
        </div>
      </header>

      <div className="history-toolbar">
        <label>
          Chọn ngày
          <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        </label>
      </div>

      <div className="history-content">
        <section className="invoice-list">
          <h2>Hoá đơn trong ngày</h2>
          <div className="invoice-scroll">
            {isLoading ? (
              <p className="empty-state">Đang tải dữ liệu...</p>
            ) : filteredInvoices.length ? (
              filteredInvoices.map((invoice) => (
                <button
                  key={invoice.id}
                  className={`invoice-row ${activeInvoice?.id === invoice.id ? "active" : ""}`}
                  onClick={() => setActiveInvoice(invoice)}
                >
                  <div>
                    <strong>{invoice.invoiceNumber}</strong>
                    <p>{extractTimePart(invoice.createdAt)}</p>
                  </div>
                  <div className="invoice-meta">
                    <span>{invoice.cashierName}</span>
                    <strong>{formatCurrency(invoice.total)}</strong>
                  </div>
                </button>
              ))
            ) : (
              <p className="empty-state">Không có hoá đơn nào trong ngày.</p>
            )}
          </div>
        </section>

        <section className="invoice-detail">
          <h2>Chi tiết hoá đơn</h2>
          {activeInvoice ? (
            <div className="detail-card">
              <div className="detail-row">
                <span>Số hoá đơn</span>
                <strong>{activeInvoice.invoiceNumber}</strong>
              </div>
              <div className="detail-row">
                <span>Thời gian</span>
                <strong>{formatFullTimestamp(activeInvoice.createdAt)}</strong>
              </div>
              <div className="detail-row">
                <span>Thu ngân</span>
                <strong>{activeInvoice.cashierName}</strong>
              </div>
              <div className="detail-items">
                <p>Sản phẩm</p>
                <ul>
                  {activeInvoice.items.map((item) => {
                    const quantityValue =
                      Number(item.quantityDecimal ?? item.quantity ?? 0) || 0;
                    const effectiveUnitPrice =
                      Number(
                        item.effectiveUnitPrice ??
                          item.price ??
                          item.editedUnitPrice ??
                          item.baseUnitPrice ??
                          0,
                      ) || 0;
                    const lineSubtotal =
                      Number(item.lineSubtotal ?? Math.round(quantityValue * effectiveUnitPrice)) || 0;
                    const lineDiscount = Number(item.lineDiscount ?? item.discount ?? 0) || 0;
                    const finalLineTotal = Math.max(0, lineSubtotal - lineDiscount);
                    const hasEditedPrice = item.editedUnitPrice != null;
                    return (
                      <li key={item.id ?? `${item.name}-${quantityValue}`}>
                        <div className="detail-item-info">
                          <span>{item.name}</span>
                          <small>
                            {formatQuantity(quantityValue)} × {formatCurrency(effectiveUnitPrice)}
                          </small>
                          {hasEditedPrice && (
                            <small>Giá gốc: {formatCurrency(item.baseUnitPrice ?? effectiveUnitPrice)}</small>
                          )}
                          {lineDiscount > 0 && <small>Giảm: -{formatCurrency(lineDiscount)}</small>}
                        </div>
                        <strong>{formatCurrency(finalLineTotal)}</strong>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="detail-row">
                <span>Tạm tính</span>
                <strong>{formatCurrency(activeInvoice.subtotal)}</strong>
              </div>
              <div className="detail-row">
                <span>Thuế</span>
                <strong>{formatCurrency(activeInvoice.tax)}</strong>
              </div>
              <div className="detail-row">
                <span>Giảm giá</span>
                <strong>-{formatCurrency(activeInvoice.discount)}</strong>
              </div>
              <div className="detail-row">
                <span>Tiền khách đưa</span>
                <strong>{formatCurrency(activeInvoice.paidCash)}</strong>
              </div>
              <div className="detail-row">
                <span>Tiền thừa</span>
                <strong>{formatCurrency(activeInvoice.changeDue)}</strong>
              </div>
              {activeInvoice.note && (
                <div className="detail-row">
                  <span>Ghi chú</span>
                  <strong>{activeInvoice.note}</strong>
                </div>
              )}
              <div className="detail-row total">
                <span>Tổng</span>
                <strong>{formatCurrency(activeInvoice.total)}</strong>
              </div>
              <button className="primary-btn" onClick={handleReprint}>
                In lại hoá đơn
              </button>
            </div>
          ) : (
            <p className="empty-state">Chọn một hoá đơn để xem chi tiết.</p>
          )}
        </section>
      </div>
    </div>
  </>
  );
};

export default InvoiceHistory;
