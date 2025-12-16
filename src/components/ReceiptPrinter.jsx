import { useEffect } from "react";
import { createPortal } from "react-dom";

const formatCurrency = (value) => {
  const number = Number(value) || 0;
  return `${number.toLocaleString("vi-VN")}đ`;
};

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

const ReceiptPrinter = ({ data, onAfterPrint }) => {
  useEffect(() => {
    if (!data || typeof window === "undefined") return undefined;
    const printTimeout = setTimeout(() => {
      window.print();
    }, 120);
    const handleAfterPrint = () => {
      onAfterPrint?.();
    };
    window.addEventListener("afterprint", handleAfterPrint);
    return () => {
      clearTimeout(printTimeout);
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, [data, onAfterPrint]);

  if (!data || typeof document === "undefined") return null;

  const target = document.body;
  const store = data.store ?? {};
  const paperWidth = data.paperWidth ?? "58mm";
  const invoiceNumber = data.invoiceNumber ?? "N/A";
  const createdAt = data.createdAt
    ? new Date(data.createdAt).toLocaleString("vi-VN")
    : new Date().toLocaleString("vi-VN");
  const cashierName = data.cashierName ?? "—";
  const items = Array.isArray(data.items) ? data.items : [];
  const subtotal = data.subtotal ?? 0;
  const discount = data.discount ?? 0;
  const total = data.total ?? subtotal - discount;
  const paidCash = data.paidCash ?? total;
  const changeDue = data.changeDue ?? Math.max(paidCash - total, 0);
  const tax = data.tax ?? 0;
  const footerText = store.footer ?? "Cảm ơn quý khách!";

  const styleContent = `
    @page {
      size: ${paperWidth} auto;
      margin: 0;
    }
    @media print {
      body {
        margin: 0;
      }
      body * {
        visibility: hidden !important;
      }
      .receipt-print-root,
      .receipt-print-root * {
        visibility: visible !important;
      }
      .receipt-print-root {
        position: absolute;
        inset: 0;
        margin: 0;
      }
    }
    .receipt-print-root {
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 9999;
    }
    .receipt-wrapper {
      width: ${paperWidth};
      max-width: ${paperWidth};
      margin: 0 auto;
      padding: 8px 6px;
      font-family: "Fira Code", "Courier New", Consolas, monospace;
      font-size: 12px;
      line-height: 1.4;
      color: #000;
      box-sizing: border-box;
    }
    .receipt-header {
      text-align: center;
    }
    .receipt-title {
      font-size: 14px;
      font-weight: 700;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .receipt-subtitle {
      font-size: 11px;
      margin: 0;
    }
    .receipt-divider {
      margin: 8px 0;
      border-top: 1px dashed #000;
    }
    .receipt-meta {
      font-size: 11px;
      margin-bottom: 4px;
    }
    .receipt-items {
      margin: 6px 0;
    }
    .receipt-item {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      margin-bottom: 6px;
    }
    .receipt-item-info {
      flex: 1;
      min-width: 0;
    }
    .receipt-item-name {
      font-weight: 600;
      word-break: break-word;
    }
    .receipt-item-meta {
      font-size: 11px;
      color: #555;
    }
    .receipt-item-total {
      min-width: 60px;
      text-align: right;
      font-weight: 600;
    }
    .receipt-totals-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin: 2px 0;
    }
    .receipt-total-strong {
      font-size: 17px;
      font-weight: 700;
    }
    .receipt-footer {
      text-align: center;
      margin-top: 10px;
      font-size: 11px;
    }
  `;

  return createPortal(
    <div className="receipt-print-root">
      <style>{styleContent}</style>
      <div className="receipt-wrapper">
        <div className="receipt-header">
          <div className="receipt-title">{store.name ?? "HTX POS"}</div>
          {store.address && <p className="receipt-subtitle">{store.address}</p>}
          {store.phone && <p className="receipt-subtitle">☎ {store.phone}</p>}
        </div>
        <div className="receipt-divider" />
        <div className="receipt-meta">Số hoá đơn: {invoiceNumber}</div>
        <div className="receipt-meta">Ngày giờ: {createdAt}</div>
        <div className="receipt-meta">Thu ngân: {cashierName}</div>
        <div className="receipt-divider" />
        <div className="receipt-items">
          {items.map((item) => {
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
            const baseUnitPrice =
              Number(item.baseUnitPrice ?? effectiveUnitPrice) || 0;
            const lineSubtotal =
              Number(item.lineSubtotal ?? Math.round(quantityValue * effectiveUnitPrice)) || 0;
            const lineDiscount = Number(item.lineDiscount ?? item.discount ?? 0) || 0;
            const finalLineTotal = Math.max(0, lineSubtotal - lineDiscount);
            const hasEditedPrice = item.editedUnitPrice != null;
            return (
              <div className="receipt-item" key={`${item.id}-${item.name}`}>
                <div className="receipt-item-info">
                  <div className="receipt-item-name">{item.name}</div>
                  <div className="receipt-item-meta">
                    {formatQuantity(quantityValue)} × {formatCurrency(effectiveUnitPrice)}
                  </div>
                  {hasEditedPrice && (
                    <div className="receipt-item-meta">
                      Giá gốc: {formatCurrency(baseUnitPrice)}
                    </div>
                  )}
                  {lineDiscount > 0 && (
                    <div className="receipt-item-meta">Giảm: -{formatCurrency(lineDiscount)}</div>
                  )}
                </div>
                <div className="receipt-item-total">{formatCurrency(finalLineTotal)}</div>
              </div>
            );
          })}
        </div>
        <div className="receipt-divider" />
        <div className="receipt-totals-row">
          <span>Tạm tính</span>
          <strong>{formatCurrency(subtotal)}</strong>
        </div>
        <div className="receipt-totals-row">
          <span>Thuế</span>
          <strong>{formatCurrency(tax)}</strong>
        </div>
        <div className="receipt-totals-row">
          <span>Giảm giá</span>
          <strong>-{formatCurrency(discount)}</strong>
        </div>
        <div className="receipt-totals-row">
          <span className="receipt-total-strong">Tổng</span>
          <span className="receipt-total-strong">{formatCurrency(total)}</span>
        </div>
        <div className="receipt-totals-row">
          <span>Tiền khách đưa</span>
          <strong>{formatCurrency(paidCash)}</strong>
        </div>
        <div className="receipt-totals-row">
          <span>Tiền thừa</span>
          <strong>{formatCurrency(changeDue)}</strong>
        </div>
        <div className="receipt-divider" />
        {data.note && (
          <div style={{ fontSize: "11px", marginBottom: "6px", whiteSpace: "pre-wrap" }}>
            Ghi chú: {data.note}
          </div>
        )}
        <div className="receipt-footer">{footerText}</div>
      </div>
    </div>,
    target,
  );
};

export default ReceiptPrinter;
