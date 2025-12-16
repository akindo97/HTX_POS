import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

const formatCurrency = (value) => `${Number(value || 0).toLocaleString("vi-VN")}đ`;
const formatTime = (value) => {
  if (!value) return "";
  const [, time = ""] = value.split(" ");
  return time.slice(0, 5);
};

const getToday = () => new Date().toISOString().slice(0, 10);

const RevenueReport = ({ onBack }) => {
  const [selectedDate, setSelectedDate] = useState(getToday);
  const [receipts, setReceipts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rows = await invoke("list_payments");
        if (!mounted) return;
        if (Array.isArray(rows)) {
          setReceipts(rows);
        }
      } catch (error) {
        console.error("Không thể tải dữ liệu bán hàng:", error);
        setReceipts([]);
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

  const dailyReceipts = useMemo(() => {
    if (!selectedDate) return [];
    return receipts
      .filter((receipt) => receipt.createdAt?.slice(0, 10) === selectedDate)
      .sort((a, b) => {
        const aTime = a.createdAt ?? "";
        const bTime = b.createdAt ?? "";
        return aTime.localeCompare(bTime);
      });
  }, [receipts, selectedDate]);

  const aggregate = useMemo(() => {
    if (!dailyReceipts.length) {
      return {
        count: 0,
        revenue: 0,
        discounts: 0,
        paid: 0,
        change: 0,
        avg: 0,
        max: null,
        min: null,
      };
    }
    const initial = {
      count: 0,
      revenue: 0,
      discounts: 0,
      paid: 0,
      change: 0,
      max: dailyReceipts[0],
      min: dailyReceipts[0],
    };
    const result = dailyReceipts.reduce((acc, receipt) => {
      const total = Number(receipt.total) || 0;
      const discount = Number(receipt.discount) || 0;
      const paidCash = Number(receipt.paidCash) || 0;
      const changeDue = Number(receipt.changeDue) || 0;
      acc.count += 1;
      acc.revenue += total;
      acc.discounts += discount;
      acc.paid += paidCash;
      acc.change += changeDue;
      if (!acc.max || total > (Number(acc.max.total) || 0)) {
        acc.max = receipt;
      }
      if (!acc.min || total < (Number(acc.min.total) || 0)) {
        acc.min = receipt;
      }
      return acc;
    }, initial);
    result.avg = result.count ? Math.round(result.revenue / result.count) : 0;
    return result;
  }, [dailyReceipts]);

  const cashierSummary = useMemo(() => {
    const groups = new Map();
    dailyReceipts.forEach((receipt) => {
      const name = receipt.cashierName || "Không rõ";
      const total = Number(receipt.total) || 0;
      const discount = Number(receipt.discount) || 0;
      const current = groups.get(name) ?? { count: 0, revenue: 0, discounts: 0 };
      current.count += 1;
      current.revenue += total;
      current.discounts += discount;
      groups.set(name, current);
    });
    return Array.from(groups.entries()).map(([name, stats]) => ({
      cashierName: name,
      ...stats,
    }));
  }, [dailyReceipts]);

  const exportReport = () => {
    if (!dailyReceipts.length) return;
    const rows = [
      ["STT", "Số hoá đơn", "Thời gian", "Thu ngân", "Tổng tiền", "Giảm giá", "Tiền khách đưa", "Tiền thừa"],
      ...dailyReceipts.map((receipt, index) => [
        index + 1,
        receipt.invoiceNumber,
        formatTime(receipt.createdAt),
        receipt.cashierName,
        Number(receipt.total) || 0,
        Number(receipt.discount) || 0,
        Number(receipt.paidCash) || 0,
        Number(receipt.changeDue) || 0,
      ]),
    ];
    const csvContent = rows
      .map((line) =>
        line
          .map((value) => {
            const stringValue = `${value ?? ""}`.replace(/"/g, '""');
            return `"${stringValue}"`;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([`\uFEFF${csvContent}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bao-cao-${selectedDate}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDateChange = (event) => {
    const value = event.target.value;
    const today = getToday();
    if (value > today) return;
    setSelectedDate(value);
  };

  return (
    <div className="report-screen">
      <header className="history-header">
        <div>
          <p className="caption">Báo cáo</p>
          <h1>Báo cáo doanh thu ngày {selectedDate}</h1>
          <p className="subtext">Kiểm tra nhanh doanh thu từng ngày để đối soát cuối ca.</p>
        </div>
        <div className="header-actions">
          <button className="ghost-btn" onClick={onBack}>
            ← Quay lại POS
          </button>
          <button className="primary-btn" onClick={exportReport} disabled={!dailyReceipts.length}>
            Xuất file
          </button>
        </div>
      </header>

      <div className="report-toolbar">
        <label>
          Chọn ngày
          <input type="date" value={selectedDate} max={getToday()} onChange={handleDateChange} />
        </label>
      </div>

      {!dailyReceipts.length && !isLoading ? (
        <div className="empty-state">Không có giao dịch trong ngày này.</div>
      ) : null}

      {dailyReceipts.length > 0 && (
        <>
          <section className="report-summary">
            <div className="summary-card primary">
              <span>Tổng doanh thu</span>
              <strong>{formatCurrency(aggregate.revenue)}</strong>
            </div>
            <div className="summary-card">
              <span>Tổng hoá đơn</span>
              <strong>{aggregate.count}</strong>
            </div>
            <div className="summary-card">
              <span>Tổng giảm giá</span>
              <strong>{formatCurrency(aggregate.discounts)}</strong>
            </div>
            <div className="summary-card">
              <span>Tiền khách trả</span>
              <strong>{formatCurrency(aggregate.paid)}</strong>
            </div>
            <div className="summary-card">
              <span>Tiền thừa</span>
              <strong>{formatCurrency(aggregate.change)}</strong>
            </div>
            <div className="summary-card">
              <span>Hoá đơn trung bình</span>
              <strong>{formatCurrency(aggregate.avg)}</strong>
            </div>
          </section>

          <section className="report-detail">
            <h2>Chi tiết hoá đơn</h2>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>STT</th>
                    <th>Số hoá đơn</th>
                    <th>Thời gian</th>
                    <th>Thu ngân</th>
                    <th>Tổng tiền</th>
                    <th>Giảm giá</th>
                    <th>Tiền khách đưa</th>
                    <th>Tiền thừa</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyReceipts.map((receipt, index) => (
                    <tr key={receipt.id}>
                      <td>{index + 1}</td>
                      <td>{receipt.invoiceNumber}</td>
                      <td>{formatTime(receipt.createdAt)}</td>
                      <td>{receipt.cashierName}</td>
                      <td>{formatCurrency(receipt.total)}</td>
                      <td>-{formatCurrency(receipt.discount)}</td>
                      <td>{formatCurrency(receipt.paidCash)}</td>
                      <td>{formatCurrency(receipt.changeDue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {cashierSummary.length > 0 && (
            <section className="report-cashier">
              <h2>Doanh thu theo thu ngân</h2>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Thu ngân</th>
                      <th>Số hoá đơn</th>
                      <th>Tổng doanh thu</th>
                      <th>Tổng giảm giá</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashierSummary.map((entry) => (
                      <tr key={entry.cashierName}>
                        <td>{entry.cashierName}</td>
                        <td>{entry.count}</td>
                        <td>{formatCurrency(entry.revenue)}</td>
                        <td>{formatCurrency(entry.discounts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default RevenueReport;
