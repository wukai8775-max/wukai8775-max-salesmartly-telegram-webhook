const officialWebhook = require("./salesmartly-official-webhook");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method Not Allowed",
    });
  }

  return officialWebhook.handleOfficialWebhookBusiness(req, res);
};
