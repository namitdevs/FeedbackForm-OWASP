export default function requireAdminKey(req, res, next) {
  const provided = req.header("x-admin-key");
  const adminKey = process.env.ADMIN_KEY;

  if (!adminKey) {
    return res
      .status(500)
      .json({ error: "Server misconfigured: ADMIN_KEY is not set." });
  }

  if (!provided || provided !== adminKey) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Invalid or missing x-admin-key header." });
  }

  next();
}
