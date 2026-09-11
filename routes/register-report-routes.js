function registerReportRoutes(app, deps) {
  const {
    ensureAuth,
    getCurrentMonthKey,
    isIsoDate,
    all,
    get,
    PDFDocument,
    monthLabel,
    currency
  } = deps;

  app.get("/reports/monthly.csv", ensureAuth, async (req, res) => {
    const monthKey = String(req.query.month || getCurrentMonthKey());
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();
    const useRange = isIsoDate(startDate) && isIsoDate(endDate);

    if ((startDate || endDate) && !useRange) {
      res.status(400).send("Please provide a valid start and end date in YYYY-MM-DD format.");
      return;
    }

    if (useRange && startDate > endDate) {
      res.status(400).send("Start date must be before or equal to end date.");
      return;
    }

    try {
      const rows = await all(
        useRange
          ? `
            SELECT spent_on, label, category, note, amount
            FROM expenses
            WHERE user_id = ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) >= ?
              AND COALESCE(spent_on, substr(created_at, 1, 10)) <= ?
            ORDER BY COALESCE(spent_on, created_at) DESC
          `
          : `
            SELECT spent_on, label, category, note, amount
            FROM expenses
            WHERE user_id = ? AND month_key = ?
            ORDER BY COALESCE(spent_on, created_at) DESC
          `,
        useRange ? [req.session.userId, startDate, endDate] : [req.session.userId, monthKey]
      );

      const header = "Date,Label,Category,Note,Amount";
      const csvRows = rows.map((row) => {
        const escaped = [row.spent_on || "", row.label || "", row.category || "", row.note || "", Number(row.amount || 0)]
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",");
        return escaped;
      });

      const csvContent = [header, ...csvRows].join("\n");
      res.setHeader("Content-Type", "text/csv");
      const fileSuffix = useRange ? `${startDate}-to-${endDate}` : monthKey;
      res.setHeader("Content-Disposition", `attachment; filename=budget-${fileSuffix}.csv`);
      res.send(csvContent);
    } catch (error) {
      res.status(500).send("Unable to export CSV right now.");
    }
  });

  app.get("/reports/monthly.pdf", ensureAuth, async (req, res) => {
    const monthKey = String(req.query.month || getCurrentMonthKey());
    const startDate = String(req.query.startDate || "").trim();
    const endDate = String(req.query.endDate || "").trim();
    const useRange = isIsoDate(startDate) && isIsoDate(endDate);

    if ((startDate || endDate) && !useRange) {
      res.status(400).send("Please provide a valid start and end date in YYYY-MM-DD format.");
      return;
    }

    if (useRange && startDate > endDate) {
      res.status(400).send("Start date must be before or equal to end date.");
      return;
    }

    try {
      const [totals, rows] = await Promise.all([
        get(
          useRange
            ? `
              SELECT COALESCE(SUM(amount), 0) AS spent
              FROM expenses
              WHERE user_id = ?
                AND COALESCE(spent_on, substr(created_at, 1, 10)) >= ?
                AND COALESCE(spent_on, substr(created_at, 1, 10)) <= ?
            `
            : `
              SELECT mb.total_budget,
                     COALESCE(SUM(e.amount), 0) AS spent
              FROM monthly_budgets mb
              LEFT JOIN expenses e
                ON mb.user_id = e.user_id
               AND mb.month_key = e.month_key
              WHERE mb.user_id = ?
                AND mb.month_key = ?
              GROUP BY mb.total_budget
            `,
          useRange ? [req.session.userId, startDate, endDate] : [req.session.userId, monthKey]
        ),
        all(
          useRange
            ? `
              SELECT spent_on, label, category, amount
              FROM expenses
              WHERE user_id = ?
                AND COALESCE(spent_on, substr(created_at, 1, 10)) >= ?
                AND COALESCE(spent_on, substr(created_at, 1, 10)) <= ?
              ORDER BY COALESCE(spent_on, created_at) DESC
            `
            : `
              SELECT spent_on, label, category, amount
              FROM expenses
              WHERE user_id = ? AND month_key = ?
              ORDER BY COALESCE(spent_on, created_at) DESC
            `,
          useRange ? [req.session.userId, startDate, endDate] : [req.session.userId, monthKey]
        )
      ]);

      const totalBudget = totals ? Number(totals.total_budget || 0) : 0;
      const spent = totals ? Number(totals.spent || 0) : 0;
      const remaining = totalBudget - spent;

      res.setHeader("Content-Type", "application/pdf");
      const fileSuffix = useRange ? `${startDate}-to-${endDate}` : monthKey;
      res.setHeader("Content-Disposition", `attachment; filename=budget-${fileSuffix}.pdf`);

      const doc = new PDFDocument({ margin: 40 });
      doc.pipe(res);
      doc.fontSize(18).text(
        useRange ? `Budget Report - ${startDate} to ${endDate}` : `Budget Report - ${monthLabel(monthKey)}`
      );
      doc.moveDown(0.5);
      doc.fontSize(11).text(`Total Budget: ${currency(totalBudget)}`);
      doc.text(`Spent: ${currency(spent)}`);
      doc.text(`Remaining: ${currency(remaining)}`);
      doc.moveDown(1);
      doc.fontSize(13).text("Expenses", { underline: true });
      doc.moveDown(0.5);

      rows.forEach((row) => {
        const line = `${row.spent_on || "-"} | ${row.label} | ${row.category || "Other"} | ${currency(Number(row.amount || 0))}`;
        doc.fontSize(10).text(line);
      });

      doc.end();
    } catch (error) {
      res.status(500).send("Unable to export PDF right now.");
    }
  });
}

module.exports = registerReportRoutes;
