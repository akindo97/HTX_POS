use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};
use tauri::{path::BaseDirectory, Manager};

const MONEY_ROUNDING_MODE: &str = "floor";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductRecord {
    id: i64,
    name: String,
    price: i64,
    barcode: Option<String>,
    visible: bool,
    quick_display: bool,
    display_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProductPayload {
    name: String,
    price: i64,
    barcode: Option<String>,
    visible: bool,
    quick_display: bool,
    display_order: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProductPayload {
    id: i64,
    name: String,
    price: i64,
    barcode: Option<String>,
    visible: bool,
    quick_display: bool,
    display_order: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PaymentItemRecord {
    id: i64,
    product_id: Option<i64>,
    name: String,
    quantity: i64,
    price: i64,
    quantity_decimal: Option<f64>,
    base_unit_price: i64,
    edited_unit_price: Option<i64>,
    effective_unit_price: i64,
    line_subtotal: i64,
    line_discount: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CashierRecord {
    id: i64,
    code: String,
    name: String,
    role: String,
    last_active: Option<String>,
    require_pin: bool,
    pin: Option<String>,
    display_order: i64,
    is_active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PaymentRecord {
    id: i64,
    invoice_number: String,
    cashier_name: String,
    subtotal: i64,
    tax: i64,
    total: i64,
    discount: i64,
    paid_cash: i64,
    change_due: i64,
    note: Option<String>,
    created_at: String,
    items: Vec<PaymentItemRecord>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentItemInput {
    product_id: Option<i64>,
    name: String,
    quantity: f64,
    base_unit_price: i64,
    edited_unit_price: Option<i64>,
    effective_unit_price: Option<i64>,
    price: Option<i64>,
    line_subtotal: Option<i64>,
    line_discount: Option<i64>,
}

struct NormalizedPaymentItem {
    product_id: Option<i64>,
    name: String,
    quantity_decimal: f64,
    legacy_quantity: i64,
    base_unit_price: i64,
    edited_unit_price: Option<i64>,
    effective_unit_price: i64,
    line_subtotal: i64,
    line_discount: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePaymentPayload {
    invoice_number: String,
    cashier_name: String,
    subtotal: i64,
    tax: i64,
    total: i64,
    discount: i64,
    paid_cash: i64,
    change_due: i64,
    note: Option<String>,
    items: Vec<PaymentItemInput>,
}

fn locate_seed_database(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    let resource_candidates = [
        "../data/products.sqlite",
    ];
    for relative in resource_candidates {
        if let Ok(path) = app_handle.path().resolve(relative, BaseDirectory::Resource) {
            candidates.push(path);
        }
    }
    if let Ok(current_dir) = env::current_dir() {
        candidates.push(current_dir.join("data").join("products.sqlite"));
    }
    candidates.into_iter().find(|path| path.exists())
}

fn ensure_database(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let db_path = app_handle
        .path()
        .resolve("products.sqlite", BaseDirectory::AppData)
        .map_err(|err| err.to_string())?;
    if !db_path.exists() {
        if let Some(resource_path) = locate_seed_database(app_handle) {
            if let Some(parent) = db_path.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::copy(resource_path, &db_path).map_err(|err| err.to_string())?;
        } else {
            if let Some(parent) = db_path.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            fs::File::create(&db_path).map_err(|err| err.to_string())?;
        }
    }
    Ok(db_path)
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let sql = format!("PRAGMA table_info({})", table);
    let mut statement = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let mut rows = statement.query([]).map_err(|err| err.to_string())?;
    while let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let name: String = row.get(1).map_err(|err| err.to_string())?;
        if name.eq_ignore_ascii_case(column) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    if column_exists(conn, table, column)? {
        return Ok(());
    }
    let sql = format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition);
    conn.execute(sql.as_str(), [])
        .map_err(|err| err.to_string())
        .map(|_| ())
}

fn ensure_payment_item_columns(conn: &Connection) -> Result<(), String> {
    add_column_if_missing(conn, "payment_items", "quantity_decimal", "REAL")?;
    add_column_if_missing(conn, "payment_items", "base_unit_price", "INTEGER")?;
    add_column_if_missing(conn, "payment_items", "edited_unit_price", "INTEGER")?;
    add_column_if_missing(conn, "payment_items", "line_subtotal", "INTEGER")?;
    add_column_if_missing(
        conn,
        "payment_items",
        "line_discount",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    Ok(())
}

fn round_money(value: f64) -> i64 {
    if MONEY_ROUNDING_MODE == "round" {
        return value.round().max(0.0) as i64;
    }
    value.floor().max(0.0) as i64
}

fn initialize_schema(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price INTEGER NOT NULL,
            barcode TEXT,
            visible INTEGER NOT NULL DEFAULT 1,
            quick_display INTEGER NOT NULL DEFAULT 0,
            display_order INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_number TEXT NOT NULL,
            cashier_name TEXT NOT NULL,
            subtotal INTEGER NOT NULL,
            tax INTEGER NOT NULL,
            total INTEGER NOT NULL,
            discount INTEGER NOT NULL DEFAULT 0,
            paid_cash INTEGER NOT NULL,
            change_due INTEGER NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS payment_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
            product_id INTEGER,
            name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price INTEGER NOT NULL,
            quantity_decimal REAL,
            base_unit_price INTEGER,
            edited_unit_price INTEGER,
            line_subtotal INTEGER,
            line_discount INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|err| err.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cashiers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            last_active TEXT,
            require_pin INTEGER NOT NULL DEFAULT 0,
            pin TEXT,
            display_order INTEGER NOT NULL DEFAULT 1,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|err| err.to_string())?;
    ensure_payment_item_columns(conn)?;
    seed_cashiers_if_empty(conn)?;
    Ok(())
}

fn open_connection(app_handle: &tauri::AppHandle) -> Result<Connection, String> {
    let db_path = ensure_database(app_handle)?;
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    initialize_schema(&conn)?;
    Ok(conn)
}

fn bool_to_sql(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

const DEFAULT_CASHIER_SEED: &[(&str, &str, &str, &str, bool, Option<&str>)] = &[
    ("linh", "Linh", "Trưởng ca", "08:05", true, Some("1234")),
    ("hoang", "Hoàng", "Thu ngân", "08:10", false, None),
    ("an", "An", "Thu ngân", "Đang nghỉ", true, Some("5678")),
    ("vi", "Vi", "Thu ngân", "Hôm qua", false, None),
];

fn seed_cashiers_if_empty(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM cashiers", [], |row| row.get(0))
        .map_err(|err| err.to_string())?;
    if count > 0 {
        return Ok(());
    }
    for (index, (code, name, role, last_active, require_pin, pin)) in
        DEFAULT_CASHIER_SEED.iter().enumerate()
    {
        conn.execute(
            "INSERT INTO cashiers (code, name, role, last_active, require_pin, pin, display_order)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            (
                *code,
                *name,
                *role,
                *last_active,
                bool_to_sql(*require_pin),
                *pin,
                (index as i64) + 1,
            ),
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn normalize_barcode(barcode: Option<String>) -> Option<String> {
    barcode.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn parse_cashier_row(row: &rusqlite::Row<'_>) -> Result<CashierRecord, rusqlite::Error> {
    Ok(CashierRecord {
        id: row.get(0)?,
        code: row.get(1)?,
        name: row.get(2)?,
        role: row.get(3)?,
        last_active: row.get(4)?,
        require_pin: row.get::<_, i64>(5)? != 0,
        pin: row.get(6)?,
        display_order: row.get(7)?,
        is_active: row.get::<_, i64>(8)? != 0,
    })
}

fn parse_product_row(row: &rusqlite::Row<'_>) -> Result<ProductRecord, rusqlite::Error> {
    Ok(ProductRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        price: row.get(2)?,
        barcode: row.get(3)?,
        visible: row.get::<_, i64>(4)? != 0,
        quick_display: row.get::<_, i64>(5)? != 0,
        display_order: row.get(6)?,
    })
}

fn fetch_product_by_id(conn: &Connection, id: i64) -> Result<ProductRecord, String> {
    conn.query_row(
        "SELECT id, name, price, barcode, visible, quick_display, display_order
         FROM products
         WHERE id = ?1",
        [id],
        |row| parse_product_row(row),
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn list_products(app_handle: tauri::AppHandle) -> Result<Vec<ProductRecord>, String> {
    let conn = open_connection(&app_handle)?;
    let mut statement = conn
        .prepare(
            "SELECT id, name, price, barcode, visible, quick_display, display_order
             FROM products
             ORDER BY display_order ASC",
        )
        .map_err(|err| err.to_string())?;
    let records = statement
        .query_map([], |row| parse_product_row(row))
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;

    Ok(records)
}

#[tauri::command]
fn list_cashiers(app_handle: tauri::AppHandle) -> Result<Vec<CashierRecord>, String> {
    let conn = open_connection(&app_handle)?;
    let mut statement = conn
        .prepare(
            "SELECT id, code, name, role, last_active, require_pin, pin, display_order, is_active
             FROM cashiers
             WHERE is_active != 0
             ORDER BY display_order ASC, name ASC",
        )
        .map_err(|err| err.to_string())?;
    let records = statement
        .query_map([], |row| parse_cashier_row(row))
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    Ok(records)
}

#[tauri::command]
fn create_product(
    app_handle: tauri::AppHandle,
    payload: CreateProductPayload,
) -> Result<ProductRecord, String> {
    let conn = open_connection(&app_handle)?;
    let CreateProductPayload {
        name,
        price,
        barcode,
        visible,
        quick_display,
        display_order,
    } = payload;
    let cleaned_name = name.trim().to_string();
    let normalized_barcode = normalize_barcode(barcode);
    conn.execute(
        "INSERT INTO products (name, price, barcode, visible, quick_display, display_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (
            cleaned_name.as_str(),
            price,
            normalized_barcode.as_deref(),
            bool_to_sql(visible),
            bool_to_sql(quick_display),
            display_order,
        ),
    )
    .map_err(|err| err.to_string())?;
    let id = conn.last_insert_rowid();
    fetch_product_by_id(&conn, id)
}

#[tauri::command]
fn update_product(
    app_handle: tauri::AppHandle,
    payload: UpdateProductPayload,
) -> Result<ProductRecord, String> {
    let conn = open_connection(&app_handle)?;
    let UpdateProductPayload {
        id,
        name,
        price,
        barcode,
        visible,
        quick_display,
        display_order,
    } = payload;
    let cleaned_name = name.trim().to_string();
    let normalized_barcode = normalize_barcode(barcode);
    let affected = conn
        .execute(
            "UPDATE products
             SET name = ?1,
                 price = ?2,
                 barcode = ?3,
                 visible = ?4,
                 quick_display = ?5,
                 display_order = ?6
             WHERE id = ?7",
            (
                cleaned_name.as_str(),
                price,
                normalized_barcode.as_deref(),
                bool_to_sql(visible),
                bool_to_sql(quick_display),
                display_order,
                id,
            ),
        )
        .map_err(|err| err.to_string())?;
    if affected == 0 {
        return Err("Product not found".into());
    }
    fetch_product_by_id(&conn, id)
}

struct PaymentRow {
    id: i64,
    invoice_number: String,
    cashier_name: String,
    subtotal: i64,
    tax: i64,
    total: i64,
    discount: i64,
    paid_cash: i64,
    change_due: i64,
    note: Option<String>,
    created_at: String,
}

fn fetch_payment_row(conn: &Connection, id: i64) -> Result<PaymentRow, String> {
    conn.query_row(
        "SELECT id, invoice_number, cashier_name, subtotal, tax, total, discount,
                paid_cash, change_due, note, created_at
         FROM payments
         WHERE id = ?1",
        [id],
        |row| {
            Ok(PaymentRow {
                id: row.get(0)?,
                invoice_number: row.get(1)?,
                cashier_name: row.get(2)?,
                subtotal: row.get(3)?,
                tax: row.get(4)?,
                total: row.get(5)?,
                discount: row.get(6)?,
                paid_cash: row.get(7)?,
                change_due: row.get(8)?,
                note: row.get(9)?,
                created_at: row.get(10)?,
            })
        },
    )
    .map_err(|err| err.to_string())
}

fn fetch_payment_items(conn: &Connection, payment_id: i64) -> Result<Vec<PaymentItemRecord>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, product_id, name, quantity, price,
                    quantity_decimal, base_unit_price, edited_unit_price,
                    line_subtotal, line_discount
             FROM payment_items
             WHERE payment_id = ?1
             ORDER BY id ASC",
        )
        .map_err(|err| err.to_string())?;
    let mapped_rows = statement
        .query_map([payment_id], |row| {
            let legacy_quantity: i64 = row.get(3)?;
            let price: i64 = row.get(4)?;
            let quantity_decimal: Option<f64> = row.get(5)?;
            let base_unit_price: Option<i64> = row.get(6)?;
            let edited_unit_price: Option<i64> = row.get(7)?;
            let line_subtotal: Option<i64> = row.get(8)?;
            let line_discount: Option<i64> = row.get(9)?;
            let normalized_quantity = quantity_decimal.unwrap_or(legacy_quantity as f64);
            let resolved_base_price = base_unit_price.unwrap_or(price);
            let subtotal_value =
                line_subtotal.unwrap_or_else(|| round_money(price as f64 * normalized_quantity));
            Ok(PaymentItemRecord {
                id: row.get(0)?,
                product_id: row.get(1)?,
                name: row.get(2)?,
                quantity: legacy_quantity,
                price,
                quantity_decimal: Some(normalized_quantity),
                base_unit_price: resolved_base_price,
                edited_unit_price,
                effective_unit_price: price,
                line_subtotal: subtotal_value,
                line_discount: line_discount.unwrap_or(0),
            })
        })
        .map_err(|err| err.to_string())?;
    mapped_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

fn hydrate_payment_record(conn: &Connection, row: PaymentRow) -> Result<PaymentRecord, String> {
    let items = fetch_payment_items(conn, row.id)?;
    Ok(PaymentRecord {
        id: row.id,
        invoice_number: row.invoice_number,
        cashier_name: row.cashier_name,
        subtotal: row.subtotal,
        tax: row.tax,
        total: row.total,
        discount: row.discount,
        paid_cash: row.paid_cash,
        change_due: row.change_due,
        note: row.note,
        created_at: row.created_at,
        items,
    })
}

fn list_payment_rows(conn: &Connection) -> Result<Vec<PaymentRow>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, invoice_number, cashier_name, subtotal, tax, total, discount,
                    paid_cash, change_due, note, created_at
             FROM payments
             ORDER BY datetime(created_at) DESC
             LIMIT 200",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(PaymentRow {
                id: row.get(0)?,
                invoice_number: row.get(1)?,
                cashier_name: row.get(2)?,
                subtotal: row.get(3)?,
                tax: row.get(4)?,
                total: row.get(5)?,
                discount: row.get(6)?,
                paid_cash: row.get(7)?,
                change_due: row.get(8)?,
                note: row.get(9)?,
                created_at: row.get(10)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

fn normalize_note(note: Option<String>) -> Option<String> {
    note.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn normalize_payment_items(items: Vec<PaymentItemInput>) -> Result<Vec<NormalizedPaymentItem>, String> {
    if items.is_empty() {
        return Err("Payment must contain at least one item".into());
    }
    let mut normalized = Vec::with_capacity(items.len());
    for item in items {
        if !item.quantity.is_finite() || item.quantity <= 0.0 {
            return Err("Item quantity must be greater than 0".into());
        }
        let cleaned_name = item.name.trim();
        if cleaned_name.is_empty() {
            return Err("Item name cannot be empty".into());
        }
        if item.base_unit_price < 0 {
            return Err("Base unit price cannot be negative".into());
        }
        let resolved_effective_price = item
            .effective_unit_price
            .or(item.price)
            .unwrap_or(item.base_unit_price);
        if resolved_effective_price < 0 {
            return Err("Effective unit price cannot be negative".into());
        }
        let edited_price = item.edited_unit_price.filter(|value| *value >= 0);
        let computed_subtotal =
            round_money((resolved_effective_price as f64) * item.quantity);
        let line_subtotal = item.line_subtotal.unwrap_or(computed_subtotal);
        if line_subtotal < 0 {
            return Err("Line subtotal cannot be negative".into());
        }
        let line_discount = item.line_discount.unwrap_or(0);
        if line_discount < 0 {
            return Err("Line discount cannot be negative".into());
        }
        let rounded_qty = item.quantity.round() as i64;
        let legacy_quantity = if rounded_qty <= 0 { 1 } else { rounded_qty };
        normalized.push(NormalizedPaymentItem {
            product_id: item.product_id,
            name: cleaned_name.to_string(),
            quantity_decimal: item.quantity,
            legacy_quantity,
            base_unit_price: item.base_unit_price,
            edited_unit_price: edited_price,
            effective_unit_price: resolved_effective_price,
            line_subtotal,
            line_discount,
        });
    }
    Ok(normalized)
}

fn load_payment_by_id(conn: &Connection, id: i64) -> Result<PaymentRecord, String> {
    let row = fetch_payment_row(conn, id)?;
    hydrate_payment_record(conn, row)
}

#[tauri::command]
fn list_payments(app_handle: tauri::AppHandle) -> Result<Vec<PaymentRecord>, String> {
    let conn = open_connection(&app_handle)?;
    let rows = list_payment_rows(&conn)?;
    rows.into_iter()
        .map(|row| hydrate_payment_record(&conn, row))
        .collect::<Result<Vec<_>, _>>()
}

#[tauri::command]
fn create_payment(
    app_handle: tauri::AppHandle,
    payload: CreatePaymentPayload,
) -> Result<PaymentRecord, String> {
    let mut conn = open_connection(&app_handle)?;
    let CreatePaymentPayload {
        invoice_number,
        cashier_name,
        subtotal,
        tax,
        total,
        discount,
        paid_cash,
        change_due,
        note,
        items,
    } = payload;
    let normalized_items = normalize_payment_items(items)?;
    let cleaned_invoice = invoice_number.trim().to_string();
    if cleaned_invoice.is_empty() {
        return Err("Invoice number is required".into());
    }
    let cleaned_cashier = cashier_name.trim().to_string();
    if cleaned_cashier.is_empty() {
        return Err("Cashier name is required".into());
    }
    let normalized_note = normalize_note(note);
    let tx = conn.transaction().map_err(|err| err.to_string())?;
    tx.execute(
        "INSERT INTO payments (
            invoice_number, cashier_name, subtotal, tax, total, discount,
            paid_cash, change_due, note
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        (
            cleaned_invoice.as_str(),
            cleaned_cashier.as_str(),
            subtotal,
            tax,
            total,
            discount,
            paid_cash,
            change_due,
            normalized_note.as_deref(),
        ),
    )
    .map_err(|err| err.to_string())?;
    let payment_id = tx.last_insert_rowid();
    for item in normalized_items {
        tx.execute(
            "INSERT INTO payment_items (
                payment_id, product_id, name, quantity, price,
                quantity_decimal, base_unit_price, edited_unit_price,
                line_subtotal, line_discount
            )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            (
                payment_id,
                item.product_id,
                item.name.as_str(),
                item.legacy_quantity,
                item.effective_unit_price,
                item.quantity_decimal,
                item.base_unit_price,
                item.edited_unit_price,
                item.line_subtotal,
                item.line_discount,
            ),
        )
        .map_err(|err| err.to_string())?;
    }
    tx.commit().map_err(|err| err.to_string())?;
    load_payment_by_id(&conn, payment_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_products,
            list_cashiers,
            create_product,
            update_product,
            list_payments,
            create_payment
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
