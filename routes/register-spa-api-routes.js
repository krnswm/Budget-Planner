function registerSpaApiRoutes(app, deps) {
  const {
    ensureAuth,
    fs,
    reactIndexFile,
    get,
    run,
    all,
    getHealthSnapshot,
    NODE_ENV,
    getCurrentMonthKey,
    getDaysInMonthFromKey,
    monthLabel,
    currency,
    EXPENSE_CATEGORIES,
    parseMonthFromDate,
    isIsoDate,
    isoDateToday,
    applyRecurringExpensesForMonth,
    bcrypt,
    crypto
  } = deps;

  app.get("/", (req, res) => {
    if (req.session.userId) {
      res.redirect("/app");
      return;
    }
    res.redirect("/login");
  });

  app.get("/healthz", async (req, res) => {
    try {
      await get("SELECT 1 AS ok");
      res.status(200).json(getHealthSnapshot());
    } catch (error) {
      res.status(503).json({
        status: "error",
        env: NODE_ENV,
        timestamp: new Date().toISOString(),
        message: "Database health check failed."
      });
    }
  });

  app.get("/app", ensureAuth, (req, res) => {
    if (!fs.existsSync(reactIndexFile)) {
      res.status(503).send("React frontend is not built yet. Run: npm --prefix client install; npm --prefix client run build");
      return;
    }

    res.sendFile(reactIndexFile);
  });

  app.get("/app/*splat", ensureAuth, (req, res) => {
    if (!fs.existsSync(reactIndexFile)) {
      res.status(503).send("React frontend is not built yet. Run: npm --prefix client install; npm --prefix client run build");
      return;
    }

    res.sendFile(reactIndexFile);
  });

  app.get("/api/session", ensureAuth, async (req, res) => {
    try {
      const user = await get("SELECT full_name, google_id, email, avatar_url FROM users WHERE id = ?", [req.session.userId]);
      res.json({
        csrfToken: req.csrfToken(),
        userName: user && user.full_name ? user.full_name : req.session.userEmail.split("@")[0],
        userEmail: user ? user.email : req.session.userEmail,
        googleConnected: user ? Boolean(user.google_id) : Boolean(req.session.googleConnected),
        avatarUrl: user && user.avatar_url ? user.avatar_url : ""
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to load session info." });
    }
  });

  app.get(["/dashboard", "/expenses", "/planning", "/insights", "/reports", "/profile", "/budget", "/months"], ensureAuth, (req, res) => {
    const queryPart = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(`/app${req.path}${queryPart}`);
  });

  app.get("/api/dashboard-summary", ensureAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const activeMonthInput = String(req.query.monthKey || "").trim();
      const activeMonthKey = /^\d{4}-\d{2}$/.test(activeMonthInput) ? activeMonthInput : getCurrentMonthKey();
      const todayMonthKey = getCurrentMonthKey();
      const currentMonthDay = activeMonthKey === todayMonthKey
        ? Number(new Date().toISOString().slice(8, 10))
        : getDaysInMonthFromKey(activeMonthKey);
      const [
        user,
        budget,
        expenseTotals,
        expenses,
        history
      ] = await Promise.all([
        get("SELECT full_name, google_id FROM users WHERE id = ?", [userId]),
        get("SELECT total_budget FROM monthly_budgets WHERE user_id = ? AND month_key = ?", [userId, activeMonthKey]),
        get("SELECT COALESCE(SUM(amount), 0) AS spent FROM expenses WHERE user_id = ? AND month_key = ?", [userId, activeMonthKey]),
        all(
          `
            SELECT id, label, amount, category, note, spent_on
            FROM expenses
            WHERE user_id = ? AND month_key = ?
            ORDER BY COALESCE(spent_on, created_at) DESC, id DESC
            LIMIT 12
          `,
          [userId, activeMonthKey]
        ),
        all(
          `
            SELECT mb.month_key,
                   mb.total_budget,
                   COALESCE(SUM(e.amount), 0) AS spent
            FROM monthly_budgets mb
            LEFT JOIN expenses e
              ON mb.user_id = e.user_id
             AND mb.month_key = e.month_key
            WHERE mb.user_id = ?
            GROUP BY mb.month_key, mb.total_budget
            ORDER BY mb.month_key DESC
            LIMIT 6
          `,
          [userId]
        )
      ]);

      const totalBudget = budget ? Number(budget.total_budget) : 0;
      const spent = Number(expenseTotals.spent || 0);
      const remaining = totalBudget - spent;
      const daysInMonth = getDaysInMonthFromKey(activeMonthKey);
      const projectedSpent = currentMonthDay > 0 ? (spent / currentMonthDay) * daysInMonth : spent;
      const projectedLeft = totalBudget - projectedSpent;

      let trafficLight = "empty";
      if (totalBudget > 0) {
        const percentLeft = (remaining / totalBudget) * 100;
        if (percentLeft > 50) {
          trafficLight = "green";
        } else if (percentLeft >= 20) {
          trafficLight = "yellow";
        } else {
          trafficLight = "red";
        }
      }

      res.json({
        csrfToken: req.csrfToken(),
        currentMonthKey: activeMonthKey,
        currentMonthLabel: monthLabel(activeMonthKey),
        isCurrentMonth: activeMonthKey === todayMonthKey,
        totalBudget,
        spent,
        remaining,
        projectedSpent,
        projectedLeft,
        percentSpent: totalBudget > 0 ? Math.min((spent / totalBudget) * 100, 100) : 0,
        trafficLight,
        paceMessage: totalBudget > 0
          ? `At this pace, you will have ${currency(projectedLeft)} left by month end.`
          : "Set your monthly budget to get spending forecasts.",
        availableCategories: EXPENSE_CATEGORIES,
        userName: user && user.full_name ? user.full_name : req.session.userEmail.split("@")[0],
        googleConnected: user ? Boolean(user.google_id) : false,
        expenses: expenses.map((entry) => ({
          id: entry.id,
          label: entry.label,
          amount: Number(entry.amount),
          category: entry.category || "Other",
          note: entry.note || "",
          spentOn: entry.spent_on || ""
        })),
        history: history.map((entry) => ({
          monthLabel: monthLabel(entry.month_key),
          total: Number(entry.total_budget),
          spent: Number(entry.spent),
          remaining: Number(entry.total_budget) - Number(entry.spent)
        }))
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to load dashboard summary." });
    }
  });

  app.post("/api/budget", ensureAuth, async (req, res) => {
    const totalBudget = Number(req.body.totalBudget);
    const requestedMonthKey = String(req.body.monthKey || "").trim();
    const targetMonthKey = /^\d{4}-\d{2}$/.test(requestedMonthKey) ? requestedMonthKey : getCurrentMonthKey();

    if (!Number.isFinite(totalBudget) || totalBudget <= 0) {
      res.status(400).json({ message: "Monthly budget must be a number greater than 0." });
      return;
    }

    try {
      await run(
        `
          INSERT INTO monthly_budgets (user_id, month_key, total_budget)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, month_key)
          DO UPDATE SET total_budget = excluded.total_budget
        `,
        [req.session.userId, targetMonthKey, totalBudget]
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to save budget right now." });
    }
  });

  app.post("/api/expenses", ensureAuth, async (req, res) => {
    const amount = Number(req.body.amount);
    const label = String(req.body.label || "").trim().slice(0, 60);
    const requestedCategory = String(req.body.category || "Other").trim();
    const category = EXPENSE_CATEGORIES.includes(requestedCategory) ? requestedCategory : "Other";
    const note = String(req.body.note || "").trim().slice(0, 200);
    const spentOn = String(req.body.spentOn || "").trim();
    const selectedMonthKey = parseMonthFromDate(spentOn);
    const currentMonthKey = selectedMonthKey || getCurrentMonthKey();

    if (!Number.isFinite(amount) || amount <= 0 || !label) {
      res.status(400).json({ message: "Expense requires a valid label and amount greater than 0." });
      return;
    }

    if (spentOn && !isIsoDate(spentOn)) {
      res.status(400).json({ message: "Please choose a valid expense date." });
      return;
    }

    try {
      const budgetRow = await get(
        "SELECT id FROM monthly_budgets WHERE user_id = ? AND month_key = ?",
        [req.session.userId, currentMonthKey]
      );

      if (!budgetRow) {
        res.status(400).json({ message: "Set monthly budget first before adding expenses." });
        return;
      }

      await run(
        "INSERT INTO expenses (user_id, month_key, amount, label, category, note, spent_on) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [req.session.userId, currentMonthKey, amount, label, category, note || null, spentOn || isoDateToday()]
      );

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to add expense right now." });
    }
  });

  app.get("/api/expenses", ensureAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const monthInput = String(req.query.monthKey || "").trim();
      const currentMonthKey = /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : getCurrentMonthKey();
      const labelFilter = String(req.query.label || "").trim();
      const categoryFilter = String(req.query.category || "").trim();
      const startDateFilter = String(req.query.startDate || "").trim();
      const endDateFilter = String(req.query.endDate || "").trim();

      const expenseFilterConditions = ["user_id = ?", "month_key = ?"];
      const expenseFilterParams = [userId, currentMonthKey];

      if (labelFilter) {
        expenseFilterConditions.push("label LIKE ?");
        expenseFilterParams.push(`%${labelFilter}%`);
      }

      if (categoryFilter && EXPENSE_CATEGORIES.includes(categoryFilter)) {
        expenseFilterConditions.push("category = ?");
        expenseFilterParams.push(categoryFilter);
      }

      if (startDateFilter && isIsoDate(startDateFilter)) {
        expenseFilterConditions.push("COALESCE(spent_on, substr(created_at, 1, 10)) >= ?");
        expenseFilterParams.push(startDateFilter);
      }

      if (endDateFilter && isIsoDate(endDateFilter)) {
        expenseFilterConditions.push("COALESCE(spent_on, substr(created_at, 1, 10)) <= ?");
        expenseFilterParams.push(endDateFilter);
      }

      await applyRecurringExpensesForMonth(userId, currentMonthKey);

      const [currentBudget, expenseTotals, expenses] = await Promise.all([
        get("SELECT total_budget FROM monthly_budgets WHERE user_id = ? AND month_key = ?", [userId, currentMonthKey]),
        get("SELECT COALESCE(SUM(amount), 0) AS spent FROM expenses WHERE user_id = ? AND month_key = ?", [userId, currentMonthKey]),
        all(
          `
            SELECT id, amount, label, category, note, spent_on
            FROM expenses
            WHERE ${expenseFilterConditions.join(" AND ")}
            ORDER BY COALESCE(spent_on, created_at) DESC, id DESC
          `,
          expenseFilterParams
        )
      ]);

      const totalBudget = currentBudget ? Number(currentBudget.total_budget) : 0;
      const spent = Number(expenseTotals.spent || 0);

      res.json({
        csrfToken: req.csrfToken(),
        currentMonthKey,
        currentMonthLabel: monthLabel(currentMonthKey),
        totalBudget,
        spent,
        remaining: totalBudget - spent,
        availableCategories: EXPENSE_CATEGORIES,
        filters: {
          label: labelFilter,
          category: categoryFilter,
          startDate: startDateFilter,
          endDate: endDateFilter
        },
        expenses: expenses.map((item) => ({
          id: item.id,
          amount: Number(item.amount),
          label: item.label,
          category: item.category || "Other",
          note: item.note || "",
          spentOn: item.spent_on || ""
        }))
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to load expenses right now." });
    }
  });

  app.put("/api/expenses/:id", ensureAuth, async (req, res) => {
    const expenseId = Number(req.params.id);
    const label = String(req.body.label || "").trim().slice(0, 60);
    const amount = Number(req.body.amount);
    const categoryInput = String(req.body.category || "Other").trim();
    const category = EXPENSE_CATEGORIES.includes(categoryInput) ? categoryInput : "Other";
    const note = String(req.body.note || "").trim().slice(0, 200);
    const spentOn = String(req.body.spentOn || "").trim();

    if (!Number.isInteger(expenseId) || expenseId <= 0 || !label || !Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ message: "Provide a valid label and amount greater than 0." });
      return;
    }

    if (spentOn && !isIsoDate(spentOn)) {
      res.status(400).json({ message: "Please choose a valid expense date." });
      return;
    }

    try {
      // A blank date must leave spent_on and month_key untouched. Defaulting
      // month_key to the current month here silently relocated edited
      // expenses out of their original month and corrupted past totals.
      const result = await run(
        `
          UPDATE expenses
          SET label = ?,
              amount = ?,
              category = ?,
              note = ?,
              spent_on = COALESCE(?, spent_on),
              month_key = COALESCE(?, month_key)
          WHERE id = ? AND user_id = ?
        `,
        [
          label,
          amount,
          category,
          note || null,
          spentOn || null,
          parseMonthFromDate(spentOn) || null,
          expenseId,
          req.session.userId
        ]
      );

      if (result && result.changes === 0) {
        res.status(404).json({ message: "Expense not found." });
        return;
      }

      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to update expense right now." });
    }
  });

  app.delete("/api/expenses/:id", ensureAuth, async (req, res) => {
    const expenseId = Number(req.params.id);

    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      res.status(400).json({ message: "Invalid expense selection." });
      return;
    }

    try {
      await run("DELETE FROM expenses WHERE id = ? AND user_id = ?", [expenseId, req.session.userId]);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to delete expense right now." });
    }
  });

  app.get("/api/planning", ensureAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const monthInput = String(req.query.monthKey || "").trim();
      const currentMonthKey = /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : getCurrentMonthKey();
      const currentMonthDay = Number(new Date().toISOString().slice(8, 10));

      await applyRecurringExpensesForMonth(userId, currentMonthKey);

      const [categoryTotals, categoryLimits, recurringExpenses] = await Promise.all([
        all(
          `
            SELECT category, SUM(amount) AS total
            FROM expenses
            WHERE user_id = ? AND month_key = ?
            GROUP BY category
            ORDER BY total DESC
            LIMIT 10
          `,
          [userId, currentMonthKey]
        ),
        all(
          `
            SELECT category, limit_amount
            FROM category_limits
            WHERE user_id = ? AND month_key = ?
            ORDER BY category ASC
          `,
          [userId, currentMonthKey]
        ),
        all(
          `
            SELECT id, label, amount, category, note, day_of_month, is_active
            FROM recurring_expenses
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 20
          `,
          [userId]
        )
      ]);

      const categorySpentMap = new Map(
        categoryTotals.map((entry) => [entry.category || "Other", Number(entry.total || 0)])
      );

      const categoryProgress = categoryLimits.map((entry) => {
        const used = categorySpentMap.get(entry.category) || 0;
        const limit = Number(entry.limit_amount);
        return {
          category: entry.category,
          used,
          limit,
          percentage: Math.min((used / limit) * 100, 100)
        };
      });

      const warningList = categoryTotals
        .map((entry) => {
          const limit = categoryLimits.find((item) => item.category === (entry.category || "Other"));
          if (!limit) {
            return null;
          }
          const used = Number(entry.total || 0);
          const limitAmount = Number(limit.limit_amount || 0);
          if (used <= limitAmount) {
            return null;
          }
          return {
            category: entry.category || "Other",
            used,
            limit: limitAmount,
            overBy: used - limitAmount
          };
        })
        .filter(Boolean);

      res.json({
        csrfToken: req.csrfToken(),
        currentMonthKey,
        currentMonthLabel: monthLabel(currentMonthKey),
        availableCategories: EXPENSE_CATEGORIES,
        categoryLimits: categoryLimits.map((item) => ({
          category: item.category,
          limit: Number(item.limit_amount)
        })),
        categoryWarnings: warningList,
        categoryProgress,
        recurringExpenses: recurringExpenses.map((item) => ({
          id: item.id,
          label: item.label,
          amount: Number(item.amount),
          category: item.category,
          note: item.note || "",
          dayOfMonth: item.day_of_month,
          isActive: Boolean(item.is_active),
          isUpcoming: item.day_of_month >= currentMonthDay
        }))
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to load planning right now." });
    }
  });

  app.post("/api/category-limits", ensureAuth, async (req, res) => {
    const category = String(req.body.category || "").trim();
    const limitAmount = Number(req.body.limitAmount);
    const monthInput = String(req.body.monthKey || "").trim();
    const currentMonthKey = /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : getCurrentMonthKey();

    if (!EXPENSE_CATEGORIES.includes(category) || !Number.isFinite(limitAmount) || limitAmount <= 0) {
      res.status(400).json({ message: "Pick a valid category and limit greater than 0." });
      return;
    }

    try {
      await run(
        `
          INSERT INTO category_limits (user_id, month_key, category, limit_amount)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, month_key, category)
          DO UPDATE SET limit_amount = excluded.limit_amount
        `,
        [req.session.userId, currentMonthKey, category, limitAmount]
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to save category limit right now." });
    }
  });

  app.put("/api/category-limits/:category", ensureAuth, async (req, res) => {
    const category = decodeURIComponent(String(req.params.category || "")).trim();
    const limitAmount = Number(req.body.limitAmount);
    const monthInput = String(req.body.monthKey || "").trim();
    const currentMonthKey = /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : getCurrentMonthKey();

    if (!EXPENSE_CATEGORIES.includes(category) || !Number.isFinite(limitAmount) || limitAmount <= 0) {
      res.status(400).json({ message: "Pick a valid category and limit greater than 0." });
      return;
    }

    try {
      const existing = await get(
        "SELECT id FROM category_limits WHERE user_id = ? AND month_key = ? AND category = ?",
        [req.session.userId, currentMonthKey, category]
      );

      if (!existing) {
        res.status(404).json({ message: "Category limit not found." });
        return;
      }

      await run(
        "UPDATE category_limits SET limit_amount = ? WHERE user_id = ? AND month_key = ? AND category = ?",
        [limitAmount, req.session.userId, currentMonthKey, category]
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to update category limit right now." });
    }
  });

  app.delete("/api/category-limits/:category", ensureAuth, async (req, res) => {
    const category = decodeURIComponent(String(req.params.category || "")).trim();
    const monthInput = String(req.body.monthKey || "").trim();
    const currentMonthKey = /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : getCurrentMonthKey();

    if (!EXPENSE_CATEGORIES.includes(category)) {
      res.status(400).json({ message: "Invalid category selection." });
      return;
    }

    try {
      await run(
        "DELETE FROM category_limits WHERE user_id = ? AND month_key = ? AND category = ?",
        [req.session.userId, currentMonthKey, category]
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to delete category limit right now." });
    }
  });

  app.post("/api/recurring-expenses", ensureAuth, async (req, res) => {
    const label = String(req.body.label || "").trim().slice(0, 60);
    const amount = Number(req.body.amount);
    const dayOfMonth = Number(req.body.dayOfMonth);
    const requestedCategory = String(req.body.category || "Other").trim();
    const category = EXPENSE_CATEGORIES.includes(requestedCategory) ? requestedCategory : "Other";
    const note = String(req.body.note || "").trim().slice(0, 200);

    if (!label || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      res.status(400).json({ message: "Recurring expense needs label, amount, and day between 1 and 31." });
      return;
    }

    try {
      await run(
        "INSERT INTO recurring_expenses (user_id, label, amount, category, note, day_of_month, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)",
        [req.session.userId, label, amount, category, note || null, dayOfMonth]
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to add recurring expense right now." });
    }
  });

  app.patch("/api/recurring-expenses/:id/toggle", ensureAuth, async (req, res) => {
    const recurringId = Number(req.params.id);

    if (!Number.isInteger(recurringId) || recurringId <= 0) {
      res.status(400).json({ message: "Invalid recurring expense selection." });
      return;
    }

    try {
      const row = await get(
        "SELECT is_active FROM recurring_expenses WHERE id = ? AND user_id = ?",
        [recurringId, req.session.userId]
      );

      if (!row) {
        res.status(404).json({ message: "Recurring expense not found." });
        return;
      }

      const nextActive = row.is_active ? 0 : 1;
      await run("UPDATE recurring_expenses SET is_active = ? WHERE id = ?", [nextActive, recurringId]);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to update recurring expense right now." });
    }
  });

  app.put("/api/recurring-expenses/:id", ensureAuth, async (req, res) => {
    const recurringId = Number(req.params.id);
    const label = String(req.body.label || "").trim().slice(0, 60);
    const amount = Number(req.body.amount);
    const dayOfMonth = Number(req.body.dayOfMonth);
    const requestedCategory = String(req.body.category || "Other").trim();
    const category = EXPENSE_CATEGORIES.includes(requestedCategory) ? requestedCategory : "Other";
    const note = String(req.body.note || "").trim().slice(0, 200);
    const isActive = req.body.isActive === false ? 0 : 1;

    if (!Number.isInteger(recurringId) || recurringId <= 0) {
      res.status(400).json({ message: "Invalid recurring expense selection." });
      return;
    }

    if (!label || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      res.status(400).json({ message: "Recurring expense needs label, amount, and day between 1 and 31." });
      return;
    }

    try {
      const row = await get("SELECT id FROM recurring_expenses WHERE id = ? AND user_id = ?", [recurringId, req.session.userId]);
      if (!row) {
        res.status(404).json({ message: "Recurring expense not found." });
        return;
      }

      await run(
        `
          UPDATE recurring_expenses
          SET label = ?, amount = ?, category = ?, note = ?, day_of_month = ?, is_active = ?
          WHERE id = ? AND user_id = ?
        `,
        [label, amount, category, note || null, dayOfMonth, isActive, recurringId, req.session.userId]
      );
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to update recurring expense right now." });
    }
  });

  app.delete("/api/recurring-expenses/:id", ensureAuth, async (req, res) => {
    const recurringId = Number(req.params.id);

    if (!Number.isInteger(recurringId) || recurringId <= 0) {
      res.status(400).json({ message: "Invalid recurring expense selection." });
      return;
    }

    try {
      await run("DELETE FROM recurring_expenses WHERE id = ? AND user_id = ?", [recurringId, req.session.userId]);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to delete recurring expense right now." });
    }
  });

  app.get("/api/insights", ensureAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      const monthInput = String(req.query.monthKey || "").trim();
      const currentMonthKey = /^\d{4}-\d{2}$/.test(monthInput) ? monthInput : getCurrentMonthKey();
      const isCurrentMonth = currentMonthKey === getCurrentMonthKey();
      const today = isCurrentMonth ? Number(new Date().toISOString().slice(8, 10)) : getDaysInMonthFromKey(currentMonthKey);
      const daysInMonth = getDaysInMonthFromKey(currentMonthKey);

      const [currentBudget, expenseTotals, history, categoryTotals, categoryLimits, biggestExpenses] = await Promise.all([
        get("SELECT total_budget FROM monthly_budgets WHERE user_id = ? AND month_key = ?", [userId, currentMonthKey]),
        get("SELECT COALESCE(SUM(amount), 0) AS spent FROM expenses WHERE user_id = ? AND month_key = ?", [userId, currentMonthKey]),
        all(
          `
            SELECT mb.month_key,
                   mb.total_budget,
                   COALESCE(SUM(e.amount), 0) AS spent
            FROM monthly_budgets mb
            LEFT JOIN expenses e
              ON mb.user_id = e.user_id
             AND mb.month_key = e.month_key
            WHERE mb.user_id = ?
            GROUP BY mb.month_key, mb.total_budget
            ORDER BY mb.month_key DESC
          `,
          [userId]
        ),
        all(
          `
            SELECT category, SUM(amount) AS total
            FROM expenses
            WHERE user_id = ? AND month_key = ?
            GROUP BY category
            ORDER BY total DESC
            LIMIT 8
          `,
          [userId, currentMonthKey]
        ),
        all(
          `
            SELECT category, limit_amount
            FROM category_limits
            WHERE user_id = ? AND month_key = ?
            ORDER BY category ASC
          `,
          [userId, currentMonthKey]
        ),
        all(
          `
            SELECT label, amount, category, spent_on
            FROM expenses
            WHERE user_id = ? AND month_key = ?
            ORDER BY amount DESC, id DESC
            LIMIT 5
          `,
          [userId, currentMonthKey]
        )
      ]);

      const totalBudget = currentBudget ? Number(currentBudget.total_budget) : 0;
      const spent = Number(expenseTotals.spent || 0);
      const remaining = totalBudget - spent;
      const avgPerDay = today > 0 ? spent / today : spent;
      const projectedSpent = avgPerDay * daysInMonth;
      const projectedRemaining = totalBudget - projectedSpent;

      const historyTrend = history
        .map((entry) => ({
          label: monthLabel(entry.month_key),
          spent: Number(entry.spent),
          remaining: Number(entry.total_budget) - Number(entry.spent)
        }))
        .reverse();

      const previousMonth = history[1] ? Number(history[1].spent || 0) : 0;
      const changeVsPrevious = previousMonth > 0 ? ((spent - previousMonth) / previousMonth) * 100 : 0;

      const alerts = [];
      if (totalBudget > 0 && remaining < totalBudget * 0.2) {
        alerts.push("You are below 20% remaining budget. Consider pausing non-essential spends.");
      }
      if (projectedRemaining < 0) {
        alerts.push("Current pace projects an over-budget month. Reduce daily spend this week.");
      }
      const overLimitCategories = categoryLimits
        .map((entry) => {
          const used = Number((categoryTotals.find((row) => row.category === entry.category) || { total: 0 }).total || 0);
          return { category: entry.category, used, limit: Number(entry.limit_amount) };
        })
        .filter((entry) => entry.used > entry.limit);

      res.json({
        currentMonthKey,
        currentMonthLabel: monthLabel(currentMonthKey),
        totalBudget,
        spent,
        remaining,
        avgPerDay,
        projectedSpent,
        projectedRemaining,
        changeVsPrevious,
        alerts,
        overLimitCategories,
        topCategories: categoryTotals.map((entry) => ({
          name: entry.category || "Other",
          total: Number(entry.total),
          percentage: totalBudget > 0 ? Math.min((Number(entry.total) / totalBudget) * 100, 100) : 0
        })),
        biggestExpenses: biggestExpenses.map((entry) => ({
          label: entry.label,
          amount: Number(entry.amount),
          category: entry.category || "Other",
          spentOn: entry.spent_on || ""
        })),
        chartsData: {
          spent,
          remaining: Math.max(remaining, 0),
          categoryLabels: categoryTotals.map((entry) => entry.category || "Other"),
          categoryValues: categoryTotals.map((entry) => Number(entry.total)),
          trendLabels: historyTrend.map((entry) => entry.label),
          trendSpentValues: historyTrend.map((entry) => entry.spent),
          trendRemainingValues: historyTrend.map((entry) => Math.max(entry.remaining, 0))
        },
        categoryProgress: categoryLimits.map((entry) => {
          const used = Number((categoryTotals.find((row) => row.category === entry.category) || { total: 0 }).total || 0);
          const limit = Number(entry.limit_amount);
          return {
            category: entry.category,
            used,
            limit,
            percentage: Math.min((used / limit) * 100, 100)
          };
        })
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to load insights right now." });
    }
  });

  app.get("/api/reports", ensureAuth, async (req, res) => {
    const defaultStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const defaultEnd = isoDateToday();
    const startDate = isIsoDate(String(req.query.startDate || "")) ? String(req.query.startDate) : defaultStart;
    const endDate = isIsoDate(String(req.query.endDate || "")) ? String(req.query.endDate) : defaultEnd;

    if (startDate > endDate) {
      res.status(400).json({ message: "Start date must be before or equal to end date." });
      return;
    }

    try {
      const [summary, expensesInRange, categoryBreakdown, dailyTotals] = await Promise.all([
        get(
          `
            SELECT COALESCE(SUM(amount), 0) AS spent
            FROM expenses
            WHERE user_id = ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) >= ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) <= ?
          `,
          [req.session.userId, startDate, endDate]
        ),
        all(
          `
            SELECT spent_on, label, category, note, amount
            FROM expenses
            WHERE user_id = ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) >= ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) <= ?
            ORDER BY COALESCE(spent_on, created_at) DESC
          `,
          [req.session.userId, startDate, endDate]
        ),
        all(
          `
            SELECT category, COALESCE(SUM(amount), 0) AS total
            FROM expenses
            WHERE user_id = ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) >= ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) <= ?
            GROUP BY category
            ORDER BY total DESC
          `,
          [req.session.userId, startDate, endDate]
        ),
        all(
          `
            SELECT COALESCE(spent_on, substr(created_at, 1, 10)) AS day_key, COALESCE(SUM(amount), 0) AS total
            FROM expenses
            WHERE user_id = ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) >= ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) <= ?
            GROUP BY day_key
            ORDER BY day_key ASC
          `,
          [req.session.userId, startDate, endDate]
        )
      ]);

      const spentValue = Number(summary.spent || 0);
      const expenseCount = expensesInRange.length;
      const averageExpense = expenseCount > 0 ? spentValue / expenseCount : 0;
      const topDay = dailyTotals.reduce((acc, item) => {
        const amount = Number(item.total || 0);
        if (!acc || amount > acc.total) {
          return { day: item.day_key, total: amount };
        }
        return acc;
      }, null);

      res.json({
        startDate,
        endDate,
        spent: spentValue,
        expenseCount,
        averageExpense,
        topDay,
        categoryBreakdown: categoryBreakdown.map((row) => ({
          category: row.category || "Other",
          total: Number(row.total || 0)
        })),
        dailyTotals: dailyTotals.map((row) => ({
          day: row.day_key,
          total: Number(row.total || 0)
        })),
        expenses: expensesInRange.map((row) => ({
          spentOn: row.spent_on || "",
          label: row.label,
          category: row.category || "Other",
          note: row.note || "",
          amount: Number(row.amount)
        }))
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to load reports right now." });
    }
  });

  app.get("/api/profile", ensureAuth, async (req, res) => {
    try {
      const user = await get(
        "SELECT email, full_name, google_id, avatar_url, created_at FROM users WHERE id = ?",
        [req.session.userId]
      );
      res.json({
        email: user.email,
        fullName: user.full_name || "",
        avatarUrl: user.avatar_url || "",
        joinedAt: user.created_at,
        googleConnected: Boolean(user.google_id),
        authMethod: user.google_id ? "Google + Email" : "Email"
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to load profile." });
    }
  });

  app.patch("/api/profile", ensureAuth, async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const fullName = String(req.body.fullName || "").trim().slice(0, 80);
    const avatarUrl = String(req.body.avatarUrl || "").trim().slice(0, 1000000);

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ message: "Please provide a valid email address." });
      return;
    }

    if (fullName.length > 0 && fullName.length < 2) {
      res.status(400).json({ message: "Full name should be at least 2 characters if provided." });
      return;
    }

    try {
      await run(
        "UPDATE users SET email = ?, full_name = ?, avatar_url = ? WHERE id = ?",
        [email || req.session.userEmail, fullName || null, avatarUrl || null, req.session.userId]
      );
      req.session.userEmail = email || req.session.userEmail;
      req.session.userName = fullName || req.session.userEmail.split("@")[0];
      res.json({ ok: true });
    } catch (error) {
      if (error && error.code === "SQLITE_CONSTRAINT") {
        res.status(409).json({ message: "That email address is already in use." });
        return;
      }
      res.status(500).json({ message: "Unable to update profile right now." });
    }
  });

  app.post("/api/profile/change-password", ensureAuth, async (req, res) => {
    const currentPassword = String(req.body.currentPassword || "");
    const newPassword = String(req.body.newPassword || "");

    try {
      const user = await get(
        "SELECT google_id, password_hash FROM users WHERE id = ?",
        [req.session.userId]
      );

      if (!user || !user.password_hash) {
        res.status(400).json({ message: "Password change is not available for this account." });
        return;
      }

      const isValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValid) {
        res.status(400).json({ message: "Current password is incorrect." });
        return;
      }

      if (newPassword.length < 6) {
        res.status(400).json({ message: "New password must be at least 6 characters." });
        return;
      }

      const newPasswordHash = await bcrypt.hash(newPassword, 10);
      await run("UPDATE users SET password_hash = ? WHERE id = ?", [newPasswordHash, req.session.userId]);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Unable to change password right now." });
    }
  });

  app.delete("/api/profile", ensureAuth, async (req, res) => {
    const confirmationText = String(req.body.confirmationText || "").trim();
    if (confirmationText !== "DELETE") {
      res.status(400).json({ message: "Type DELETE exactly to confirm account deletion." });
      return;
    }

    try {
      await run("DELETE FROM expenses WHERE user_id = ?", [req.session.userId]);
      await run("DELETE FROM monthly_budgets WHERE user_id = ?", [req.session.userId]);
      await run("DELETE FROM password_reset_tokens WHERE user_id = ?", [req.session.userId]);
      await run("DELETE FROM category_limits WHERE user_id = ?", [req.session.userId]);
      await run("DELETE FROM recurring_expenses WHERE user_id = ?", [req.session.userId]);
      await run("DELETE FROM users WHERE id = ?", [req.session.userId]);

      req.session.destroy(() => {
        res.json({ ok: true });
      });
    } catch (error) {
      res.status(500).json({ message: "Unable to delete account right now." });
    }
  });

  app.post("/api/profile/send-email-verification", ensureAuth, async (req, res) => {
    const newEmail = String(req.body.email || "").trim().toLowerCase();
    
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      res.status(400).json({ message: "Please provide a valid email address." });
      return;
    }

    try {
      const user = await get("SELECT email FROM users WHERE id = ?", [req.session.userId]);
      if (!user) {
        res.status(404).json({ message: "User not found." });
        return;
      }

      if (newEmail === user.email) {
        res.status(400).json({ message: "This is already your current email address." });
        return;
      }

      // Check if email is already taken
      const existingUser = await get("SELECT id FROM users WHERE email = ?", [newEmail]);
      if (existingUser) {
        res.status(409).json({ message: "That email address is already in use." });
        return;
      }

      // Generate verification token
      const randomToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(randomToken).digest("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

      // Store verification token
      await run(
        "INSERT INTO email_verification_tokens (user_id, new_email, token_hash, expires_at) VALUES (?, ?, ?, ?)",
        [req.session.userId, newEmail, tokenHash, expiresAt]
      );

      // In production, send email here with nodemailer
      // For now, return verification link that could be used
      const verificationLink = `${process.env.APP_BASE_URL || "http://localhost:3000"}/verify-email?token=${randomToken}`;
      
      // Log for development purposes
      if (NODE_ENV === "development") {
        console.log(`Email verification link for ${newEmail}: ${verificationLink}`);
      }

      res.json({ 
        ok: true, 
        message: `Verification email sent to ${newEmail}. Please check your inbox.`,
        verificationLink: NODE_ENV === "development" ? verificationLink : undefined
      });
    } catch (error) {
      console.error("Email verification error:", error);
      res.status(500).json({ message: "Unable to send verification email." });
    }
  });

  app.get("/api/profile/verify-email/:token", ensureAuth, async (req, res) => {
    const token = String(req.params.token || "").trim();
    
    if (!token) {
      res.status(400).json({ message: "Invalid verification token." });
      return;
    }

    try {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const tokenRecord = await get(
        "SELECT id, user_id, new_email, expires_at, verified_at FROM email_verification_tokens WHERE token_hash = ?",
        [tokenHash]
      );

      if (!tokenRecord) {
        res.status(404).json({ message: "Invalid or expired verification token." });
        return;
      }

      if (tokenRecord.verified_at) {
        res.status(400).json({ message: "This email has already been verified." });
        return;
      }

      const expiresAt = new Date(tokenRecord.expires_at);
      if (new Date() > expiresAt) {
        res.status(400).json({ message: "Verification token has expired. Please request a new one." });
        return;
      }

      // Make sure token belongs to authenticated user
      if (tokenRecord.user_id !== req.session.userId) {
        res.status(403).json({ message: "This token is not for your account." });
        return;
      }

      // Update user email
      await run("UPDATE users SET email = ? WHERE id = ?", [tokenRecord.new_email, req.session.userId]);
      await run("UPDATE email_verification_tokens SET verified_at = ? WHERE id = ?", [new Date().toISOString(), tokenRecord.id]);
      
      // Update session
      req.session.userEmail = tokenRecord.new_email;

      res.json({ ok: true, message: `Email successfully changed to ${tokenRecord.new_email}` });
    } catch (error) {
      if (error && error.code === "SQLITE_CONSTRAINT") {
        res.status(409).json({ message: "That email address is already in use." });
        return;
      }
      console.error("Email verification error:", error);
      res.status(500).json({ message: "Unable to verify email address." });
    }
  });

  app.post("/api/logout", ensureAuth, (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
}

module.exports = registerSpaApiRoutes;
