const openBtn = document.getElementById("openExpenseModal");
const openBtnAlt = document.getElementById("openExpenseModalAlt");
const closeBtn = document.getElementById("closeExpenseModal");
const modal = document.getElementById("expenseModal");
const meterFills = document.querySelectorAll(".meter-fill[data-percent]");
const chartsEncoded = document.body ? document.body.dataset.charts : "";
let chartsData = null;

function ensureThemeToggle() {
  const existingToggle = document.getElementById("themeToggle");
  if (existingToggle) {
    return existingToggle;
  }

  const button = document.createElement("button");
  button.id = "themeToggle";
  button.type = "button";
  button.className = "btn-ghost btn-mini theme-toggle";
  document.body.appendChild(button);
  return button;
}

function applyTheme(theme) {
  const normalized = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", normalized);
  const toggle = ensureThemeToggle();
  toggle.textContent = normalized === "dark" ? "Light" : "Dark";
  toggle.setAttribute("aria-label", `Switch to ${normalized === "dark" ? "light" : "dark"} theme`);
}

function initializeTheme() {
  const savedTheme = localStorage.getItem("budgetTheme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const activeTheme = savedTheme || (prefersDark ? "dark" : "light");
  applyTheme(activeTheme);

  const toggle = ensureThemeToggle();
  toggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem("budgetTheme", nextTheme);
    applyTheme(nextTheme);
  });
}

function initializePageTransitions() {
  document.body.classList.add("page-ready");

  document.addEventListener("click", (event) => {
    const anchor = event.target.closest("a[href]");
    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      return;
    }

    if (anchor.target && anchor.target !== "_self") {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const destination = new URL(anchor.href, window.location.origin);
    if (destination.origin !== window.location.origin) {
      return;
    }

    if (destination.href === window.location.href) {
      return;
    }

    event.preventDefault();
    document.body.classList.add("page-leaving");
    window.setTimeout(() => {
      window.location.assign(destination.href);
    }, 140);
  });
}

if (chartsEncoded) {
  try {
    chartsData = JSON.parse(decodeURIComponent(chartsEncoded));
  } catch (error) {
    chartsData = null;
  }
}

initializeTheme();
initializePageTransitions();

function openModal() {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

if (openBtn && closeBtn && modal) {
  openBtn.addEventListener("click", openModal);

  if (openBtnAlt) {
    openBtnAlt.addEventListener("click", openModal);
  }

  closeBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal();
    }
  });
}

if (meterFills.length > 0) {
  meterFills.forEach((meterFill) => {
    const percent = Number(meterFill.dataset.percent || 0);
    const clampedPercent = Math.max(0, Math.min(percent, 100));
    meterFill.style.width = `${clampedPercent}%`;
  });
}

if (chartsData && window.Chart) {
  const spentRemainingCanvas = document.getElementById("chartSpentRemaining");
  const categoryCanvas = document.getElementById("chartCategory");
  const trendCanvas = document.getElementById("chartTrend");

  if (spentRemainingCanvas) {
    new Chart(spentRemainingCanvas, {
      type: "doughnut",
      data: {
        labels: ["Spent", "Remaining"],
        datasets: [{
          data: [Number(chartsData.spent || 0), Number(chartsData.remaining || 0)],
          backgroundColor: ["#d65f2f", "#10804b"]
        }]
      }
    });
  }

  if (categoryCanvas) {
    new Chart(categoryCanvas, {
      type: "bar",
      data: {
        labels: chartsData.categoryLabels || [],
        datasets: [{
          label: "Category Spend",
          data: chartsData.categoryValues || [],
          backgroundColor: "#d99b1f"
        }]
      },
      options: {
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }

  if (trendCanvas) {
    new Chart(trendCanvas, {
      type: "line",
      data: {
        labels: chartsData.trendLabels || [],
        datasets: [
          {
            label: "Spent",
            data: chartsData.trendSpentValues || [],
            borderColor: "#cb3b2d",
            backgroundColor: "rgba(203, 59, 45, 0.2)",
            tension: 0.25
          },
          {
            label: "Remaining",
            data: chartsData.trendRemainingValues || [],
            borderColor: "#10804b",
            backgroundColor: "rgba(16, 128, 75, 0.2)",
            tension: 0.25
          }
        ]
      },
      options: {
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
}
