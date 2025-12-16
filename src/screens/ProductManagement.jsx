import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

const mapDatabaseProduct = (record) => ({
  ...record,
  price: Number(record.price),
  barcode: record.barcode ?? "",
});

const buildFormState = (product) => ({
  ...product,
  price: product.price.toString(),
  barcode: product.barcode || "",
  displayOrder: product.displayOrder.toString(),
});

const buildProductPayload = (product, { includeId = false } = {}) => {
  const barcodeValue = typeof product.barcode === "string" ? product.barcode.trim() : "";
  const payload = {
    name: product.name.trim(),
    price: Number(product.price),
    barcode: barcodeValue || null,
    quickDisplay: Boolean(product.quickDisplay),
    displayOrder: Number(product.displayOrder),
    visible: Boolean(product.visible),
  };
  if (includeId) {
    payload.id = Number(product.id);
  }
  return payload;
};

const fallbackProducts = [
  {
    id: 1,
    name: "Cà phê sữa đá",
    price: 39000,
    barcode: "8931230001",
    visible: true,
    quickDisplay: true,
    displayOrder: 1,
  },
  {
    id: 2,
    name: "Trà đào cam sả",
    price: 49000,
    barcode: "8931230002",
    visible: true,
    quickDisplay: true,
    displayOrder: 2,
  },
  {
    id: 3,
    name: "Bánh croissant bơ",
    price: 36000,
    barcode: "8931230003",
    visible: true,
    quickDisplay: false,
    displayOrder: 6,
  },
  {
    id: 4,
    name: "Combo sáng",
    price: 79000,
    barcode: null,
    visible: true,
    quickDisplay: false,
    displayOrder: 4,
  },
  {
    id: 5,
    name: "Sinh tố xoài",
    price: 56000,
    barcode: "8931230007",
    visible: false,
    quickDisplay: false,
    displayOrder: 8,
  },
];

const createEmptyForm = (count) => ({
  id: null,
  name: "",
  price: "",
  barcode: "",
  quickDisplay: false,
  displayOrder: String(count + 1),
  visible: true,
});

const formatCurrency = (value) => `${value.toLocaleString("vi-VN")}đ`;

const ProductManagement = ({ onBack }) => {
  const [products, setProducts] = useState(fallbackProducts);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState(createEmptyForm(fallbackProducts.length));
  const [formErrors, setFormErrors] = useState({});
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rows = await invoke("list_products");
        if (!mounted) return;
        if (Array.isArray(rows)) {
          setProducts(rows.map((row) => mapDatabaseProduct(row)));
          setFormData(createEmptyForm(rows.length));
        }
      } catch (error) {
        console.error("Không thể tải dữ liệu sản phẩm:", error);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const stats = useMemo(
    () => ({
      total: products.length,
      visible: products.filter((item) => item.visible).length,
      pinned: products.filter((item) => item.quickDisplay).length,
    }),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    const result = products.filter((product) => {
      if (!keyword) return true;
      const byName = product.name.toLowerCase().includes(keyword);
      const byBarcode = product.barcode?.toLowerCase().includes(keyword);
      return byName || byBarcode;
    });
    return [...result].sort((a, b) => a.displayOrder - b.displayOrder);
  }, [products, searchTerm]);

  const resetForm = (count = products.length) => {
    setIsEditing(false);
    setFormData(createEmptyForm(count));
    setFormErrors({});
  };

  const handleEditProduct = (product) => {
    setIsEditing(true);
    setFormData(buildFormState(product));
    setFormErrors({});
  };

  const handleFormChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const validateForm = () => {
    const errors = {};
    const priceValue = Number(formData.price);
    if (!formData.name.trim()) {
      errors.name = "Tên sản phẩm không được để trống.";
    }
    if (Number.isNaN(priceValue) || priceValue <= 0) {
      errors.price = "Giá bán phải lớn hơn 0.";
    }
    const orderValue = Number(formData.displayOrder);
    if (Number.isNaN(orderValue) || orderValue < 1) {
      errors.displayOrder = "Thứ tự hiển thị phải từ 1 trở lên.";
    }
    return errors;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    const errors = validateForm();
    if (Object.keys(errors).length) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing) {
        const payload = buildProductPayload(formData, { includeId: true });
        const updated = await invoke("update_product", { payload });
        const normalized = mapDatabaseProduct(updated);
        setProducts((prev) =>
          prev.map((item) => (item.id === normalized.id ? normalized : item)),
        );
        resetForm(products.length);
      } else {
        const payload = buildProductPayload(formData);
        const created = await invoke("create_product", { payload });
        const normalized = mapDatabaseProduct(created);
        setProducts((prev) => [...prev, normalized]);
        resetForm(products.length + 1);
      }
    } catch (error) {
      console.error("Không thể lưu sản phẩm:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Persist a product to SQLite and keep local/UI state in sync.
  const syncProductToDatabase = async (nextProduct, fallbackProduct) => {
    try {
      const payload = buildProductPayload(nextProduct, { includeId: true });
      const saved = await invoke("update_product", { payload });
      const normalized = mapDatabaseProduct(saved);
      setProducts((prev) =>
        prev.map((item) => (item.id === normalized.id ? normalized : item)),
      );
      if (formData.id === normalized.id) {
        setFormData(buildFormState(normalized));
      }
    } catch (error) {
      console.error("Không thể cập nhật sản phẩm:", error);
      if (fallbackProduct) {
        setProducts((prev) =>
          prev.map((item) => (item.id === fallbackProduct.id ? fallbackProduct : item)),
        );
        if (formData.id === fallbackProduct.id) {
          setFormData(buildFormState(fallbackProduct));
        }
      }
    }
  };

  const toggleStatus = (productId) => {
    const target = products.find((item) => item.id === productId);
    if (!target) return;
    const updated = { ...target, visible: !target.visible };
    setProducts((prev) =>
      prev.map((item) => (item.id === productId ? updated : item)),
    );
    if (formData.id === productId) {
      setFormData((prev) => ({ ...prev, visible: updated.visible }));
    }
    syncProductToDatabase(updated, target);
  };

  const togglePinProduct = (productId) => {
    const target = products.find((item) => item.id === productId);
    if (!target) return;
    const updated = { ...target, quickDisplay: !target.quickDisplay };
    setProducts((prev) =>
      prev.map((item) => (item.id === productId ? updated : item)),
    );
    if (formData.id === productId) {
      setFormData((prev) => ({ ...prev, quickDisplay: updated.quickDisplay }));
    }
    syncProductToDatabase(updated, target);
  };

  return (
    <div className="product-admin">
      <header className="admin-header">
        <div>
          <p className="caption">Quản lý sản phẩm</p>
          <h1>Bảng hàng hoá POS</h1>
          <p className="subtext">Tập trung vào thao tác nhanh, ít trường thông tin nhưng đủ ý.</p>
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={onBack}>
            ← Quay lại POS
          </button>
          <button className="primary-btn" onClick={resetForm}>
            + Thêm sản phẩm
          </button>
        </div>
      </header>

      <div className="admin-toolbar">
        <div className="search-box">
          <input
            type="text"
            placeholder="Tìm theo tên hoặc barcode..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>
        <div className="stats">
          <div>
            <span>Tổng</span>
            <strong>{stats.total}</strong>
          </div>
          <div>
            <span>Đang hiển thị</span>
            <strong>{stats.visible}</strong>
          </div>
          <div>
            <span>Đang ghim</span>
            <strong>{stats.pinned}</strong>
          </div>
        </div>
      </div>

      <div className="content-grid">
        <section className="table-card">
          <div className="table-card__header">
            <div>
              <h2>Danh sách sản phẩm</h2>
              <p>Kiểm soát nhanh trạng thái · Ghép barcode · Ghim chỉ trong 1 cú chạm</p>
            </div>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Tên sản phẩm</th>
                  <th>Giá bán</th>
                  <th>Barcode</th>
                  <th>Trạng thái</th>
                  <th>Hiển thị nhanh</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    className={formData.id === product.id ? "active-row" : undefined}
                  >
                    <td>
                      <div className="product-cell">
                        <strong>{product.name}</strong>
                        <span className="order">Thứ tự #{product.displayOrder}</span>
                      </div>
                    </td>
                    <td>{formatCurrency(product.price)}</td>
                    <td>{product.barcode || "—"}</td>
                    <td>
                      <span className={`status-pill ${product.visible ? "status-on" : "status-off"}`}>
                        {product.visible ? "Hiển" : "Ẩn"}
                      </span>
                      <button className="link-btn" onClick={() => toggleStatus(product.id)}>
                        Chuyển
                      </button>
                    </td>
                    <td>{product.quickDisplay ? "Đang ghim" : "Không"}</td>
                    <td>
                      <div className="row-actions">
                        <button className="ghost-btn" onClick={() => handleEditProduct(product)}>
                          Sửa
                        </button>
                        <button
                          className={`pin-btn ${product.quickDisplay ? "active" : ""}`}
                          onClick={() => togglePinProduct(product.id)}
                        >
                          Ghim lên POS
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filteredProducts.length && (
                  <tr>
                    <td colSpan={6} className="empty-state">
                      Không có sản phẩm nào phù hợp với từ khoá tìm kiếm.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="form-card">
          <h2>{isEditing ? "Sửa sản phẩm" : "Thêm sản phẩm"}</h2>
          <p className="subtext">Form gọn nhẹ · Chỉ gồm trường bắt buộc cho thu ngân.</p>
          <form onSubmit={handleSubmit}>
            <div className="form-field">
              <label htmlFor="name">Tên sản phẩm</label>
              <input
                id="name"
                type="text"
                value={formData.name}
                onChange={(event) => handleFormChange("name", event.target.value)}
                placeholder="Nhập tên dễ nhớ"
              />
              {formErrors.name && <p className="error-text">{formErrors.name}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="price">Giá bán (VND)</label>
              <input
                id="price"
                type="number"
                min="0"
                step="1"
                value={formData.price}
                onChange={(event) => handleFormChange("price", event.target.value)}
                placeholder="Ví dụ: 45000"
              />
              {formErrors.price && <p className="error-text">{formErrors.price}</p>}
            </div>
            <div className="form-field">
              <label htmlFor="barcode">Barcode (tuỳ chọn)</label>
              <input
                id="barcode"
                type="text"
                value={formData.barcode}
                onChange={(event) => handleFormChange("barcode", event.target.value)}
                placeholder="Nhập hoặc quét mã"
              />
            </div>
            <div className="form-field">
              <label htmlFor="displayOrder">Thứ tự hiển thị</label>
              <input
                id="displayOrder"
                type="number"
                min="1"
                value={formData.displayOrder}
                onChange={(event) => handleFormChange("displayOrder", event.target.value)}
              />
              {formErrors.displayOrder && (
                <p className="error-text">{formErrors.displayOrder}</p>
              )}
            </div>
            <div className="checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={formData.quickDisplay}
                  onChange={(event) => handleFormChange("quickDisplay", event.target.checked)}
                />
                Hiển thị nhanh trên POS
              </label>
            </div>
            <div className="form-actions">
              <button type="submit" className="primary-btn" disabled={isSubmitting}>
                {isEditing ? "Lưu thay đổi" : "Thêm sản phẩm"}
              </button>
              {isEditing && (
                <button type="button" className="ghost-btn" onClick={resetForm}>
                  Huỷ chỉnh sửa
                </button>
              )}
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
};

export default ProductManagement;
