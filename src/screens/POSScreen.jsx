import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReceiptPrinter from "../components/ReceiptPrinter";

const MONEY_ROUNDING_MODE = "floor"; // chuyển thành "round" nếu cần làm tròn gần nhất
const MAX_EDITABLE_PRICE = 9_999_999;
const QTY_DECIMAL_PRECISION = 3;
const DECIMAL_STEP = 0.001;
const PRECISION_FACTOR = 10 ** QTY_DECIMAL_PRECISION;
const DEFAULT_ALLOW_DECIMAL_QTY = true;

const formatCurrency = (value) => `${Number(value || 0).toLocaleString("vi-VN")}đ`;

const sanitizeIntegerInput = (value) => value.replace(/\D/g, "");

const sanitizeQtyInput = (value, allowDecimal) => {
  if (!allowDecimal) {
    return value.replace(/\D/g, "");
  }
  let sanitized = value.replace(/[^0-9.]/g, "");
  const segments = sanitized.split(".");
  if (segments.length > 2) {
    const [head, ...rest] = segments;
    sanitized = `${head}.${rest.join("")}`;
  }
  const [integerPart = "", decimalPart = ""] = sanitized.split(".");
  const limitedDecimal = decimalPart.slice(0, QTY_DECIMAL_PRECISION);
  if (integerPart === "" && limitedDecimal) {
    return `.${limitedDecimal}`;
  }
  return limitedDecimal ? `${integerPart}.${limitedDecimal}` : integerPart;
};

const formatQtyValue = (value, allowDecimal) => {
  if (!Number.isFinite(value) || Number.isNaN(value)) return "";
  if (!allowDecimal) {
    return String(Math.max(1, Math.round(value)));
  }
  const normalized = Math.round(value * PRECISION_FACTOR) / PRECISION_FACTOR;
  return normalized
    .toFixed(QTY_DECIMAL_PRECISION)
    .replace(/\.0+$/, "")
    .replace(/\.$/, "");
};

const validateQtyInput = (value, allowDecimal) => {
  if (value == null || value === "") {
    return { value: 0, error: "Số lượng phải > 0" };
  }
  const normalized = value === "." ? "0" : value;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    return { value: 0, error: "Số lượng không hợp lệ" };
  }
  if (numeric <= 0) {
    return { value: 0, error: "Số lượng phải > 0" };
  }
  if (!allowDecimal && !Number.isInteger(numeric)) {
    return { value: 0, error: "Chỉ nhập số nguyên" };
  }
  const fraction = value.split(".")[1];
  if (allowDecimal && fraction && fraction.length > QTY_DECIMAL_PRECISION) {
    return { value: 0, error: `Tối đa ${QTY_DECIMAL_PRECISION} chữ số thập phân` };
  }
  const rounded = Math.round(numeric * PRECISION_FACTOR) / PRECISION_FACTOR;
  return { value: rounded, error: null };
};

const validateUnitPriceInput = (value) => {
  if (value === "" || value == null) {
    return { value: null, error: null };
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || Number.isNaN(numeric)) {
    return { value: null, error: "Giá phải là số" };
  }
  if (numeric < 0) {
    return { value: null, error: "Giá không hợp lệ" };
  }
  if (numeric > MAX_EDITABLE_PRICE) {
    return { value: null, error: `Tối đa ${MAX_EDITABLE_PRICE.toLocaleString("vi-VN")}` };
  }
  return { value: numeric, error: null };
};

const roundMoney = (value) => {
  const safe = Number.isFinite(value) ? value : 0;
  if (MONEY_ROUNDING_MODE === "round") {
    return Math.max(0, Math.round(safe));
  }
  return Math.max(0, Math.floor(safe));
};

const calculateLineSubtotal = (unitPrice, qty) => {
  const safePrice = Number(unitPrice) || 0;
  const scaledQty = Math.round((Number(qty) || 0) * PRECISION_FACTOR);
  const raw = (safePrice * scaledQty) / PRECISION_FACTOR;
  return roundMoney(raw);
};

const getEffectiveUnitPrice = (item) =>
  item.editedUnitPrice != null ? item.editedUnitPrice : item.baseUnitPrice;

const formatUnitLabel = (allowDecimalQty) => (allowDecimalQty ? "/ kg" : "/ món");

const buildCartItem = (product, { initialQty, initialEditedPrice } = {}) => {
  const allowDecimalSetting = product.allowDecimalQty ?? product.allow_decimal_qty;
  const allowDecimalQty =
    allowDecimalSetting == null
      ? DEFAULT_ALLOW_DECIMAL_QTY
      : Boolean(allowDecimalSetting);
  const baseUnitPrice = Number(
    product.baseUnitPrice ?? product.price ?? product.unitPrice ?? 0,
  ) || 0;
  const qtyValue =
    typeof initialQty === "number"
      ? initialQty
      : typeof product.qty === "number"
        ? product.qty
        : 1;
  const normalizedQty = allowDecimalQty
    ? Math.max(DECIMAL_STEP, Math.round(qtyValue * PRECISION_FACTOR) / PRECISION_FACTOR)
    : Math.max(1, Math.round(qtyValue));
  const editedUnitPrice =
    typeof initialEditedPrice === "number"
      ? initialEditedPrice
      : typeof product.editedUnitPrice === "number"
        ? product.editedUnitPrice
        : null;
  const displayPrice = editedUnitPrice != null ? editedUnitPrice : baseUnitPrice;
  return {
    id: product.id,
    name: product.name,
    allowDecimalQty,
    baseUnitPrice,
    editedUnitPrice,
    unitPriceInput: String(displayPrice),
    qty: normalizedQty,
    qtyInput: formatQtyValue(normalizedQty, allowDecimalQty),
    qtyError: null,
    unitPriceError: null,
  };
};

const normalizeQtyWithStep = (qty, allowDecimal) => {
  if (allowDecimal) {
    const min = DECIMAL_STEP;
    const safe = Math.max(min, qty);
    return Math.round(safe * PRECISION_FACTOR) / PRECISION_FACTOR;
  }
  return Math.max(1, Math.round(qty));
};

const formatQtyDisplay = (value, allowDecimal) => formatQtyValue(value, allowDecimal);

const computeQtyAfterDelta = (item, deltaSteps) => {
  const step = item.allowDecimalQty ? DECIMAL_STEP : 1;
  const raw = item.qty + deltaSteps * step;
  if (raw <= 0) {
    return null;
  }
  return normalizeQtyWithStep(raw, item.allowDecimalQty);
};

const generateInvoiceNumber = () => {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.floor(Math.random() * 900) + 100;
  return `HD${timestamp}${random}`;
};

const STORE_PROFILE = {
  name: "HTX DIỄN QUẢNG",
  address: "123 Đường POS, Q.1, TP.HCM",
  phone: "0123 456 789",
  footer: "Cảm ơn quý khách và hẹn gặp lại!",
};
const DEFAULT_PAPER_WIDTH = "58mm";

const POSScreen = ({ currentCashier, onOpenSettings, onOpenHistory, onOpenReport, onSwitchCashier }) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [products, setProducts] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [note, setNote] = useState("");
  const searchRef = useRef(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [cashGiven, setCashGiven] = useState("");
  const cashInputRef = useRef(null);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [pendingReceipt, setPendingReceipt] = useState(null);
  const handleReceiptPrinted = useCallback(() => {
    setPendingReceipt(null);
  }, []);

  // Focus ô tìm kiếm khi tải POS
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Nạp sản phẩm từ SQLite thông qua Tauri
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rows = await invoke("list_products");
        if (!mounted) return;
        if (Array.isArray(rows) && rows.length) {
          setProducts(
            rows.map((row) => ({
              ...row,
              price: Number(row.price),
            })),
          );
        }
      } catch (error) {
        console.error("Không thể tải sản phẩm từ SQLite:", error);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const visibleProducts = useMemo(
    () => products.filter((item) => item.visible !== false && item.quick_display !== false),
    [products],
  );

  // Lọc sản phẩm theo từ khoá nhập nhanh
  const filteredProducts = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    if (!keyword) return visibleProducts;
    return visibleProducts.filter((product) => product.name.toLowerCase().includes(keyword));
  }, [searchTerm, visibleProducts]);

  const addProduct = (product) => {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        const nextQty = computeQtyAfterDelta(existing, 1) ?? existing.qty;
        return prev.map((item) =>
          item.id === product.id
            ? {
              ...item,
              qty: nextQty,
              qtyInput: formatQtyValue(nextQty, item.allowDecimalQty),
              qtyError: null,
            }
            : item,
        );
      }
      return [...prev, buildCartItem(product)];
    });
  };

  const updateQuantity = (productId, deltaSteps) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.id !== productId) return item;
          const nextQty = computeQtyAfterDelta(item, deltaSteps);
          if (nextQty == null) {
            return null;
          }
          return {
            ...item,
            qty: nextQty,
            qtyInput: formatQtyValue(nextQty, item.allowDecimalQty),
            qtyError: null,
          };
        })
        .filter(Boolean),
    );
  };

  const removeLine = (productId) => {
    setCartItems((prev) => prev.filter((item) => item.id !== productId));
  };

  // Tính toán tổng tiền giỏ hàng (không áp dụng thuế)
  const cartSubtotal = useMemo(
    () =>
      cartItems.reduce((sum, item) => {
        const unitPrice = getEffectiveUnitPrice(item);
        return sum + calculateLineSubtotal(unitPrice, item.qty);
      }, 0),
    [cartItems],
  );
  const tax = 0;
  const total = cartSubtotal;
  const cartHasErrors = useMemo(
    () => cartItems.some((item) => item.qtyError || item.unitPriceError),
    [cartItems],
  );
  const parsedCashGiven = Number(cashGiven) || 0;
  const changeDue = Math.max(parsedCashGiven - total, 0);
  const outstandingDebt = Math.max(total - parsedCashGiven, 0);
  const canConfirmPayment = total > 0 && parsedCashGiven >= total && !cartHasErrors;
  const canSubmitDebtPayment = total > 0 && !cartHasErrors && outstandingDebt > 0;

  // Modal thanh toán
  const openPaymentModal = useCallback(() => {
    if (!cartItems.length || cartHasErrors) return;
    setShowPaymentModal(true);
    setTimeout(() => cashInputRef.current?.focus(), 0);
  }, [cartItems.length, cartHasErrors]);

  const closePaymentModal = useCallback(() => {
    setShowPaymentModal(false);
    setCashGiven("");
  }, []);

  const finalizePayment = useCallback(
    async ({ allowDebt = false } = {}) => {
      if (isSavingPayment || cartHasErrors) return;
      if (!cartItems.length || total <= 0) return;
      const shortfall = Math.max(total - parsedCashGiven, 0);
      if (!allowDebt && shortfall > 0) return;
      if (allowDebt && shortfall <= 0) return;
      const noteValue = note.trim();
      const items = cartItems.map((item) => {
        const effectiveUnitPrice = getEffectiveUnitPrice(item);
        const lineSubtotal = calculateLineSubtotal(effectiveUnitPrice, item.qty);
        return {
          productId: typeof item.id === "number" ? item.id : null,
          name: item.name,
          quantity: item.qty,
          baseUnitPrice: item.baseUnitPrice,
          editedUnitPrice: item.editedUnitPrice,
          effectiveUnitPrice,
          lineSubtotal,
          price: effectiveUnitPrice,
          lineDiscount: 0,
        };
      });
      if (!items.length) return;
      const payload = {
        invoiceNumber: generateInvoiceNumber(),
        cashierName: currentCashier,
        subtotal: cartSubtotal,
        tax,
        total,
        discount: 0,
        paidCash: parsedCashGiven,
        changeDue,
        debtAmount: allowDebt ? shortfall : 0,
        note: noteValue ? noteValue : null,
        items,
      };
      setIsSavingPayment(true);
      try {
        const savedPayment = await invoke("create_payment", { payload });
        setPendingReceipt({
          ...savedPayment,
          note: savedPayment.note ?? payload.note,
          debtAmount: savedPayment.debtAmount ?? payload.debtAmount ?? 0,
          paperWidth: DEFAULT_PAPER_WIDTH,
          store: STORE_PROFILE,
        });
        setCartItems([]);
        setNote("");
        closePaymentModal();
      } catch (error) {
        console.error("Không thể lưu hoá đơn:", error);
      } finally {
        setIsSavingPayment(false);
      }
    },
    [
      isSavingPayment,
      cartHasErrors,
      cartItems,
      total,
      parsedCashGiven,
      note,
      currentCashier,
      cartSubtotal,
      tax,
      changeDue,
      closePaymentModal,
    ],
  );

  const confirmPayment = useCallback(() => {
    finalizePayment();
  }, [finalizePayment]);

  const confirmDebtPayment = useCallback(() => {
    finalizePayment({ allowDebt: true });
  }, [finalizePayment]);

  useEffect(() => {
    if (!showPaymentModal) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePaymentModal();
      }
      if (event.key === "Enter") {
        event.preventDefault();
        confirmPayment();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    cashInputRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showPaymentModal, closePaymentModal, confirmPayment]);

  const handleUnitPriceInputChange = (productId, rawValue) => {
    const sanitized = sanitizeIntegerInput(rawValue);
    setCartItems((prev) =>
      prev.map((item) =>
        item.id === productId
          ? {
            ...item,
            unitPriceInput: sanitized,
            unitPriceError: null,
          }
          : item,
      ),
    );
  };

  const commitUnitPriceInput = (productId) => {
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.id !== productId) return item;
        const { value, error } = validateUnitPriceInput(item.unitPriceInput);
        if (error) {
          return { ...item, unitPriceError: error };
        }
        if (value == null || value === item.baseUnitPrice) {
          return {
            ...item,
            editedUnitPrice: null,
            unitPriceInput: String(item.baseUnitPrice),
            unitPriceError: null,
          };
        }
        return {
          ...item,
          editedUnitPrice: value,
          unitPriceInput: String(value),
          unitPriceError: null,
        };
      }),
    );
  };

  const resetUnitPriceInput = (productId) => {
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.id !== productId) return item;
        const display = item.editedUnitPrice ?? item.baseUnitPrice;
        return {
          ...item,
          unitPriceInput: String(display),
          unitPriceError: null,
        };
      }),
    );
  };

  const handleUnitPriceKeyDown = (event, productId) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitUnitPriceInput(productId);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      resetUnitPriceInput(productId);
    }
  };

  const handleQtyInputChange = (productId, rawValue) => {
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.id !== productId) return item;
        const sanitized = sanitizeQtyInput(rawValue, item.allowDecimalQty);
        return {
          ...item,
          qtyInput: sanitized,
          qtyError: null,
        };
      }),
    );
  };

  const commitQtyInput = (productId) => {
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.id !== productId) return item;
        const { value, error } = validateQtyInput(item.qtyInput, item.allowDecimalQty);
        if (error) {
          return { ...item, qtyError: error };
        }
        return {
          ...item,
          qty: value,
          qtyInput: formatQtyValue(value, item.allowDecimalQty),
          qtyError: null,
        };
      }),
    );
  };

  const handleQtyKeyDown = (event, productId) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitQtyInput(productId);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setCartItems((prev) =>
        prev.map((item) =>
          item.id === productId
            ? {
              ...item,
              qtyInput: formatQtyValue(item.qty, item.allowDecimalQty),
              qtyError: null,
            }
            : item,
        ),
      );
    }
  };

  const handleCashInputChange = (event) => {
    const numeric = event.target.value.replace(/\D/g, "");
    setCashGiven(numeric);
  };

  // Nút cộng nhanh các mệnh giá hay dùng
  const handleQuickAdd = (amount) => {
    setCashGiven((prev) => {
      const numeric = Number(prev) || 0;
      return String(numeric + amount);
    });
  };

  // Xử lý keypad ảo ngay trên màn hình
  const handleKeypadInput = (value) => {
    if (value === "clear") {
      setCashGiven("");
      return;
    }
    if (value === "backspace") {
      setCashGiven((prev) => prev.slice(0, -1));
      return;
    }
    setCashGiven((prev) => {
      const next = `${prev}${value}`;
      return next.replace(/^0+(?!$)/, "");
    });
  };

  const keypadButtons = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

  return (
    <>
      <ReceiptPrinter data={pendingReceipt} onAfterPrint={handleReceiptPrinted} />
      <div className="pos-layout">
        <section className="pos-products">
          <header className="pos-topbar">
            <div>
              <h1>HTX DIỄN QUẢNG</h1>
              <p>Thu ngân hiện tại: {currentCashier}</p>
            </div>
            <div className="pos-topbar-actions">
              <button className="ghost-btn" type="button" onClick={onSwitchCashier}>
                👤 Đổi thu ngân
              </button>
              <button className="ghost-btn" type="button" onClick={onOpenHistory}>
                🧾 Lịch sử hoá đơn
              </button>
              <button className="ghost-btn" type="button" onClick={onOpenReport}>
                📊 Báo cáo ngày
              </button>
              <button className="ghost-btn" type="button" onClick={onOpenSettings}>
                ⚙ Cài đặt sản phẩm
              </button>
            </div>
          </header>
          <div className="pos-search">
            <input
              ref={searchRef}
              type="text"
              placeholder="Tìm kiếm hoặc quét barcode..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            <button className="ghost-btn" onClick={() => setSearchTerm("")}>
              Xoá
            </button>
          </div>
          <div className="pos-grid">
            {filteredProducts.map((product) => (
              <button
                key={product.id}
                className="pos-product-card"
                onClick={() => addProduct(product)}
              >
                <span className="pos-product-name">{product.name}</span>
                <strong>{formatCurrency(product.price)}</strong>
                <p>Chạm để thêm nhanh</p>
              </button>
            ))}
            {!filteredProducts.length && (
              <div className="empty-state">Không tìm thấy sản phẩm phù hợp.</div>
            )}
          </div>
        </section>

        <section className="pos-cart">
          <div className="cart-header">
            <div>
              <div style={{ fontSize: '22px', fontWeight: '600' }}>Giỏ hàng</div>
              <p>{cartItems.length} dòng sản phẩm</p>
            </div>
            <div className="cart-header-actions">
              <button className="ghost-btn" type="button" onClick={onOpenHistory}>
                🧾 Lịch sử
              </button>
              <button className="ghost-btn" type="button" onClick={() => setCartItems([])}>
                Làm mới
              </button>
            </div>
          </div>
          <div className="cart-content">
            <div className="cart-lines">
              {cartItems.map((item) => {
                const unitLabel = formatUnitLabel(item.allowDecimalQty);
                const effectiveUnitPrice = getEffectiveUnitPrice(item);
                const lineSubtotal = calculateLineSubtotal(effectiveUnitPrice, item.qty);
                const formattedQty = formatQtyDisplay(item.qty, item.allowDecimalQty);
                return (
                  <div
                    key={item.id}
                    className={`cart-line ${item.qtyError || item.unitPriceError ? "has-error" : ""}`}
                  >
                    <div className="cart-line-head">
                      <div>
                        <div className="cart-line-title">
                          <strong>{item.name}</strong>
                          {item.editedUnitPrice != null && <span className="price-badge">Giá sửa</span>}
                        </div>
                        <p className="cart-line-meta">
                          {item.editedUnitPrice != null ? (
                            <>
                              <span className="meta-current">
                                {formatCurrency(effectiveUnitPrice)} {unitLabel}
                              </span>
                              <span className="meta-original">
                                Giá gốc: {formatCurrency(item.baseUnitPrice)} {unitLabel}
                              </span>
                            </>
                          ) : (
                            <span className="meta-original">
                              Giá gốc: {formatCurrency(item.baseUnitPrice)} {unitLabel}
                            </span>
                          )}
                        </p>
                      </div>
                      <button className="remove-btn" onClick={() => removeLine(item.id)} aria-label="Xoá dòng">
                        ×
                      </button>
                    </div>
                    <div className="cart-line-body">
                        <div className="cart-field price-field">
                          <label>Đơn giá</label>
                          <div className={`input-shell ${item.unitPriceError ? "error" : ""}`}>
                            <input
                              value={item.unitPriceInput}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              onChange={(event) => handleUnitPriceInputChange(item.id, event.target.value)}
                              onBlur={() => commitUnitPriceInput(item.id)}
                              onKeyDown={(event) => handleUnitPriceKeyDown(event, item.id)}
                            />
                            <span className="input-suffix">đ</span>
                          </div>
                          {item.unitPriceError && <p className="input-error">{item.unitPriceError}</p>}
                        </div>
                        <div className="cart-field qty-field">
                          <label>Số lượng</label>
                          <div className={`qty-control ${item.qtyError ? "error" : ""}`}>
                            <input
                              value={item.qtyInput}
                              inputMode={item.allowDecimalQty ? "decimal" : "numeric"}
                              onChange={(event) => handleQtyInputChange(item.id, event.target.value)}
                              onBlur={() => commitQtyInput(item.id)}
                              onKeyDown={(event) => handleQtyKeyDown(event, item.id)}
                            />
                          </div>
                          {item.qtyError && <p className="input-error">{item.qtyError}</p>}
                        </div>
                        <div className="cart-field qty-field">
                          <label>Thành tiền</label>
                          <div className="cart-line-total">
                            <strong>{formatCurrency(lineSubtotal)}</strong>
                          </div>
                        </div>
                      </div>
                  </div>
                );
              })}
              {!cartItems.length && (
                <div className="empty-cart">Chưa có sản phẩm nào trong giỏ.</div>
              )}
              {cartHasErrors && cartItems.length > 0 && (
                <div className="cart-warning">Vui lòng sửa các ô có viền đỏ trước khi thanh toán.</div>
              )}
            </div>
            <div className="cart-note">
              <label htmlFor="note">Ghi chú đơn</label>
              <textarea
                id="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ví dụ: ít đá, giao nhanh..."
              />
            </div>
          </div>
          <div className="totals-panel">
            <div className="summary-row">
              <span>Tạm tính</span>
              <strong>{formatCurrency(cartSubtotal)}</strong>
            </div>
            <div className="summary-row">
              <span>Thuế (0%)</span>
              <strong>{formatCurrency(tax)}</strong>
            </div>
            <div className="summary-row total">
              <span>Tổng cộng</span>
              <strong>{formatCurrency(total)}</strong>
            </div>
            <div className="action-buttons">
              <button
                className="primary-btn"
                onClick={openPaymentModal}
                disabled={!cartItems.length || cartHasErrors}
              >
                Thanh toán
              </button>
              <button className="ghost-btn">In tạm</button>
            </div>
            {cartHasErrors && cartItems.length > 0 && (
              <p className="cart-warning inline">Có lỗi trong giỏ hàng, vui lòng kiểm tra lại.</p>
            )}
          </div>
        </section>
        {showPaymentModal && (
          <div className="modal-overlay">
            <div className="payment-modal" role="dialog" aria-modal="true">
              <div className="modal-header">
                <h3>Thanh toán</h3>
                <p className="modal-hint">Enter để xác nhận · ESC để huỷ · 'Cho nợ' nếu khách chưa trả đủ</p>
                {outstandingDebt > 0 && (
                  <p className="modal-hint debt-warning">
                    Khách còn thiếu {formatCurrency(outstandingDebt)} - sẽ được ghi nợ khi ấn 'Cho nợ'
                  </p>
                )}
              </div>
              <div className="payment-row">
                <span>Tổng phải trả</span>
                <strong>{formatCurrency(total)}</strong>
              </div>
              <label htmlFor="cash-input" className="payment-label">
                Tiền khách đưa (VND)
              </label>
              <input
                id="cash-input"
                ref={cashInputRef}
                className="payment-input"
                inputMode="numeric"
                pattern="[0-9]*"
                value={cashGiven}
                onChange={handleCashInputChange}
                placeholder="Nhập số tiền hoặc dùng bàn phím"
              />
              <div className="quick-amounts">
                <button onClick={() => handleQuickAdd(10000)}>+10.000</button>
                <button onClick={() => handleQuickAdd(50000)}>+50.000</button>
                <button onClick={() => handleQuickAdd(100000)}>+100.000</button>
              </div>
              <div className="keypad-grid">
                {keypadButtons.map((btn) => (
                  <button
                    key={btn}
                    className={btn === "⌫" ? "keypad-btn secondary" : "keypad-btn"}
                    onClick={() =>
                      handleKeypadInput(btn === "⌫" ? "backspace" : btn)
                    }
                  >
                    {btn}
                  </button>
                ))}
                <button className="keypad-btn secondary" onClick={() => handleKeypadInput("clear")}>
                  C
                </button>
              </div>
              <div className="payment-row">
                <span>Tiền thừa</span>
                <strong className={changeDue > 0 ? "highlight" : ""}>
                  {formatCurrency(changeDue)}
                </strong>
              </div>
              {outstandingDebt > 0 && (
                <div className="payment-row">
                  <span>Còn thiếu</span>
                  <strong className="debt-amount">{formatCurrency(outstandingDebt)}</strong>
                </div>
              )}
              <div className="modal-actions">
                <button
                  className="primary-btn"
                  onClick={confirmPayment}
                  disabled={!canConfirmPayment || isSavingPayment}
                >
                  Xác nhận thanh toán
                </button>
                <button
                  className="debt-btn"
                  type="button"
                  onClick={confirmDebtPayment}
                  disabled={!canSubmitDebtPayment || isSavingPayment}
                >
                  Cho khách nợ
                </button>
                <button className="ghost-btn" onClick={closePaymentModal}>
                  Huỷ
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default POSScreen;
