import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

const THEMES = [
  { id: "aurora", label: "Aurora" },
  { id: "midnight", label: "Midnight" },
  { id: "forest", label: "Forest" },
  { id: "sand", label: "Sand" }
];

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/expenses", label: "Expenses" },
  { to: "/planning", label: "Planning" },
  { to: "/insights", label: "Insights" },
  { to: "/reports", label: "Reports" }
];

function addMonthsToKey(monthKey, delta) {
  const [yearStr, monthStr] = monthKey.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const date = new Date(Date.UTC(year, monthIndex + delta, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

const DEFAULT_THEME = "aurora";

// Only ever trust a stored theme that still exists in THEMES. An unknown
// value matches no selector in styles.css and renders the app unstyled,
// which is what a stale "dark"/"light" value from the auth pages used to do.
// localStorage can also throw outright in private-browsing modes.
function readStoredTheme() {
  try {
    const stored = localStorage.getItem("budgetTheme");
    return THEMES.some((option) => option.id === stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function metricTone(traffic) {
  if (traffic === "green") return "ok";
  if (traffic === "yellow") return "warn";
  if (traffic === "red") return "danger";
  return "calm";
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "Request failed.");
  }
  return payload;
}

function AppShell({
  session,
  csrfToken,
  setCsrfToken,
  onLogout,
  theme,
  setTheme
}) {
  const [globalError, setGlobalError] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const location = useLocation();
  const headerAvatar = session.avatarUrl || "";
  const initials = (session.userName || "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  async function apiRequest(path, options = {}) {
    try {
      setGlobalError("");
      const response = await fetch(path, {
        credentials: "same-origin",
        ...options,
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
          ...(options.headers || {})
        }
      });
      const payload = await parseResponse(response);
      if (payload && payload.csrfToken) {
        setCsrfToken(payload.csrfToken);
      }
      return payload;
    } catch (error) {
      setGlobalError(error.message || "Request failed.");
      throw error;
    }
  }

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!profileMenuRef.current) {
        return;
      }
      if (!profileMenuRef.current.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setProfileMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!globalError) {
      return;
    }
    const timer = window.setTimeout(() => setGlobalError(""), 3000);
    return () => window.clearTimeout(timer);
  }, [globalError]);

  return (
    <div className="spa-shell">
      <header className="spa-topbar">
        <div className="topbar-minimal">
          <p className="eyebrow">Budget Planner</p>
          <h1>{session && session.userName ? `${session.userName}'s Workspace` : "Personal Finance Workspace"}</h1>
        </div>

        <div className="profile-corner" ref={profileMenuRef}>
          <button
            type="button"
            className="profile-trigger"
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
            onClick={() => setProfileMenuOpen((prev) => !prev)}
          >
            {headerAvatar ? (
              <img className="avatar avatar-photo avatar-photo-sm" src={headerAvatar} alt={session.userName || "Profile"} />
            ) : (
              <div className="avatar avatar-sm">{initials || "U"}</div>
            )}
            <div className="profile-corner-meta">
              <strong>{session.userName}</strong>
              <p className="subtext">Profile</p>
            </div>
            <span className="caret">v</span>
          </button>
          {profileMenuOpen ? (
            <div className="profile-dropdown" role="menu">
              <Link className="dropdown-item" to="/profile" onClick={() => setProfileMenuOpen(false)}>Account settings</Link>
              <Link className="dropdown-item" to="/budget" onClick={() => setProfileMenuOpen(false)}>Set Monthly Budget</Link>
              <Link className="dropdown-item" to="/months" onClick={() => setProfileMenuOpen(false)}>Recent Months</Link>
              <button className="dropdown-item-btn" onClick={onLogout} type="button">Log out</button>
            </div>
          ) : null}
        </div>
      </header>

      <nav className="spa-nav minimal" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} title={item.label}>
            <span className="nav-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {globalError ? <div className="alert">{globalError}</div> : null}

      <div className="route-frame" key={location.pathname}>
        <Routes location={location}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage apiRequest={apiRequest} />} />
          <Route path="/expenses" element={<ExpensesPage apiRequest={apiRequest} />} />
          <Route path="/planning" element={<PlanningPage apiRequest={apiRequest} />} />
          <Route path="/insights" element={<InsightsPage apiRequest={apiRequest} />} />
          <Route path="/reports" element={<ReportsPage apiRequest={apiRequest} />} />
          <Route path="/budget" element={<BudgetPage apiRequest={apiRequest} />} />
          <Route path="/months" element={<RecentMonthsPage apiRequest={apiRequest} />} />
          <Route
            path="/profile"
            element={(
              <ProfilePage
                apiRequest={apiRequest}
                theme={theme}
                setTheme={setTheme}
              />
            )}
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function DashboardPage({ apiRequest }) {
      const [data, setData] = useState(null);
      const [monthKey, setMonthKey] = useState(new Date().toISOString().slice(0, 7));
      const [monthLoading, setMonthLoading] = useState(false);
      const [expenseForm, setExpenseForm] = useState({ amount: "", label: "", category: "Other", spentOn: new Date().toISOString().slice(0, 10), note: "" });
      const todayMonthKey = new Date().toISOString().slice(0, 7);

      async function load(targetMonthKey = monthKey) {
        setMonthLoading(true);
        try {
          const query = targetMonthKey ? `?monthKey=${encodeURIComponent(targetMonthKey)}` : "";
          const payload = await apiRequest(`/api/dashboard-summary${query}`, { method: "GET", headers: {} });
          setData(payload);
          if (payload.currentMonthKey && payload.currentMonthKey !== targetMonthKey) {
            setMonthKey(payload.currentMonthKey);
          }
          setExpenseForm((prev) => ({ ...prev, category: payload.availableCategories[0] || "Other" }));
        } finally {
          setMonthLoading(false);
        }
      }

      useEffect(() => { load(monthKey); }, [monthKey]);

      const percentSpent = useMemo(() => {
        if (!data) return 0;
        return Math.max(0, Math.min(data.percentSpent || 0, 100));
      }, [data]);

      if (!data) {
        return <div className="screen-center">Loading dashboard...</div>;
      }

      const previousMonthKey = monthKey ? addMonthsToKey(monthKey, -1) : "";
      const nextMonthKey = monthKey ? addMonthsToKey(monthKey, 1) : "";

      return (
        <main className="grid dashboard-layout">
          <section className="card card-wide dashboard-main-card">
            <div className="section-head">
              <h2>{data.currentMonthLabel}</h2>
              <div className="month-nav-actions">
                <button type="button" className="btn-ghost" onClick={() => setMonthKey(previousMonthKey)} disabled={monthLoading}>Prev</button>
                <button type="button" className="btn-ghost" onClick={() => setMonthKey(nextMonthKey)} disabled={monthLoading || monthKey === todayMonthKey}>Next</button>
              </div>
            </div>
            <p className={`balance metric-${metricTone(data.trafficLight)}`}>{money.format(data.remaining || 0)}</p>
            <div className="meter"><div className="meter-fill" style={{ width: `${percentSpent}%` }} /></div>
            <div className="metrics-display">
              <div className="metric-item">
                <label>Spent</label>
                <strong>{money.format(data.spent || 0)}</strong>
              </div>
              <div className="metric-item">
                <label>Total Budget</label>
                <strong>{money.format(data.totalBudget || 0)}</strong>
              </div>
            </div>
          </section>

          <section className="card dashboard-card">
            <div className="section-head">
              <h2>Recent Expenses</h2>
              <Link className="ghost" to="/expenses">Manage Expenses</Link>
            </div>
            <div className="dashboard-card-scroll recent-expenses-scroll">
              {data.expenses.length === 0 ? <p className="subtext">No expenses yet.</p> : (
                <ul className="list">
                  {data.expenses.map((expense) => (
                    <li key={expense.id}>
                      <div>
                        <strong>{expense.label}</strong>
                        <p className="subtext">{expense.category}{expense.spentOn ? ` | ${expense.spentOn}` : ""}</p>
                      </div>
                      <span>{money.format(expense.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="card dashboard-card">
            <h2>Quick Add Expense</h2>
            <div className="dashboard-card-content">
              <form
                className="stack"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await apiRequest("/api/expenses", {
                    method: "POST",
                    body: JSON.stringify({
                      amount: Number(expenseForm.amount),
                      label: expenseForm.label,
                      category: expenseForm.category,
                      spentOn: expenseForm.spentOn,
                      note: expenseForm.note
                    })
                  });
                  setExpenseForm((prev) => ({ ...prev, amount: "", label: "", note: "" }));
                  await load(monthKey);
                }}
              >
                <input type="number" min="0.01" step="0.01" value={expenseForm.amount} onChange={(event) => setExpenseForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="Amount" required />
                <input type="text" value={expenseForm.label} onChange={(event) => setExpenseForm((prev) => ({ ...prev, label: event.target.value }))} placeholder="Label" required />
                <select value={expenseForm.category} onChange={(event) => setExpenseForm((prev) => ({ ...prev, category: event.target.value }))}>
                  {data.availableCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
                <input type="date" value={expenseForm.spentOn} onChange={(event) => setExpenseForm((prev) => ({ ...prev, spentOn: event.target.value }))} required />
                <input type="text" value={expenseForm.note} onChange={(event) => setExpenseForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="Note" />
                <button type="submit">Add Expense</button>
              </form>
            </div>
          </section>

        </main>
      );
}

function BudgetPage({ apiRequest }) {
  const [data, setData] = useState(null);
  const [budgetInput, setBudgetInput] = useState("");

  async function load() {
    const payload = await apiRequest("/api/dashboard-summary", { method: "GET", headers: {} });
    setData(payload);
    setBudgetInput(payload.totalBudget > 0 ? String(payload.totalBudget) : "");
  }

  useEffect(() => { load(); }, []);

  if (!data) {
    return <div className="screen-center">Loading monthly budget...</div>;
  }

  return (
    <main className="grid">
      <section className="card card-wide">
        <h2>Set Monthly Budget</h2>
        <p className="subtext">{data.currentMonthLabel}</p>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            await apiRequest("/api/budget", {
              method: "POST",
              body: JSON.stringify({ totalBudget: Number(budgetInput) })
            });
            await load();
          }}
        >
          <input type="number" min="1" step="0.01" value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} required />
          <button type="submit">Save Budget</button>
        </form>
      </section>
    </main>
  );
}

function RecentMonthsPage({ apiRequest }) {
  const [data, setData] = useState(null);

  async function load() {
    const payload = await apiRequest("/api/dashboard-summary", { method: "GET", headers: {} });
    setData(payload);
  }

  useEffect(() => { load(); }, []);

  if (!data) {
    return <div className="screen-center">Loading month history...</div>;
  }

  return (
    <main className="grid">
      <section className="card card-wide">
        <h2>Recent Months</h2>
        {data.history.length === 0 ? <p className="subtext">No history yet.</p> : (
          <ul className="history">
            {data.history.map((month) => (
              <li key={month.monthLabel}>
                <strong>{month.monthLabel}</strong>
                <div className="history-metrics">
                  <span><small>Total</small> {money.format(month.total)}</span>
                  <span><small>Spent</small> {money.format(month.spent)}</span>
                  <span><small>Left</small> {money.format(month.remaining)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ExpensesPage({ apiRequest }) {
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ label: "", category: "", startDate: "", endDate: "" });
  const [editingItem, setEditingItem] = useState(null);

  async function load(nextFilters = filters) {
    const query = new URLSearchParams(nextFilters).toString();
    const payload = await apiRequest(`/api/expenses${query ? `?${query}` : ""}`, { method: "GET", headers: {} });
    setData(payload);
    setFilters(payload.filters);
  }

  useEffect(() => { load(); }, []);

  if (!data) {
    return <div className="screen-center">Loading expenses...</div>;
  }

  return (
    <main className="grid">
      <section className="card card-wide">
        <h2>{data.currentMonthLabel} Expenses</h2>
        <div className="metrics-display">
          <div className="metric-item">
            <label>Total Budget</label>
            <strong>{money.format(data.totalBudget)}</strong>
          </div>
          <div className="metric-item">
            <label>Spent</label>
            <strong>{money.format(data.spent)}</strong>
          </div>
          <div className="metric-item">
            <label>Remaining</label>
            <strong>{money.format(data.remaining)}</strong>
          </div>
        </div>
      </section>

      <section className="card card-wide">
        <form
          className="filter-grid"
          onSubmit={(event) => {
            event.preventDefault();
            load(filters);
          }}
        >
          <input placeholder="Search label" value={filters.label} onChange={(event) => setFilters((prev) => ({ ...prev, label: event.target.value }))} />
          <select value={filters.category} onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}>
            <option value="">All Categories</option>
            {data.availableCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <input type="date" value={filters.startDate} onChange={(event) => setFilters((prev) => ({ ...prev, startDate: event.target.value }))} />
          <input type="date" value={filters.endDate} onChange={(event) => setFilters((prev) => ({ ...prev, endDate: event.target.value }))} />
          <button type="submit">Apply</button>
          <button type="button" className="btn-ghost" onClick={() => load({ label: "", category: "", startDate: "", endDate: "" })}>Clear</button>
        </form>
      </section>

      <section className="card card-wide">
        {data.expenses.length === 0 ? <p className="subtext">No expenses found.</p> : (
          <ul className="list">
            {data.expenses.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <p className="subtext">{item.category}{item.spentOn ? ` | ${item.spentOn}` : ""}</p>
                  {item.note ? <p className="subtext">{item.note}</p> : null}
                </div>
                <div className="row-actions">
                  <span>{money.format(item.amount)}</span>
                  <button type="button" className="btn-ghost" onClick={() => setEditingItem(item)}>Edit</button>
                  <button
                    type="button"
                    className="btn-ghost danger-outline"
                    onClick={async () => {
                      await apiRequest(`/api/expenses/${item.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editingItem && (
        <ExpenseEditModal
          item={editingItem}
          categories={data.availableCategories}
          onClose={() => setEditingItem(null)}
          onSave={async (payload) => {
            await apiRequest(`/api/expenses/${editingItem.id}`, { method: "PUT", body: JSON.stringify(payload) });
            setEditingItem(null);
            await load();
          }}
        />
      )}
    </main>
  );
}

function ExpenseEditModal({ item, categories, onClose, onSave }) {
  const [form, setForm] = useState({
    label: item.label,
    amount: String(item.amount),
    category: item.category,
    spentOn: item.spentOn || "",
    note: item.note || ""
  });
  const modalRef = useRef(null);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    function handleBackdropClick(event) {
      if (modalRef.current === event.target) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleBackdropClick);

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleBackdropClick);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" ref={modalRef}>
      <div className="modal-window">
        <div className="modal-header">
          <h2>Edit Expense</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close modal">×</button>
        </div>
        <form
          className="modal-body stack"
          onSubmit={(event) => {
            event.preventDefault();
            onSave({
              label: form.label,
              amount: Number(form.amount),
              category: form.category,
              spentOn: form.spentOn,
              note: form.note
            });
          }}
        >
          <div>
            <label className="modal-label">Label</label>
            <input value={form.label} onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))} required />
          </div>
          <div>
            <label className="modal-label">Amount</label>
            <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} required />
          </div>
          <div>
            <label className="modal-label">Category</label>
            <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>
              {categories.map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </div>
          <div>
            <label className="modal-label">Date</label>
            <input type="date" value={form.spentOn} onChange={(event) => setForm((prev) => ({ ...prev, spentOn: event.target.value }))} required />
          </div>
          <div>
            <label className="modal-label">Note</label>
            <input value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="Optional note" />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PlanningPage({ apiRequest }) {
  const [data, setData] = useState(null);
  const [limitForm, setLimitForm] = useState({ category: "Other", limitAmount: "" });
  const [recurringForm, setRecurringForm] = useState({ label: "", amount: "", category: "Other", dayOfMonth: "", note: "" });
  const [editingCategory, setEditingCategory] = useState("");
  const [editingLimitAmount, setEditingLimitAmount] = useState("");
  const [editingRecurringId, setEditingRecurringId] = useState(0);

  async function load() {
    const payload = await apiRequest("/api/planning", { method: "GET", headers: {} });
    setData(payload);
    setLimitForm((prev) => ({ ...prev, category: payload.availableCategories[0] || "Other" }));
    setRecurringForm((prev) => ({ ...prev, category: payload.availableCategories[0] || "Other" }));
  }

  useEffect(() => { load(); }, []);

  if (!data) {
    return <div className="screen-center">Loading planning...</div>;
  }

  return (
    <main className="grid">
      <section className="card">
        <h2>Category Limits</h2>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            await apiRequest("/api/category-limits", {
              method: "POST",
              body: JSON.stringify({ category: limitForm.category, limitAmount: Number(limitForm.limitAmount) })
            });
            setLimitForm((prev) => ({ ...prev, limitAmount: "" }));
            await load();
          }}
        >
          <select value={limitForm.category} onChange={(event) => setLimitForm((prev) => ({ ...prev, category: event.target.value }))}>
            {data.availableCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <input type="number" min="1" step="0.01" value={limitForm.limitAmount} onChange={(event) => setLimitForm((prev) => ({ ...prev, limitAmount: event.target.value }))} placeholder="Limit" required />
          <button type="submit">Save Limit</button>
        </form>
        <div className="planning-lists">
          {data.categoryLimits.length > 0 ? (
            <ul className="list compact-list">
              {data.categoryLimits.map((item) => (
                <li key={item.category}>
                  {editingCategory === item.category ? (
                    <form
                      className="row-actions inline-editor"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        await apiRequest(`/api/category-limits/${encodeURIComponent(item.category)}`, {
                          method: "PUT",
                          body: JSON.stringify({ limitAmount: Number(editingLimitAmount) })
                        });
                        setEditingCategory("");
                        setEditingLimitAmount("");
                        await load();
                      }}
                    >
                      <strong>{item.category}</strong>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={editingLimitAmount}
                        onChange={(event) => setEditingLimitAmount(event.target.value)}
                        required
                      />
                      <button type="submit">Save</button>
                      <button type="button" className="btn-ghost" onClick={() => setEditingCategory("")}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <div>
                        <strong>{item.category}</strong>
                        <p className="subtext">Limit {money.format(item.limit)}</p>
                      </div>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => {
                            setEditingCategory(item.category);
                            setEditingLimitAmount(String(item.limit));
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-ghost danger-outline"
                          onClick={async () => {
                            await apiRequest(`/api/category-limits/${encodeURIComponent(item.category)}`, { method: "DELETE" });
                            await load();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      <section className="card">
        <h2>Recurring Expenses</h2>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            await apiRequest("/api/recurring-expenses", {
              method: "POST",
              body: JSON.stringify({
                label: recurringForm.label,
                amount: Number(recurringForm.amount),
                category: recurringForm.category,
                dayOfMonth: Number(recurringForm.dayOfMonth),
                note: recurringForm.note
              })
            });
            setRecurringForm((prev) => ({ ...prev, label: "", amount: "", dayOfMonth: "", note: "" }));
            await load();
          }}
        >
          <input value={recurringForm.label} onChange={(event) => setRecurringForm((prev) => ({ ...prev, label: event.target.value }))} placeholder="Label" required />
          <input type="number" min="0.01" step="0.01" value={recurringForm.amount} onChange={(event) => setRecurringForm((prev) => ({ ...prev, amount: event.target.value }))} placeholder="Amount" required />
          <select value={recurringForm.category} onChange={(event) => setRecurringForm((prev) => ({ ...prev, category: event.target.value }))}>
            {data.availableCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          <input type="number" min="1" max="31" value={recurringForm.dayOfMonth} onChange={(event) => setRecurringForm((prev) => ({ ...prev, dayOfMonth: event.target.value }))} placeholder="Day of month" required />
          <input value={recurringForm.note} onChange={(event) => setRecurringForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="Note" />
          <button type="submit">Add Recurring</button>
        </form>
      </section>

      <section className="card card-wide">
        <h2>Recurring List</h2>
        {data.recurringExpenses.length === 0 ? <p className="subtext">No recurring items.</p> : (
          <ul className="list">
            {data.recurringExpenses.map((item) => (
              <li key={item.id}>
                {editingRecurringId === item.id ? (
                  <RecurringEditInline
                    item={item}
                    categories={data.availableCategories}
                    onCancel={() => setEditingRecurringId(0)}
                    onSave={async (payload) => {
                      await apiRequest(`/api/recurring-expenses/${item.id}`, { method: "PUT", body: JSON.stringify(payload) });
                      setEditingRecurringId(0);
                      await load();
                    }}
                  />
                ) : (
                  <>
                    <div>
                      <strong>{item.label}</strong>
                      <p className="subtext">{money.format(item.amount)} | {item.category} | Day {item.dayOfMonth}</p>
                      {item.note ? <p className="subtext">{item.note}</p> : null}
                    </div>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={async () => {
                          await apiRequest(`/api/recurring-expenses/${item.id}/toggle`, { method: "PATCH" });
                          await load();
                        }}
                      >
                        {item.isActive ? "Pause" : "Resume"}
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => setEditingRecurringId(item.id)}>Edit</button>
                      <button
                        type="button"
                        className="btn-ghost danger-outline"
                        onClick={async () => {
                          await apiRequest(`/api/recurring-expenses/${item.id}`, { method: "DELETE" });
                          await load();
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function RecurringEditInline({ item, categories, onCancel, onSave }) {
  const [form, setForm] = useState({
    label: item.label,
    amount: String(item.amount),
    category: item.category,
    dayOfMonth: String(item.dayOfMonth),
    note: item.note || "",
    isActive: item.isActive
  });

  return (
    <form
      className="stack inline-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          label: form.label,
          amount: Number(form.amount),
          category: form.category,
          dayOfMonth: Number(form.dayOfMonth),
          note: form.note,
          isActive: Boolean(form.isActive)
        });
      }}
    >
      <input value={form.label} onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))} required />
      <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} required />
      <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>
        {categories.map((category) => <option key={category} value={category}>{category}</option>)}
      </select>
      <input type="number" min="1" max="31" value={form.dayOfMonth} onChange={(event) => setForm((prev) => ({ ...prev, dayOfMonth: event.target.value }))} required />
      <input value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} placeholder="Note" />
      <label>
        Status
        <select value={form.isActive ? "active" : "paused"} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.value === "active" }))}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>
      </label>
      <div className="row-actions">
        <button type="submit">Save</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function InsightsPage({ apiRequest }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest("/api/insights", { method: "GET", headers: {} })
      .then((payload) => {
        setError("");
        setData(payload);
      })
      .catch((err) => {
        setError(err.message || "Unable to load insights.");
      });
  }, [apiRequest]);

  if (error) {
    return <div className="screen-center"><div className="alert">{error}</div></div>;
  }

  if (!data) {
    return <div className="screen-center"><p style={{ color: "var(--muted)" }}>Loading insights...</p></div>;
  }

  return (
    <main className="grid">
      <section className="card card-wide">
        <h2>{data.currentMonthLabel} Action Snapshot</h2>
        <div className="metrics-display">
          <div className="metric-item">
            <label>Total Budget</label>
            <strong>{money.format(data.totalBudget)}</strong>
          </div>
          <div className="metric-item">
            <label>Spent</label>
            <strong>{money.format(data.spent)}</strong>
          </div>
          <div className="metric-item">
            <label>Remaining</label>
            <strong>{money.format(data.remaining)}</strong>
          </div>
          <div className="metric-item">
            <label>Avg/Day</label>
            <strong>{money.format(data.avgPerDay || 0)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Forecast</h2>
        <ul className="list compact-list">
          <li><span>Projected month-end spend</span><strong>{money.format(data.projectedSpent || 0)}</strong></li>
          <li><span>Projected remaining</span><strong>{money.format(data.projectedRemaining || 0)}</strong></li>
          <li><span>Vs last month</span><strong>{Number(data.changeVsPrevious || 0).toFixed(1)}%</strong></li>
        </ul>
      </section>

      <section className="card">
        <h2>Alerts</h2>
        {!data.alerts || data.alerts.length === 0 ? <p className="subtext">No critical alerts. Keep going.</p> : (
          <ul className="list compact-list">
            {data.alerts.map((alert) => (
              <li key={alert}><span>{alert}</span></li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Top Categories</h2>
        {!data.topCategories || data.topCategories.length === 0 ? <p className="subtext">No category data yet.</p> : (
          <ul className="list compact-list">
            {data.topCategories.map((item) => (
              <li key={item.name}>
                <span>{item.name}</span>
                <strong>{money.format(item.total)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Category Progress</h2>
        {!data.categoryProgress || data.categoryProgress.length === 0 ? <p className="subtext">No category limits set.</p> : (
          <ul className="list compact-list">
            {data.categoryProgress.map((item) => (
              <li key={item.category}>
                <div>
                  <strong>{item.category}</strong>
                  <p className="subtext">{money.format(item.used)} / {money.format(item.limit)}</p>
                </div>
                <span>{item.percentage.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-wide">
        <h2>Largest Transactions</h2>
        {!data.biggestExpenses || data.biggestExpenses.length === 0 ? <p className="subtext">No transactions this month.</p> : (
          <ul className="list">
            {data.biggestExpenses.map((entry) => (
              <li key={`${entry.label}-${entry.spentOn}-${entry.amount}`}>
                <div>
                  <strong>{entry.label}</strong>
                  <p className="subtext">{entry.category} | {entry.spentOn || "-"}</p>
                </div>
                <strong>{money.format(entry.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ReportsPage({ apiRequest }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [startDate, setStartDate] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));

  async function load(nextStart = startDate, nextEnd = endDate) {
    try {
      const payload = await apiRequest(`/api/reports?startDate=${encodeURIComponent(nextStart)}&endDate=${encodeURIComponent(nextEnd)}`, { method: "GET", headers: {} });
      setError("");
      setData(payload);
    } catch (err) {
      setError(err.message || "Unable to load reports.");
    }
  }

  useEffect(() => { load(); }, []);

  if (error) {
    return <div className="screen-center">{error}</div>;
  }

  if (!data) {
    return <div className="screen-center"><p style={{ color: "var(--muted)" }}>Loading reports...</p></div>;
  }

  return (
    <main className="grid">
      <section className="card card-wide">
        <h2>Report Controls</h2>
        <form
          className="filter-grid"
          onSubmit={(event) => {
            event.preventDefault();
            load(startDate, endDate);
          }}
        >
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required />
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required />
          <button type="submit">Apply</button>
          <a className="btn-ghost btn-link" href={`/reports/monthly.csv?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`}>CSV</a>
          <a className="btn-ghost btn-link" href={`/reports/monthly.pdf?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`}>PDF</a>
          <button type="button" className="btn-ghost" onClick={() => window.print()}>Print</button>
        </form>
      </section>

      <section className="card card-wide">
        <h2>Summary</h2>
        <div className="metrics-display">
          <div className="metric-item">
            <label>Total Spent</label>
            <strong>{money.format(data.spent)}</strong>
          </div>
          <div className="metric-item">
            <label>Transactions</label>
            <strong>{data.expenseCount}</strong>
          </div>
          <div className="metric-item">
            <label>Average</label>
            <strong>{money.format(data.averageExpense || 0)}</strong>
          </div>
          <div className="metric-item">
            <label>Highest Day</label>
            <strong>{data.topDay ? `${data.topDay.day} (${money.format(data.topDay.total)})` : "-"}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Category Breakdown</h2>
        {!data.categoryBreakdown || data.categoryBreakdown.length === 0 ? <p className="subtext">No category data in this range.</p> : (
          <ul className="list compact-list">
            {data.categoryBreakdown.map((item) => (
              <li key={item.category}>
                <span>{item.category}</span>
                <strong>{money.format(item.total)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Daily Totals</h2>
        {!data.dailyTotals || data.dailyTotals.length === 0 ? <p className="subtext">No day-wise spend in this range.</p> : (
          <ul className="list compact-list">
            {data.dailyTotals.slice(-10).map((item) => (
              <li key={item.day}>
                <span>{item.day}</span>
                <strong>{money.format(item.total)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-wide">
        <h2>Entries</h2>
        {!data.expenses || data.expenses.length === 0 ? <p className="subtext">No entries found.</p> : (
          <ul className="list">
            {data.expenses.map((item, index) => (
              <li key={`${item.spentOn}-${item.label}-${index}`}>
                <div>
                  <strong>{item.label}</strong>
                  <p className="subtext">{item.category} | {item.spentOn || "-"}</p>
                  {item.note ? <p className="subtext">{item.note}</p> : null}
                </div>
                <span>{money.format(item.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function ProfilePage({ apiRequest, theme, setTheme }) {
  const [profile, setProfile] = useState(null);
  const [fullName, setFullName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarFileName, setAvatarFileName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [focus, setFocus] = useState(localStorage.getItem("budgetFocus") || "");
  const [city, setCity] = useState(localStorage.getItem("budgetCity") || "");
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [deleteText, setDeleteText] = useState("");
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const photoInputRef = useRef(null);
  const avatarMenuRef = useRef(null);

  function compressImage(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const maxSize = 400;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else if (height > maxSize) {
          width = (width * maxSize) / height;
          height = maxSize;
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function cropAvatarCenter() {
    if (!avatarUrl) {
      return;
    }

    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const sx = Math.floor((img.width - side) / 2);
      const sy = Math.floor((img.height - side) / 2);
      const canvas = document.createElement("canvas");
      canvas.width = 400;
      canvas.height = 400;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, sx, sy, side, side, 0, 0, 400, 400);
      setAvatarUrl(canvas.toDataURL("image/jpeg", 0.85));
      setAvatarFileName((prev) => prev || "profile-photo.jpg");
      setAvatarMenuOpen(false);
    };
    img.src = avatarUrl;
  }

  async function load() {
    const payload = await apiRequest("/api/profile", { method: "GET", headers: {} });
    setProfile(payload);
    setFullName(payload.fullName || "");
    setAvatarUrl(payload.avatarUrl || "");
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (!avatarMenuRef.current) {
        return;
      }
      if (!avatarMenuRef.current.contains(event.target)) {
        setAvatarMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("touchstart", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("touchstart", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const verificationToken = params.get("verify-email");
    
    if (verificationToken) {
      apiRequest(`/api/profile/verify-email/${verificationToken}`, { method: "GET", headers: {} })
        .then(() => {
          setSuccess("Email successfully verified and changed! Refreshing...");
          window.setTimeout(() => {
            load();
            window.history.replaceState({}, document.title, "/app/profile");
          }, 1500);
        })
        .catch((err) => {
          setError(err.message || "Failed to verify email.");
          window.setTimeout(() => setError(""), 5000);
        });
    }
  }, []);

  if (!profile) {
    return <div className="screen-center">Loading profile...</div>;
  }

  const memberDays = Math.max(1, Math.round((Date.now() - new Date(profile.joinedAt).getTime()) / (1000 * 60 * 60 * 24)));
  const displayName = fullName || profile.email || "User";
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
  const avatarSource = avatarUrl || profile.avatarUrl || "";

  async function saveInlineName() {
    try {
      setError("");
      await apiRequest("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({ fullName, avatarUrl })
      });
      setSuccess("Name updated.");
      window.setTimeout(() => setSuccess(""), 3000);
      setIsEditingName(false);
      await load();
      window.dispatchEvent(new Event("profile-updated"));
    } catch (err) {
      setError(err.message || "Failed to update name.");
      window.setTimeout(() => setError(""), 3000);
    }
  }

  return (
    <main className="grid profile-layout">
      <section className="card profile-card">
        <div className="profile-head profile-head-compact">
          <div className="profile-avatar-wrap" ref={avatarMenuRef}>
            {avatarSource ? <img className="avatar avatar-photo" src={avatarSource} alt={displayName} /> : <div className="avatar">{initials || "U"}</div>}
            <button
              type="button"
              className="avatar-hover-button"
              onClick={() => setAvatarMenuOpen((prev) => !prev)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h4l10-10-4-4L4 16v4zm12.7-12.3 1.6-1.6a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-1.6 1.6-3-3z" fill="currentColor" />
              </svg>
            </button>
            {avatarMenuOpen ? (
              <div className="avatar-action-menu">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    if (photoInputRef.current) {
                      photoInputRef.current.click();
                    }
                    setAvatarMenuOpen(false);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    cropAvatarCenter();
                    setAvatarMenuOpen(false);
                  }}
                  disabled={!avatarUrl}
                >
                  Crop
                </button>
                <button
                  type="button"
                  className="btn-ghost danger-outline"
                  onClick={() => {
                    setAvatarUrl("");
                    setAvatarFileName("");
                    setAvatarMenuOpen(false);
                  }}
                >
                  Delete
                </button>
              </div>
            ) : null}
            <input
              ref={photoInputRef}
              className="avatar-file-input"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files && event.target.files[0];
                if (!file) {
                  return;
                }
                compressImage(file, (compressedData) => {
                  setAvatarUrl(compressedData);
                  setAvatarFileName(file.name);
                  setAvatarMenuOpen(false);
                });
              }}
            />
          </div>
          <div>
            <p className="eyebrow">Account</p>
            <div className="profile-title-inline">
              {isEditingName ? (
                <form
                  className="profile-inline-name-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    await saveInlineName();
                  }}
                >
                  <input
                    className="profile-inline-name-input"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Your name"
                    style={{ width: `${Math.max(12, (fullName || displayName).length + 2)}ch` }}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setIsEditingName(false);
                      }
                    }}
                  />
                </form>
              ) : (
                <h2>{displayName}</h2>
              )}
              <span className="profile-member-inline">Member for {memberDays} days</span>
            </div>
            {!isEditingName ? (
              <button
                type="button"
                className="btn-ghost profile-name-edit-btn"
                onClick={() => setIsEditingName(true)}
              >
                Edit name
              </button>
            ) : null}
          </div>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
        {success ? <div className="success-banner">{success}</div> : null}
        <form
          className="stack profile-form"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              setError("");
              await apiRequest("/api/profile", {
                method: "PATCH",
                body: JSON.stringify({ fullName, avatarUrl })
              });
              setSuccess("Profile photo and name updated.");
              window.setTimeout(() => setSuccess(""), 3000);
              await load();
              window.dispatchEvent(new Event("profile-updated"));
            } catch (err) {
              setError(err.message || "Failed to save profile photo.");
              window.setTimeout(() => setError(""), 3000);
            }
          }}
        >
          <div className="profile-upload-row">
            <p className="subtext profile-hint">Save any changes to your profile photo or name.</p>
          </div>
          <button type="submit">Save Profile Photo</button>
        </form>

        <form
          className="stack profile-form profile-divider-block profile-password-box"
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              setError("");
              await apiRequest("/api/profile/change-password", {
                method: "POST",
                body: JSON.stringify(passwordForm)
              });
              setPasswordForm({ currentPassword: "", newPassword: "" });
              setSuccess("Password updated.");
              window.setTimeout(() => setSuccess(""), 3000);
            } catch (err) {
              setError(err.message || "Unable to change password.");
              window.setTimeout(() => setError(""), 3000);
            }
          }}
        >
          <h3>Change Password</h3>
          <p className="subtext">Use a strong password with at least 6 characters.</p>
          <div className="profile-form-grid">
            <input
              type="password"
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
              placeholder="Current password"
              required
            />
            <input
              type="password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
              placeholder="New password"
              required
            />
          </div>
          <button type="submit">Update Password</button>
        </form>
      </section>

      <section className="card profile-card profile-side-card">
        <h2>Workspace & Security</h2>
        <form
          className="stack profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            localStorage.setItem("budgetFocus", focus);
            localStorage.setItem("budgetCity", city);
            setSuccess("Preferences saved on this device.");
            window.setTimeout(() => setSuccess(""), 3000);
          }}
        >
          <div className="profile-form-grid">
            <label>
              City
              <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="City" />
            </label>
            <label>
              Money goal
              <input value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="Current money goal" />
            </label>
          </div>
          <label>
            Theme
            <select value={theme} onChange={(event) => setTheme(event.target.value)}>
              {THEMES.map((themeOption) => (
                <option key={themeOption.id} value={themeOption.id}>{themeOption.label}</option>
              ))}
            </select>
          </label>
          <button type="submit">Save Preferences</button>
        </form>

      </section>

      <section className="card card-wide danger-zone profile-delete-card">
        <h2>Delete Account</h2>
        <p className="subtext">Type DELETE to permanently remove your account and data.</p>
        <form
          className="stack profile-form profile-danger-form"
          onSubmit={async (event) => {
            event.preventDefault();
            await apiRequest("/api/profile", {
              method: "DELETE",
              body: JSON.stringify({ confirmationText: deleteText })
            });
            window.location.assign("/register");
          }}
        >
          <input value={deleteText} onChange={(event) => setDeleteText(event.target.value)} required />
          <button type="submit" className="danger">Delete Account</button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [bootError, setBootError] = useState("");
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    document.body.dataset.theme = theme;
    try {
      localStorage.setItem("budgetTheme", theme);
    } catch {
      // Private browsing can reject writes; the theme still applies in-session.
    }
  }, [theme]);

  useEffect(() => {
    function loadSession() {
      fetch("/api/session", { credentials: "same-origin" })
        .then(parseResponse)
        .then((payload) => {
          setSession({
            userName: payload.userName,
            userEmail: payload.userEmail,
            googleConnected: payload.googleConnected,
            avatarUrl: payload.avatarUrl || ""
          });
          setCsrfToken(payload.csrfToken || "");
        })
        .catch((error) => {
          setBootError(error.message || "Unable to load session.");
        });
    }

    loadSession();
    window.addEventListener("profile-updated", loadSession);
    return () => {
      window.removeEventListener("profile-updated", loadSession);
    };
  }, []);

  if (bootError) {
    return <div className="screen-center">{bootError}</div>;
  }

  if (!session) {
    return <div className="screen-center">Loading app...</div>;
  }

  return (
    <AppShell
      session={session}
      csrfToken={csrfToken}
      setCsrfToken={setCsrfToken}
      theme={theme}
      setTheme={setTheme}
      onLogout={async () => {
        await fetch("/api/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": csrfToken
          },
          body: JSON.stringify({})
        });
        navigate("/dashboard", { replace: true });
        window.location.assign("/login");
      }}
    />
  );
}

export default App;
