function registerAuthRoutes(app, deps) {
  const {
    authLimiter,
    passwordResetLimiter,
    isValidEmail,
    GOOGLE_AUTH_ENABLED,
    run,
    get,
    bcrypt,
    getAuthErrorMessage,
    createPasswordResetToken,
    getBaseUrl,
    crypto,
    passport,
    ensureAuth
  } = deps;

  app.get("/register", (req, res) => {
    res.render("register", { error: "", email: "", fullName: "", googleAuthEnabled: GOOGLE_AUTH_ENABLED });
  });

  app.post("/register", authLimiter, async (req, res) => {
    const fullName = (req.body.fullName || "").trim().slice(0, 80);
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!isValidEmail(email) || !password || password.length < 6) {
      res.status(400).render("register", {
        error: "Enter a valid email and a password with at least 6 characters.",
        email,
        fullName,
        googleAuthEnabled: GOOGLE_AUTH_ENABLED
      });
      return;
    }

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await run(
        "INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?) RETURNING id",
        [email, passwordHash, fullName || null]
      );

      req.session.userId = result.lastID;
      req.session.userEmail = email;
      req.session.userName = fullName || email.split("@")[0];
      req.session.googleConnected = false;
      res.redirect("/app");
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        res.status(409).render("register", {
          error: "This email is already registered. Please log in.",
          email,
          fullName,
          googleAuthEnabled: GOOGLE_AUTH_ENABLED
        });
        return;
      }

      res.status(500).render("register", {
        error: "Something went wrong while creating your account.",
        email,
        fullName,
        googleAuthEnabled: GOOGLE_AUTH_ENABLED
      });
    }
  });

  app.get("/login", (req, res) => {
    const queryError = getAuthErrorMessage(req.query.error || "");
    res.render("login", { error: queryError, email: "", googleAuthEnabled: GOOGLE_AUTH_ENABLED });
  });

  app.post("/login", authLimiter, async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";

    if (!isValidEmail(email) || !password) {
      res.status(400).render("login", {
        error: "Please enter a valid email and password.",
        email,
        googleAuthEnabled: GOOGLE_AUTH_ENABLED
      });
      return;
    }

    try {
      const user = await get("SELECT * FROM users WHERE email = ?", [email]);

      if (!user) {
        res.status(401).render("login", {
          error: "Invalid email or password.",
          email,
          googleAuthEnabled: GOOGLE_AUTH_ENABLED
        });
        return;
      }

      const isPasswordValid = await bcrypt.compare(password, user.password_hash);

      if (!isPasswordValid) {
        res.status(401).render("login", {
          error: "Invalid email or password.",
          email,
          googleAuthEnabled: GOOGLE_AUTH_ENABLED
        });
        return;
      }

      req.session.userId = user.id;
      req.session.userEmail = user.email;
      req.session.userName = user.full_name || user.email.split("@")[0];
      req.session.googleConnected = Boolean(user.google_id);
      res.redirect("/app");
    } catch (error) {
      res.status(500).render("login", {
        error: "Something went wrong while logging in.",
        email,
        googleAuthEnabled: GOOGLE_AUTH_ENABLED
      });
    }
  });

  app.get("/forgot-password", (req, res) => {
    res.render("forgot-password", {
      error: "",
      info: "",
      email: "",
      resetLink: ""
    });
  });

  app.post("/forgot-password", passwordResetLimiter, async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();

    if (!isValidEmail(email)) {
      res.status(400).render("forgot-password", {
        error: "Please enter a valid email address.",
        info: "",
        email,
        resetLink: ""
      });
      return;
    }

    try {
      const user = await get("SELECT id FROM users WHERE email = ?", [email]);
      let resetLink = "";

      if (user) {
        const { rawToken, tokenHash } = createPasswordResetToken();
        const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();

        await run("DELETE FROM password_reset_tokens WHERE user_id = ?", [user.id]);

        await run(
          "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
          [user.id, tokenHash, expiresAt]
        );

        resetLink = `${getBaseUrl(req)}/reset-password?token=${encodeURIComponent(rawToken)}`;

        // eslint-disable-next-line no-console
        console.log(`Password reset link for ${email}: ${resetLink}`);
      }

      res.render("forgot-password", {
        error: "",
        info: "If an account exists for this email, a reset link has been generated.",
        email: "",
        resetLink: process.env.NODE_ENV === "production" ? "" : resetLink
      });
    } catch (error) {
      res.status(500).render("forgot-password", {
        error: "Unable to process reset request right now.",
        info: "",
        email,
        resetLink: ""
      });
    }
  });

  app.get("/reset-password", async (req, res) => {
    const token = String(req.query.token || "").trim();

    if (!token) {
      res.status(400).render("reset-password", {
        error: "Reset token is missing or invalid.",
        info: "",
        token: ""
      });
      return;
    }

    try {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const tokenRow = await get(
        `
          SELECT id
          FROM password_reset_tokens
          WHERE token_hash = ?
            AND used_at IS NULL
            AND expires_at > NOW()
        `,
        [tokenHash]
      );

      if (!tokenRow) {
        res.status(400).render("reset-password", {
          error: "This reset link is invalid or has expired.",
          info: "",
          token: ""
        });
        return;
      }

      res.render("reset-password", {
        error: "",
        info: "",
        token
      });
    } catch (error) {
      res.status(500).render("reset-password", {
        error: "Unable to verify reset link right now.",
        info: "",
        token: ""
      });
    }
  });

  app.post("/reset-password", passwordResetLimiter, async (req, res) => {
    const token = String(req.body.token || "").trim();
    const password = req.body.password || "";

    if (!token) {
      res.status(400).render("reset-password", {
        error: "Reset token is missing or invalid.",
        info: "",
        token: ""
      });
      return;
    }

    if (password.length < 6) {
      res.status(400).render("reset-password", {
        error: "Password must be at least 6 characters.",
        info: "",
        token
      });
      return;
    }

    try {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const tokenRow = await get(
        `
          SELECT id, user_id
          FROM password_reset_tokens
          WHERE token_hash = ?
            AND used_at IS NULL
            AND expires_at > NOW()
        `,
        [tokenHash]
      );

      if (!tokenRow) {
        res.status(400).render("reset-password", {
          error: "This reset link is invalid or has expired.",
          info: "",
          token: ""
        });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, tokenRow.user_id]);
      await run("UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?", [tokenRow.id]);
      await run(
        "DELETE FROM password_reset_tokens WHERE user_id = ? AND id <> ?",
        [tokenRow.user_id, tokenRow.id]
      );

      res.render("reset-password", {
        error: "",
        info: "Password updated successfully. You can now log in.",
        token: ""
      });
    } catch (error) {
      res.status(500).render("reset-password", {
        error: "Unable to reset password right now.",
        info: "",
        token
      });
    }
  });

  app.get("/auth/google", authLimiter, (req, res, next) => {
    if (!GOOGLE_AUTH_ENABLED) {
      res.redirect("/login?error=google_not_configured");
      return;
    }

    passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
  });

  app.get(
    "/auth/google/callback",
    (req, res, next) => {
      if (!GOOGLE_AUTH_ENABLED) {
        res.redirect("/login?error=google_not_configured");
        return;
      }

      next();
    },
    passport.authenticate("google", {
      failureRedirect: "/login?error=google_auth_failed",
      session: false
    }),
    (req, res) => {
      req.session.userId = req.user.id;
      req.session.userEmail = req.user.email;
      req.session.userName = req.user.full_name || req.user.email.split("@")[0];
      req.session.googleConnected = Boolean(req.user.google_id);
      res.redirect("/app");
    }
  );

  app.post("/logout", ensureAuth, (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error("Session destroy error:", err);
        res.status(500).json({ message: "Logout failed. Please try again." });
        return;
      }
      res.json({ ok: true, csrfToken: req.csrfToken() });
    });
  });
}

module.exports = registerAuthRoutes;
